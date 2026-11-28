import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFeedbackRequest } from './index.js';

function makeRequest(body, { method = 'POST', path = '/api/feedback', headers = {} } = {}) {
  const mergedHeaders = new Headers({
    'Content-Type': 'application/json',
    'X-Vesper-Client': 'vesper-desktop',
    'CF-Connecting-IP': '203.0.113.10',
    ...headers,
  });
  return new Request(`https://feedback.yingqianlan.top${path}`, {
    method,
    headers: mergedHeaders,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const baseEnv = {
  GITHUB_REPO: 'yingqianlan1234/Vesper',
  GITHUB_TOKEN: 'github_pat_fixture_token',
  RATE_LIMIT_WINDOW_SEC: '60',
  RATE_LIMIT_MAX: '3',
};

test('GET /health 返回健康状态', async () => {
  const res = await handleFeedbackRequest(
    new Request('https://feedback.yingqianlan.top/health', { method: 'GET' }),
    baseEnv
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: 'vesper-feedback' });
});

test('POST /api/feedback 合法提交时创建带标签的 GitHub Issue', async () => {
  const captured = [];
  const fetchImpl = async (url, init) => {
    captured.push({ url, init });
    return new Response(JSON.stringify({ number: 42 }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const res = await handleFeedbackRequest(
    makeRequest({
      category: 'playback',
      title: 'QQ 音乐无损切换验证',
      description: '切换到无损档位后，部分老歌会自动降级并提示当前播放音质。',
      contact: 'wx: test_user',
      includeEnv: true,
      env: {
        appVersion: '1.2.0',
        os: 'windows',
        arch: 'x86_64',
        activeProvider: 'qqmusic',
        qqQuality: 'lossless',
        theme: 'night-radio',
        secretCookie: 'should-be-stripped',
      },
    }),
    baseEnv,
    { fetchImpl, rateLimiter: async () => ({ limited: false }) }
  );
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, issueNumber: 42 });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, 'https://api.github.com/repos/yingqianlan1234/Vesper/issues');
  assert.equal(captured[0].init.headers.Authorization, 'Bearer github_pat_fixture_token');
  const ghBody = JSON.parse(captured[0].init.body);
  assert.equal(ghBody.title, '[播放与音质] QQ 音乐无损切换验证');
  assert.deepEqual(ghBody.labels, ['feedback', 'playback']);
  assert(ghBody.body.includes('应用版本'));
  assert(ghBody.body.includes('wx: test\\_user'));
  assert(!ghBody.body.includes('should-be-stripped'));
});

test('includeEnv=false 时不附带运行环境段', async () => {
  let ghBody;
  const res = await handleFeedbackRequest(
    makeRequest({
      category: 'feature',
      title: '希望支持快捷键导出',
      description: '希望可以一键导出当前已绑定的快捷键配置方便多设备使用。',
      includeEnv: false,
      env: { appVersion: '1.2.0' },
    }),
    baseEnv,
    {
      rateLimiter: async () => ({ limited: false }),
      fetchImpl: async (_url, init) => {
        ghBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ number: 7 }), { status: 201 });
      },
    }
  );
  assert.equal(res.status, 201);
  assert(!ghBody.body.includes('运行环境'));
  assert.deepEqual(ghBody.labels, ['feedback', 'enhancement']);
});

test('缺少客户端头、超大请求体或字段不合法均返回 400/413', async () => {
  const noHeader = await handleFeedbackRequest(
    new Request('https://feedback.yingqianlan.top/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'bug',
        title: '测试标题',
        description: '测试描述内容至少十个字符以上。',
      }),
    }),
    baseEnv
  );
  assert.equal(noHeader.status, 400);

  const oversized = await handleFeedbackRequest(
    makeRequest({
      category: 'bug',
      title: '超大包测试',
      description: '字'.repeat(7000),
    }),
    baseEnv
  );
  assert.equal(oversized.status, 413);

  const shortDesc = await handleFeedbackRequest(
    makeRequest({
      category: 'other',
      title: '太短',
      description: '只有几个字',
    }),
    baseEnv
  );
  assert.equal(shortDesc.status, 400);
});

test('触发限流返回 429，缺少 GITHUB_TOKEN 返回 503，上游失败返回 502', async () => {
  const payload = {
    category: 'bug',
    title: '触发限流测试',
    description: '这是一段合法的反馈描述内容，用于测试限流与异常状态码。',
  };
  const limited = await handleFeedbackRequest(makeRequest(payload), baseEnv, {
    rateLimiter: async () => ({ limited: true, ipHash: 'abc' }),
  });
  assert.equal(limited.status, 429);

  const misconfigured = await handleFeedbackRequest(
    makeRequest(payload),
    { ...baseEnv, GITHUB_TOKEN: '' },
    { rateLimiter: async () => ({ limited: false }) }
  );
  assert.equal(misconfigured.status, 503);

  const upstreamErr = await handleFeedbackRequest(makeRequest(payload), baseEnv, {
    rateLimiter: async () => ({ limited: false }),
    fetchImpl: async () => new Response('rate limit', { status: 500 }),
  });
  assert.equal(upstreamErr.status, 502);
});
