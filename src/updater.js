export const DEFAULT_UPDATER_CONFIG = Object.freeze({
  currentVersion: '1.1.0',
  autoCheck: true,
  source: 'github',
  customMirror: '',
  defaultMirror: 'https://gh-proxy.com/',
  skippedVersion: null,
  pubkeyConfigured: false,
});

export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const cleaned = version.trim().replace(/^[vV]/, '');
  if (!cleaned) return null;
  const [core] = cleaned.split(/[+-]/, 1);
  const parts = core.split('.');
  if (parts.length !== 3) return null;
  const nums = parts.map(part => {
    if (!/^\d+$/.test(part)) return NaN;
    return Number(part);
  });
  if (nums.some(n => !Number.isSafeInteger(n) || n < 0)) return null;
  return {
    major: nums[0],
    minor: nums[1],
    patch: nums[2],
    normalized: cleaned,
  };
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

const FEATURE_TAG_RE = /\[(feature|major|important)\]/i;
const PATCH_TAG_RE = /\[(patch|silent|bugfix)\]/i;
const DIRECTIVE_TAG_RE = /\[(feature|major|important|patch|silent|bugfix)\]/gi;

export function classifyUpdateKind(currentVersion, nextVersion, notes = '') {
  const noteText = typeof notes === 'string' ? notes : '';
  if (FEATURE_TAG_RE.test(noteText)) return 'feature';
  if (PATCH_TAG_RE.test(noteText)) return 'patch';
  const cur = parseSemver(currentVersion);
  const next = parseSemver(nextVersion);
  if (!cur || !next) return 'patch';
  if (next.major > cur.major || (next.major === cur.major && next.minor > cur.minor)) {
    return 'feature';
  }
  return 'patch';
}

export function stripUpdateDirectives(notes) {
  if (typeof notes !== 'string') return '';
  return notes
    .replace(DIRECTIVE_TAG_RE, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function parseReleaseNotes(notes) {
  const clean = stripUpdateDirectives(notes);
  if (!clean) return [];
  const rows = [];
  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,4}\s+/.test(line)) {
      const text = line.replace(/^#{1,4}\s+/, '').trim();
      if (text) rows.push({ type: 'heading', text });
    } else if (/^[-*•]\s+/.test(line)) {
      const text = line.replace(/^[-*•]\s+/, '').trim();
      if (text) rows.push({ type: 'item', text });
    } else {
      rows.push({ type: 'text', text: line });
    }
  }
  return rows;
}

export function validateMirrorPrefix(raw) {
  if (typeof raw !== 'string') {
    return { valid: false, normalized: '', error: '镜像地址必须是文本' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, normalized: '', error: '' };
  }
  if (trimmed.length > 256) {
    return { valid: false, normalized: '', error: '自定义镜像地址不能超过 256 个字符' };
  }
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
    return { valid: false, normalized: '', error: '自定义镜像地址不能包含空白或控制字符' };
  }
  if (!trimmed.startsWith('https://')) {
    return { valid: false, normalized: '', error: '自定义镜像地址必须以 https:// 开头' };
  }
  const sample = trimmed.includes('{url}')
    ? trimmed.replaceAll('{url}', 'https://github.com/yingqianlan1234/Vesper/releases/latest/download/latest.json')
    : trimmed;
  let parsed;
  try {
    parsed = new URL(sample);
  } catch {
    return { valid: false, normalized: '', error: '自定义镜像地址格式无效' };
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    return { valid: false, normalized: '', error: '自定义镜像地址格式不受支持' };
  }
  const normalized = trimmed.includes('{url}') || trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  return { valid: true, normalized, error: '' };
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function shouldAutoPromptUpdate({ checkResult, config, dismissedVersions }) {
  if (!checkResult || checkResult.status !== 'available' || !checkResult.version) return false;
  if (config?.skippedVersion && config.skippedVersion === checkResult.version) return false;
  if (dismissedVersions?.has?.(checkResult.version)) return false;
  const kind =
    checkResult.updateKind ||
    classifyUpdateKind(checkResult.currentVersion || config?.currentVersion, checkResult.version, checkResult.notes);
  return kind === 'feature';
}

export function hasUpdateBadge({ updateState, config }) {
  const phase = updateState?.phase;
  if (phase === 'downloading' || phase === 'ready') return true;
  if (phase === 'available') {
    const version = updateState?.info?.version;
    if (!version) return false;
    return config?.skippedVersion !== version;
  }
  return false;
}

export function isSwitchableSourceError(errorCode) {
  return errorCode === 'network' || errorCode === 'timeout' || errorCode === 'upstream';
}

export function buildUpdateSummary({ updateConfig, updateState }) {
  const currentVersion = updateConfig?.currentVersion || DEFAULT_UPDATER_CONFIG.currentVersion;
  const phase = updateState?.phase || 'idle';
  const info = updateState?.info;
  const progress = updateState?.progress;

  if (phase === 'checking') {
    return { currentVersion, badgeText: '检查中…', badgeTone: 'muted', hint: '正在检查应用更新' };
  }
  if (phase === 'downloading') {
    const pct = Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, Math.round(progress.percent))) : 0;
    return {
      currentVersion,
      badgeText: `下载中 ${pct}%`,
      badgeTone: 'accent',
      hint: `正在下载更新 ${pct}%`,
    };
  }
  if (phase === 'ready') {
    const ver = info?.version ? `v${info.version}` : '新版本';
    return {
      currentVersion,
      badgeText: '重启以更新',
      badgeTone: 'ok',
      hint: `${ver} 已就绪，点击重启安装`,
    };
  }
  if (phase === 'available' && info?.version && updateConfig?.skippedVersion !== info.version) {
    return {
      currentVersion,
      badgeText: `新版本 v${info.version}`,
      badgeTone: 'accent',
      hint: `发现新版本 v${info.version}`,
    };
  }
  if (phase === 'up-to-date') {
    return { currentVersion, badgeText: `v${currentVersion} 最新`, badgeTone: 'muted', hint: '' };
  }
  if (phase === 'error') {
    const unconfigured = updateState?.errorCode === 'unconfigured';
    return {
      currentVersion,
      badgeText: unconfigured ? '未配公钥' : '检查失败',
      badgeTone: unconfigured ? 'muted' : 'danger',
      hint: '',
    };
  }
  return { currentVersion, badgeText: `v${currentVersion}`, badgeTone: 'muted', hint: '' };
}
