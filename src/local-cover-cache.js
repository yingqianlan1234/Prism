import { artworkUrl } from './cover.js';

const MAX_CACHE_ENTRIES = 64;
const MAX_CONCURRENCY = 3;

const coverCache = new Map(); // trackId -> string | null
const inflight = new Map(); // trackId -> Promise<string | null>
const waitQueue = [];
let activeCount = 0;
let activeFetcher = null;
let cacheEpoch = 0;
const listeners = new Set();

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {}
  }
}

export function setLocalCoverFetcher(fetcher) {
  const next = typeof fetcher === 'function' ? fetcher : null;
  if (activeFetcher === next) return;
  activeFetcher = next;
  notifyListeners();
}

export function getLocalCoverFetcher() {
  return activeFetcher;
}

export function subscribeLocalCoverFetcher(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCachedLocalCover(id) {
  const key = typeof id === 'string' ? id : '';
  if (!key || !coverCache.has(key)) return undefined;
  const val = coverCache.get(key);
  // 刷新 LRU 位置
  coverCache.delete(key);
  coverCache.set(key, val);
  return val;
}

function writeCache(id, value) {
  if (coverCache.has(id)) coverCache.delete(id);
  coverCache.set(id, value);
  while (coverCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = coverCache.keys().next().value;
    coverCache.delete(oldestKey);
  }
}

export function clearLocalCoverCache() {
  cacheEpoch += 1;
  coverCache.clear();
  inflight.clear();
  waitQueue.length = 0;
  notifyListeners();
}

function drainQueue() {
  while (activeCount < MAX_CONCURRENCY && waitQueue.length > 0) {
    const task = waitQueue.shift();
    activeCount += 1;
    task().finally(() => {
      activeCount -= 1;
      drainQueue();
    });
  }
}

export function loadLocalCover(id, fetcher = activeFetcher) {
  const key = typeof id === 'string' ? id : '';
  if (!key || typeof fetcher !== 'function') return Promise.resolve(null);

  const cached = getCachedLocalCover(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = inflight.get(key);
  if (existing) return existing;

  const epochAtStart = cacheEpoch;
  const promise = new Promise(resolve => {
    const run = async () => {
      try {
        const raw = await fetcher(key);
        const safe = typeof raw === 'string' ? artworkUrl(raw) : null;
        if (epochAtStart === cacheEpoch) {
          writeCache(key, safe || null);
        }
        resolve(safe || null);
      } catch {
        // 失败时不永久缓存 null，允许后续重试
        resolve(null);
      } finally {
        if (inflight.get(key) === promise) {
          inflight.delete(key);
        }
      }
    };
    waitQueue.push(run);
    drainQueue();
  });

  inflight.set(key, promise);
  return promise;
}
