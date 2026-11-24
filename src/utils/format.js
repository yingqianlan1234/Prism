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
