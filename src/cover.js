// Only upgrade known platform image hosts; never relax the application's CSP.
export function playlistCoverUrl(value) {
 if (typeof value !== 'string' || !value.trim()) return null;
 try {
  const url = new URL(value.trim());
  if (url.protocol === 'http:' && (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net') || url.hostname === 'music.163.com' || url.hostname.endsWith('.music.163.com'))) url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
 } catch { return null; }
}
const SAFE_EMBEDDED_DATA_IMAGE_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_EMBEDDED_DATA_URI_LENGTH = 3_000_000;

export function artworkUrl(value, size) {
 if (typeof value === 'string') {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:')) {
   if (trimmed.length <= MAX_EMBEDDED_DATA_URI_LENGTH && SAFE_EMBEDDED_DATA_IMAGE_RE.test(trimmed)) {
    return trimmed;
   }
   return null;
  }
 }
 const safe = playlistCoverUrl(value);
 if (!safe) return null;
 const url = new URL(safe);
 const isNetease = url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net') || url.hostname === 'music.163.com' || url.hostname.endsWith('.music.163.com');
 if (isNetease && !url.search && [80,100,500,800].includes(size)) url.searchParams.set('param', `${size}y${size}`);
 if (url.hostname === 'y.gtimg.cn' && !url.search && [500, 800].includes(size)) {
  const match = url.pathname.match(/^\/music\/photo_new\/T002R300x300M000([A-Za-z0-9]+)\.jpg$/);
  if (match) url.pathname = `/music/photo_new/T002R${size}x${size}M000${match[1]}.jpg`;
 }
 return url.href;
}
export function songAlbum(song) {
 const legacy = song?.al || {};
 const modern = song?.album || {};
 return {...legacy, ...modern, picUrl: modern.picUrl || legacy.picUrl};
}
// 单一来源：显示层与取色层都走这里，避免字段/规格不一致。
export function coverUrl(song, size) {
 if (!song) return null;
 const raw = song.coverUrl || song.picUrl || songAlbum(song).picUrl;
 return artworkUrl(raw, size);
}
