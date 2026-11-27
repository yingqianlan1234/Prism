import { coverForStorage, qqCoverForStorage } from './playback-state.js';

export const CUSTOM_PLAYLISTS_STORAGE_KEY = 'vesper.customPlaylists.v1';
export const MAX_CUSTOM_PLAYLISTS = 50;
export const MAX_CUSTOM_PLAYLIST_TRACKS = 1000;
export const MAX_CUSTOM_PLAYLIST_NAME = 40;

const VALID_PROVIDERS = new Set(['netease', 'qqmusic', 'local']);

const cleanText = (value, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const safeArtists = song => {
  const raw = Array.isArray(song?.artists)
    ? song.artists
    : Array.isArray(song?.ar)
      ? song.ar
      : [];
  const list = [];
  for (const item of raw) {
    if (list.length >= 30) break;
    const name = typeof item === 'string' ? item : item?.name;
    const trimmed = cleanText(name, 200);
    if (trimmed) list.push(trimmed);
  }
  return list;
};

const safeAlbumName = song => {
  if (typeof song?.album === 'string') return cleanText(song.album, 300);
  if (song?.album && typeof song.album.name === 'string') return cleanText(song.album.name, 300);
  if (typeof song?.al?.name === 'string') return cleanText(song.al.name, 300);
  return '';
};

const safeCoverUrl = (provider, song) => {
  if (provider === 'netease') {
    const direct = typeof song?.coverUrl === 'string' ? { al: { picUrl: song.coverUrl } } : song;
    return coverForStorage(direct) || null;
  }
  if (provider === 'qqmusic') {
    const direct = typeof song?.coverUrl === 'string' ? { al: { picUrl: song.coverUrl } } : song;
    return qqCoverForStorage(direct) || null;
  }
  return null;
};

const safeMediaMid = raw => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[a-z0-9]{1,64}$/i.test(trimmed) ? trimmed : null;
};

export function customTrackKey(track) {
  if (!track || !VALID_PROVIDERS.has(track.provider)) return '';
  if (track.id == null || track.id === '') return '';
  return `${track.provider}:${String(track.id)}`;
}

export function sanitizeCustomTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const provider = raw.provider;
  if (!VALID_PROVIDERS.has(provider)) return null;

  let id = null;
  if (provider === 'netease') {
    const num = Number(raw.id);
    if (!Number.isSafeInteger(num) || num <= 0 || num > 9_007_199_254_740_991) return null;
    id = num;
  } else if (provider === 'qqmusic') {
    const str = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!/^[a-z0-9]{1,64}$/i.test(str)) return null;
    id = str;
  } else {
    const str = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!str || str.length > 128) return null;
    id = str;
  }

  const name = cleanText(raw.name, 300);
  if (!name) return null;

  const durationRaw = Number(raw.duration ?? raw.dt ?? 0);
  const duration =
    Number.isFinite(durationRaw) && durationRaw >= 0 && durationRaw <= 86_400_000
      ? Math.round(durationRaw)
      : 0;

  const addedAtRaw = Number(raw.addedAt);
  const addedAt = Number.isFinite(addedAtRaw) && addedAtRaw > 0 ? Math.round(addedAtRaw) : Date.now();

  const out = {
    provider,
    id,
    name,
    artists: safeArtists(raw),
    album: safeAlbumName(raw),
    duration,
    addedAt,
  };

  const coverUrl = safeCoverUrl(provider, raw);
  if (coverUrl) out.coverUrl = coverUrl;

  if (provider === 'qqmusic') {
    const mediaMid = safeMediaMid(raw.mediaMid);
    if (mediaMid) out.mediaMid = mediaMid;
  }

  return out;
}

export function normalizeCustomPlaylistName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_CUSTOM_PLAYLIST_NAME);
}

