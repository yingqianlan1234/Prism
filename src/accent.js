// 一次性离屏封面取色。只读像素，不常驻、不轮询。
// 结果写入根节点 CSS 变量 --lw-a / --lw-on，不进 React state。
const CACHE = new Map(); // url -> {a, on} | 'fail'
const TIMEOUT_MS = 4000;

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function linearToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toHex(L, a, b) {
  const rgb = oklabToLinear(L, a, b).map(v => clamp(linearToSrgb(clamp(v, 0, 1)), 0, 1));
  return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

// 相对亮度决定主色块上的文字色
function onColorFor(hex) {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.36 ? '#101214' : '#FFFFFF';
}

// 量化直方图取主色。分两级亮度门槛：
// 先排除暗部（深色背景往往颜色均匀、更容易在桶数量上压过渐变主体），
// 若严格门槛下没有候选，再放宽，避免整张暗色封面被判为无主色。
function histogram(data, minLuma) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], al = data[i + 3];
    if (al < 128) continue;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < minLuma) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mn > 245) continue;           // 近白
    if (mx - mn < 12) continue;       // 灰度
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(key);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
    else buckets.set(key, { n: 1, r, g, b });
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : null;
}

function dominantPixel(data) {
  return histogram(data, 55) || histogram(data, 25);
}

function clampToSpec(rgb) {
  const lin = rgb.map(v => srgbToLinear(v / 255));
  const [L, a, b] = linearToOklab(lin[0], lin[1], lin[2]);
  const C = Math.hypot(a, b);
  // 黑白封面：低饱和 -> 用 --lw-ink 的 70%，并关闭彩色光晕
  if (C < 0.04) return { a: 'color-mix(in srgb, var(--lw-ink) 70%, transparent)', on: '#101214', monochrome: true };
  const L2 = clamp(L, 0.62, 0.78);
  const C2 = clamp(C, 0.08, 0.20);
  const scale = C === 0 ? 0 : C2 / C;
  const hex = toHex(L2, a * scale, b * scale);
  return { a: hex, on: onColorFor(hex), monochrome: false };
}

export function cachedAccent(url) {
  return CACHE.get(url) || null;
}

// 单次离屏取色；失败/超时返回 null，由调用方回退到哈希策展色。
export function extractAccent(url) {
  const hit = CACHE.get(url);
  if (hit) return Promise.resolve(hit === 'fail' ? null : hit);
  return new Promise(resolve => {
    let settled = false;
    const finish = v => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (v) CACHE.set(url, v); else CACHE.set(url, 'fail');
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        try {
          const size = 64;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: false });
          if (!ctx) return finish(null);
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          const dom = dominantPixel(data);
          finish(dom ? clampToSpec(dom) : null);
        } catch {
          finish(null); // 跨域污染等
        }
      };
      img.onerror = () => finish(null);
      img.src = url;
    } catch {
      finish(null);
    }
  });
}
