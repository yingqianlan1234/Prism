import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseLrc, mergeTranslation, mergeRomaji } from '../lyrics.js';
import { installMediaSession, updateMediaSession } from '../media-session.js';
import {
  makePlaybackState,
  restorePlaybackState,
  makeQqPlaybackState,
  restoreQqPlaybackState,
  manualIndex,
  queueMode,
  reorderQueueTracks,
} from '../playback-state.js';
import { qqLocalHandle } from '../utils/format.js';
import { hydrateCustomTrack } from '../custom-playlists.js';
import { createLyricIndexStore } from '../lyric-store.js';

/**
 * 封装唯一 <audio> 播放引擎、失败回滚、跨源队列管理、三源播放状态保存/恢复、
 * 歌词同步与精准唤醒定时器以及 MediaSession 集成。
 */
export function usePlayback({
  getProvider,
  capabilities,
  platformFlavor,
  canLocalLibrary,
  local,
  latestRequest,
  activeProvider,
  activeRef,
  workRef,
  update,
  mixedQueueRef,
  setMixedQueue,
  setView,
  listening,
  diagnosticsOn,
  setLastDiagnostic,
  sampleListening,
  fm,
  fmAutoStartRef,
  identity,
  errorText,
  playbackDepsRef,
}) {
  const [mode, setMode] = useState('sequential');
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const settings = useRef({ mode: 'sequential', volume: 1, muted: false });
  const [playbackRate, setPlaybackRate] = useState(1);

  const saved = useRef({
    normal: null,
    fm: null,
    current: null,
    timer: null,
    chain: Promise.resolve(),
    resume: null,
  });
  const qqSaved = useRef({ queue: null, position: 0, resume: null, cleared: false });
  const localSaved = useRef({ resume: null, position: 0, cleared: false, lastKey: '' });
  const providerSettings = useRef({ netease: null, qqmusic: null, local: null });

  const [song, setSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [restoredProgress, setRestoredProgress] = useState(null);
  const [trackQuality, setTrackQuality] = useState(null);
  const [lyrics, setLyrics] = useState([]);
  const lyricsRef = useRef([]);
  const lyricIndexStoreRef = useRef(null);
  if (!lyricIndexStoreRef.current) lyricIndexStoreRef.current = createLyricIndexStore(-1);
  const lyricIndexStore = lyricIndexStoreRef.current;
  const lyricIndexRef = useRef(-1);
  const [lyricStatus, setLyricStatus] = useState('idle');
  const [showQueue, setShowQueue] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearFocus = useRef(false);

  const audio = useRef(null);
  const songRef = useRef(null);
  const resumedLyric = useRef(null);
  const pendingPlay = useRef(null);
  const rollbackRef = useRef(null);
  const playback = useRef(latestRequest());
  const diagnosticTick = useRef(null);

  const changePlaybackRate = rate => {
    setPlaybackRate(rate);
    if (audio.current) audio.current.playbackRate = rate;
  };

  useEffect(() => {
    if (!showQueue) {
      clearFocus.current = false;
      return;
    }
    if (!confirmClear) {
      if (clearFocus.current) {
        clearFocus.current = false;
        (
          document.querySelector('.lw-clear-queue') || document.querySelector('.queue-header button')
        )?.focus();
      }
      return;
    }
    clearFocus.current = true;
    const box = document.querySelector('.lw-confirm');
    const items = () => Array.from(box?.querySelectorAll('button:not([disabled])') || []);
    box?.querySelector('[data-cancel]')?.focus();
    const trap = e => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const first = items()[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      e.stopPropagation();
    };
    box?.addEventListener('keydown', trap);
    return () => box?.removeEventListener('keydown', trap);
  }, [confirmClear, showQueue]);

  const isPlayInterruptedError = e =>
    e?.name === 'AbortError' ||
    /interrupted by a call to pause|interrupted by a new load request/i.test(String(e?.message || ''));

  const syncLyric = position => {
    let index = -1;
    const list = lyricsRef.current;
    for (let i = 0; i < list.length; i++) {
      if (list[i].at <= position + 0.02) index = i;
    }
    if (index !== lyricIndexRef.current) {
      lyricIndexRef.current = index;
      lyricIndexStore.setIndex(index);
    }
  };

  const replaceLyrics = (items, explicitPosition = null) => {
    lyricsRef.current = items;
    setLyrics(items);
    if (!items.length) {
      lyricIndexRef.current = -1;
      lyricIndexStore.setIndex(-1);
      return;
    }
    const targetPos =
      explicitPosition != null
        ? explicitPosition
        : audio.current && audio.current.readyState >= 1
          ? audio.current.currentTime || 0
          : 0;
    syncLyric(targetPos);
  };

  const saveQq = () => {
    const user = workRef.current.qqmusic.profile?.userId;
    if (!user || workRef.current.qqmusic.identityUnknown) return;
    const current = songRef.current;
    const q = workRef.current.qqmusic.queue;
    if (current?.provider === 'qqmusic' && q) {
      providerSettings.current.qqmusic = { ...settings.current };
      qqSaved.current.cleared = false;
      qqSaved.current.queue = q;
      qqSaved.current.position = qqSaved.current.resume?.position ?? audio.current?.currentTime ?? 0;
    }
    if (!qqSaved.current.queue && !qqSaved.current.cleared) return;
    let state;
    try {
      state = makeQqPlaybackState({
        accountId: user,
        queue: qqSaved.current.queue,
        position: qqSaved.current.position,
        ...(providerSettings.current.qqmusic || settings.current),
      });
    } catch {
      update('qqmusic', { storageStatus: '播放状态无法保存' });
      return;
    }
    const generation = identity.current.qqmusic.current();
    const markCurrent = songRef.current?.provider === 'qqmusic';
    saved.current.chain = saved.current.chain
      .catch(() => {})
      .then(() => {
        if (
          !identity.current.qqmusic.isCurrent(generation) ||
          String(workRef.current.qqmusic.profile?.userId) !== String(user)
        )
          return;
        return invoke('playback_state_save', { state, markCurrent });
      })
      .catch(() => {
        if (identity.current.qqmusic.isCurrent(generation)) {
          update('qqmusic', { storageStatus: '播放状态保存失败' });
        }
      });
  };

  const saveLocalQueue = () => {
    if (
      !canLocalLibrary ||
      !capabilities?.local?.persistQueue ||
      !playbackDepsRef.current.localInitRef?.current?.ready
    )
      return;
    const q = workRef.current.local.queue;
    let payload = null;
    if (q && Array.isArray(q.tracks) && q.tracks.length > 0) {
      const ids = q.tracks.slice(0, 1000).map(t => String(t.id));
      const index = Math.max(0, Math.min(q.index ?? 0, ids.length - 1));
      const a = audio.current;
      const rawPos =
        songRef.current?.provider === 'local'
          ? (localSaved.current.resume?.position ?? a?.currentTime ?? 0)
          : localSaved.current.position;
      const position = Number.isFinite(rawPos)
        ? Math.min(86400, Math.max(0, Math.round(rawPos * 100) / 100))
        : 0;
      localSaved.current.position = position;
      localSaved.current.cleared = false;
      payload = { ids, index, position };
    } else if (localSaved.current.cleared) {
      payload = { ids: [], index: null, position: 0 };
    }
    if (!payload) return;
    const key = JSON.stringify(payload);
    if (localSaved.current.lastKey === key) return;
    localSaved.current.lastKey = key;
    local.setQueue(payload).catch(() => {});
  };

  const saveNow = () => {
    if (mixedQueueRef.current) return;
    saveQq();
    saveLocalQueue();
    const user = workRef.current.netease.profile?.userId;
    if (!user || workRef.current.netease.identityUnknown) return;
    const a = audio.current;
    const current = songRef.current;
    const q = workRef.current.netease.queue;
    if (current?.provider === 'netease' && q) {
      providerSettings.current.netease = { ...settings.current };
      saved.current.current = {
        provider: 'netease',
        kind: q.type === 'fm' ? 'fm' : 'normal',
        index: q.index,
        position: saved.current.resume?.position ?? a?.currentTime ?? 0,
      };
      if (q.type === 'fm') saved.current.fm = { ...q, tracks: [...fm.current.tracks] };
      else saved.current.normal = q;
    }
    let state;
    try {
      state = makePlaybackState({
        accountId: user,
        normalQueue: saved.current.normal,
        fmQueue: saved.current.fm,
        current: saved.current.current,
        ...(providerSettings.current.netease || settings.current),
      });
    } catch {
      update('netease', { storageStatus: '播放状态无法保存' });
      return;
    }
    if (!state) return;
    const generation = identity.current.netease.current();
    const markCurrent = songRef.current?.provider === 'netease';
    saved.current.chain = saved.current.chain
      .catch(() => {})
      .then(() => {
        if (
          !identity.current.netease.isCurrent(generation) ||
          String(workRef.current.netease.profile?.userId) !== String(user)
        )
          return;
        return invoke('playback_state_save', { state, markCurrent });
      })
      .catch(() => {
        if (
          identity.current.netease.isCurrent(generation) &&
          String(workRef.current.netease.profile?.userId) === String(user)
        ) {
          update('netease', { storageStatus: '播放状态保存失败' });
        }
      });
  };

  const scheduleSave = (immediate = false) => {
    if (immediate) {
      if (saved.current.timer) clearTimeout(saved.current.timer);
      saved.current.timer = null;
      saveNow();
      return;
    }
    if (saved.current.timer) return;
    saved.current.timer = setTimeout(() => {
      saved.current.timer = null;
      saveNow();
    }, 3000);
  };

  // 歌词加载：play() 与恢复流程共用；同时合并译文与罗马音
  const loadLyricsFor = (s, isCurrent, onFail, provider, position, prefetched) => {
    if (!s || !capabilities[s.provider]?.getLyrics) return;
    const sameSong = () =>
      songRef.current === s ||
      (!!songRef.current &&
        songRef.current.id === s.id &&
        songRef.current.provider === s.provider &&
        String(songRef.current.accountId ?? '') === String(s.accountId ?? ''));
    const settle = fn => {
      if (!isCurrent() || !sameSong()) return;
      fn();
    };
    const request =
      prefetched ||
      Promise.resolve(provider || getProvider(s.provider))
        .then(p => p.getLyrics(s.id))
        .then(
          data => ({ data }),
          () => ({ failed: true })
        );
    request.then(result =>
      settle(() => {
        if (result.failed) {
          if (onFail) onFail();
          else setLyricStatus('error');
          return;
        }
        const data = result.data;
        const rawLrc = typeof data === 'string' ? data : data?.lrc?.lyric || '';
        const base = parseLrc(rawLrc);
        const withTrans = mergeTranslation(
          base,
          parseLrc(typeof data === 'string' ? '' : data?.tlyric?.lyric || '')
        );
        const parsed = mergeRomaji(
          withTrans,
          parseLrc(typeof data === 'string' ? '' : data?.romalrc?.lyric || '')
        );
        replaceLyrics(parsed, position);
        setLyricStatus(parsed.length ? 'ready' : data?.nolyric ? 'instrumental' : 'empty');
      })
    );
  };

  const restoreSaved = async (user, generation, playToken) => {
    try {
      const result = await invoke('playback_state_load');
      if (
        !identity.current.netease.isCurrent(generation) ||
        String(workRef.current.netease.profile?.userId) !== String(user) ||
        !playback.current.isCurrent(playToken)
      )
        return;
      if (result.status === 'empty') return;
      if (result.status !== 'ok') {
        update('netease', { storageStatus: '播放状态无法恢复' });
        return;
      }
      const state = restorePlaybackState(result.state, user);
      if (!state) return;
      providerSettings.current.netease = {
        mode: state.mode,
        volume: state.volume,
        muted: state.muted,
      };
      if (songRef.current || pendingPlay.current) {
        saved.current.normal = state.normalQueue
          ? { ...state.normalQueue, provider: 'netease', accountId: user }
          : null;
        saved.current.fm = state.fmQueue
          ? { ...state.fmQueue, type: 'fm', provider: 'netease', accountId: user }
          : null;
        if (saved.current.fm) {
          fm.current = {
            accountId: user,
            tracks: [...saved.current.fm.tracks],
            seen: new Set(saved.current.fm.tracks.map(t => t.id)),
            pending: null,
            error: '',
            generation: fm.current.generation + 1,
          };
          playbackDepsRef.current.setFmError?.('');
        }
        saved.current.current = state.current ? { provider: 'netease', ...state.current } : null;
        const queue = state.current?.kind === 'fm' ? saved.current.fm : saved.current.normal;
        if (queue) update('netease', { queue });
        return;
      }
      settings.current = { mode: state.mode, volume: state.volume, muted: state.muted };
      setMode(state.mode);
      setVolume(state.volume);
      setMuted(state.muted);
      audio.current.volume = state.volume;
      audio.current.muted = state.muted;
      saved.current.normal = state.normalQueue
        ? { ...state.normalQueue, provider: 'netease', accountId: user }
        : null;
      saved.current.fm = state.fmQueue
        ? { ...state.fmQueue, type: 'fm', provider: 'netease', accountId: user }
        : null;
      if (saved.current.fm) {
        fm.current = {
          accountId: user,
          tracks: [...saved.current.fm.tracks],
          seen: new Set(saved.current.fm.tracks.map(t => t.id)),
          pending: null,
          error: '',
          generation: fm.current.generation + 1,
        };
        playbackDepsRef.current.setFmError?.('');
      }
      const c = state.current;
      const q = c?.kind === 'fm' ? saved.current.fm : saved.current.normal;
      if (!c || !q) return;
      const track = q.tracks[c.index];
      if (!track) return;
      const snapshot = { ...q, index: c.index };
      saved.current.current = {
        provider: 'netease',
        kind: c.kind,
        index: c.index,
        position: c.position,
      };
      saved.current.resume = { provider: 'netease', id: track.id, position: c.position };
      songRef.current = track;
      setSong(track);
      if (track.provider === 'netease') {
        resumedLyric.current = track;
        loadLyricsFor(
          track,
          () =>
            identity.current.netease.isCurrent(generation) &&
            playback.current.isCurrent(playToken) &&
            String(workRef.current.netease.profile?.userId) === String(user),
          () => setLyricStatus('idle'),
          undefined,
          state.current?.position
        );
      }
      setRestoredProgress({ position: c.position, duration: (track.duration || 0) / 1000 });
      update('netease', { queue: snapshot, message: '已恢复播放状态，点击播放继续' });
    } catch {
      if (identity.current.netease.isCurrent(generation)) {
        update('netease', { storageStatus: '播放状态读取失败' });
      }
    }
  };

  const restoreQq = async (user, generation) => {
    const playToken = playback.current.current();
    try {
      const result = await invoke('playback_state_load', { provider: 'qqmusic' });
      if (
        !identity.current.qqmusic.isCurrent(generation) ||
        !playback.current.isCurrent(playToken) ||
        String(workRef.current.qqmusic.profile?.userId) !== String(user)
      )
        return;
      if (result.status === 'empty') return;
      if (result.status !== 'ok') {
        update('qqmusic', { storageStatus: '播放状态无法恢复' });
        return;
      }
      const state = restoreQqPlaybackState(result.state, user);
      if (
        !state?.queue ||
        songRef.current?.provider === 'qqmusic' ||
        pendingPlay.current?.provider === 'qqmusic'
      )
        return;
      providerSettings.current.qqmusic = {
        mode: state.mode,
        volume: state.volume,
        muted: state.muted,
      };
      qqSaved.current.queue = state.queue;
      qqSaved.current.position = state.position;
      update('qqmusic', { queue: state.queue });
      if (songRef.current || pendingPlay.current) return;
      const track = state.queue.tracks[state.queue.index];
      if (!track) return;
      settings.current = { mode: state.mode, volume: state.volume, muted: state.muted };
      setMode(state.mode);
      setVolume(state.volume);
      setMuted(state.muted);
      audio.current.volume = state.volume;
      audio.current.muted = state.muted;
      qqSaved.current.resume = { id: track.id, position: state.position };
      songRef.current = track;
      setSong(track);
      setRestoredProgress({ position: state.position, duration: (track.duration || 0) / 1000 });
      update('qqmusic', { queue: state.queue, message: '已恢复播放状态，点击播放继续' });
    } catch {
      if (identity.current.qqmusic.isCurrent(generation)) {
        update('qqmusic', { storageStatus: '播放状态读取失败' });
      }
    }
  };

  const clearProviderSavedState = id => {
    if (
      pendingPlay.current?.provider === id ||
      (rollbackRef.current &&
        (rollbackRef.current.song.provider === id || rollbackRef.current.targetProvider === id))
    ) {
      rollbackRef.current = null;
    }
    if (id === 'qqmusic') {
      providerSettings.current.qqmusic = null;
      qqSaved.current.queue = null;
      qqSaved.current.position = 0;
      qqSaved.current.resume = null;
      qqSaved.current.cleared = false;
    }
    if (id === 'netease') {
      resumedLyric.current = null;
      providerSettings.current.netease = null;
      if (saved.current.timer) clearTimeout(saved.current.timer);
      saved.current.timer = null;
      saved.current.normal = null;
      saved.current.fm = null;
      saved.current.current = null;
      saved.current.resume = null;
    }
    if (songRef.current?.provider === id) {
      if (diagnosticsOn.current) setLastDiagnostic(listening.current.diagnosticSnapshot());
      listening.current.clear();
    }
  };

  const stopProviderPlayback = id => {
    if (pendingPlay.current?.provider === id) {
      playback.current.next();
      pendingPlay.current = null;
    }
    if (songRef.current?.provider === id) {
      playback.current.next();
      audio.current.pause();
      audio.current.removeAttribute('src');
      audio.current.load();
      songRef.current = null;
      setSong(null);
      setTrackQuality(null);
      replaceLyrics([]);
      setRestoredProgress(null);
    }
  };

  const play = async (s, queueSnapshot, { autoOpenStage = false } = {}) => {
    const deps = playbackDepsRef.current;
    deps.stopSmoothFade?.({ restoreVolume: false });
    const id = s.provider;
    const w = workRef.current[id];
    const isMixed = queueSnapshot?.type === 'custom';
    let targetSong = s;
    if (isMixed) {
      if (id === 'local') {
        if (!canLocalLibrary) {
          deps.setCustomPlaylistNotice?.('当前环境不支持本地曲库播放');
          return;
        }
        targetSong = { ...s, accountId: 'local' };
      } else if (id === 'netease') {
        if (w.identityUnknown) {
          deps.setCustomPlaylistNotice?.('网易云账号正在验证中，请稍后再试');
          return;
        }
        targetSong = { ...s, accountId: w.profile?.userId || null };
      } else if (id === 'qqmusic') {
        if (w.identityUnknown || (platformFlavor.qqmusic !== 'mock' && !w.profile?.userId)) {
          deps.setCustomPlaylistNotice?.('此歌曲来自 QQ 音乐，请先登录 QQ 音乐后播放');
          return;
        }
        targetSong = { ...s, accountId: w.profile?.userId || null };
      }
    } else if (w.identityUnknown || s.accountId !== (w.profile?.userId || null)) {
      update(id, { message: '账号已变化，请重新浏览歌曲' });
      return;
    }
    if (!capabilities[id].resolvePlayback) {
      const msg =
        id === 'qqmusic' && platformFlavor.qqmusic === 'mock'
          ? 'QQ 音乐模拟模式不支持播放'
          : 'QQ 音乐播放暂不可用';
      if (isMixed) deps.setCustomPlaylistNotice?.(msg);
      else update(id, { message: msg });
      return;
    }
    const snapshot =
      queueSnapshot || {
        source: w.trackOrigin || 'unknown',
        tracks: [...w.songs],
        index: w.songs.findIndex(
          item =>
            item.id === targetSong.id &&
            item.provider === targetSong.provider &&
            item.accountId === targetSong.accountId
        ),
        provider: id,
        accountId: targetSong.accountId,
      };
    if (snapshot.type !== 'fm') {
      fmAutoStartRef.current = null;
      deps.setFmStageFocus?.(false);
    }
    const token = playback.current.next();
    const generation = identity.current[id].current();
    pendingPlay.current = { provider: id, generation };
    const valid = () => playback.current.isCurrent(token) && identity.current[id].isCurrent(generation);
    let prior = rollbackRef.current;
    let trialBanner = '';
    if (isMixed) deps.setCustomPlaylistNotice?.(`正在准备播放「${targetSong.name}」…`);
    else update(id, { message: '正在获取歌曲…' });
    try {
      const p = await getProvider(id);
      const skipResumedLyric =
        !!resumedLyric.current &&
        resumedLyric.current.id === targetSong.id &&
        resumedLyric.current.provider === targetSong.provider &&
        String(resumedLyric.current.accountId ?? '') === String(targetSong.accountId ?? '') &&
        lyricStatus === 'ready';
      resumedLyric.current = null;
      const lyricRequest = skipResumedLyric
        ? null
        : Promise.resolve()
            .then(() => p.getLyrics(targetSong.id))
            .then(
              data => ({ data }),
              () => ({ failed: true })
            );
      const qualityLevel = deps.qualityRef?.current;
      const qqQualityLevel = deps.qqQualityRef?.current;
      const url =
        id === 'netease'
          ? await p.resolvePlayback(
              targetSong.id,
              capabilities[id].playbackQuality && qualityLevel && qualityLevel !== 'standard'
                ? { level: qualityLevel }
                : undefined
            )
          : id === 'local'
            ? await p.resolvePlayback(targetSong.id)
            : await p.resolvePlayback(
                targetSong.id,
                targetSong.mediaMid,
                capabilities[id].playbackQuality && qqQualityLevel && qqQualityLevel !== 'standard'
                  ? { level: qqQualityLevel }
                  : undefined
              );
      if (!valid()) return;
      let streamUrl = '';
      let info = null;
      if (id === 'local') {
        streamUrl = url?.url || '';
        if (!streamUrl) throw Error('未获取到本地音频地址');
        if (url?.contentType?.startsWith('audio/ogg;') && audio.current?.canPlayType(url.contentType) === '') {
          throw Error('当前系统不支持这首 Ogg 音频的编码');
        }
      } else {
        info = url.data?.[0];
        if (!info?.url || (info.code != null && info.code !== 200))
          throw Error('未获取到播放资源，请稍后重试');
        streamUrl = info.url;
      }
      trialBanner = info?.freeTrialInfo ? '当前为试听片段' : '';
      const trial = info?.freeTrialInfo;
      const isTrial = !!(trial && Number(trial.end) > Number(trial.start));
      const nextTrackQuality =
        (id === 'netease' || id === 'qqmusic') && (info?.level || info?.br || isTrial)
          ? {
              level: typeof info.level === 'string' ? info.level : null,
              br: Number.isFinite(Number(info.br)) && Number(info.br) > 0 ? Number(info.br) : null,
              isTrial,
            }
          : null;
      const previousSong = songRef.current;
      if (previousSong && !prior) {
        prior = {
          song: previousSong,
          identity: identity.current[previousSong.provider].current(),
          source: audio.current.getAttribute('src'),
          position: audio.current.currentTime,
          wasPlaying: !audio.current.paused,
          previousQueue: workRef.current[previousSong.provider].queue,
          previousMixedQueue: mixedQueueRef.current,
          targetProvider: id,
          targetQueue: workRef.current[id].queue,
          queuesBefore: {
            netease: workRef.current.netease.queue,
            qqmusic: workRef.current.qqmusic.queue,
            local: workRef.current.local.queue,
          },
          stagedQueues: {},
          settings: { ...settings.current },
          normal: saved.current.normal,
          fm: saved.current.fm,
          current: saved.current.current,
          resume: saved.current.resume,
          qqQueue: qqSaved.current.queue,
          qqPosition: qqSaved.current.position,
          qqResume: qqSaved.current.resume,
          qqCleared: qqSaved.current.cleared,
          localResume: localSaved.current.resume,
          localPosition: localSaved.current.position,
          localCleared: localSaved.current.cleared,
          lyrics: [...lyricsRef.current],
          lyricStatus,
          restoredProgress,
          trackQuality,
        };
      }
      if (prior) rollbackRef.current = prior;
      if (audio.current && !audio.current.paused && audio.current.readyState >= 3) {
        sampleListening(audio.current);
      }
      if (!isMixed || (songRef.current && !mixedQueueRef.current)) saveNow();
      listening.current.settle();
      if (diagnosticsOn.current) setLastDiagnostic(listening.current.diagnosticSnapshot());
      listening.current.start({
        provider: targetSong.provider,
        accountId: targetSong.accountId,
        trackId: targetSong.id,
        source: snapshot.source || 'unknown',
      });
      const resume = isMixed
        ? 0
        : id === 'qqmusic' && qqSaved.current.resume?.id === targetSong.id
          ? qqSaved.current.resume.position
          : id === 'local' && localSaved.current.resume?.id === targetSong.id
            ? localSaved.current.resume.position
            : saved.current.resume?.provider === id && saved.current.resume?.id === targetSong.id
              ? saved.current.resume.position
              : 0;
      if (!isMixed) {
        saved.current.resume = null;
        qqSaved.current.resume = null;
        localSaved.current.resume = null;
      }
      const changeSource = songRef.current?.provider !== id;
      songRef.current = targetSong;
      if (changeSource && !isMixed) {
        const target = providerSettings.current[id];
        if (target) {
          settings.current = { ...target };
          setMode(target.mode);
          setVolume(target.volume);
          setMuted(target.muted);
          audio.current.volume = target.volume;
          audio.current.muted = target.muted;
        } else {
          providerSettings.current[id] = { ...settings.current };
        }
      }
      setSong(targetSong);
      setTrackQuality(nextTrackQuality);
      if (!skipResumedLyric) {
        replaceLyrics([]);
        setLyricStatus('loading');
        loadLyricsFor(targetSong, valid, undefined, p, undefined, lyricRequest);
      }
      diagnosticTick.current = null;
      setRestoredProgress(null);
      if (isMixed) {
        const nextMixed = {
          ...snapshot,
          tracks: snapshot.tracks.map((item, idx) => (idx === snapshot.index ? targetSong : item)),
        };
        mixedQueueRef.current = nextMixed;
        setMixedQueue(nextMixed);
      } else {
        mixedQueueRef.current = null;
        setMixedQueue(null);
        update(id, { queue: snapshot });
        if (prior) prior.stagedQueues[id] = snapshot;
        if (id === 'netease') {
          if (snapshot.type === 'fm') saved.current.fm = snapshot;
          else saved.current.normal = snapshot;
          saved.current.current = {
            provider: 'netease',
            kind: snapshot.type === 'fm' ? 'fm' : 'normal',
            index: snapshot.index,
            position: resume,
          };
        } else if (id === 'local') {
          localSaved.current.position = resume;
          localSaved.current.cleared = false;
        }
        if (snapshot.type === 'fm' && snapshot.tracks.length - snapshot.index <= 2 && !fm.current.error) {
          deps.loadFm?.();
        }
      }
      audio.current.src = streamUrl;
      syncLyric(resume);
      if (playbackRate !== 1) audio.current.playbackRate = playbackRate;
      if (resume > 0) {
        const target = audio.current;
        target.addEventListener(
          'loadedmetadata',
          () => {
            if (valid() && songRef.current === targetSong) {
              try {
                target.currentTime = Math.min(
                  resume,
                  Number.isFinite(target.duration) ? target.duration : resume
                );
              } catch {
                update(id, { message: '无法恢复播放进度' });
              }
            }
          },
          { once: true }
        );
      }
      deps.triggerSmoothFade?.(settings.current.volume);
      await audio.current.play();
      if (!isMixed) scheduleSave(true);
      if (valid()) {
        rollbackRef.current = null;
        if (isMixed) deps.setCustomPlaylistNotice?.(trialBanner);
        else update(id, { message: trialBanner });
        if (autoOpenStage && deps.audioPrefsRef?.current?.autoOpenStageOnPlay !== false) {
          setView('stage');
        }
      }
    } catch (e) {
      deps.stopSmoothFade?.();
      if (valid()) {
        if (isPlayInterruptedError(e)) {
          rollbackRef.current = null;
          setBuffering(false);
          setPlaying(false);
          const curMsg = workRef.current[id].message;
          if (isMixed) {
            deps.setCustomPlaylistNotice?.(trialBanner);
          } else if (trialBanner || curMsg === '正在获取歌曲…') {
            update(id, { message: trialBanner });
          }
          return;
        }
        prior = prior || rollbackRef.current;
        const canRestore =
          prior &&
          rollbackRef.current === prior &&
          identity.current[prior.song.provider].isCurrent(prior.identity) &&
          String(workRef.current[prior.song.provider].profile?.userId || '') ===
            String(prior.song.accountId || '');
        if (canRestore) {
          const failedHandle = qqLocalHandle(audio.current.getAttribute('src'));
          const previousHandle =
            prior.song.provider === 'qqmusic' ? qqLocalHandle(prior.source) : null;
          if (failedHandle && previousHandle && failedHandle !== previousHandle) {
            try {
              await invoke('qq_web_restore_previous', {
                currentHandle: failedHandle,
                previousHandle,
              });
            } catch {
              if (valid()) {
                rollbackRef.current = null;
                if (isMixed) deps.setCustomPlaylistNotice?.('上一首音频会话已失效，请手动重试');
                else update(id, { message: '上一首音频会话已失效，请手动重试' });
              }
              return;
            }
            if (
              !valid() ||
              rollbackRef.current !== prior ||
              !identity.current[prior.song.provider].isCurrent(prior.identity)
            )
              return;
          }
          rollbackRef.current = null;
          audio.current.pause();
          songRef.current = prior.song;
          setSong(prior.song);
          setTrackQuality(prior.trackQuality ?? null);
          settings.current = { ...prior.settings };
          setMode(prior.settings.mode);
          setVolume(prior.settings.volume);
          setMuted(prior.settings.muted);
          audio.current.volume = prior.settings.volume;
          audio.current.muted = prior.settings.muted;
          mixedQueueRef.current = prior.previousMixedQueue ?? null;
          setMixedQueue(prior.previousMixedQueue ?? null);
          saved.current.normal = prior.normal;
          saved.current.fm = prior.fm;
          saved.current.current = prior.current;
          saved.current.resume = prior.resume;
          qqSaved.current.queue = prior.qqQueue;
          qqSaved.current.position = prior.qqPosition;
          qqSaved.current.resume = prior.qqResume;
          qqSaved.current.cleared = prior.qqCleared;
          localSaved.current.resume = prior.localResume ?? null;
          localSaved.current.position = prior.localPosition ?? 0;
          localSaved.current.cleared = prior.localCleared ?? false;
          for (const provider of ['netease', 'qqmusic', 'local']) {
            if (
              prior.stagedQueues[provider] &&
              workRef.current[provider].queue === prior.stagedQueues[provider]
            ) {
              update(provider, { queue: prior.queuesBefore[provider] });
            }
          }
          if (isMixed) deps.setCustomPlaylistNotice?.('新歌曲播放失败，已尝试恢复上一首');
          else update(id, { message: '新歌曲播放失败，已尝试恢复上一首' });
          replaceLyrics(prior.lyrics);
          setLyricStatus(prior.lyricStatus);
          setRestoredProgress(prior.restoredProgress);
          listening.current.start({
            provider: prior.song.provider,
            accountId: prior.song.accountId,
            trackId: prior.song.id,
            source: prior.previousQueue?.source || 'unknown',
          });
          const target = audio.current;
          if (prior.source) {
            target.addEventListener(
              'loadedmetadata',
              () => {
                if (valid() && songRef.current === prior.song) {
                  try {
                    target.currentTime = prior.position;
                  } catch {
                    update(prior.song.provider, { message: '上一首播放位置恢复失败' });
                  }
                }
              },
              { once: true }
            );
            target.src = prior.source;
            if (prior.wasPlaying) {
              target.play().catch(() => {
                if (valid() && songRef.current === prior.song) {
                  update(prior.song.provider, { message: '上一首恢复失败，请手动重试' });
                }
              });
            }
          } else {
            target.removeAttribute('src');
            target.load();
          }
          if (!prior.previousMixedQueue) scheduleSave(true);
        } else {
          const failMsg = '播放失败：' + errorText(e);
          if (isMixed) deps.setCustomPlaylistNotice?.(failMsg);
          else update(id, { message: failMsg });
        }
      }
    } finally {
      if (valid()) pendingPlay.current = null;
      if (id === 'qqmusic' && valid()) void deps.refreshQqDiagnostic?.();
    }
  };

  const skipTrack = delta => {
    const current = songRef.current;
    if (!current) return;
    const mq = mixedQueueRef.current;
    if (
      mq &&
      mq.tracks[mq.index]?.provider === current.provider &&
      mq.tracks[mq.index]?.id === current.id
    ) {
      const idx = manualIndex(settings.current.mode, mq.index, mq.tracks.length, delta);
      if (idx >= 0 && idx < mq.tracks.length) {
        const nextTrack = hydrateCustomTrack(mq.tracks[idx], workRef.current);
        void play(nextTrack, { ...mq, index: idx });
      } else {
        playbackDepsRef.current.setCustomPlaylistNotice?.(delta > 0 ? '暂无下一首' : '暂无上一首');
      }
      return;
    }
    const queue = workRef.current[current.provider].queue;
    if (
      !queue ||
      queue.accountId !== current.accountId ||
      queue.tracks[queue.index]?.id !== current.id
    )
      return;
    const index =
      current.provider === 'qqmusic'
        ? queue.index + delta
        : manualIndex(queueMode(settings.current.mode, queue), queue.index, queue.tracks.length, delta);
    if (index >= 0 && index < queue.tracks.length) {
      play(queue.tracks[index], { ...queue, index });
    } else {
      update(current.provider, { message: delta > 0 ? '暂无下一首' : '暂无上一首' });
    }
  };

  const togglePlayback = () => {
    const current = songRef.current;
    if (!current) return;
    const deps = playbackDepsRef.current;
    if (!audio.current.paused) {
      deps.stopSmoothFade?.();
      audio.current.pause();
      return;
    }
    if (
      (!mixedQueueRef.current &&
        ((saved.current.resume && current.provider === 'netease') ||
          (qqSaved.current.resume && current.provider === 'qqmusic') ||
          (localSaved.current.resume && current.provider === 'local'))) ||
      !audio.current.getAttribute('src')
    ) {
      if (pendingPlay.current) return;
      const q = mixedQueueRef.current || workRef.current[current.provider].queue;
      if (q) play(current, q);
      return;
    }
    deps.triggerSmoothFade?.(settings.current.volume);
    audio.current
      .play()
      .then(() => {
        if (
          songRef.current === current &&
          workRef.current[current.provider].message.startsWith('播放失败：')
        ) {
          update(current.provider, { message: '' });
        }
      })
      .catch(e => {
        deps.stopSmoothFade?.();
        if (songRef.current !== current) return;
        if (isPlayInterruptedError(e)) {
          setBuffering(false);
          return;
        }
        update(current.provider, { message: '播放失败：' + errorText(e) });
      });
  };

  const adjustVolume = delta => {
    const a = audio.current;
    if (!a) return;
    playbackDepsRef.current.stopSmoothFade?.({ restoreVolume: false });
    const next = Math.min(1, Math.max(0, Math.round((a.volume + delta) * 100) / 100));
    a.volume = next;
    if (delta > 0 && a.muted) a.muted = false;
    scheduleSave(true);
  };

  const cycleMode = () => {
    const all =
      (songRef.current?.provider || activeProvider) === 'qqmusic'
        ? ['sequential', 'repeat-one', 'shuffle']
        : ['sequential', 'list-loop', 'repeat-one', 'shuffle'];
    const value = all[(all.indexOf(settings.current.mode) + 1) % all.length];
    settings.current.mode = value;
    setMode(value);
    scheduleSave(true);
  };

  const editQueue = (removeIndex, clear = false) => {
    const id = activeRef.current;
    const q = workRef.current[id].queue;
    if (!q || q.type === 'fm' || q.source === 'fm') return;
    if (pendingPlay.current) {
      update(id, { message: '歌曲切换中，请稍后修改队列' });
      return;
    }
    rollbackRef.current = null;
    const current = songRef.current;
    const removesCurrent = current?.provider === id && (clear || removeIndex === q.index);
    if (pendingPlay.current?.provider === id) {
      playback.current.next();
      pendingPlay.current = null;
    }
    const tracks = clear ? [] : q.tracks.filter((_, index) => index !== removeIndex);
    let next = null;
    if (tracks.length) {
      const index = clear ? 0 : Math.min(q.index - (removeIndex < q.index ? 1 : 0), tracks.length - 1);
      next = { ...q, tracks, index };
    }
    if (removesCurrent) {
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
      if (id === 'netease') saved.current.resume = null;
      else if (id === 'qqmusic') qqSaved.current.resume = null;
      else localSaved.current.resume = null;
    }
    update(id, { queue: next });
    if (id === 'netease') {
      saved.current.normal = next;
      if (removesCurrent || !next) saved.current.current = null;
      else if (saved.current.current?.kind === 'normal') {
        saved.current.current = { ...saved.current.current, index: next.index };
      }
    } else if (id === 'qqmusic') {
      qqSaved.current.queue = next;
      qqSaved.current.cleared = !next;
      if (!next) qqSaved.current.position = 0;
    } else {
      localSaved.current.cleared = !next;
      if (!next) localSaved.current.position = 0;
    }
    setConfirmClear(false);
    scheduleSave(true);
  };

  const editMixedQueue = (removeIndex, clear = false) => {
    const mq = mixedQueueRef.current;
    if (!mq) return;
    if (pendingPlay.current) {
      playbackDepsRef.current.setCustomPlaylistNotice?.('歌曲切换中，请稍后修改队列');
      return;
    }
    rollbackRef.current = null;
    const current = songRef.current;
    const removesCurrent =
      clear ||
      (current &&
        mq.tracks[removeIndex]?.provider === current.provider &&
        mq.tracks[removeIndex]?.id === current.id &&
        mq.index === removeIndex);
    const tracks = clear ? [] : mq.tracks.filter((_, index) => index !== removeIndex);
    let next = null;
    if (tracks.length) {
      const index = clear ? 0 : Math.min(mq.index - (removeIndex < mq.index ? 1 : 0), tracks.length - 1);
      next = { ...mq, tracks, index };
    }
    if (removesCurrent) {
      playbackDepsRef.current.stopSmoothFade?.();
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
    }
    mixedQueueRef.current = next;
    setMixedQueue(next);
    setConfirmClear(false);
  };

  const reorderQueue = (fromIndex, toIndex) => {
    const id = activeRef.current;
    const q = workRef.current[id].queue;
    if (!q || q.type === 'fm' || q.source === 'fm') return;
    if (pendingPlay.current) {
      update(id, { message: '歌曲切换中，请稍后修改队列' });
      return;
    }
    const reordered = reorderQueueTracks(q.tracks, q.index, fromIndex, toIndex);
    if (!reordered) return;
    rollbackRef.current = null;
    const next = { ...q, tracks: reordered.tracks, index: reordered.index };
    update(id, { queue: next });
    if (id === 'netease') {
      saved.current.normal = next;
      if (saved.current.current?.kind === 'normal') {
        saved.current.current = { ...saved.current.current, index: next.index };
      }
    } else if (id === 'qqmusic') {
      qqSaved.current.queue = next;
    }
    scheduleSave(true);
  };

  const reorderMixedQueue = (fromIndex, toIndex) => {
    const mq = mixedQueueRef.current;
    if (!mq) return;
    if (pendingPlay.current) {
      playbackDepsRef.current.setCustomPlaylistNotice?.('歌曲切换中，请稍后修改队列');
      return;
    }
    const reordered = reorderQueueTracks(mq.tracks, mq.index, fromIndex, toIndex);
    if (!reordered) return;
    rollbackRef.current = null;
    const next = { ...mq, tracks: reordered.tracks, index: reordered.index };
    mixedQueueRef.current = next;
    setMixedQueue(next);
  };

  useEffect(() => {
    const flush = () => {
      if (saved.current.timer) {
        clearTimeout(saved.current.timer);
        saved.current.timer = null;
      }
      saveNow();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // 单次下一句精准唤醒定时器（亚 30ms 节拍同步，零轮询，隐藏/暂停即撤销）
  useEffect(() => {
    if (!playing || !lyrics.length) return undefined;
    let timer = null;
    const delayMsBound = ms => (Number.isFinite(ms) ? ms : 1000);
    const scheduleNext = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof document !== 'undefined' && document.hidden) return;
      const a = audio.current;
      if (!a) return;
      const idx = lyricIndexStore.getSnapshot();
      const next = lyrics[idx + 1];
      if (!next) return;
      const rate = a.playbackRate || playbackRate || 1;
      const deltaMs = Math.ceil(((next.at - (a.currentTime || 0)) / rate) * 1000) + 12;
      if (deltaMs <= 0) {
        syncLyric(a.currentTime || 0);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (audio.current) syncLyric(audio.current.currentTime || 0);
      }, Math.min(delayMsBound(deltaMs), 60000));
    };
    scheduleNext();
    const unsubLyric = lyricIndexStore.subscribe(scheduleNext);
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden && audio.current) {
        syncLyric(audio.current.currentTime || 0);
        scheduleNext();
      }
    };
    document?.addEventListener?.('visibilitychange', onVisible);
    return () => {
      unsubLyric();
      if (timer) clearTimeout(timer);
      document?.removeEventListener?.('visibilitychange', onVisible);
    };
  }, [playing, lyrics, playbackRate, song]);

  useEffect(() => {
    if (showQueue) {
      document.querySelector('.queue-item.selected')?.scrollIntoView?.({
        block: 'nearest',
        behavior: 'auto',
      });
    }
  }, [showQueue, activeProvider, song]);

  useEffect(() => {
    const session = navigator.mediaSession;
    updateMediaSession(session, globalThis.MediaMetadata, song, playing);
    return installMediaSession(session, {
      play: () => {
        if (audio.current?.paused) togglePlayback();
      },
      pause: () => {
        if (audio.current && !audio.current.paused) audio.current.pause();
      },
      previoustrack: () => skipTrack(-1),
      nexttrack: () => skipTrack(1),
    });
  }, [song, playing]);

  return {
    song,
    setSong,
    songRef,
    playing,
    setPlaying,
    buffering,
    setBuffering,
    restoredProgress,
    setRestoredProgress,
    trackQuality,
    setTrackQuality,
    lyrics,
    lyricsRef,
    lyricIndexStore,
    lyricStatus,
    setLyricStatus,
    mode,
    volume,
    setVolume,
    muted,
    setMuted,
    settings,
    playbackRate,
    changePlaybackRate,
    saved,
    qqSaved,
    localSaved,
    audio,
    pendingPlay,
    playback,
    diagnosticTick,
    showQueue,
    setShowQueue,
    confirmClear,
    setConfirmClear,
    syncLyric,
    replaceLyrics,
    loadLyricsFor,
    saveNow,
    scheduleSave,
    restoreSaved,
    restoreQq,
    play,
    skipTrack,
    togglePlayback,
    adjustVolume,
    cycleMode,
    editQueue,
    editMixedQueue,
    reorderQueue,
    reorderMixedQueue,
    clearProviderSavedState,
    stopProviderPlayback,
  };
}