const makePlaylistId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `cp-${globalThis.crypto.randomUUID()}`;
  }
  return `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

function sanitizePlaylistRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanText(raw.id, 80);
  const name = normalizeCustomPlaylistName(raw.name);
  if (!id || !name) return null;

  const seen = new Set();
  const tracks = [];
  if (Array.isArray(raw.tracks)) {
    for (const item of raw.tracks) {
      if (tracks.length >= MAX_CUSTOM_PLAYLIST_TRACKS) break;
      const track = sanitizeCustomTrack(item);
      if (!track) continue;
      const key = customTrackKey(track);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
    }
  }

  const now = Date.now();
  const createdAt = Number.isFinite(Number(raw.createdAt)) && Number(raw.createdAt) > 0
    ? Math.round(Number(raw.createdAt))
    : now;
  const updatedAt = Number.isFinite(Number(raw.updatedAt)) && Number(raw.updatedAt) > 0
    ? Math.round(Number(raw.updatedAt))
    : createdAt;

  return { id, name, createdAt, updatedAt, tracks };
}

export function loadCustomPlaylists(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem?.(CUSTOM_PLAYLISTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.playlists) ? parsed.playlists : null;
    if (!list) return [];
    const seenIds = new Set();
    const out = [];
    for (const item of list) {
      if (out.length >= MAX_CUSTOM_PLAYLISTS) break;
      const pl = sanitizePlaylistRecord(item);
      if (!pl || seenIds.has(pl.id)) continue;
      seenIds.add(pl.id);
      out.push(pl);
    }
    return out;
  } catch {
    return [];
  }
}

export function saveCustomPlaylists(playlists, storage = globalThis?.localStorage) {
  try {
    const payload = {
      version: 1,
      playlists: Array.isArray(playlists) ? playlists.slice(0, MAX_CUSTOM_PLAYLISTS) : [],
    };
    storage?.setItem?.(CUSTOM_PLAYLISTS_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function createCustomPlaylist(playlists, rawName) {
  const list = Array.isArray(playlists) ? playlists : [];
  if (list.length >= MAX_CUSTOM_PLAYLISTS) {
    return { playlists: list, created: null, error: `最多只能创建 ${MAX_CUSTOM_PLAYLISTS} 个本机歌单` };
  }
  const name = normalizeCustomPlaylistName(rawName);
  if (!name) {
    return { playlists: list, created: null, error: '请输入歌单名称' };
  }
  if (list.some(pl => pl.name.toLowerCase() === name.toLowerCase())) {
    return { playlists: list, created: null, error: `已存在同名歌单「${name}」` };
  }
  const now = Date.now();
  const created = {
    id: makePlaylistId(),
    name,
    createdAt: now,
    updatedAt: now,
    tracks: [],
  };
  return { playlists: [created, ...list], created, error: '' };
}

export function renameCustomPlaylist(playlists, playlistId, rawName) {
  const list = Array.isArray(playlists) ? playlists : [];
  const name = normalizeCustomPlaylistName(rawName);
  if (!name) {
    return { playlists: list, renamed: null, error: '请输入歌单名称' };
  }
  if (list.some(pl => pl.id !== playlistId && pl.name.toLowerCase() === name.toLowerCase())) {
    return { playlists: list, renamed: null, error: `已存在同名歌单「${name}」` };
  }
  let renamed = null;
  const next = list.map(pl => {
    if (pl.id !== playlistId) return pl;
    renamed = { ...pl, name, updatedAt: Date.now() };
    return renamed;
  });
  return {
    playlists: next,
    renamed,
    error: renamed ? '' : '未找到目标歌单',
  };
}

export function deleteCustomPlaylist(playlists, playlistId) {
  const list = Array.isArray(playlists) ? playlists : [];
  const next = list.filter(pl => pl.id !== playlistId);
  return { playlists: next, deleted: next.length !== list.length };
}

export function addTrackToCustomPlaylist(playlists, playlistId, rawTrack) {
  const list = Array.isArray(playlists) ? playlists : [];
  const clean = sanitizeCustomTrack(rawTrack);
  if (!clean) {
    return { playlists: list, added: false, duplicate: false, error: '歌曲信息不完整，无法加入' };
  }
  const key = customTrackKey(clean);
  let added = false;
  let duplicate = false;
  let error = '';
  let found = false;

  const next = list.map(pl => {
    if (pl.id !== playlistId) return pl;
    found = true;
    if (pl.tracks.some(item => customTrackKey(item) === key)) {
      duplicate = true;
      return pl;
    }
    if (pl.tracks.length >= MAX_CUSTOM_PLAYLIST_TRACKS) {
      error = `单个本机歌单最多收录 ${MAX_CUSTOM_PLAYLIST_TRACKS} 首曲目`;
      return pl;
    }
    added = true;
    return {
      ...pl,
      updatedAt: Date.now(),
      tracks: [clean, ...pl.tracks],
    };
  });

  if (!found) {
    error = '未找到目标歌单';
  }
  return { playlists: next, added, duplicate, error };
}

export function removeTrackFromCustomPlaylist(playlists, playlistId, targetKey) {
  const list = Array.isArray(playlists) ? playlists : [];
  let removed = false;
  const next = list.map(pl => {
    if (pl.id !== playlistId) return pl;
    const tracks = pl.tracks.filter(item => customTrackKey(item) !== targetKey);
    if (tracks.length !== pl.tracks.length) {
      removed = true;
      return { ...pl, updatedAt: Date.now(), tracks };
    }
    return pl;
  });
  return { playlists: next, removed };
}

const SOURCE_LABELS = {
  netease: '网易云',
  qqmusic: 'qq 音乐',
  local: '本地',
};

export function filterCustomPlaylistTracks(tracks, query) {
  const list = Array.isArray(tracks) ? tracks : [];
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return list;
  return list.filter(track => {
    const name = String(track.name || '').toLowerCase();
    const artists = Array.isArray(track.artists) ? track.artists.join(' / ').toLowerCase() : '';
    const album = String(track.album || '').toLowerCase();
    const source = SOURCE_LABELS[track.provider] || '';
    return name.includes(q) || artists.includes(q) || album.includes(q) || source.includes(q);
  });
}

export function summarizeCustomPlaylistSources(tracks) {
  const counts = { netease: 0, qqmusic: 0, local: 0 };
  for (const track of Array.isArray(tracks) ? tracks : []) {
    if (Object.hasOwn(counts, track.provider)) counts[track.provider] += 1;
  }
  return counts;
}

export function exportCustomPlaylistsJson(playlists) {
  return JSON.stringify(
    {
      version: 1,
      app: 'Vesper',
      exportedAt: new Date().toISOString(),
      playlists: Array.isArray(playlists) ? playlists : [],
    },
    null,
    2
  );
}

export function importCustomPlaylistsJson(rawText, existingPlaylists = []) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { playlists: existingPlaylists, addedPlaylists: 0, addedTracks: 0, error: '备份文件内容为空' };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { playlists: existingPlaylists, addedPlaylists: 0, addedTracks: 0, error: '无法解析备份 JSON 文件' };
  }
  const incomingList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.playlists)
      ? parsed.playlists
      : null;
  if (!incomingList) {
    return { playlists: existingPlaylists, addedPlaylists: 0, addedTracks: 0, error: '备份文件格式不受支持' };
  }

  let next = [...(Array.isArray(existingPlaylists) ? existingPlaylists : [])];
  let addedPlaylists = 0;
  let addedTracks = 0;

  for (const rawPl of incomingList) {
    const pl = sanitizePlaylistRecord(rawPl);
    if (!pl) continue;
    const matchIdx = next.findIndex(
      cur => cur.id === pl.id || cur.name.toLowerCase() === pl.name.toLowerCase()
    );
    if (matchIdx >= 0) {
      const target = next[matchIdx];
      const existingKeys = new Set(target.tracks.map(customTrackKey));
      const merged = [...target.tracks];
      for (const track of pl.tracks) {
        if (merged.length >= MAX_CUSTOM_PLAYLIST_TRACKS) break;
        const key = customTrackKey(track);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          merged.push(track);
          addedTracks += 1;
        }
      }
      if (merged.length !== target.tracks.length) {
        next[matchIdx] = { ...target, updatedAt: Date.now(), tracks: merged };
      }
    } else if (next.length < MAX_CUSTOM_PLAYLISTS) {
      const createdId = next.some(cur => cur.id === pl.id) ? makePlaylistId() : pl.id;
      next = [{ ...pl, id: createdId }, ...next];
      addedPlaylists += 1;
      addedTracks += pl.tracks.length;
    }
  }

  if (!addedPlaylists && !addedTracks && incomingList.length > 0) {
    return {
      playlists: next,
      addedPlaylists: 0,
      addedTracks: 0,
      error: '',
    };
  }
  return { playlists: next, addedPlaylists, addedTracks, error: '' };
}

export function hydrateCustomTrack(track, workspaces = {}) {
  if (!track) return null;
  const provider = track.provider;
  const accountId =
    provider === 'local'
      ? 'local'
      : workspaces?.[provider]?.profile?.userId || null;
  return {
    provider,
    id: track.id,
    name: track.name,
    artists: Array.isArray(track.artists) ? track.artists.map(name => ({ name })) : [],
    ar: Array.isArray(track.artists) ? track.artists.map(name => ({ name })) : [],
    album: track.album || '',
    al: {
      name: track.album || '',
      ...(track.coverUrl ? { picUrl: track.coverUrl } : {}),
    },
    ...(track.coverUrl ? { coverUrl: track.coverUrl } : {}),
    duration: Number(track.duration) || 0,
    ...(track.mediaMid ? { mediaMid: track.mediaMid } : {}),
    accountId,
    customKey: customTrackKey(track),
  };
}
