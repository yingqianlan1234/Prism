import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { coverUrl } from './cover.js';
import * as defaultProviders from './providers.js';
import { ListeningTracker as DefaultListeningTracker } from './listening.js';
import { parseLrc, mergeTranslation, mergeRomaji } from './lyrics.js';
import { installMediaSession, updateMediaSession } from './media-session.js';
import {
  makePlaybackState,
  restorePlaybackState,
  makeQqPlaybackState,
  restoreQqPlaybackState,
  nextIndex,
  manualIndex,
  queueMode,
  cleanTrack,
} from './playback-state.js';
import { extractAccent } from './accent.js';
import {
  artist,
  lyricalLines,
  qqLocalHandle,
  accentFor,
  loadSearchHistory,
  saveSearchHistory,
  clearSearchHistory,
} from './utils/format.js';
import { PlaylistCover, InlineNotice } from './components/Artwork.jsx';
import { AppHeader } from './components/AppHeader.jsx';
import { LibraryBar } from './components/LibraryBar.jsx';
import { SongList, EmptyState, NowPanel } from './components/LibraryContent.jsx';
import { RadioStage } from './components/RadioStage.jsx';
import { FloatingDock } from './components/FloatingDock.jsx';
import { LyricPanel } from './components/LyricPanel.jsx';
import {
  MoreSettingsPanel,
  QueueDrawer,
  QqAuthDialog,
  CloseBehaviorDialog,
  QrDialog,
} from './components/Overlays.jsx';

if (typeof window !== 'undefined') window.__extractAccent = extractAccent;

const makeWorkspace = () => ({
  query: '',
  songs: [],
  title: '发现音乐',
  profile: null,
  lists: [],
  recommendLists: null,
  queue: null,
  message: '搜索歌曲，开始聆听',
  listStatus: '',
  storageStatus: '',
  accountBusy: false,
  identityUnknown: true,
  page: 0,
  searchQuery: '',
  searching: false,
  fmView: false,
  trackOrigin: 'unknown',
  listPage: 0,
  listsBusy: false,
  qqPlaylist: null,
  qqTrackPage: 0,
  qqHasMore: null,
});

