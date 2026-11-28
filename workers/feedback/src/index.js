const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_CATEGORIES = new Map([
  ['bug', { label: 'bug', text: 'Bug 反馈' }],
  ['feature', { label: 'enhancement', text: '功能建议' }],
  ['playback', { label: 'playback', text: '播放与音质' }],
  ['other', { label: 'question', text: '其他' }],
]);
const ALLOWED_PROVIDERS = new Set(['netease', 'qqmusic', 'local']);
const ALLOWED_NETEASE_QUALITIES = new Set(['standard', 'exhigh', 'lossless', 'hires']);
const ALLOWED_QQ_QUALITIES = new Set(['standard', 'exhigh', 'lossless']);

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(status, code, message) {
  return jsonResponse({ ok: false, code, message }, status);
}

function cleanSingleLine(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
}

function cleanMultiline(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();
}

function charCount(value) {
  return [...value].length;
}

function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}

async function readBodyWithLimit(request, limitBytes) {
  const declaredLen = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLen) && declaredLen > limitBytes) {
    return { tooLarge: true, text: '' };
  }
  if (!request.body) {
    return { tooLarge: false, text: '' };
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        try {
          await reader.cancel();
        } catch {}
        return { tooLarge: true, text: '' };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, text: new TextDecoder().decode(merged) };
}

function sanitizeEnv(rawEnv) {
  if (!rawEnv || typeof rawEnv !== 'object' || Array.isArray(rawEnv)) return null;
  const out = {};
  if (typeof rawEnv.appVersion === 'string') {
    const v = cleanSingleLine(rawEnv.appVersion);
    if (v && /^[0-9A-Za-z.+-]{1,32}$/.test(v)) out.appVersion = v;
  }
  if (typeof rawEnv.os === 'string') {
    const os = cleanSingleLine(rawEnv.os);
    if (os && /^[a-z0-9_-]{1,24}$/i.test(os)) out.os = os;
  }
  if (typeof rawEnv.arch === 'string') {
    const arch = cleanSingleLine(rawEnv.arch);
    if (arch && /^[a-z0-9_-]{1,24}$/i.test(arch)) out.arch = arch;
  }
  if (typeof rawEnv.activeProvider === 'string' && ALLOWED_PROVIDERS.has(rawEnv.activeProvider)) {
    out.activeProvider = rawEnv.activeProvider;
  }
  if (
    typeof rawEnv.neteaseQuality === 'string' &&
    ALLOWED_NETEASE_QUALITIES.has(rawEnv.neteaseQuality)
  ) {
    out.neteaseQuality = rawEnv.neteaseQuality;
  }
  if (typeof rawEnv.qqQuality === 'string' && ALLOWED_QQ_QUALITIES.has(rawEnv.qqQuality)) {
    out.qqQuality = rawEnv.qqQuality;
  }
  if (typeof rawEnv.theme === 'string') {
    const theme = cleanSingleLine(rawEnv.theme);
    if (theme && /^[A-Za-z0-9-]{1,32}$/.test(theme)) out.theme = theme;
  }
  return Object.keys(out).length ? out : null;
}

export function validateFeedbackPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: '请求体格式无效' };
  }
  const categoryMeta = ALLOWED_CATEGORIES.get(raw.category);
  if (!categoryMeta) {
    return { ok: false, message: '反馈类型无效' };
  }
  if (typeof raw.title !== 'string' || typeof raw.description !== 'string') {
    return { ok: false, message: '标题与描述必须是文本' };
  }
  const title = cleanSingleLine(raw.title);
  const titleLen = charCount(title);
  if (titleLen < 2 || titleLen > 80) {
    return { ok: false, message: '标题长度需在 2 到 80 个字符之间' };
  }
  const description = cleanMultiline(raw.description);
  const descLen = charCount(description);
  if (descLen < 10 || descLen > 2000) {
    return { ok: false, message: '问题描述需在 10 到 2000 个字符之间' };
  }
  let contact = '';
  if (raw.contact != null) {
    if (typeof raw.contact !== 'string') {
      return { ok: false, message: '联系方式格式无效' };
    }
    contact = cleanSingleLine(raw.contact);
    if (charCount(contact) > 120) {
      return { ok: false, message: '联系方式不能超过 120 个字符' };
    }
  }
  const includeEnv = raw.includeEnv !== false;
  const envData = includeEnv ? sanitizeEnv(raw.env) : null;
  return {
    ok: true,
    data: {
      category: raw.category,
      categoryLabel: categoryMeta.label,
      categoryText: categoryMeta.text,
      title,
      description,
      contact,
      includeEnv,
      env: envData,
    },
  };
}

