import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { cleanTrack, coverForStorage } from '../playback-state.js';
import {
  loadSearchHistory,
  saveSearchHistory,
  clearSearchHistory,
  QUALITY_LABELS,
  loadNeteaseQuality,
  saveNeteaseQuality,
  isOwnedPlaylist,
} from '../utils/format.js';

/**
 * 封装曲库浏览交互：搜索与搜索历史、本地最近播放、歌单详情、推荐、私人 FM、音质档位、红心喜欢与歌单增删曲目。
 */
export function useLibraryBrowse({
  netease,
  getProvider,
  capabilities,
  activeRef,
  workRef,
  update,
  songRef,
  pendingPlay,
  audio,
  listening,
  playback,
  browse,
  identity,
  account,
  recommendation,
  recommendationPending,
  fm,
  fmAutoStartRef,
  saved,
  scheduleSave,
  tagged,
  errorText,
  setView,
  setSong,
  setTrackQuality,
  setPlaying,
  replaceLyrics,
  setLyricStatus,
  setRestoredProgress,
  applyLocalView,
  localTracksRef,
  localActiveFolderRef,
  pickerTrack,
  setPickerTrack,
  pickerBusyId,
  setPickerBusyId,
  setPickerError,
  setActiveCustomPlaylistId,
  play,
}) {
  // 本地搜索历史（按平台隔离）
  const [searchHistory, setSearchHistory] = useState(() => ({
    netease: loadSearchHistory('netease'),
    qqmusic: loadSearchHistory('qqmusic'),
    local: [],
  }));

  // 网易云 P1 增强能力状态：音质档位、红心喜欢集合、FM 跳过、歌单收藏与移出
  const [neteaseQuality, setNeteaseQuality] = useState(() => loadNeteaseQuality());
  const qualityRef = useRef(neteaseQuality);
  const [likedIds, setLikedIds] = useState(() => new Set());
  const [likedBusyIds, setLikedBusyIds] = useState(() => new Set());
  const [fmTrashBusy, setFmTrashBusy] = useState(false);
  const [fmError, setFmError] = useState('');
  const [fmStageFocus, setFmStageFocus] = useState(false);
  const [removingTrackKey, setRemovingTrackKey] = useState(null);

  const recent = useRef({ last: null, chain: Promise.resolve() });
  const [confirmRecent, setConfirmRecent] = useState(false);
  const recentFocus = useRef(null);

  useEffect(() => {
    if (!confirmRecent) return;
    recentFocus.current = document.activeElement;
    const box = document.querySelector('.lw-recent-confirm');
    const buttons = () => Array.from(box?.querySelectorAll('button:not([disabled])') || []);
    box?.querySelector('[data-cancel]')?.focus();
    const trap = e => {
      if (e.key !== 'Tab') return;
      const list = buttons();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === list[list.length - 1]) {
        e.preventDefault();
        list[0].focus();
      }
    };
    box?.addEventListener('keydown', trap);
    return () => {
      box?.removeEventListener('keydown', trap);
      if (recentFocus.current?.isConnected) recentFocus.current.focus();
    };
  }, [confirmRecent]);

  const clearProviderSearchHistory = providerId => {
    setSearchHistory(prev => ({
      ...prev,
      [providerId]: clearSearchHistory(providerId),
    }));
  };

  const resetNeteaseBrowseState = () => {
    setFmError('');
    setFmStageFocus(false);
    setLikedIds(new Set());
    setLikedBusyIds(new Set());
    setFmTrashBusy(false);
    setRemovingTrackKey(null);
  };

  const loadLikedIds = async (token, userId) => {
    if (!capabilities.netease.getLikedSongIds || userId == null) return;
    try {
      const p = await getProvider('netease');
      if (typeof p.getLikedSongIds !== 'function') return;
      const d = await p.getLikedSongIds();
      if (
        !account.current.netease.isCurrent(token) ||
        String(workRef.current.netease.profile?.userId ?? '') !== String(userId)
      )
        return;
      if (Array.isArray(d?.ids)) {
        setLikedIds(new Set(d.ids.map(Number).filter(Number.isFinite)));
      }
    } catch {
      // 红心同步属于附加信息，失败不阻断账号恢复或主列表加载
    }
  };

  const search = async (e, page = 1, explicitTerm = null, explicitType = null) => {
    e?.preventDefault();
    setActiveCustomPlaylistId(null);
    const id = activeRef.current;
    if (id === 'local') {
      const term = explicitTerm != null ? explicitTerm : workRef.current.local.query;
      applyLocalView(localTracksRef.current, localActiveFolderRef.current, term);
      return;
    }
    const w = workRef.current[id];
    if (w.identityUnknown) {
      update(id, { message: '请先刷新账号，确认当前身份' });
      return;
    }
    const q = (explicitTerm != null ? explicitTerm : e ? w.query : w.searchQuery).trim();
    if (!q) return;
    if (explicitTerm != null) update(id, { query: q });
    setSearchHistory(prev => ({ ...prev, [id]: saveSearchHistory(id, q) }));
    recommendationPending.current = false;
    const nextType =
      id === 'netease' && capabilities[id].searchCategories
        ? (explicitType ?? w.searchType ?? 1)
        : 1;
    const safePage = Math.max(1, Number(page) || 1);
    const offset =
      id === 'netease' && capabilities[id].searchPagination
        ? Math.max(0, Math.min(1000, (safePage - 1) * 40))
        : 0;
    const token = browse.current[id].next();
    const generation = identity.current[id].current();
    update(id, {
      message: '正在搜索…',
      searching: true,
      trackOrigin: 'search',
      searchType: nextType,
      qqPlaylist: null,
      qqTrackPage: 0,
    });
    try {
      const p = await getProvider(id);
      let d;
      if (id === 'netease') {
        const opts = {};
        if (offset > 0) opts.offset = offset;
        if (nextType !== 1) opts.searchType = nextType;
        d = await p.search(q, Object.keys(opts).length ? opts : undefined);
      } else {
        d = await p.search(q, { page: safePage, pageSize: 5 });
      }
      if (!browse.current[id].isCurrent(token) || !identity.current[id].isCurrent(generation))
        return;

      if (id === 'netease' && nextType !== 1) {
        const res = d.result || {};
        if (nextType === 10) {
          const items = Array.isArray(res.albums) ? res.albums : [];
          const total = res.albumCount ?? null;
          update(id, {
            songs: [],
            searchItems: items,
            searchTotal: total,
            recommendLists: null,
            title: '搜索专辑：' + q,
            page: safePage,
            searchQuery: q,
            searching: false,
            message: items.length ? '' : '没有找到专辑',
          });
        } else if (nextType === 100) {
          const items = Array.isArray(res.artists) ? res.artists : [];
          const total = res.artistCount ?? null;
          update(id, {
            songs: [],
            searchItems: items,
            searchTotal: total,
            recommendLists: null,
            title: '搜索歌手：' + q,
            page: safePage,
            searchQuery: q,
            searching: false,
            message: items.length ? '' : '没有找到歌手',
          });
        } else if (nextType === 1000) {
          const items = Array.isArray(res.playlists) ? res.playlists : [];
          const total = res.playlistCount ?? null;
          update(id, {
            songs: [],
            searchItems: items,
            searchTotal: total,
            recommendLists: null,
            title: '搜索歌单：' + q,
            page: safePage,
            searchQuery: q,
            searching: false,
            message: items.length ? '' : '没有找到歌单',
          });
        }
        return;
      }

      if (!Array.isArray(d.result?.songs) && d.result?.songCount !== 0)
        throw Error('搜索结果数据不完整');
      const found = tagged(d.result?.songs || [], id, w.profile?.userId || null);
      const total = d.result?.songCount;
      const maxPage = total != null ? Math.min(26, Math.max(1, Math.ceil(total / 40))) : null;
      update(id, {
        songs: found,
        searchItems: [],
        searchTotal: total ?? null,
        recommendLists: null,
        title: '搜索：' + q,
        page: safePage,
        searchQuery: q,
        searching: false,
        message:
          id === 'qqmusic'
            ? found.length
              ? '总数未知，可继续请求下一页'
              : '本页没有找到歌曲'
            : total == null
              ? found.length
                ? `第 ${safePage} 页 · 共 ${found.length} 首`
                : '没有找到歌曲'
              : total > found.length
                ? `共 ${total} 首 · 第 ${safePage}/${maxPage} 页`
                : found.length
                  ? ''
                  : '没有找到歌曲',
      });
    } catch (err) {
      if (browse.current[id].isCurrent(token) && identity.current[id].isCurrent(generation)) {
        update(id, { message: errorText(err), searching: false });
      }
    }
  };

  const openRecent = async () => {
    setActiveCustomPlaylistId(null);
    const id = 'netease';
    const user = workRef.current.netease.profile?.userId;
    if (!user || workRef.current.netease.identityUnknown) return;
    const token = browse.current.netease.next();
    const generation = identity.current.netease.current();
    update(id, {
      title: '本地最近播放',
      songs: [],
      searchItems: [],
      searchTotal: null,
      recommendLists: null,
      trackOrigin: 'recent',
      qqPlaylist: null,
      message: '正在读取本地记录…',
    });
    try {
      const data = await invoke('netease_recent_get', { accountId: String(user) });
      if (!browse.current.netease.isCurrent(token) || !identity.current.netease.isCurrent(generation))
        return;
      const tracks = (data.tracks || []).map(t => ({
        id: t.id,
        name: t.name,
        artists: t.artists.map(name => ({ name })),
        album: { name: t.album, ...(t.coverUrl ? { picUrl: t.coverUrl } : {}) },
        duration: t.duration,
        provider: id,
        accountId: user,
      }));
      update(id, {
        songs: tracks,
        message: tracks.length ? '本地记录，非网易云云端记录' : '暂无本地播放记录',
      });
    } catch {
      if (browse.current.netease.isCurrent(token)) {
        update(id, { message: '本地最近播放读取失败' });
      }
    }
  };

  const recordRecent = () => {
    const current = songRef.current;
    const user = workRef.current.netease.profile?.userId;
    if (
      !current ||
      current.provider !== 'netease' ||
      !user ||
      String(current.accountId) !== String(user)
    )
      return;
    const token = playback.current.current();
    if (recent.current.last?.token === token && recent.current.last?.song === current) return;
    let track;
    try {
      const base = cleanTrack(current);
      const cover = coverForStorage(current);
      track = cover ? { ...base, coverUrl: cover } : base;
    } catch {
      return;
    }
    recent.current.last = { token, song: current };
    const generation = identity.current.netease.current();
    recent.current.chain = recent.current.chain
      .catch(() => {})
      .then(() => {
        if (
          identity.current.netease.isCurrent(generation) &&
          String(workRef.current.netease.profile?.userId) === String(user)
        ) {
          return invoke('netease_recent_add', { accountId: String(user), track });
        }
      })
      .catch(() => {
        if (identity.current.netease.isCurrent(generation)) {
          update('netease', { storageStatus: '本地最近播放保存失败' });
        }
      });
  };

  const clearRecent = () => {
    const user = workRef.current.netease.profile?.userId;
    const generation = identity.current.netease.current();
    setConfirmRecent(false);
    if (!user) return;
    recent.current.chain = recent.current.chain
      .catch(() => {})
      .then(() => {
        if (
          identity.current.netease.isCurrent(generation) &&
          String(workRef.current.netease.profile?.userId) === String(user)
        ) {
          return invoke('netease_recent_clear', { accountId: String(user) });
        }
      })
      .then(() => {
        if (
          identity.current.netease.isCurrent(generation) &&
          workRef.current.netease.trackOrigin === 'recent'
        ) {
          update('netease', { songs: [], message: '暂无本地播放记录' });
        }
      })
      .catch(() => update('netease', { storageStatus: '本地最近播放清空失败' }));
  };

  const openList = async (list, page = 1) => {
    setActiveCustomPlaylistId(null);
    recommendationPending.current = false;
    const id = activeRef.current;
    const w = workRef.current[id];
    if (w.identityUnknown) {
      update(id, { message: '请先刷新账号，确认当前身份' });
      return;
    }
    const token = browse.current[id].next();
    const generation = identity.current[id].current();
    update(id, {
      title: list.name,
      songs: [],
      searchItems: [],
      searchTotal: null,
      recommendLists: null,
      trackOrigin: 'playlist',
      qqPlaylist: list,
      qqTrackPage: page,
      playlistMeta: null,
      message: '正在加载歌单…',
    });
    try {
      const p = await getProvider(id);
      const d = await p.getPlaylistTracks(list.id, { page });
      if (!browse.current[id].isCurrent(token) || !identity.current[id].isCurrent(generation))
        return;
      if (
        !Array.isArray(d.songs) ||
        (id === 'netease' && typeof d.hasMore !== 'boolean') ||
        (id === 'qqmusic' && d.hasMore !== null && typeof d.hasMore !== 'boolean')
      ) {
        throw Error('歌单数据不完整');
      }
      const found = tagged(
        id === 'netease' ? d.songs.slice(0, 100) : d.songs,
        id,
        w.profile?.userId || null
      );
      update(id, {
        songs: found,
        qqPlaylist: list,
        qqTrackPage: page,
        qqHasMore: d.hasMore,
        playlistMeta:
          id === 'netease'
            ? { ...(d.playlist || {}), total: d.total }
            : { coverImgUrl: list.coverImgUrl, total: d.total },
        message:
          id === 'qqmusic'
            ? found.length
              ? ''
              : '本页没有歌曲'
            : d.hasMore
              ? `仅显示本页 ${found.length} 首${d.total != null ? '，共 ' + d.total + ' 首' : ''}`
              : found.length
                ? ''
                : '歌单为空',
      });
    } catch (e) {
      if (browse.current[id].isCurrent(token) && identity.current[id].isCurrent(generation)) {
        update(id, { message: errorText(e) });
      }
    }
  };

  const recommend = async kind => {
    setActiveCustomPlaylistId(null);
    const id = activeRef.current;
    const w = workRef.current[id];
    if (!w || activeRef.current !== id || w.identityUnknown || !w.profile?.userId) return;
    const token = browse.current[id].next();
    const generation = identity.current[id].current();
    const recToken = recommendation.current.next();
    recommendationPending.current = true;
    const names = {
      daily: '每日推荐',
      resources: '为你推荐的歌单',
      playlists: '推荐歌单',
      newsong: '推荐新歌',
    };
    update(id, {
      title: names[kind],
      songs: [],
      searchItems: [],
      searchTotal: null,
      recommendLists: null,
      qqPlaylist: null,
      qqTrackPage: 0,
      trackOrigin: 'recommendation',
      message: '正在加载…',
    });
    try {
      const p = await getProvider(id);
      if (!p.capabilities.getRecommendations || !p.recommendationCapabilities[kind])
        throw Error('该推荐类型暂不支持');
      const d = await p.getRecommendations(kind);
      if (
        !browse.current[id].isCurrent(token) ||
        !identity.current[id].isCurrent(generation) ||
        !recommendation.current.isCurrent(recToken) ||
        activeRef.current !== id
      )
        return;
      recommendationPending.current = false;
      if (!Array.isArray(d.items)) throw Error('推荐数据不完整');
      if (kind === 'daily' || kind === 'newsong') {
        update(id, {
          songs: tagged(d.items, id, w.profile.userId),
          message: d.items.length ? '' : '暂无推荐歌曲',
        });
      } else {
        update(id, {
          recommendLists: d.items,
          message: d.items.length ? '' : '暂无推荐歌单',
        });
      }
    } catch (e) {
      if (
        browse.current[id].isCurrent(token) &&
        identity.current[id].isCurrent(generation) &&
        recommendation.current.isCurrent(recToken) &&
        activeRef.current === id
      ) {
        recommendationPending.current = false;
        update(id, { message: '推荐加载失败：' + errorText(e) });
      }
    }
  };

  const loadFm = async () => {
    const state = fm.current;
    const w = workRef.current.netease;
    if (!w.profile?.userId || w.identityUnknown || state.accountId !== w.profile.userId) return;
    if (state.pending) return state.pending;
    const generation = state.generation;
    state.error = '';
    setFmError('');
    const promise = (async () => {
      try {
        const d = await netease.getPrivateFm();
        if (fm.current !== state || generation !== state.generation) return;
        if (!Array.isArray(d.items)) throw Error('私人 FM 数据不完整');
        const next = tagged(d.items, 'netease', state.accountId).filter(x => {
          if (state.seen.has(x.id)) return false;
          state.seen.add(x.id);
          return true;
        });
        state.tracks.push(...next);
        if (state.tracks.length) {
          saved.current.fm = {
            tracks: [...state.tracks],
            index: Math.min(saved.current.fm?.index ?? 0, state.tracks.length - 1),
            source: 'fm',
            type: 'fm',
            provider: 'netease',
            accountId: state.accountId,
          };
          scheduleSave();
        }
        if (!next.length) state.error = '暂无新歌曲，请稍后重试';
        setFmError(state.error);
        const current = workRef.current.netease;
        const q = current.queue;
        if (q?.type === 'fm' && q.accountId === state.accountId) {
          update('netease', { queue: { ...q, tracks: [...state.tracks] } });
        }
        const autoTarget = fmAutoStartRef.current;
        if (
          autoTarget &&
          autoTarget.accountId === state.accountId &&
          autoTarget.generation === generation &&
          state.tracks.length
        ) {
          fmAutoStartRef.current = null;
          const curSong = songRef.current;
          const curQueue = workRef.current.netease.queue;
          const alreadyPlayingFm =
            curSong?.provider === 'netease' &&
            curQueue?.type === 'fm' &&
            String(curSong.accountId) === String(state.accountId);
          if (!alreadyPlayingFm && !pendingPlay.current) {
            const idx = Math.min(saved.current.fm?.index ?? 0, state.tracks.length - 1);
            const fmQueue = {
              type: 'fm',
              source: 'fm',
              tracks: [...state.tracks],
              index: idx,
              provider: 'netease',
              accountId: state.accountId,
            };
            void play(state.tracks[idx], fmQueue);
          }
        }
      } catch (e) {
        if (fm.current === state) {
          fmAutoStartRef.current = null;
          state.error = '私人 FM 加载失败：' + errorText(e);
          setFmError(state.error);
        }
      } finally {
        if (fm.current === state) state.pending = null;
      }
    })();
    state.pending = promise;
    return promise;
  };

  const retryFm = () => {
    const w = workRef.current.netease;
    if (!w.profile?.userId || w.identityUnknown) return;
    if (!fm.current.tracks.length) {
      fmAutoStartRef.current = {
        accountId: w.profile.userId,
        generation: fm.current.generation,
      };
    }
    if (!fm.current.pending) void loadFm();
  };

  const openFm = () => {
    const w = workRef.current.netease;
    if (!w.profile?.userId || w.identityUnknown) return;
    if (fm.current.accountId !== w.profile.userId) {
      fm.current = {
        accountId: w.profile.userId,
        tracks: [],
        seen: new Set(),
        pending: null,
        error: '',
        generation: fm.current.generation + 1,
      };
      setFmError('');
    }
    setFmStageFocus(true);
    setView('stage');
    const curSong = songRef.current;
    const alreadyPlayingFm =
      curSong?.provider === 'netease' &&
      workRef.current.netease.queue?.type === 'fm' &&
      String(curSong.accountId) === String(w.profile.userId);
    if (alreadyPlayingFm) return;
    if (fm.current.tracks.length) {
      fmAutoStartRef.current = null;
      const idx = Math.min(saved.current.fm?.index ?? 0, fm.current.tracks.length - 1);
      const fmQueue = {
        type: 'fm',
        source: 'fm',
        tracks: [...fm.current.tracks],
        index: idx,
        provider: 'netease',
        accountId: w.profile.userId,
      };
      void play(fm.current.tracks[idx], fmQueue);
    } else {
      fmAutoStartRef.current = {
        accountId: w.profile.userId,
        generation: fm.current.generation,
      };
      if (!fm.current.pending) void loadFm();
    }
  };

  const changeNeteaseQuality = level => {
    const savedLevel = saveNeteaseQuality(level);
    qualityRef.current = savedLevel;
    setNeteaseQuality(savedLevel);
    if (songRef.current?.provider === 'netease') {
      update('netease', {
        message: `已设为${QUALITY_LABELS[savedLevel] || savedLevel}音质，下首歌或重载后生效`,
      });
    }
  };

  const toggleLike = async targetSong => {
    if (!targetSong || targetSong.provider !== 'netease' || !capabilities.netease.likeTrack) return;
    const w = workRef.current.netease;
    if (w.identityUnknown || !w.profile?.userId) {
      update('netease', { message: '请先登录网易云音乐后再操作喜欢' });
      return;
    }
    const numericId = Number(targetSong.id);
    if (!Number.isFinite(numericId) || numericId <= 0 || likedBusyIds.has(numericId)) return;
    const generation = identity.current.netease.current();
    const nextLike = !likedIds.has(numericId);
    setLikedBusyIds(prev => new Set([...prev, numericId]));
    try {
      const p = await getProvider('netease');
      await p.likeTrack(numericId, nextLike);
      if (!identity.current.netease.isCurrent(generation)) return;
      setLikedIds(prev => {
        const next = new Set(prev);
        if (nextLike) next.add(numericId);
        else next.delete(numericId);
        return next;
      });
      update('netease', {
        message: nextLike ? '已加入「我喜欢的音乐」' : '已取消喜欢',
      });
    } catch (err) {
      if (identity.current.netease.isCurrent(generation)) {
        update('netease', { message: errorText(err) });
      }
    } finally {
      setLikedBusyIds(prev => {
        if (!prev.has(numericId)) return prev;
        const next = new Set(prev);
        next.delete(numericId);
        return next;
      });
    }
  };

  const trashCurrentFmTrack = async () => {
    const current = songRef.current;
    if (!current || current.provider !== 'netease' || !capabilities.netease.trashFmTrack) return;
    const w = workRef.current.netease;
    if (w.identityUnknown || !w.profile?.userId || fmTrashBusy) return;
    const queue = w.queue;
    if (!queue || queue.type !== 'fm') return;
    const generation = identity.current.netease.current();
    const fmGen = fm.current.generation;
    const numericId = Number(current.id);
    setFmTrashBusy(true);
    try {
      const p = await getProvider('netease');
      await p.trashFmTrack(numericId);
      if (!identity.current.netease.isCurrent(generation) || fm.current.generation !== fmGen) return;
      const nextTracks = fm.current.tracks.filter(t => Number(t.id) !== numericId);
      fm.current.tracks = nextTracks;
      const curIndex = queue.index ?? 0;
      const nextIdx = Math.min(curIndex, Math.max(0, nextTracks.length - 1));
      const nextQueue = nextTracks.length ? { ...queue, tracks: [...nextTracks], index: nextIdx } : null;
      saved.current.fm = nextQueue;
      update('netease', {
        queue: nextQueue,
      });
      if (nextTracks.length - nextIdx <= 2 && !fm.current.error) void loadFm();
      if (nextQueue && nextTracks[nextIdx]) {
        await play(nextTracks[nextIdx], nextQueue);
      } else {
        listening.current.settle();
        listening.current.clear();
        audio.current.pause();
        audio.current.removeAttribute('src');
        audio.current.load();
        songRef.current = null;
        setSong(null);
        setTrackQuality(null);
        setPlaying(false);
        replaceLyrics([]);
        setLyricStatus('idle');
        setRestoredProgress(null);
        update('netease', { message: '已从私人 FM 移除，正在获取新推荐' });
      }
      scheduleSave(true);
    } catch (err) {
      if (identity.current.netease.isCurrent(generation)) {
        update('netease', { message: errorText(err) });
      }
    } finally {
      setFmTrashBusy(false);
    }
  };

  const addTrackToPlaylist = async playlist => {
    if (!pickerTrack || !playlist || pickerBusyId != null) return;
    const w = workRef.current.netease;
    if (w.identityUnknown || !w.profile?.userId) {
      setPickerError('请先登录网易云音乐');
      return;
    }
    const generation = identity.current.netease.current();
    setPickerBusyId(playlist.id);
    setPickerError('');
    try {
      const p = await getProvider('netease');
      await p.editPlaylistTracks('add', Number(playlist.id), Number(pickerTrack.id));
      if (!identity.current.netease.isCurrent(generation)) return;
      const curList = workRef.current.netease;
      const isViewingTarget =
        curList.trackOrigin === 'playlist' &&
        String(curList.qqPlaylist?.id ?? '') === String(playlist.id);
      update('netease', {
        lists: curList.lists.map(item =>
          String(item.id) === String(playlist.id) && Number.isFinite(Number(item.trackCount))
            ? { ...item, trackCount: Number(item.trackCount) + 1 }
            : item
        ),
        ...(isViewingTarget && curList.playlistMeta?.total != null
          ? {
              playlistMeta: {
                ...curList.playlistMeta,
                total: Number(curList.playlistMeta.total) + 1,
              },
            }
          : {}),
        message: `已收藏到「${playlist.name}」`,
      });
      setPickerTrack(null);
    } catch (err) {
      if (identity.current.netease.isCurrent(generation)) {
        setPickerError(errorText(err));
      }
    } finally {
      setPickerBusyId(null);
    }
  };

  const removeTrackFromCurrentPlaylist = async track => {
    const w = workRef.current.netease;
    if (
      !track ||
      w.identityUnknown ||
      !w.profile?.userId ||
      w.trackOrigin !== 'playlist' ||
      !isOwnedPlaylist(w.qqPlaylist, w.profile.userId)
    )
      return;
    const pid = w.qqPlaylist.id;
    const key = `${pid}:${track.id}`;
    if (removingTrackKey === key) return;
    const generation = identity.current.netease.current();
    setRemovingTrackKey(key);
    try {
      const p = await getProvider('netease');
      await p.editPlaylistTracks('del', Number(pid), Number(track.id));
      if (!identity.current.netease.isCurrent(generation)) return;
      const cur = workRef.current.netease;
      const stillSame =
        cur.trackOrigin === 'playlist' && String(cur.qqPlaylist?.id ?? '') === String(pid);
      update('netease', {
        lists: cur.lists.map(item =>
          String(item.id) === String(pid) && Number(item.trackCount) > 0
            ? { ...item, trackCount: Number(item.trackCount) - 1 }
            : item
        ),
        ...(stillSame
          ? {
              songs: cur.songs.filter(item => Number(item.id) !== Number(track.id)),
              ...(cur.playlistMeta?.total != null
                ? {
                    playlistMeta: {
                      ...cur.playlistMeta,
                      total: Math.max(0, Number(cur.playlistMeta.total) - 1),
                    },
                  }
                : {}),
            }
          : {}),
        message: `已从「${w.qqPlaylist.name}」移出`,
      });
    } catch (err) {
      if (identity.current.netease.isCurrent(generation)) {
        update('netease', { message: errorText(err) });
      }
    } finally {
      setRemovingTrackKey(null);
    }
  };

  return {
    searchHistory,
    clearProviderSearchHistory,
    neteaseQuality,
    qualityRef,
    likedIds,
    likedBusyIds,
    fmTrashBusy,
    fmError,
    setFmError,
    fmStageFocus,
    setFmStageFocus,
    removingTrackKey,
    confirmRecent,
    setConfirmRecent,
    resetNeteaseBrowseState,
    loadLikedIds,
    search,
    openRecent,
    recordRecent,
    clearRecent,
    openList,
    recommend,
    loadFm,
    retryFm,
    openFm,
    changeNeteaseQuality,
    toggleLike,
    trashCurrentFmTrack,
    addTrackToPlaylist,
    removeTrackFromCurrentPlaylist,
  };
}