export function App({
  providers = defaultProviders,
  ListeningTracker = DefaultListeningTracker,
} = {}) {
  const { netease, getProvider, capabilities, platformFlavor, latestRequest } = providers;
  const [closeMode, setCloseMode] = useState('ask');
  const [trayAvailable, setTrayAvailable] = useState(false);
  const [closeDialog, setCloseDialog] = useState(null);
  const [closeError, setCloseError] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);

  const [view, setView] = useState('library');
  const [showMore, setShowMore] = useState(false);
  const [showNowDetails, setShowNowDetails] = useState(false);
  const [sideExpanded, setSideExpanded] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState(null);

  const [activeProvider, setActiveProvider] = useState('netease');
  const activeRef = useRef('netease');
  const [workspaces, setWorkspaces] = useState(() => ({
    netease: makeWorkspace(),
    qqmusic: makeWorkspace(),
  }));
  const workRef = useRef(workspaces);

  const update = (id, patch) => {
    const next = { ...workRef.current, [id]: { ...workRef.current[id], ...patch } };
    workRef.current = next;
    setWorkspaces(next);
  };

  const ws = workspaces[activeProvider];
  const {
    query,
    songs,
    title,
    profile,
    lists,
    recommendLists,
    message,
    listStatus,
    accountBusy,
    identityUnknown,
  } = ws;
  const setQuery = value => update(activeRef.current, { query: value });

  // 本地搜索历史（按平台隔离）
  const [searchHistory, setSearchHistory] = useState(() => ({
    netease: loadSearchHistory('netease'),
    qqmusic: loadSearchHistory('qqmusic'),
  }));

  // 播放倍速与睡眠定时（纯前端实用辅助，事件/单次定时器驱动）
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sleepMode, setSleepMode] = useState('off');
  const sleepRef = useRef({ mode: 'off', timer: null });

  const [reportAllowed, setReportAllowed] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [, setDiagnosticVersion] = useState(0);
  const [, setLastDiagnostic] = useState(null);
  const listening = useRef(null);
  const diagnosticsOn = useRef(false);
  if (!listening.current) listening.current = new ListeningTracker();

  const [mode, setMode] = useState('sequential');
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const settings = useRef({ mode: 'sequential', volume: 1, muted: false });
  const saved = useRef({
    normal: null,
    fm: null,
    current: null,
    timer: null,
    chain: Promise.resolve(),
    resume: null,
  });
  const qqSaved = useRef({ queue: null, position: 0, resume: null, cleared: false });
  const providerSettings = useRef({ netease: null, qqmusic: null });
  const bootProvider = useRef('netease');

  const [qqWebOpen, setQqWebOpen] = useState(false);
  const [qr, setQr] = useState(null);
  const [song, setSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [restoredProgress, setRestoredProgress] = useState(null);
  const [lyrics, setLyrics] = useState([]);
  const lyricsRef = useRef([]);
  const [lyricIndex, setLyricIndex] = useState(-1);
  const lyricIndexRef = useRef(-1);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricStatus, setLyricStatus] = useState('idle');
  const [showQueue, setShowQueue] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // 睡眠定时控制：仅使用单次 setTimeout 或 onEnded 触发，无高频轮询
  const selectSleepMode = nextMode => {
    if (sleepRef.current.timer) {
      clearTimeout(sleepRef.current.timer);
      sleepRef.current.timer = null;
    }
    sleepRef.current.mode = nextMode;
    setSleepMode(nextMode);
    if (nextMode === '15' || nextMode === '30' || nextMode === '60') {
      const minutes = Number(nextMode);
      sleepRef.current.timer = setTimeout(() => {
        sleepRef.current.timer = null;
        sleepRef.current.mode = 'off';
        setSleepMode('off');
        if (audio.current && !audio.current.paused) audio.current.pause();
        const curProvider = songRef.current?.provider || activeRef.current;
        update(curProvider, { message: `睡眠定时（${minutes} 分钟）已到，已暂停播放` });
      }, minutes * 60 * 1000);
    }
  };

  useEffect(
    () => () => {
      if (sleepRef.current.timer) clearTimeout(sleepRef.current.timer);
    },
    []
  );

  const changePlaybackRate = rate => {
    setPlaybackRate(rate);
    if (audio.current) audio.current.playbackRate = rate;
  };

  // 模态弹窗焦点陷阱与关闭返还焦点
  useEffect(() => {
    const selector = showQueue
      ? '.queue-dialog'
      : qr
        ? '.qr-dialog'
        : qqWebOpen
          ? '.qq-auth-dialog'
          : null;
    if (!selector) return;
    const previous = document.activeElement;
    const box = document.querySelector(selector);
    const focusable = () =>
      Array.from(
        box?.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) || []
      );
    focusable()[0]?.focus();
    const trap = e => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    box?.addEventListener('keydown', trap);
    return () => {
      box?.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [showQueue, !!qr, qqWebOpen]);

  const clearFocus = useRef(false);
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
      const first = list[0];
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

  const [qqDiagnostic, setQqDiagnostic] = useState(null);
  const [qqDiagnosticEnabled, setQqDiagnosticEnabled] = useState(false);
  const qqDiagnosticOn = useRef(false);

  const refreshQqDiagnostic = async () => {
    if (!qqDiagnosticOn.current) return;
    try {
      const result = await invoke('qq_playback_diagnostic');
      if (qqDiagnosticOn.current) setQqDiagnostic(result.diagnostic);
    } catch {
      if (qqDiagnosticOn.current) setQqDiagnostic(null);
    }
  };

  const toggleQqDiagnostic = async () => {
    const enabled = !qqDiagnosticOn.current;
    try {
      const result = await invoke('qq_playback_diagnostic', { enabled });
      qqDiagnosticOn.current = enabled;
      setQqDiagnosticEnabled(enabled);
      setQqDiagnostic(result.diagnostic);
    } catch {
      update('qqmusic', { message: 'QQ 诊断开关不可用' });
    }
  };

  const fm = useRef({
    accountId: null,
    tracks: [],
    seen: new Set(),
    pending: null,
    error: '',
    generation: 0,
  });
  const audio = useRef(null);
  const searchInput = useRef(null);
  const songRef = useRef(null);
  const resumedLyric = useRef(null);
  const pendingPlay = useRef(null);
  const rollbackRef = useRef(null);

  const recommendation = useRef(latestRequest());
  const recommendationPending = useRef(false);
  const browse = useRef({ netease: latestRequest(), qqmusic: latestRequest() });
  const playback = useRef(latestRequest());
  const account = useRef({ netease: latestRequest(), qqmusic: latestRequest() });
  const identity = useRef({ netease: latestRequest(), qqmusic: latestRequest() });
  const qrRequest = useRef(latestRequest());

  const errorText = e => e?.message || '操作失败，请稍后重试';

  const syncLyric = position => {
    let index = -1;
    for (let i = 0; i < lyricsRef.current.length; i++) {
      if (lyricsRef.current[i].at <= position) index = i;
    }
    if (index !== lyricIndexRef.current) {
      lyricIndexRef.current = index;
      setLyricIndex(index);
    }
  };

  const replaceLyrics = items => {
    lyricsRef.current = items;
    setLyrics(items);
    syncLyric(audio.current?.currentTime || 0);
  };

  const diagnosticTick = useRef(null);
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

  const saveNow = () => {
    saveQq();
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
        const base = parseLrc(data?.lrc?.lyric || '');
        const withTrans = mergeTranslation(base, parseLrc(data?.tlyric?.lyric || ''));
        const parsed = mergeRomaji(withTrans, parseLrc(data?.romalrc?.lyric || ''));
        replaceLyrics(parsed);
        setLyricStatus(parsed.length ? 'ready' : data?.nolyric ? 'instrumental' : 'empty');
        if (position != null) syncLyric(position);
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

  const sampleListening = a => {
    if (a && !a.seeking) listening.current.progress(a.currentTime, performance.now(), a.playbackRate);
  };
  const diagnosticsChanged = () => {
    if (diagnosticsOn.current) setDiagnosticVersion(v => v + 1);
  };

  const clearAccountContent = id => {
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
    if (id === 'netease') {
      recommendationPending.current = false;
      fm.current = {
        accountId: null,
        tracks: [],
        seen: new Set(),
        pending: null,
        error: '',
        generation: fm.current.generation + 1,
      };
    }
    identity.current[id].next();
    browse.current[id].next();
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
      replaceLyrics([]);
      setRestoredProgress(null);
    }
    update(id, {
      songs: [],
      lists: [],
      recommendLists: null,
      queue: null,
      fmView: false,
      listPage: 0,
      listsBusy: false,
      qqPlaylist: null,
      qqTrackPage: 0,
      qqHasMore: null,
      storageStatus: '',
      title: '发现音乐',
    });
  };

  const tagged = (items, id, accountId) => items.map(item => ({ ...item, provider: id, accountId }));

  const loadLists = async (id, token, page = 1, append = false) => {
    update(id, { ...(append ? {} : { lists: [] }), listsBusy: true, listStatus: '正在加载歌单…' });
    try {
      const p = await getProvider(id);
      const d = await p.getPlaylists({ page });
      if (!account.current[id].isCurrent(token)) return;
      if (!Array.isArray(d.playlist)) throw Error('歌单列表数据不完整');
      const items = append
        ? [
            ...workRef.current[id].lists,
            ...d.playlist.filter(
              x => !workRef.current[id].lists.some(old => String(old.id) === String(x.id))
            ),
          ]
        : d.playlist;
      update(id, {
        lists: items,
        listPage: page,
        listsBusy: false,
        listStatus:
          id === 'qqmusic'
            ? d.playlist.length
              ? ''
              : '本页没有更多歌单'
            : d.more
              ? '仅显示部分歌单（最多 100 个）'
              : d.more === false
                ? items.length
                  ? ''
                  : '暂无歌单'
                : '歌单列表分页状态未知（最多 100 个）',
      });
    } catch (e) {
      if (account.current[id].isCurrent(token)) {
        update(id, { listsBusy: false, listStatus: '歌单加载失败：' + errorText(e) });
      }
    }
  };

  const restore = async (id = activeRef.current) => {
    const token = account.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      if (!p.capabilities.restoreSession) {
        clearAccountContent(id);
        update(id, { profile: null, identityUnknown: false, lists: [], listStatus: '' });
        return;
      }
      const d = await p.restoreSession();
      if (!account.current[id].isCurrent(token)) return;
      const next = d?.profile;
      if (!d || !Object.hasOwn(d, 'profile') || (next != null && !next.userId)) {
        clearAccountContent(id);
        update(id, {
          profile: null,
          identityUnknown: true,
          listStatus: '账号资料不完整，请刷新账号',
        });
        return;
      }
      const old = workRef.current[id];
      if ((old.profile?.userId || null) !== (next?.userId || null) || old.identityUnknown) {
        clearAccountContent(id);
      }
      update(id, { profile: next || null, identityUnknown: false });
      if (id === 'netease' && next?.userId) {
        void restoreSaved(
          next.userId,
          identity.current.netease.current(),
          playback.current.current()
        );
      }
      if (id === 'qqmusic' && next?.userId) {
        await restoreQq(next.userId, identity.current.qqmusic.current());
      }
      if (next?.userId && capabilities[id].getPlaylists) await loadLists(id, token);
      else update(id, { lists: [], listStatus: '' });
    } catch (e) {
      if (account.current[id].isCurrent(token)) {
        update(id, { listStatus: '账号刷新失败：' + errorText(e) });
      }
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  useEffect(() => {
    const syncHidden = () => {
      document.documentElement.dataset.hidden = document.hidden ? 'true' : 'false';
    };
    syncHidden();
    document.addEventListener('visibilitychange', syncHidden);
    return () => {
      document.removeEventListener('visibilitychange', syncHidden);
      delete document.documentElement.dataset.hidden;
    };
  }, []);

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

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const last = await invoke('playback_state_load', { provider: 'last' });
        if (!active) return;
        bootProvider.current =
          last?.status === 'ok' && last.provider === 'qqmusic' ? 'qqmusic' : 'netease';
      } catch {}
      if (!active) return;
      if (bootProvider.current === 'qqmusic') {
        await restore('qqmusic');
        if (!active) return;
      }
      await restore('netease');
    })();
    return () => {
      active = false;
      for (const id of ['netease', 'qqmusic']) {
        account.current[id].next();
        identity.current[id].next();
        browse.current[id].next();
      }
      qrRequest.current.next();
      playback.current.next();
      listening.current.clear();
      if (saved.current.timer) clearTimeout(saved.current.timer);
    };
  }, []);

  const switchProvider = id => {
    if (activeRef.current !== id) {
      recommendation.current.next();
      if (recommendationPending.current) {
        recommendationPending.current = false;
        update('netease', { message: '推荐加载已取消' });
      }
    }
    activeRef.current = id;
    setActiveProvider(id);
    if (workRef.current[id].identityUnknown && !workRef.current[id].accountBusy) restore(id);
  };

  const search = async (e, page = 1, explicitTerm = null) => {
    e?.preventDefault();
    const id = activeRef.current;
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
    const token = browse.current[id].next();
    const generation = identity.current[id].current();
    update(id, {
      message: '正在搜索…',
      searching: true,
      fmView: false,
      trackOrigin: 'search',
      qqPlaylist: null,
      qqTrackPage: 0,
    });
    try {
      const p = await getProvider(id);
      const d = await p.search(q, { page, pageSize: id === 'qqmusic' ? 5 : 40 });
      if (!browse.current[id].isCurrent(token) || !identity.current[id].isCurrent(generation))
        return;
      if (!Array.isArray(d.result?.songs) && d.result?.songCount !== 0)
        throw Error('搜索结果数据不完整');
      const found = tagged(d.result?.songs || [], id, w.profile?.userId || null);
      const total = d.result?.songCount;
      update(id, {
        songs: found,
        recommendLists: null,
        title: '搜索：' + q,
        page,
        searchQuery: q,
        searching: false,
        message:
          id === 'qqmusic'
            ? found.length
              ? '总数未知，可继续请求下一页'
              : '本页没有找到歌曲'
            : total == null
              ? '搜索结果数量未知，最多显示 40 首'
              : total > found.length
                ? `仅显示 ${found.length} 首，共 ${total} 首；暂不支持翻页`
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
    const id = 'netease';
    const user = workRef.current.netease.profile?.userId;
    if (!user || workRef.current.netease.identityUnknown) return;
    const token = browse.current.netease.next();
    const generation = identity.current.netease.current();
    update(id, {
      title: '本地最近播放',
      songs: [],
      fmView: false,
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
        album: { name: t.album },
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
      track = cleanTrack(current);
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
      recommendLists: null,
      fmView: false,
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
    const id = 'netease';
    const w = workRef.current[id];
    if (activeRef.current !== id || w.identityUnknown || !w.profile?.userId) return;
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
      recommendLists: null,
      fmView: false,
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
        const current = workRef.current.netease;
        const q = current.queue;
        const patch = {};
        if (current.fmView) {
          patch.songs = [...state.tracks];
          patch.message = state.error;
        }
        if (q?.type === 'fm' && q.accountId === state.accountId) {
          patch.queue = { ...q, tracks: [...state.tracks] };
        }
        update('netease', patch);
      } catch (e) {
        if (fm.current === state) {
          state.error = '私人 FM 加载失败：' + errorText(e);
          if (workRef.current.netease.fmView) update('netease', { message: state.error });
        }
      } finally {
        if (fm.current === state) state.pending = null;
      }
    })();
    state.pending = promise;
    return promise;
  };

  const openFm = () => {
    const w = workRef.current.netease;
    if (!w.profile?.userId || w.identityUnknown) return;
    recommendationPending.current = false;
    recommendation.current.next();
    browse.current.netease.next();
    if (fm.current.accountId !== w.profile.userId) {
      fm.current = {
        accountId: w.profile.userId,
        tracks: [],
        seen: new Set(),
        pending: null,
        error: '',
        generation: fm.current.generation + 1,
      };
    }
    update('netease', {
      fmView: true,
      trackOrigin: 'fm',
      title: '私人 FM',
      songs: [...fm.current.tracks],
      recommendLists: null,
      message: fm.current.error || (!fm.current.tracks.length ? '正在加载…' : ''),
    });
    if (!fm.current.tracks.length && !fm.current.pending) loadFm();
  };

  const play = async (s, queueSnapshot) => {
    const id = s.provider;
    const w = workRef.current[id];
    if (w.identityUnknown || s.accountId !== (w.profile?.userId || null)) {
      update(id, { message: '账号已变化，请重新浏览歌曲' });
      return;
    }
    if (!capabilities[id].resolvePlayback) {
      update(id, {
        message:
          id === 'qqmusic' && platformFlavor.qqmusic === 'mock'
            ? 'QQ 音乐模拟模式不支持播放'
            : 'QQ 音乐播放暂不可用',
      });
      return;
    }
    const snapshot =
      queueSnapshot ||
      (id === 'netease' && w.fmView
        ? {
            type: 'fm',
            source: 'fm',
            tracks: [...fm.current.tracks],
            index: fm.current.tracks.findIndex(item => item.id === s.id),
            provider: id,
            accountId: s.accountId,
          }
        : {
            source: w.trackOrigin || 'unknown',
            tracks: [...w.songs],
            index: w.songs.findIndex(
              item =>
                item.id === s.id && item.provider === s.provider && item.accountId === s.accountId
            ),
            provider: id,
            accountId: s.accountId,
          });
    const token = playback.current.next();
    const generation = identity.current[id].current();
    pendingPlay.current = { provider: id, generation };
    const valid = () => playback.current.isCurrent(token) && identity.current[id].isCurrent(generation);
    let prior = rollbackRef.current;
    update(id, { message: '正在获取歌曲…' });
    try {
      const p = await getProvider(id);
      const skipResumedLyric =
        !!resumedLyric.current &&
        resumedLyric.current.id === s.id &&
        resumedLyric.current.provider === s.provider &&
        String(resumedLyric.current.accountId ?? '') === String(s.accountId ?? '') &&
        lyricStatus === 'ready';
      resumedLyric.current = null;
      const lyricRequest = skipResumedLyric
        ? null
        : Promise.resolve()
            .then(() => p.getLyrics(s.id))
            .then(
              data => ({ data }),
              () => ({ failed: true })
            );
      const url = await p.resolvePlayback(s.id, s.mediaMid);
      if (!valid()) return;
      const info = url.data?.[0];
      if (!info?.url || (info.code != null && info.code !== 200))
        throw Error('未获取到播放资源，请稍后重试');
      const previousSong = songRef.current;
      if (previousSong && !prior) {
        prior = {
          song: previousSong,
          identity: identity.current[previousSong.provider].current(),
          source: audio.current.getAttribute('src'),
          position: audio.current.currentTime,
          wasPlaying: !audio.current.paused,
          previousQueue: workRef.current[previousSong.provider].queue,
          targetProvider: id,
          targetQueue: workRef.current[id].queue,
          queuesBefore: {
            netease: workRef.current.netease.queue,
            qqmusic: workRef.current.qqmusic.queue,
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
          lyrics: [...lyricsRef.current],
          lyricStatus,
          restoredProgress,
        };
      }
      if (prior) rollbackRef.current = prior;
      if (audio.current && !audio.current.paused && audio.current.readyState >= 3) {
        sampleListening(audio.current);
      }
      saveNow();
      listening.current.settle();
      if (diagnosticsOn.current) setLastDiagnostic(listening.current.diagnosticSnapshot());
      listening.current.start({
        provider: s.provider,
        accountId: s.accountId,
        trackId: s.id,
        source: snapshot.source || 'unknown',
      });
      const resume =
        id === 'qqmusic' && qqSaved.current.resume?.id === s.id
          ? qqSaved.current.resume.position
          : saved.current.resume?.provider === id && saved.current.resume?.id === s.id
            ? saved.current.resume.position
            : 0;
      saved.current.resume = null;
      qqSaved.current.resume = null;
      const changeSource = songRef.current?.provider !== id;
      songRef.current = s;
      if (changeSource) {
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
      setSong(s);
      if (!skipResumedLyric) {
        replaceLyrics([]);
        setLyricStatus('loading');
        loadLyricsFor(s, valid, undefined, p, undefined, lyricRequest);
      }
      diagnosticTick.current = null;
      setRestoredProgress(null);
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
      }
      if (snapshot.type === 'fm' && snapshot.tracks.length - snapshot.index <= 2 && !fm.current.error) {
        loadFm();
      }
      audio.current.src = info.url;
      if (playbackRate !== 1) audio.current.playbackRate = playbackRate;
      if (resume > 0) {
        const target = audio.current;
        target.addEventListener(
          'loadedmetadata',
          () => {
            if (valid() && songRef.current === s) {
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
      await audio.current.play();
      scheduleSave(true);
      if (valid()) {
        rollbackRef.current = null;
        update(id, { message: info.freeTrialInfo ? '当前为试听片段' : '' });
      }
    } catch (e) {
      if (valid()) {
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
                update(id, { message: '上一首音频会话已失效，请手动重试' });
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
          settings.current = { ...prior.settings };
          setMode(prior.settings.mode);
          setVolume(prior.settings.volume);
          setMuted(prior.settings.muted);
          audio.current.volume = prior.settings.volume;
          audio.current.muted = prior.settings.muted;
          saved.current.normal = prior.normal;
          saved.current.fm = prior.fm;
          saved.current.current = prior.current;
          saved.current.resume = prior.resume;
          qqSaved.current.queue = prior.qqQueue;
          qqSaved.current.position = prior.qqPosition;
          qqSaved.current.resume = prior.qqResume;
          qqSaved.current.cleared = prior.qqCleared;
          for (const provider of ['netease', 'qqmusic']) {
            if (
              prior.stagedQueues[provider] &&
              workRef.current[provider].queue === prior.stagedQueues[provider]
            ) {
              update(provider, { queue: prior.queuesBefore[provider] });
            }
          }
          update(id, { message: '新歌曲播放失败，已尝试恢复上一首' });
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
          scheduleSave(true);
        } else {
          update(id, { message: '播放失败：' + errorText(e) });
        }
      }
    } finally {
      if (valid()) pendingPlay.current = null;
      if (id === 'qqmusic' && valid()) void refreshQqDiagnostic();
    }
  };

  const skipTrack = delta => {
    const current = songRef.current;
    if (!current) return;
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
    if (!audio.current.paused) audio.current.pause();
    else if (
      (saved.current.resume && current.provider === 'netease') ||
      (qqSaved.current.resume && current.provider === 'qqmusic')
    ) {
      const q = workRef.current[current.provider].queue;
      if (q) play(current, q);
    } else {
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
          if (songRef.current === current) {
            update(current.provider, { message: '播放失败：' + errorText(e) });
          }
        });
    }
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
      setPlaying(false);
      replaceLyrics([]);
      setLyricStatus('idle');
      setRestoredProgress(null);
      if (id === 'netease') saved.current.resume = null;
      else qqSaved.current.resume = null;
    }
    update(id, { queue: next });
    if (id === 'netease') {
      saved.current.normal = next;
      if (removesCurrent || !next) saved.current.current = null;
      else if (saved.current.current?.kind === 'normal') {
        saved.current.current = { ...saved.current.current, index: next.index };
      }
    } else {
      qqSaved.current.queue = next;
      qqSaved.current.cleared = !next;
      if (!next) qqSaved.current.position = 0;
    }
    setConfirmClear(false);
    scheduleSave(true);
  };

  const closeQr = () => {
    const id = qr?.provider || 'netease';
    qrRequest.current.next();
    setQr(null);
    getProvider(id)
      .then(p => p.qrCancel())
      .catch(e => update(id, { message: errorText(e) }));
  };

  const login = async () => {
    const id = activeRef.current;
    const token = account.current[id].next();
    browse.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      if (id === 'netease') {
        const qrToken = qrRequest.current.next();
        const d = await p.login();
        if (!qrRequest.current.isCurrent(qrToken) || !account.current[id].isCurrent(token)) return;
        if (!d.image) throw Error('未取得登录二维码');
        setQr({ ...d, provider: id });
      } else if (id === 'qqmusic' && platformFlavor.qqmusic !== 'mock') {
        const d = await p.login();
        if (!account.current[id].isCurrent(token)) return;
        if (d?.opened !== true) throw Error('无法打开 QQ 授权窗口');
        setQqWebOpen(true);
      } else {
        const d = await p.login();
        if (!account.current[id].isCurrent(token)) return;
        clearAccountContent(id);
        update(id, {
          profile: d.profile,
          identityUnknown: false,
          message: '已进入 QQ 模拟账号',
        });
        await loadLists(id, token);
      }
    } catch (e) {
      if (account.current[id].isCurrent(token)) update(id, { message: errorText(e) });
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  const cancelQqWeb = async () => {
    account.current.qqmusic.next();
    setQqWebOpen(false);
    try {
      const p = await getProvider('qqmusic');
      await p.loginCancel();
    } catch (e) {
      update('qqmusic', { message: '无法关闭 QQ 授权：' + errorText(e) });
    }
  };

  const completeQqWeb = async () => {
    const id = 'qqmusic';
    const token = account.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      const d = await p.loginComplete();
      if (!account.current[id].isCurrent(token)) return;
      const user = d?.profile;
      if (!user?.userId) throw Error('QQ 账号资料不完整');
      clearAccountContent(id);
      update(id, { profile: user, identityUnknown: false, message: 'QQ 账号已验证' });
      setQqWebOpen(false);
      await restoreQq(user.userId, identity.current.qqmusic.current());
      if (p.capabilities.getPlaylists) await loadLists(id, token);
    } catch (e) {
      if (account.current[id].isCurrent(token)) {
        update(id, { message: 'QQ 登录未完成：' + errorText(e) });
      }
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  useEffect(() => {
    let active = true;
    const offs = [];
    invoke('close_behavior_get')
      .then(v => {
        if (active) {
          setCloseMode(v.mode);
          setTrayAvailable(v.trayAvailable);
        }
      })
      .catch(() => {});
    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const a = await listen('prism-close-choice', () => {
          if (active) {
            setCloseError('');
            setCloseDialog('close');
          }
        });
        if (!active) {
          a();
          return;
        }
        offs.push(a);
        const b = await listen('prism-close-error', e => {
          if (active) {
            setCloseError(e.payload || '无法转入后台');
            setCloseDialog('close');
          }
        });
        if (!active) {
          b();
          return;
        }
        offs.push(b);
        const c = await listen('prism-tray-exit', async () => {
          scheduleSave(true);
          try {
            await saved.current.chain;
          } catch {}
          try {
            await invoke('close_behavior_finish_exit');
          } catch {}
        });
        if (!active) c();
        else offs.push(c);
      })
      .catch(() => {});
    return () => {
      active = false;
      offs.forEach(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (!closeDialog) return;
    const previous = document.activeElement;
    const box = document.querySelector('.lw-close-dialog');
    const items = () => Array.from(box?.querySelectorAll('button:not([disabled])') || []);
    box?.querySelector('[data-close-cancel]')?.focus();
    const trap = e => {
      if (e.key !== 'Tab') return;
      const a = items();
      if (!a.length) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && document.activeElement === a[0]) {
        e.preventDefault();
        a[a.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === a[a.length - 1]) {
        e.preventDefault();
        a[0].focus();
      }
    };
    box?.addEventListener('keydown', trap);
    return () => {
      box?.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [closeDialog]);

  const chooseClose = async nextMode => {
    if (closeBusy) return;
    setCloseBusy(true);
    setCloseError('');
    try {
      if (closeDialog === 'close' && nextMode === 'exit') {
        scheduleSave(true);
        await saved.current.chain.catch(() => {});
      }
      await invoke('close_behavior_set', { mode: nextMode, closeNow: closeDialog === 'close' });
      setCloseMode(nextMode);
      setCloseDialog(null);
    } catch (e) {
      setCloseError(e?.message || '无法保存关闭设置，请重试');
    } finally {
      setCloseBusy(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    let unlisten;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('qq-auth-cleanup-failed', () =>
          update('qqmusic', { message: 'QQ 授权临时数据未能清理，请检查本机应用数据' })
        )
      )
      .then(fn => {
        if (stopped) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!qr) return;
    const id = qr.provider;
    const token = qrRequest.current.current();
    let timer;
    let active = true;
    const poll = async () => {
      try {
        const p = await getProvider(id);
        const d = await p.qrCheck();
        if (!active || !qrRequest.current.isCurrent(token)) return;
        if (d.code === 803) {
          setQr(null);
          const accountToken = account.current[id].next();
          const userId = d.profile?.userId || null;
          const old = workRef.current[id];
          if ((old.profile?.userId || null) !== userId || !userId) clearAccountContent(id);
          update(id, {
            profile: userId ? d.profile : null,
            identityUnknown: !userId,
            message: userId ? '登录成功' : '账号身份待确认',
            listStatus: userId ? '' : '账号资料不完整，请刷新账号',
          });
          if (id === 'netease' && userId) {
            void restoreSaved(
              userId,
              identity.current.netease.current(),
              playback.current.current()
            );
          }
          if (userId && capabilities[id].getPlaylists) loadLists(id, accountToken);
          return;
        }
        if (d.code === 800) {
          setQr(null);
          update(id, { message: '二维码已过期或被拒绝，请重新登录' });
          return;
        }
      } catch (e) {
        if (active && qrRequest.current.isCurrent(token)) {
          update(id, { message: errorText(e) });
          setQr(null);
          getProvider(id)
            .then(p => p.qrCancel())
            .catch(() => {});
        }
        return;
      }
      if (active) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [qr]);

  const logout = async () => {
    const id = activeRef.current;
    const token = account.current[id].next();
    browse.current[id].next();
    update(id, { accountBusy: true });
    try {
      const p = await getProvider(id);
      const result = await p.logout();
      if (!account.current[id].isCurrent(token)) return;
      if (result?.localCleared !== true) throw Error('无法确认本机退出状态');
      clearAccountContent(id);
      update(id, {
        profile: null,
        identityUnknown: false,
        listStatus: '',
        message:
          id === 'qqmusic' && platformFlavor.qqmusic === 'mock'
            ? '已退出模拟账号'
            : result.remoteRevoked
              ? '已退出登录'
              : '本机已退出，远端状态未确认',
      });
    } catch (e) {
      if (account.current[id].isCurrent(token)) update(id, { message: '退出失败：' + errorText(e) });
    } finally {
      if (account.current[id].isCurrent(token)) update(id, { accountBusy: false });
    }
  };

  // 全局键盘快捷键（保留原优先级与顺序）
  useEffect(() => {
    const onKey = e => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        if (closeDialog) {
          setCloseDialog(null);
          e.preventDefault();
        } else if (confirmClear) {
          setConfirmClear(false);
          e.preventDefault();
        } else if (showQueue) {
          setShowQueue(false);
          e.preventDefault();
        } else if (qr) {
          closeQr();
          e.preventDefault();
        } else if (qqWebOpen) {
          void cancelQqWeb();
          e.preventDefault();
        } else if (confirmRecent) {
          setConfirmRecent(false);
          e.preventDefault();
        } else if (showMore) {
          setShowMore(false);
          e.preventDefault();
        } else if (showLyrics) {
          setShowLyrics(false);
          e.preventDefault();
        } else if (showNowDetails && view === 'library') {
          setShowNowDetails(false);
          e.preventDefault();
        } else if (view === 'stage') {
          setView('library');
          e.preventDefault();
        }
        return;
      }
      const target = e.target;
      const editable = !!(
        target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
        target?.isContentEditable
      );
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (view === 'stage') {
          setView('library');
          setShowLyrics(false);
          setTimeout(() => searchInput.current?.focus(), 0);
        } else searchInput.current?.focus();
        return;
      }
      if (editable || e.altKey || e.metaKey) return;
      if (!e.ctrlKey && e.code === 'Space') {
        if (showQueue || qr || qqWebOpen || showLyrics || confirmRecent || closeDialog) return;
        e.preventDefault();
        togglePlayback();
        return;
      }
      if (!e.ctrlKey) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        skipTrack(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        audio.current.volume = Math.min(
          1,
          Math.max(0, Math.round((audio.current.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100)
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (showQueue) {
      document.querySelector('.queue-item.selected')?.scrollIntoView?.({
        block: 'nearest',
        behavior: 'auto',
      });
    }
  }, [showQueue, activeProvider, song]);

  useEffect(() => {
    const onScroll = e => {
      const t = e.target;
      if (!t?.matches) return;
      if (!t.matches('.lists,.queue-list,.lyric-lines,.lw-card-grid')) return;
      const next = t.scrollTop > 4;
      if (t.dataset.scrolled !== String(next)) t.dataset.scrolled = String(next);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

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

  // 封面漫反射取色：一次性离屏取色，仅写入根节点 CSS 变量，不进 React state
  useEffect(() => {
    const root = document.documentElement;
    const apply = c => {
      if (c && c.a) {
        root.style.setProperty('--nr-glow', c.a);
        root.style.setProperty('--lw-a', c.a);
        root.style.setProperty('--lw-on', c.on);
        root.dataset.accent = c.monochrome ? 'mono' : 'color';
      } else {
        const fb = accentFor(song);
        root.style.setProperty('--nr-glow', fb);
        root.style.setProperty('--lw-a', fb);
        root.style.setProperty('--lw-on', '#161C26');
        root.dataset.accent = 'fallback';
      }
    };
    const src = coverUrl(song, 500);
    root.dataset.accentSrc = src || '';
    if (!src) {
      apply(null);
      return;
    }
    let live = true;
    extractAccent(src).then(c => {
      if (live) apply(c);
    });
    return () => {
      live = false;
    };
  }, [song]);

  // 原生窗口标题跟随实际播放曲目
  useEffect(() => {
    const nextTitle = song ? [song.name, artist(song)].filter(Boolean).join(' — ') : 'Prism';
    try {
      const pending = getCurrentWindow().setTitle(nextTitle);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {}
    return undefined;
  }, [song]);

  const line = lyrics[lyricIndex];
  const diagnostic = showDiagnostics ? listening.current.diagnosticSnapshot() : null;
  const diagnosticText = d =>
    `会话 ${d.sessionId} · 媒体前进 ${d.mediaSeconds.toFixed(1)} 秒 · 有效收听 ${d.validSeconds.toFixed(1)} 秒 · 暂停 ${d.pauses} 次 · 缓冲 ${d.buffering} 次 · 拖动 ${d.seeks} 次 · 全曲${d.thresholdReached ? '达到' : '未达到'} 30 秒候选阈值`;

  const messageRole = /失败|无法|不可用|超时|过期|未获取|请先登录/.test(message) ? 'alert' : 'status';
  const noSearchResults =
    ws.trackOrigin === 'search' && !ws.searching && ['没有找到歌曲', '本页没有找到歌曲'].includes(message);

  const lwLyrics = lyricalLines(lyrics);
  const lwCur = lwLyrics.findIndex(l => line && l.at >= line.at);
  const lwPreview = lwCur >= 0 ? lwLyrics.slice(lwCur, lwCur + 2) : lwLyrics.slice(0, 2);

  // 舞台实况 5 行歌词上下文
  const stagePreview = (() => {
    if (!lwLyrics.length) return [];
    const anchor = lwCur >= 0 ? lwCur : 0;
    const start = Math.max(0, anchor - 2);
    return lwLyrics.slice(start, start + 5).map((item, offset) => ({
      ...item,
      isCurrent: lwCur >= 0 ? start + offset === anchor : offset === 0,
    }));
  })();

  const playingQueue = song ? workspaces[song.provider]?.queue : ws.queue;

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

  const sleepLabel =
    sleepMode === 'off' ? '' : sleepMode === 'track' ? '播完本首' : `${sleepMode}分`;

  return (
    <div
      className="app"
      data-skin="night-radio"
      data-view={view}
      data-details={showNowDetails ? 'open' : 'closed'}
      data-playing={playing ? 'true' : 'false'}
      style={{ '--lw-accent': accentFor(song) }}
    >
      <div className="nr-ambient-layer" aria-hidden="true">
        <span className="nr-orb is-warm" />
        <span className="nr-orb is-cool" />
      </div>
      <AppHeader
        capabilities={capabilities}
        platformFlavor={platformFlavor}
        view={view}
        showLyrics={showLyrics}
        setView={setView}
        setShowLyrics={setShowLyrics}
        activeProvider={activeProvider}
        switchProvider={switchProvider}
        songs={songs}
        recommendLists={recommendLists}
        search={search}
        searchInput={searchInput}
        query={query}
        setQuery={setQuery}
        profile={profile}
        identityUnknown={identityUnknown}
        accountBusy={accountBusy}
        restore={restore}
        login={login}
        logout={logout}
        onHome={() => {
          recommendationPending.current = false;
          browse.current[activeProvider].next();
          update(activeProvider, {
            title: '发现音乐',
            songs: [],
            recommendLists: null,
            fmView: false,
            trackOrigin: 'unknown',
            page: 0,
            searchQuery: '',
            searching: false,
            message: '搜索歌曲，开始聆听',
          });
        }}
      />

      <LibraryBar
        platformFlavor={platformFlavor}
        sideExpanded={sideExpanded}
        setSideExpanded={setSideExpanded}
        activeProvider={activeProvider}
        profile={profile}
        identityUnknown={identityUnknown}
        openFm={openFm}
        openRecent={openRecent}
        recommend={recommend}
        lists={lists}
        openList={openList}
        listStatus={listStatus}
        ws={ws}
        onMore={() =>
          loadLists('qqmusic', account.current.qqmusic.current(), ws.listPage + 1, true)
        }
      />

      <main className="lw-library" hidden={view !== 'library'}>
        <div className="workspace">
          <NowPanel
            platformFlavor={platformFlavor}
            song={song}
            playing={playing}
            buffering={buffering}
            activeProvider={activeProvider}
            ws={ws}
            lwPreview={lwPreview}
            lyricStatus={lyricStatus}
            showLyrics={showLyrics}
            setShowLyrics={setShowLyrics}
            setShowNowDetails={setShowNowDetails}
            setView={setView}
            setShowQueue={setShowQueue}
            setConfirmClear={setConfirmClear}
            qqDiagnosticEnabled={qqDiagnosticEnabled}
            qqDiagnostic={qqDiagnostic}
            toggleQqDiagnostic={toggleQqDiagnostic}
          />

          <section className="content">
            <div className="section-label">
              <span>音乐库</span>
              <span>
                {songs.length
                  ? ws.fmView
                    ? `最近 ${Math.min(songs.length, 200)} 首`
                    : `当前页 ${songs.length} 首`
                  : '搜索与收藏'}
              </span>
            </div>

            {songs.length > 0 && message && !['搜索歌曲，开始聆听', '歌单为空'].includes(message) && (
              <InlineNotice tone={messageRole === 'alert' ? 'err' : 'ok'} role={messageRole}>
                {message}
              </InlineNotice>
            )}

            <div className="heading">
              <div>
                <h1>{title}</h1>
                {songs.length > 0 && (
                  <p>
                    {capabilities[activeProvider].resolvePlayback
                      ? activeProvider === 'netease'
                        ? '双击歌曲播放 · 切换平台不打断播放'
                        : '单击歌曲播放'
                      : '搜索结果仅供浏览'}
                  </p>
                )}
              </div>

              {ws.trackOrigin === 'playlist' && ws.playlistMeta && (
                <div className="playlist-meta">
                  <PlaylistCover
                    className="playlist-detail-cover"
                    url={ws.playlistMeta.coverImgUrl}
                  />
                  <span>
                    {ws.playlistMeta.creator ? `创建者：${ws.playlistMeta.creator}` : '创建者未知'}{' '}
                    · {ws.playlistMeta.total ?? '未知'} 首
                  </span>
                </div>
              )}

              {songs.length > 0 && capabilities[activeProvider].resolvePlayback && (
                <button
                  type="button"
                  className="primary"
                  aria-label="播放第一首"
                  onClick={() => play(songs[0])}
                >
                  ▶ <span>播放第一首</span>
                </button>
              )}
            </div>

            {activeProvider === 'netease' && ws.trackOrigin === 'recent' && (
              <div className="recent-controls">
                <button
                  type="button"
                  className="nr-soft-btn"
                  hidden={confirmRecent}
                  onClick={() => setConfirmRecent(true)}
                >
                  清空本地记录
                </button>
                {confirmRecent && (
                  <div className="overlay">
                    <div
                      className="dialog lw-recent-confirm"
                      role="alertdialog"
                      aria-modal="true"
                      aria-labelledby="recent-confirm-title"
                    >
                      <h2 id="recent-confirm-title">清空本地最近播放？</h2>
                      <p>此操作仅清除本机记录。</p>
                      <div className="nr-confirm-actions">
                        <button type="button" className="nr-danger-btn" onClick={clearRecent}>
                          确认清空
                        </button>
                        <button
                          type="button"
                          className="nr-soft-btn"
                          data-cancel=""
                          onClick={() => setConfirmRecent(false)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {recommendLists !== null ? (
              <div className="recommend-lists">
                {recommendLists.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    className="playlist nr-rec-card"
                    onClick={() => openList(l)}
                  >
                    <PlaylistCover className="nr-rec-cover" url={l.picUrl || l.coverImgUrl} />
                    <span>{l.name}</span>
                  </button>
                ))}
                {message && <p role="status">{message}</p>}
              </div>
            ) : songs.length ? (
              <SongList
                songs={songs}
                ws={ws}
                activeProvider={activeProvider}
                song={song}
                selectedTrack={selectedTrack}
                playing={playing}
                buffering={buffering}
                play={play}
                setSelectedTrack={setSelectedTrack}
              />
            ) : (
              <EmptyState
                platformFlavor={platformFlavor}
                noSearchResults={noSearchResults}
                ws={ws}
                message={message}
                messageRole={messageRole}
                activeProvider={activeProvider}
                search={search}
                searchInput={searchInput}
                query={query}
                setQuery={setQuery}
                profile={profile}
                lists={lists}
                openList={openList}
                searchHistory={searchHistory[activeProvider]}
                onPickHistory={term => search(null, 1, term)}
                onClearHistory={() =>
                  setSearchHistory(prev => ({
                    ...prev,
                    [activeProvider]: clearSearchHistory(activeProvider),
                  }))
                }
              />
            )}

            {songs.length > 0 && message && (
              <p className="status" role={messageRole}>
                {message}
              </p>
            )}

            {activeProvider === 'netease' &&
              ws.trackOrigin === 'playlist' &&
              ws.qqPlaylist &&
              !songs.length &&
              message !== '正在加载歌单…' &&
              message !== '歌单为空' && (
                <button
                  type="button"
                  className="nr-soft-btn"
                  onClick={() => openList(ws.qqPlaylist, ws.qqTrackPage || 1)}
                >
                  重试歌单
                </button>
              )}

            {activeProvider === 'netease' && ws.fmView && fm.current.error && (
              <button type="button" className="nr-soft-btn" onClick={loadFm}>
                重试私人 FM
              </button>
            )}

            {ws.trackOrigin === 'playlist' && ws.qqPlaylist && ws.qqTrackPage > 0 && (
              <div className="pagination" aria-label="歌单歌曲分页">
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={ws.qqTrackPage <= 1}
                  onClick={() => openList(ws.qqPlaylist, ws.qqTrackPage - 1)}
                >
                  歌单上一页
                </button>
                <span>第 {ws.qqTrackPage} 页</span>
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={
                    ws.qqHasMore === false ||
                    ws.qqTrackPage >= (activeProvider === 'qqmusic' ? 100 : 10000)
                  }
                  onClick={() => openList(ws.qqPlaylist, ws.qqTrackPage + 1)}
                >
                  歌单下一页
                </button>
              </div>
            )}

            {activeProvider === 'qqmusic' && ws.page > 0 && (
              <div className="pagination" aria-label="搜索分页">
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={ws.page <= 1 || ws.searching}
                  onClick={() => search(null, ws.page - 1)}
                >
                  上一页
                </button>
                <span>第 {ws.page} 页 · 总数未知</span>
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={ws.page >= 1000 || ws.searching}
                  onClick={() => search(null, ws.page + 1)}
                >
                  请求下一页
                </button>
              </div>
            )}
          </section>
        </div>
      </main>

      {view === 'stage' && (
        <RadioStage
          song={song}
          playing={playing}
          buffering={buffering}
          pending={!!pendingPlay.current}
          activeProvider={activeProvider}
          playingQueue={playingQueue}
          showLyrics={showLyrics}
          setShowLyrics={setShowLyrics}
          stagePreview={stagePreview}
          lyricStatus={lyricStatus}
          togglePlayback={togglePlayback}
          play={play}
        />
      )}

      <MoreSettingsPanel
        showMore={showMore}
        setShowMore={setShowMore}
        playbackRate={playbackRate}
        onChangeRate={changePlaybackRate}
        sleepMode={sleepMode}
        onSelectSleep={selectSleepMode}
        reportAllowed={reportAllowed}
        onToggleReport={() => {
          const next = !reportAllowed;
          listening.current.setReportingAllowed(next);
          setReportAllowed(next);
        }}
        showDiagnostics={showDiagnostics}
        onToggleDiagnostics={() => {
          const next = !diagnosticsOn.current;
          diagnosticsOn.current = next;
          listening.current.setDiagnosticsEnabled(next);
          setLastDiagnostic(null);
          setShowDiagnostics(next);
        }}
        diagnostic={diagnostic}
        diagnosticText={diagnosticText}
        showNowDetails={showNowDetails}
        setShowNowDetails={setShowNowDetails}
        closeMode={closeMode}
        onOpenCloseSettings={() => {
          setShowMore(false);
          setCloseError('');
          setCloseDialog('settings');
        }}
      />

      <FloatingDock
        view={view}
        song={song}
        playing={playing}
        buffering={buffering}
        pending={!!pendingPlay.current}
        activeProvider={activeProvider}
        audio={audio}
        restoredProgress={restoredProgress}
        onSeekEnd={() => scheduleSave(true)}
        onSeek={value => {
          if (
            (saved.current.resume && song?.provider === 'netease') ||
            (qqSaved.current.resume && song?.provider === 'qqmusic')
          ) {
            const pending = song.provider === 'netease' ? saved.current.resume : qqSaved.current.resume;
            pending.position = value;
            setRestoredProgress(p => (p ? { ...p, position: value } : p));
            scheduleSave();
          } else {
            audio.current.currentTime = value;
          }
        }}
        skipTrack={skipTrack}
        togglePlayback={togglePlayback}
        mode={mode}
        onCycleMode={cycleMode}
        muted={muted}
        volume={volume}
        onToggleMute={() => {
          audio.current.muted = !audio.current.muted;
        }}
        onVolumeChange={v => {
          audio.current.volume = v;
        }}
        onVolumeCommit={() => scheduleSave(true)}
        onOpenQueue={() => {
          setShowQueue(true);
          setConfirmClear(false);
        }}
        showLyrics={showLyrics}
        onToggleLyrics={() => setShowLyrics(!showLyrics)}
        showMore={showMore}
        onToggleMore={() => setShowMore(!showMore)}
        playbackRate={playbackRate}
        sleepLabel={sleepLabel}
        queueCount={ws.queue?.tracks?.length || 0}
      />

      {/* 全应用唯一 <audio> 实例，绝不因切换视图或平台重建 */}
      <audio
        ref={audio}
        onTimeUpdate={e => {
          const a = e.currentTarget;
          if (['netease', 'qqmusic'].includes(songRef.current?.provider)) scheduleSave();
          if (!a.paused && !a.seeking) {
            listening.current.progress(a.currentTime, performance.now(), a.playbackRate);
          }
          syncLyric(a.currentTime);
          if (diagnosticsOn.current) {
            const tick = Math.floor(a.currentTime);
            if (tick !== diagnosticTick.current) {
              diagnosticTick.current = tick;
              diagnosticsChanged();
            }
          }
        }}
        onPlay={() => setBuffering(true)}
        onPlaying={e => {
          setBuffering(false);
          setPlaying(true);
          recordRecent();
          const a = e.currentTarget;
          if (!a.seeking) listening.current.resume(a.currentTime, performance.now(), a.playbackRate);
        }}
        onWaiting={e => {
          setBuffering(true);
          sampleListening(e.currentTarget);
          listening.current.interrupt('buffering');
          diagnosticsChanged();
        }}
        onStalled={e => {
          if (e.currentTarget.readyState < 3) {
            setBuffering(true);
            sampleListening(e.currentTarget);
            listening.current.interrupt('buffering');
            diagnosticsChanged();
          }
        }}
        onSeeking={() => {
          listening.current.interrupt('seek');
          diagnosticsChanged();
        }}
        onSeeked={e => {
          scheduleSave();
          const a = e.currentTarget;
          syncLyric(a.currentTime);
          if (!a.paused && a.readyState >= 3) {
            listening.current.resume(a.currentTime, performance.now(), a.playbackRate);
          }
        }}
        onRateChange={e => {
          const a = e.currentTarget;
          listening.current.interrupt();
          if (!a.paused && !a.seeking && a.readyState >= 3) {
            listening.current.resume(a.currentTime, performance.now(), a.playbackRate);
          }
        }}
        onVolumeChange={e => {
          const a = e.currentTarget;
          settings.current.volume = a.volume;
          settings.current.muted = a.muted;
          setVolume(a.volume);
          setMuted(a.muted);
          scheduleSave();
        }}
        onPause={e => {
          setBuffering(false);
          scheduleSave(true);
          sampleListening(e.currentTarget);
          listening.current.interrupt('pause');
          diagnosticsChanged();
          setPlaying(false);
        }}
        onEnded={async e => {
          setBuffering(false);
          sampleListening(e.currentTarget);
          listening.current.settle();
          if (diagnosticsOn.current) setLastDiagnostic(listening.current.diagnosticSnapshot());
          setPlaying(false);
          if (sleepRef.current.mode === 'track') {
            sleepRef.current.mode = 'off';
            setSleepMode('off');
            const curProvider = songRef.current?.provider || activeRef.current;
            update(curProvider, { message: '本首已播完，睡眠定时已暂停播放' });
            scheduleSave(true);
            return;
          }
          if (pendingPlay.current) return;
          const current = songRef.current;
          if (!current) return;
          let queue = workRef.current[current.provider].queue;
          if (
            !queue ||
            queue.accountId !== current.accountId ||
            queue.tracks[queue.index]?.id !== current.id
          )
            return;
          if (queue.type === 'fm' && queue.index + 1 >= queue.tracks.length && fm.current.pending) {
            await fm.current.pending;
            if (songRef.current !== current || pendingPlay.current) return;
            queue = workRef.current[current.provider].queue;
            if (
              !queue ||
              queue.type !== 'fm' ||
              queue.accountId !== current.accountId ||
              queue.tracks[queue.index]?.id !== current.id
            )
              return;
          }
          const index = nextIndex(
            queueMode(settings.current.mode, queue),
            queue.index,
            queue.tracks.length
          );
          if (index >= 0) play(queue.tracks[index], { ...queue, index });
          else scheduleSave(true);
        }}
        onError={() => {
          setBuffering(false);
          setPlaying(false);
          listening.current.interrupt();
          const current = songRef.current;
          if (current) {
            update(current.provider, { message: '音频加载失败，请重试' });
            if (current.provider === 'qqmusic') void refreshQqDiagnostic();
          }
        }}
      />

      <QueueDrawer
        showQueue={showQueue}
        setShowQueue={setShowQueue}
        confirmClear={confirmClear}
        setConfirmClear={setConfirmClear}
        activeProvider={activeProvider}
        ws={ws}
        song={song}
        pendingPlay={!!pendingPlay.current}
        selectedTrack={selectedTrack}
        setSelectedTrack={setSelectedTrack}
        play={play}
        editQueue={editQueue}
      />

      {showLyrics && (
        <LyricPanel
          stage={view === 'stage'}
          lyrics={lyrics}
          index={lyricIndex}
          status={lyricStatus}
          onClose={() => setShowLyrics(false)}
          onSeek={at => {
            if (audio.current && !saved.current.resume && !qqSaved.current.resume) {
              audio.current.currentTime = at;
              syncLyric(at);
              scheduleSave();
            }
          }}
        />
      )}

      <QqAuthDialog
        open={qqWebOpen}
        busy={workspaces.qqmusic.accountBusy}
        message={workspaces.qqmusic.message}
        onComplete={completeQqWeb}
        onCancel={cancelQqWeb}
      />

      <CloseBehaviorDialog
        closeDialog={closeDialog}
        closeBusy={closeBusy}
        trayAvailable={trayAvailable}
        closeError={closeError}
        onChoose={chooseClose}
        onCancel={() => setCloseDialog(null)}
      />

      <QrDialog qr={qr} onClose={closeQr} />
    </div>
  );
}
