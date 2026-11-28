import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_LIMITS,
  validateFeedbackDraft,
  formatFeedbackEnvLines,
  buildFeedbackCopyText,
} from './feedback.js';

test('validateFeedbackDraft 正确校验长度、类型并清理控制字符', () => {
  assert.equal(FEEDBACK_CATEGORIES.length, 4);
  const badCategory = validateFeedbackDraft({
    category: 'unknown',
    title: '有效标题',
    description: '这是一段超过十个字符的详细描述内容。',
  });
  assert.equal(badCategory.valid, false);

  const shortTitle = validateFeedbackDraft({
    category: 'bug',
    title: 'a',
    description: '这是一段超过十个字符的详细描述内容。',
  });
  assert.equal(shortTitle.valid, false);

  const shortDesc = validateFeedbackDraft({
    category: 'bug',
    title: '有效标题',
    description: '太短了',
  });
  assert.equal(shortDesc.valid, false);

  const longContact = validateFeedbackDraft({
    category: 'feature',
    title: '希望支持新特性',
    description: '希望支持一些好用的新特性，方便平时桌面听歌。',
    contact: 'a'.repeat(FEEDBACK_LIMITS.CONTACT_MAX + 1),
  });
  assert.equal(longContact.valid, false);

  const ok = validateFeedbackDraft({
    category: 'playback',
    title: '  无损播放\t测试  ',
    description: '  第一行描述\r\n第二行描述超过十个字  ',
    contact: '  qq@example.com ',
  });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.normalized, {
    category: 'playback',
    title: '无损播放 测试',
    description: '第一行描述\n第二行描述超过十个字',
    contact: 'qq@example.com',
  });
});

test('formatFeedbackEnvLines 与 buildFeedbackCopyText 输出脱敏环境与完整副本', () => {
  const envLines = formatFeedbackEnvLines({
    appVersion: '1.2.0',
    activeProvider: 'qqmusic',
    neteaseQuality: 'exhigh',
    qqQuality: 'lossless',
    theme: 'night-radio',
  });
  assert.deepEqual(envLines, [
    { label: '应用版本', value: 'Vesper v1.2.0' },
    { label: '当前音频源', value: 'QQ 音乐' },
    { label: '网易云音质', value: '极高' },
    { label: 'QQ 音乐音质', value: '无损 SQ' },
    { label: '当前主题', value: 'night-radio' },
  ]);

  const withEnv = buildFeedbackCopyText({
    category: 'playback',
    title: '切换音质偶发延迟',
    description: '切换到无损之后重载需要两秒左右才开始出声。',
    contact: 'wx_demo',
    includeEnv: true,
    envLines,
  });
  assert(withEnv.includes('分类：播放与音质'));
  assert(withEnv.includes('联系方式：wx_demo'));
  assert(withEnv.includes('- 应用版本：Vesper v1.2.0'));

  const withoutEnv = buildFeedbackCopyText({
    category: 'other',
    title: '纯文本复制',
    description: '不勾选环境信息时不应包含运行环境段落。',
    contact: '',
    includeEnv: false,
    envLines,
  });
  assert(!withoutEnv.includes('运行环境（已脱敏）'));
  assert(!withoutEnv.includes('联系方式：'));
});
