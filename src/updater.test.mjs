import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_UPDATER_CONFIG,
  parseSemver,
  compareSemver,
  classifyUpdateKind,
  stripUpdateDirectives,
  parseReleaseNotes,
  validateMirrorPrefix,
  formatBytes,
  shouldAutoPromptUpdate,
  hasUpdateBadge,
  isSwitchableSourceError,
  buildUpdateSummary,
} from './updater.js';

test('parseSemver 与 compareSemver 正确解析并比较版本号', () => {
  assert.deepEqual(parseSemver('v1.2.3-beta.1'), {
    major: 1,
    minor: 2,
    patch: 3,
    normalized: '1.2.3-beta.1',
  });
  assert.equal(parseSemver('invalid'), null);
  assert.equal(parseSemver('1.2'), null);
  assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  assert.equal(compareSemver('v1.1.0', '1.1.0'), 0);
  assert.equal(compareSemver('1.1.0', '2.0.0'), -1);
});

test('classifyUpdateKind 按显式标记优先与语义化版本分流', () => {
  assert.equal(classifyUpdateKind('1.1.0', '1.1.1', ''), 'patch');
  assert.equal(classifyUpdateKind('1.1.0', '1.2.0', ''), 'feature');
  assert.equal(classifyUpdateKind('1.1.0', '2.0.0', ''), 'feature');
  assert.equal(classifyUpdateKind('1.1.0', '1.1.1', '[feature]\n支持在线更新'), 'feature');
  assert.equal(classifyUpdateKind('1.1.0', '1.2.0', '[PATCH] 静默发布'), 'patch');
  assert.equal(classifyUpdateKind('1.1.0', '1.2.0', '[silent] 仅后台优化'), 'patch');
});

test('parseReleaseNotes 剥离控制标签并输出纯文本结构', () => {
  const raw = '[feature]\n## 更新亮点\n- 支持双更新源切换\n* 支持后台下载 [patch]\n纯文本说明';
  assert.equal(
    stripUpdateDirectives(raw),
    '## 更新亮点\n- 支持双更新源切换\n* 支持后台下载 \n纯文本说明'
  );
  assert.deepEqual(parseReleaseNotes(raw), [
    { type: 'heading', text: '更新亮点' },
    { type: 'item', text: '支持双更新源切换' },
    { type: 'item', text: '支持后台下载' },
    { type: 'text', text: '纯文本说明' },
  ]);
});

test('validateMirrorPrefix 严格校验自定义镜像前缀', () => {
  assert.deepEqual(validateMirrorPrefix('  '), { valid: true, normalized: '', error: '' });
  assert.deepEqual(validateMirrorPrefix('https://mirror.example.com'), {
    valid: true,
    normalized: 'https://mirror.example.com/',
    error: '',
  });
  assert.deepEqual(validateMirrorPrefix('https://mirror.example.com/proxy?url={url}'), {
    valid: true,
    normalized: 'https://mirror.example.com/proxy?url={url}',
    error: '',
  });
  for (const bad of [
    'http://insecure.example.com/',
    'https://user:pass@mirror.example.com/',
    'https://mirror.example.com/ has space',
    `https://mirror.example.com/${'a'.repeat(250)}`,
  ]) {
    assert.equal(validateMirrorPrefix(bad).valid, false, bad);
  }
});

test('shouldAutoPromptUpdate 与 hasUpdateBadge 遵守 Patch 静默与 Feature 单次提醒', () => {
  const patchResult = { status: 'available', currentVersion: '1.1.0', version: '1.1.1', updateKind: 'patch' };
  const featureResult = { status: 'available', currentVersion: '1.1.0', version: '1.2.0', updateKind: 'feature' };

  assert.equal(
    shouldAutoPromptUpdate({ checkResult: patchResult, config: DEFAULT_UPDATER_CONFIG, dismissedVersions: new Set() }),
    false
  );
  assert.equal(
    shouldAutoPromptUpdate({ checkResult: featureResult, config: DEFAULT_UPDATER_CONFIG, dismissedVersions: new Set() }),
    true
  );
  assert.equal(
    shouldAutoPromptUpdate({
      checkResult: featureResult,
      config: { ...DEFAULT_UPDATER_CONFIG, skippedVersion: '1.2.0' },
      dismissedVersions: new Set(),
    }),
    false
  );
  assert.equal(
    shouldAutoPromptUpdate({
      checkResult: featureResult,
      config: DEFAULT_UPDATER_CONFIG,
      dismissedVersions: new Set(['1.2.0']),
    }),
    false
  );

  assert.equal(
    hasUpdateBadge({ updateState: { phase: 'available', info: patchResult }, config: DEFAULT_UPDATER_CONFIG }),
    true
  );
  assert.equal(
    hasUpdateBadge({
      updateState: { phase: 'available', info: patchResult },
      config: { ...DEFAULT_UPDATER_CONFIG, skippedVersion: '1.1.1' },
    }),
    false
  );
  assert.equal(
    hasUpdateBadge({
      updateState: { phase: 'ready', info: featureResult },
      config: { ...DEFAULT_UPDATER_CONFIG, skippedVersion: '1.2.0' },
    }),
    true
  );
});

test('formatBytes、isSwitchableSourceError 与 buildUpdateSummary 输出一致', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(6 * 1024 * 1024), '6.0 MB');
  assert.equal(isSwitchableSourceError('network'), true);
  assert.equal(isSwitchableSourceError('unconfigured'), false);
  assert.deepEqual(
    buildUpdateSummary({
      updateConfig: DEFAULT_UPDATER_CONFIG,
      updateState: { phase: 'downloading', progress: { percent: 47.6 } },
    }),
    {
      currentVersion: '1.1.0',
      badgeText: '下载中 48%',
      badgeTone: 'accent',
      hint: '正在下载更新 48%',
    }
  );
});
