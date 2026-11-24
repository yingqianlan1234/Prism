import { songAlbum } from '../cover.js';

export const time = n =>
  Number.isFinite(n)
    ? Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0')
    : '0:00';

export const artist = s => (s?.artists || s?.ar || []).map(x => x.name).join(' / ');

export const album = songAlbum;

// 仅在展示层过滤歌词元信息行；不触碰 parseLrc / lyrics / syncLyric。
const LYRIC_META =
  /^\s*(作词|作曲|编曲|制作人|混音|母带|监制|出品|发行|统筹|录音|吉他|贝斯|鼓|和声|OP|SP|词|曲|编)[A-Za-z \/&.]{0,24}[:：]/i;

export const lyricalLines = arr =>
  Array.isArray(arr) ? arr.filter(l => !LYRIC_META.test(l.text || '')) : [];

export const qqLocalHandle = src => {
  try {
    const u = new URL(src);
    return u.protocol === 'http:' &&
      u.hostname === 'prismmedia.localhost' &&
      !u.search &&
      !u.hash &&
      /^\/[a-z0-9]{40}$/i.test(u.pathname)
      ? u.pathname.slice(1)
      : null;
  } catch {
    return null;
  }
};

// 深夜电台低饱和漫反射策展色：无封面或取色失败时按曲目稳定映射。
const accentPalette = ['#F2A65A', '#73B3E6', '#E5947E', '#7BC9B5', '#B9A3E3', '#E8BD6B'];

export const accentFor = s => {
  if (!s) return accentPalette[0];
  let n = 2166136261;
  for (const c of `${s.provider}:${s.id}`) {
    n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  }
  return accentPalette[(n >>> 0) % accentPalette.length];
};

// 本地搜索历史：仅保存用户输入关键词，按平台隔离，最多保留 8 条。
const HISTORY_KEY_PREFIX = 'prism.searchHistory.';
const MAX_HISTORY = 8;

export function loadSearchHistory(provider) {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_KEY_PREFIX + provider);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string' && item.trim()).slice(0, MAX_HISTORY)
      : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(provider, term) {
  const clean = typeof term === 'string' ? term.trim() : '';
  if (!clean) return loadSearchHistory(provider);
  const next = [clean, ...loadSearchHistory(provider).filter(item => item !== clean)].slice(
    0,
    MAX_HISTORY
  );
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY_PREFIX + provider, JSON.stringify(next));
  } catch {}
  return next;
}

export function removeSearchHistory(provider, term) {
  const next = loadSearchHistory(provider).filter(item => item !== term);
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY_PREFIX + provider, JSON.stringify(next));
  } catch {}
  return next;
}

export function clearSearchHistory(provider) {
  try {
    globalThis.localStorage?.removeItem(HISTORY_KEY_PREFIX + provider);
  } catch {}
  return [];
}

// 网易云音质档位与显示标签（默认 standard）
export const NETEASE_QUALITIES = [
  { id: 'standard', label: '标准', short: '标准' },
  { id: 'exhigh', label: '极高', short: '极高' },
  { id: 'lossless', label: '无损', short: '无损 SQ' },
  { id: 'hires', label: 'Hi-Res', short: 'Hi-Res' },
];

export const QUALITY_LABELS = Object.freeze({
  standard: '标准',
  exhigh: '极高',
  lossless: '无损 SQ',
  hires: 'Hi-Res',
});

const QUALITY_STORAGE_KEY = 'prism.netease.quality';
const VALID_QUALITIES = new Set(NETEASE_QUALITIES.map(q => q.id));

export function loadNeteaseQuality() {
  try {
    const raw = globalThis.localStorage?.getItem(QUALITY_STORAGE_KEY);
    return VALID_QUALITIES.has(raw) ? raw : 'standard';
  } catch {
    return 'standard';
  }
}

export function saveNeteaseQuality(level) {
  const safe = VALID_QUALITIES.has(level) ? level : 'standard';
  try {
    globalThis.localStorage?.setItem(QUALITY_STORAGE_KEY, safe);
  } catch {}
  return safe;
}