function buildIssueBody(data) {
  const safeDescription = data.description.replace(/```/g, '\\`\\`\\`');
  const lines = [
    `### 反馈分类`,
    `${data.categoryText} (\`${data.category}\`)`,
    '',
    `### 详细描述`,
    safeDescription,
  ];
  if (data.contact) {
    lines.push('', '### 联系方式', escapeMarkdown(data.contact));
  }
  if (data.includeEnv && data.env) {
    lines.push('', '### 运行环境（已脱敏）');
    const envFields = [
      ['应用版本', data.env.appVersion],
      ['操作系统', data.env.os],
      ['CPU 架构', data.env.arch],
      ['当前音频源', data.env.activeProvider],
      ['网易云音质', data.env.neteaseQuality],
      ['QQ 音乐音质', data.env.qqQuality],
      ['主题预设', data.env.theme],
    ];
    for (const [label, value] of envFields) {
      if (value) lines.push(`- **${label}**: \`${value}\``);
    }
  }
  lines.push('', '---', '*由 Vesper 桌面客户端应用内反馈通道自动提交*');
  return lines.join('\n');
}

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkCacheRateLimit(clientIp, windowSec, maxHits) {
  if (typeof caches === 'undefined' || !caches.default) return { limited: false };
  const ipHash = await sha256Hex(clientIp || 'unknown');
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const keyUrl = `https://rate-limit.internal/vesper-feedback/${ipHash}/${bucket}`;
  const cache = caches.default;
  const cached = await cache.match(keyUrl);
  const count = cached ? Number(await cached.text()) || 0 : 0;
  if (count >= maxHits) {
    return { limited: true, ipHash };
  }
  await cache.put(
    keyUrl,
    new Response(String(count + 1), {
      headers: {
        'Cache-Control': `public, max-age=${windowSec}`,
      },
    })
  );
  return { limited: false, ipHash };
}

export async function handleFeedbackRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ ok: true, service: 'vesper-feedback' }, 200);
  }
  if (url.pathname !== '/api/feedback') {
    return errorResponse(404, 'not_found', '接口不存在');
  }
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed', '仅支持 POST 请求');
  }
  if (request.headers.get('X-Vesper-Client') !== 'vesper-desktop') {
    return errorResponse(400, 'validation', '缺少有效的客户端标识');
  }
  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return errorResponse(400, 'validation', '请求类型必须为 application/json');
  }

  const bodyRead = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (bodyRead.tooLarge) {
    return errorResponse(413, 'validation', '反馈内容超出大小限制');
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyRead.text);
  } catch {
    return errorResponse(400, 'validation', '请求体不是合法的 JSON');
  }

  const validated = validateFeedbackPayload(parsed);
  if (!validated.ok) {
    return errorResponse(400, 'validation', validated.message);
  }

  const windowSec = Math.max(10, Number(env.RATE_LIMIT_WINDOW_SEC) || 60);
  const maxHits = Math.max(1, Number(env.RATE_LIMIT_MAX) || 3);
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateCheck = deps.rateLimiter
    ? await deps.rateLimiter(clientIp, windowSec, maxHits)
    : await checkCacheRateLimit(clientIp, windowSec, maxHits);
  if (rateCheck?.limited) {
    console.log(
      JSON.stringify({
        event: 'feedback_rate_limited',
        category: validated.data.category,
        ipHash: rateCheck.ipHash || 'redacted',
      })
    );
    return errorResponse(429, 'rate_limited', '提交过于频繁，请稍后再试');
  }

  const token = typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN.trim() : '';
  if (!token) {
    console.error(JSON.stringify({ event: 'feedback_misconfigured', reason: 'missing_github_token' }));
    return errorResponse(503, 'misconfigured', '反馈服务暂未完成配置，请先复制内容联系开发者');
  }

  const repo = (env.GITHUB_REPO || 'yingqianlan1234/Vesper').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.error(JSON.stringify({ event: 'feedback_misconfigured', reason: 'invalid_repo' }));
    return errorResponse(503, 'misconfigured', '反馈服务仓库配置无效');
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const issuePayload = {
    title: `[${validated.data.categoryText}] ${validated.data.title}`,
    body: buildIssueBody(validated.data),
    labels: ['feedback', validated.data.categoryLabel],
  };

  let ghResponse;
  try {
    ghResponse = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Vesper-Feedback-Worker/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(issuePayload),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'feedback_github_network_error',
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return errorResponse(502, 'upstream', 'GitHub 反馈通道暂时不可用，请稍后重试');
  }

  if (!ghResponse.ok) {
    try {
      await ghResponse.body?.cancel?.();
    } catch {}
    console.error(
      JSON.stringify({
        event: 'feedback_github_http_error',
        status: ghResponse.status,
      })
    );
    return errorResponse(502, 'upstream', 'GitHub 反馈通道暂时不可用，请稍后重试');
  }

  let issueResult;
  try {
    issueResult = await ghResponse.json();
  } catch {
    return errorResponse(502, 'upstream', 'GitHub 返回响应格式异常');
  }

  const issueNumber = Number(issueResult?.number);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return errorResponse(502, 'upstream', 'GitHub 未返回有效的 Issue 编号');
  }

  console.log(
    JSON.stringify({
      event: 'feedback_created',
      category: validated.data.category,
      issueNumber,
      includeEnv: validated.data.includeEnv,
    })
  );
  return jsonResponse({ ok: true, issueNumber }, 201);
}

export default {
  async fetch(request, env) {
    return handleFeedbackRequest(request, env);
  },
};
