import { useEffect, useRef, useState } from 'react';
import { artist, normalizeLocalTrack } from '../utils/format.js';
import { clearLocalCoverCache, setLocalCoverFetcher } from '../local-cover-cache.js';

/**
 * 封装 P2-B 本地音乐曲库状态、目录管理、分页扫描、队列恢复与内嵌封面 fetcher 生命周期。
 */
export function useLocalLibrary({
  canLocalLibrary,
  canLocalCover,
  capabilities,
  local,
  workRef,
  update,
  songRef,
  pendingPlay,
  setSong,
  setRestoredProgress,
  setLyricStatus,
  loadLyricsFor,
  localSaved,
  errorText,
}) {
  const [localFolders, setLocalFolders] = useState([]);
  const localFoldersRef = useRef([]);
  const [localActiveFolderId, setLocalActiveFolderId] = useState(null);
  const localActiveFolderRef = useRef(null);
  const [localTotal, setLocalTotal] = useState(0);
  const [localHasMore, setLocalHasMore] = useState(false);
  const [localTruncated, setLocalTruncated] = useState(false);
  const [localUnavailableIds, setLocalUnavailableIds] = useState([]);
  const [localBusy, setLocalBusy] = useState(false);
  const localTracksRef = useRef([]);
  const localInitRef = useRef({ started: false, ready: false });

  // 注册或注销本地内嵌封面按需拉取函数
  useEffect(() => {
    if (!canLocalCover) {
      setLocalCoverFetcher(null);
      return undefined;
    }
    const fetcher = id => local.getCover(id);
    setLocalCoverFetcher(fetcher);
    return () => setLocalCoverFetcher(null);
  }, [canLocalCover]);

  const applyLocalView = (
    allTracks,
    folderId = localActiveFolderRef.current,
    term = workRef.current.local.query,
    extraPatch = {}
  ) => {
    const clean = String(term || '').trim().toLowerCase();
    const visible = allTracks.filter(t => {
      if (folderId && t.folderId !== folderId) return false;
      if (!clean) return true;
      const hay = [t.name, artist(t), t.album?.name].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(clean);
    });
    const folderObj = folderId ? localFoldersRef.current.find(f => f.id === folderId) : null;
    update('local', {
      songs: visible,
      query: term ?? '',
      searchQuery: String(term || '').trim(),
      title: folderObj ? folderObj.name : '全部本地歌曲',
      ...extraPatch,
    });
  };

  const loadLocalTracksPage = async ({ offset = 0, limit = 100, append = false } = {}) => {
    const page = await local.getTracks({ offset, limit });
    const items = Array.isArray(page?.tracks)
      ? page.tracks.map(normalizeLocalTrack).filter(Boolean)
      : [];
    let merged;
    if (append) {
      const seen = new Set(localTracksRef.current.map(t => t.id));
      merged = [...localTracksRef.current, ...items.filter(t => !seen.has(t.id))];
    } else {
      merged = items;
    }
    localTracksRef.current = merged;
    setLocalTotal(Number(page?.total) || merged.length);
    setLocalHasMore(Boolean(page?.hasMore));
    applyLocalView(merged, localActiveFolderRef.current, workRef.current.local.query);
    return { page, merged };
  };

  const restoreLocalQueue = async () => {
    if (!capabilities?.local?.persistQueue || !local?.getQueue) return;
    try {
      const savedQueue = await local.getQueue();
      const ids = Array.isArray(savedQueue?.ids) ? savedQueue.ids.map(String) : [];
      if (!ids.length) return;
      const missing = () => ids.some(id => !localTracksRef.current.some(t => t.id === id));
      let hasMore = true;
      while (missing() && hasMore) {
        const res = await loadLocalTracksPage({
          offset: localTracksRef.current.length,
          limit: 200,
          append: true,
        });
        hasMore = Boolean(res.page?.hasMore);
        if (!res.page?.tracks?.length) break;
      }
      const byId = new Map(localTracksRef.current.map(t => [t.id, t]));
      const tracks = ids.map(id => byId.get(id)).filter(Boolean);
      if (!tracks.length) return;
      const savedIdx = Number.isInteger(savedQueue?.index) ? savedQueue.index : 0;
      const index = Math.max(0, Math.min(savedIdx, tracks.length - 1));
      const restoredQueue = {
        source: 'local',
        tracks,
        index,
        provider: 'local',
        accountId: 'local',
      };
      update('local', { queue: restoredQueue });
      if (!songRef.current && !pendingPlay.current) {
        const track = tracks[index];
        const position = Number.isFinite(Number(savedQueue?.position))
          ? Math.max(0, Number(savedQueue.position))
          : 0;
        const duration = (track.duration || 0) / 1000;
        localSaved.current.resume = { id: track.id, position };
        localSaved.current.position = position;
        songRef.current = track;
        setSong(track);
        setRestoredProgress({ position, duration });
        if (capabilities.local?.getLyrics) {
          setLyricStatus('loading');
          loadLyricsFor(
            track,
            () => true,
            () => setLyricStatus('error'),
            local,
            position
          );
        }
        update('local', { message: '已恢复本地播放进度，点击播放继续' });
      }
    } catch {}
  };

  const scanAndReloadLocal = async ({ messageOverride = '' } = {}) => {
    const scanRes = await local.scan();
    clearLocalCoverCache();
    setLocalTruncated(Boolean(scanRes?.truncated));
    const unavailable = Array.isArray(scanRes?.unavailableFolderIds)
      ? scanRes.unavailableFolderIds
      : [];
    setLocalUnavailableIds(unavailable);
    await loadLocalTracksPage({ offset: 0, limit: 100, append: false });
    let statusMsg = messageOverride;
    if (!statusMsg) {
      if (unavailable.length && scanRes?.truncated) {
        statusMsg = '部分文件夹暂不可用，且本地曲库已达到 5,000 首上限';
      } else if (unavailable.length) {
        statusMsg = `有 ${unavailable.length} 个本地文件夹暂不可用，请检查磁盘或路径`;
      } else if (scanRes?.truncated) {
        statusMsg = '本地曲库已达到 5,000 首扫描上限，其余文件未计入';
      }
    }
    update('local', { message: statusMsg });
    return scanRes;
  };

  const initLocalLibrary = async () => {
    if (!canLocalLibrary || localInitRef.current.started) return;
    localInitRef.current.started = true;
    setLocalBusy(true);
    try {
      const folders = (await local.getFolders()) || [];
      localFoldersRef.current = folders;
      setLocalFolders(folders);
      if (folders.length > 0) {
        await scanAndReloadLocal();
        await restoreLocalQueue();
      } else {
        localTracksRef.current = [];
        setLocalTotal(0);
        setLocalHasMore(false);
        applyLocalView([], null, '');
      }
      localInitRef.current.ready = true;
    } catch (e) {
      localInitRef.current.ready = true;
      update('local', { message: errorText(e) });
    } finally {
      setLocalBusy(false);
    }
  };

  const pickLocalFolder = async () => {
    if (!canLocalLibrary || localBusy) return;
    setLocalBusy(true);
    update('local', { message: '' });
    try {
      const picked = await local.pickFolder();
      if (!picked) return;
      const folders = (await local.getFolders()) || [];
      localFoldersRef.current = folders;
      setLocalFolders(folders);
      await scanAndReloadLocal();
      localInitRef.current.ready = true;
    } catch (e) {
      update('local', { message: errorText(e) });
    } finally {
      setLocalBusy(false);
    }
  };

  const removeLocalFolder = async folderId => {
    if (!canLocalLibrary || localBusy) return;
    setLocalBusy(true);
    try {
      await local.removeFolder(folderId);
      clearLocalCoverCache();
      const folders = (await local.getFolders()) || [];
      localFoldersRef.current = folders;
      setLocalFolders(folders);
      if (localActiveFolderRef.current === folderId) {
        localActiveFolderRef.current = null;
        setLocalActiveFolderId(null);
      }
      if (folders.length > 0) {
        await scanAndReloadLocal();
      } else {
        localTracksRef.current = [];
        setLocalTotal(0);
        setLocalHasMore(false);
        setLocalTruncated(false);
        setLocalUnavailableIds([]);
        applyLocalView([], null, workRef.current.local.query, { message: '' });
      }
    } catch (e) {
      update('local', { message: errorText(e) });
    } finally {
      setLocalBusy(false);
    }
  };

  const scanLocalLibrary = async () => {
    if (!canLocalLibrary || localBusy) return;
    setLocalBusy(true);
    try {
      await scanAndReloadLocal();
    } catch (e) {
      update('local', { message: errorText(e) });
    } finally {
      setLocalBusy(false);
    }
  };

  const selectLocalFolder = folderId => {
    localActiveFolderRef.current = folderId;
    setLocalActiveFolderId(folderId);
    applyLocalView(localTracksRef.current, folderId, workRef.current.local.query);
  };

  const loadMoreLocalTracks = async () => {
    if (!canLocalLibrary || localBusy || !localHasMore) return;
    setLocalBusy(true);
    try {
      await loadLocalTracksPage({
        offset: localTracksRef.current.length,
        limit: 100,
        append: true,
      });
    } catch (e) {
      update('local', { message: errorText(e) });
    } finally {
      setLocalBusy(false);
    }
  };

  return {
    localFolders,
    localFoldersRef,
    localActiveFolderId,
    localActiveFolderRef,
    localTotal,
    localHasMore,
    localTruncated,
    localUnavailableIds,
    localBusy,
    localTracksRef,
    localInitRef,
    applyLocalView,
    initLocalLibrary,
    pickLocalFolder,
    removeLocalFolder,
    scanLocalLibrary,
    selectLocalFolder,
    loadMoreLocalTracks,
  };
}