export function formatBitrate(br) {
  const n = Number(br);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.round(n / 1000)} kbps`;
}

export function isOwnedPlaylist(playlist, userId) {
  if (!playlist || userId == null) return false;
  const owner = playlist.creator?.userId ?? playlist.userId;
  if (owner != null && owner !== '') return String(owner) === String(userId);
  return playlist.subscribed === false;
}

export function providerLabel(id) {
  if (id === 'netease') return '网易云';
  if (id === 'qqmusic') return 'QQ 音乐';
  if (id === 'local') return '本地音乐';
  return '';
}

// P2-A 全局系统快捷键与桌面悬浮歌词纯常量与格式工具
export const SHORTCUT_MODIFIERS = ['Ctrl+Alt', 'Ctrl+Shift'];
export const SHORTCUT_FKEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11'];
const SHORTCUT_LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
export const SHORTCUT_KEY_GROUPS = Object.freeze([
  Object.freeze({
    label: '方向与空格',
    items: Object.freeze([
      Object.freeze({ value: 'Left', label: '← 左方向' }),
      Object.freeze({ value: 'Right', label: '→ 右方向' }),
      Object.freeze({ value: 'Up', label: '↑ 上方向' }),
      Object.freeze({ value: 'Down', label: '↓ 下方向' }),
      Object.freeze({ value: 'Space', label: 'Space 空格' }),
    ]),
  }),
  Object.freeze({
    label: '字母键 A–Z',
    items: Object.freeze(SHORTCUT_LETTERS.map(ch => Object.freeze({ value: ch, label: ch }))),
  }),
  Object.freeze({
    label: '功能键 F1–F11',
    items: Object.freeze(SHORTCUT_FKEYS.map(fk => Object.freeze({ value: fk, label: fk }))),
  }),
]);
export const SHORTCUT_ALL_KEYS = new Set(
  SHORTCUT_KEY_GROUPS.flatMap(group => group.items.map(item => item.value))
);

export const SHORTCUT_ACTIONS = Object.freeze([
  Object.freeze({ id: 'togglePlayback', label: '播放 / 暂停', defaultKey: 'Ctrl+Alt+P' }),
  Object.freeze({ id: 'prevTrack', label: '上一首', defaultKey: 'Ctrl+Alt+Left' }),
  Object.freeze({ id: 'nextTrack', label: '下一首', defaultKey: 'Ctrl+Alt+Right' }),
  Object.freeze({ id: 'volumeUp', label: '增大音量', defaultKey: 'Ctrl+Alt+Up' }),
  Object.freeze({ id: 'volumeDown', label: '减小音量', defaultKey: 'Ctrl+Alt+Down' }),
  Object.freeze({ id: 'toggleDesktopLyric', label: '开关桌面歌词', defaultKey: 'Ctrl+Alt+D' }),
]);

export const DEFAULT_SHORTCUT_BINDINGS = Object.freeze(
  Object.fromEntries(SHORTCUT_ACTIONS.map(item => [item.id, item.defaultKey]))
);

export function parseShortcutBinding(binding) {
  if (typeof binding === 'string') {
    for (const modifier of SHORTCUT_MODIFIERS) {
      const prefix = `${modifier}+`;
      if (binding.startsWith(prefix)) {
        const key = binding.slice(prefix.length);
        if (SHORTCUT_ALL_KEYS.has(key)) {
          return { modifier, key, fkey: key };
        }
      }
    }
  }
  return { modifier: 'Ctrl+Alt', key: 'P', fkey: 'P' };
}

export function formatShortcutBinding(modifier, key) {
  const safeModifier = SHORTCUT_MODIFIERS.includes(modifier) ? modifier : 'Ctrl+Alt';
  const safeKey = SHORTCUT_ALL_KEYS.has(key) ? key : 'P';
  return `${safeModifier}+${safeKey}`;
}

export function findDuplicateShortcutActions(bindings) {
  const seen = new Map();
  const duplicates = new Set();
  for (const { id } of SHORTCUT_ACTIONS) {
    const key = bindings?.[id];
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.add(seen.get(key));
      duplicates.add(id);
    } else {
      seen.set(key, id);
    }
  }
  return duplicates;
}

export function hasTextSelectionShortcutWarning(bindings) {
  for (const { id } of SHORTCUT_ACTIONS) {
    const value = bindings?.[id];
    if (value === 'Ctrl+Shift+Left' || value === 'Ctrl+Shift+Right') return true;
  }
  return false;
}

export function clipLyricField(value, max = 480) {
  if (typeof value !== 'string' || !value) return '';
  const singleLine = value.replace(/[\r\n\t]+/g, ' ').trim();
  const chars = Array.from(singleLine);
  return chars.length > max ? chars.slice(0, max).join('') : singleLine;
}

// P2-B 本地曲目标准化为通用曲目对象
export function normalizeLocalTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: String(raw.id),
    folderId: String(raw.folderId || ''),
    name: raw.title || '未知曲目',
    artists: raw.artist ? [{ name: raw.artist }] : [],
    album: { name: raw.album || '' },
    duration: Number(raw.durationMs) || 0,
    provider: 'local',
    accountId: 'local',
  };
}
