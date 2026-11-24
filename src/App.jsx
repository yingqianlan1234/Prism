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
  QUALITY_LABELS,
  loadNeteaseQuality,
  saveNeteaseQuality,
  isOwnedPlaylist,
  DEFAULT_SHORTCUT_BINDINGS,
  clipLyricField,
  normalizeLocalTrack,
} from './utils/format.js';
import { PlaylistCover, InlineNotice } from './components/Artwork.jsx';
import { AppHeader } from './components/AppHeader.jsx';
import { LibraryBar } from './components/LibraryBar.jsx';
import {
  SongList,
  TrackListSkeleton,
  EmptyState,
  LocalEmptyState,
  NowPanel,
  SearchCategoryBar,
  SearchCategoryResults,
} from './components/LibraryContent.jsx';
import { RadioStage } from './components/RadioStage.jsx';
import { FloatingDock } from './components/FloatingDock.jsx';
import { LyricPanel } from './components/LyricPanel.jsx';
import {
  MoreSettingsPanel,
  QueueDrawer,
  QqAuthDialog,
  CloseBehaviorDialog,
  QrDialog,
  PlaylistPickerDialog,
  GlobalShortcutsDialog,
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
  searchType: 1,
  searchTotal: null,
  searchItems: [],
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
  const { netease, getProvider, capabilities, platformFlavor, latestRequest, desktop, local } = providers;
  const canGlobalShortcuts = Boolean(capabilities?.desktop?.globalShortcuts && desktop?.globalShortcutsGet);
  const canDesktopLyric = Boolean(capabilities?.desktop?.desktopLyric && desktop?.desktopLyricGet);
  const canLocalLibrary = Boolean(capabilities?.local?.getTracks && local?.getFolders);
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

  const makeLocalWorkspace = () => ({
    ...makeWorkspace(),
    title: '全部本地歌曲',
    profile: { userId: 'local', nickname: '本地曲库' },
    identityUnknown: false,
    message: '',
    trackOrigin: 'local',
  });

  const [activeProvider, setActiveProvider] = useState('netease');
  const activeRef = useRef('netease');
  const [workspaces, setWorkspaces] = useState(() => ({
    netease: makeWorkspace(),
    qqmusic: makeWorkspace(),
    local: makeLocalWorkspace(),
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
  const setQuery = value => {
    if (activeRef.current === 'local') {
      applyLocalView(localTracksRef.current, localActiveFolderRef.current, value);
    } else {
      update(activeRef.current, { query: value });
    }
  };

  // 本地搜索历史（按平台隔离）
  const [searchHistory, setSearchHistory] = useState(() => ({
    netease: loadSearchHistory('netease'),
    qqmusic: loadSearchHistory('qqmusic'),
    local: [],
  }));

  // 播放倍速与睡眠定时（纯前端实用辅助，事件/单次定时器驱动）
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sleepMode, setSleepMode] = useState('off');
  const sleepRef = useRef({ mode: 'off', timer: null });

  // 网易云 P1 增强能力状态：音质档位、红心喜欢集合、FM 跳过、歌单收藏与移出
  const [neteaseQuality, setNeteaseQuality] = useState(() => loadNeteaseQuality());
  const qualityRef = useRef(neteaseQuality);
  const [trackQuality, setTrackQuality] = useState(null);
  const [likedIds, setLikedIds] = useState(() => new Set());
  const [likedBusyIds, setLikedBusyIds] = useState(() => new Set());
  const [fmTrashBusy, setFmTrashBusy] = useState(false);
  const [pickerTrack, setPickerTrack] = useState(null);
  const [pickerBusyId, setPickerBusyId] = useState(null);
  const [pickerError, setPickerError] = useState('');
  const [removingTrackKey, setRemovingTrackKey] = useState(null);

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
  const localSaved = useRef({ resume: null, position: 0, cleared: false, lastKey: '' });
  const providerSettings = useRef({ netease: null, qqmusic: null, local: null });
  const bootProvider = useRef('netease');

  // P2-B 本地音乐曲库状态
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

  // P2-A 全局系统快捷键与桌面悬浮歌词状态
  const [globalShortcuts, setGlobalShortcuts] = useState(() => ({
    enabled: false,
    bindings: { ...DEFAULT_SHORTCUT_BINDINGS },
    error: null,
  }));
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [shortcutsBusy, setShortcutsBusy] = useState(false);
  const [shortcutsError, setShortcutsError] = useState('');
  const [desktopLyric, setDesktopLyric] = useState({ enabled: false, locked: false, position: null });
  const desktopLyricRef = useRef({ enabled: false, locked: false, position: null });
  const [desktopLyricBusy, setDesktopLyricBusy] = useState(false);
  const [desktopLyricError, setDesktopLyricError] = useState('');
  const lastDesktopLyricKeyRef = useRef(null);
  const desktopHandlersRef = useRef({});

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
      : showShortcuts
        ? '.nr-shortcuts-dialog'
        : pickerTrack
          ? '.nr-picker-dialog'
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
  }, [showQueue, showShortcuts, !!pickerTrack, !!qr, qqWebOpen]);

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
  const browse = useRef({
    netease: latestRequest(),
    qqmusic: latestRequest(),
    local: latestRequest(),
  });
  const playback = useRef(latestRequest());
  const account = useRef({
    netease: latestRequest(),
    qqmusic: latestRequest(),
    local: latestRequest(),
  });
  const identity = useRef({
    netease: latestRequest(),
    qqmusic: latestRequest(),
    local: latestRequest(),
  });
  const qrRequest = useRef(latestRequest());

  const errorText = e => e?.message || '操作失败，请稍后重试';
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
      setLyricIndex(index);
    }
  };

  const replaceLyrics = (items, explicitPosition = null) => {
    lyricsRef.current = items;
    setLyrics(items);
    if (!items.length) {
      lyricIndexRef.current = -1;
      setLyricIndex(-1);
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

  const saveLocalQueue = () => {
    if (!canLocalLibrary || !capabilities?.local?.persistQueue || !localInitRef.current.ready) return;
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
      setLikedIds(new Set());
      setLikedBusyIds(new Set());
      setFmTrashBusy(false);
      setPickerTrack(null);
      setPickerBusyId(null);
      setPickerError('');
      setRemovingTrackKey(null);
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
      setTrackQuality(null);
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
      searchType: 1,
      searchTotal: null,
      searchItems: [],
      storageStatus: '',
      title: '发现音乐',
    });
  };

  const tagged = (items, id, accountId) => items.map(item => ({ ...item, provider: id, accountId }));

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
        void loadLikedIds(token, next.userId);
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

  const applyLocalView = (allTracks, folderId = localActiveFolderRef.current, term = workRef.current.local.query, extraPatch = {}) => {
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
    const items = Array.isArray(page?.tracks) ? page.tracks.map(normalizeLocalTrack).filter(Boolean) : [];
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
    setLocalTruncated(Boolean(scanRes?.truncated));
    const unavailable = Array.isArray(scanRes?.unavailableFolderIds) ? scanRes.unavailableFolderIds : [];
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
    if (id === 'local') {
      void initLocalLibrary();
      return;
    }
    if (workRef.current[id].identityUnknown && !workRef.current[id].accountBusy) restore(id);
  };

  const search = async (e, page = 1, explicitTerm = null, explicitType = null) => {
    e?.preventDefault();
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
      fmView: false,
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
      searchItems: [],
      searchTotal: null,
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
      searchItems: [],
      searchTotal: null,
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
      searchItems: [],
      searchTotal: null,
      recommendLists: null,
      message: fm.current.error || (!fm.current.tracks.length ? '正在加载…' : ''),
    });
    if (!fm.current.tracks.length && !fm.current.pending) loadFm();
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
        ...(workRef.current.netease.fmView ? { songs: [...nextTracks] } : {}),
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

  const openPlaylistPicker = track => {
    if (!track || track.provider !== 'netease' || !capabilities.netease.editPlaylistTracks) return;
    const w = workRef.current.netease;
    if (w.identityUnknown || !w.profile?.userId) {
      update('netease', { message: '请先登录网易云音乐' });
      return;
    }
    setPickerError('');
    setPickerTrack(track);
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
    let trialBanner = '';
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
      const url =
        id === 'netease'
          ? await p.resolvePlayback(
              s.id,
              capabilities[id].playbackQuality && qualityRef.current !== 'standard'
                ? { level: qualityRef.current }
                : undefined
            )
          : id === 'local'
            ? await p.resolvePlayback(s.id)
            : await p.resolvePlayback(s.id, s.mediaMid);
      if (!valid()) return;
      let streamUrl = '';
      let info = null;
      if (id === 'local') {
        streamUrl = url?.url || '';
        if (!streamUrl) throw Error('未获取到本地音频地址');
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
        id === 'netease' && (info?.level || info?.br || isTrial)
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
          : id === 'local' && localSaved.current.resume?.id === s.id
            ? localSaved.current.resume.position
            : saved.current.resume?.provider === id && saved.current.resume?.id === s.id
              ? saved.current.resume.position
              : 0;
      saved.current.resume = null;
      qqSaved.current.resume = null;
      localSaved.current.resume = null;
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
      setTrackQuality(nextTrackQuality);
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
      } else if (id === 'local') {
        localSaved.current.position = resume;
        localSaved.current.cleared = false;
      }
      if (snapshot.type === 'fm' && snapshot.tracks.length - snapshot.index <= 2 && !fm.current.error) {
        loadFm();
      }
      audio.current.src = streamUrl;
      syncLyric(resume);
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
        update(id, { message: trialBanner });
      }
    } catch (e) {
      if (valid()) {
        if (isPlayInterruptedError(e)) {
          rollbackRef.current = null;
          setBuffering(false);
          setPlaying(false);
          const curMsg = workRef.current[id].message;
          if (trialBanner || curMsg === '正在获取歌曲…') {
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
          setTrackQuality(prior.trackQuality ?? null);
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
    if (!audio.current.paused) {
      audio.current.pause();
      return;
    }
    if (
      (saved.current.resume && current.provider === 'netease') ||
      (qqSaved.current.resume && current.provider === 'qqmusic') ||
      (localSaved.current.resume && current.provider === 'local') ||
      !audio.current.getAttribute('src')
    ) {
      if (pendingPlay.current) return;
      const q = workRef.current[current.provider].queue;
      if (q) play(current, q);
      return;
    }
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
    const next = Math.min(1, Math.max(0, Math.round((a.volume + delta) * 100) / 100));
    a.volume = next;
    if (delta > 0 && a.muted) a.muted = false;
    scheduleSave(true);
  };

  const setDesktopLyricState = async ({ enabled, locked }) => {
    if (!canDesktopLyric || desktopLyricBusy) return;
    setDesktopLyricBusy(true);
    setDesktopLyricError('');
    try {
      const res = await desktop.desktopLyricSet({ enabled, locked });
      const next = {
        enabled: Boolean(res?.enabled),
        locked: Boolean(res?.locked),
        position: res?.position ?? null,
      };
      const turnedOn = next.enabled && !desktopLyricRef.current.enabled;
      desktopLyricRef.current = next;
      if (!next.enabled || turnedOn) lastDesktopLyricKeyRef.current = null;
      setDesktopLyric(next);
    } catch (e) {
      setDesktopLyricError(errorText(e));
    } finally {
      setDesktopLyricBusy(false);
    }
  };

  const toggleDesktopLyric = () => {
    void setDesktopLyricState({ enabled: !desktopLyricRef.current.enabled });
  };

  const toggleDesktopLyricLock = () => {
    void setDesktopLyricState({
      enabled: desktopLyricRef.current.enabled,
      locked: !desktopLyricRef.current.locked,
    });
  };

  const updateGlobalShortcuts = async ({ enabled, bindings }) => {
    if (!canGlobalShortcuts || shortcutsBusy) return { ok: false };
    setShortcutsBusy(true);
    setShortcutsError('');
    try {
      const res = await desktop.globalShortcutsSet({ enabled, bindings });
      setGlobalShortcuts({
        enabled: Boolean(res?.enabled),
        bindings: { ...DEFAULT_SHORTCUT_BINDINGS, ...(res?.bindings || bindings || {}) },
        error: res?.error || null,
      });
      return { ok: true };
    } catch (e) {
      setShortcutsError(errorText(e));
      if (e?.code === 'storage') {
        desktop
          .globalShortcutsGet()
          .then(res => {
            if (res) {
              setGlobalShortcuts({
                enabled: Boolean(res.enabled),
                bindings: { ...DEFAULT_SHORTCUT_BINDINGS, ...(res.bindings || {}) },
                error: res.error || null,
              });
            }
          })
          .catch(() => {});
      }
      return { ok: false, error: e };
    } finally {
      setShortcutsBusy(false);
    }
  };

  desktopHandlersRef.current = {
    togglePlayback,
    prevTrack: () => skipTrack(-1),
    nextTrack: () => skipTrack(1),
    volumeUp: () => adjustVolume(0.05),
    volumeDown: () => adjustVolume(-0.05),
    toggleDesktopLyric,
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

  // P2-A 启动状态同步与全局快捷键 / 原生桌面歌词事件监听
  useEffect(() => {
    if (!canGlobalShortcuts && !canDesktopLyric) return;
    let active = true;
    const offs = [];
    if (canGlobalShortcuts) {
      desktop
        .globalShortcutsGet()
        .then(res => {
          if (!active || !res) return;
          setGlobalShortcuts({
            enabled: Boolean(res.enabled),
            bindings: { ...DEFAULT_SHORTCUT_BINDINGS, ...(res.bindings || {}) },
            error: res.error || null,
          });
          if (res.error?.message) setShortcutsError(res.error.message);
        })
        .catch(() => {});
    }
    if (canDesktopLyric) {
      desktop
        .desktopLyricGet()
        .then(res => {
          if (!active || !res) return;
          const next = {
            enabled: Boolean(res.enabled),
            locked: Boolean(res.locked),
            position: res.position ?? null,
          };
          desktopLyricRef.current = next;
          setDesktopLyric(next);
        })
        .catch(() => {});
    }
    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        if (canGlobalShortcuts) {
          const eventName = desktop?.events?.globalShortcut || 'prism:global-shortcut';
          const unShortcut = await listen(eventName, e => {
            if (!active) return;
            const action = e?.payload?.action;
            if (typeof action === 'string') {
              desktopHandlersRef.current[action]?.();
            }
          });
          if (!active) unShortcut();
          else offs.push(unShortcut);
        }
        if (canDesktopLyric) {
          const eventName = desktop?.events?.desktopLyricState || 'prism:desktop-lyric-state';
          const unLyric = await listen(eventName, e => {
            if (!active || !e?.payload || typeof e.payload.enabled !== 'boolean') return;
            const next = {
              enabled: Boolean(e.payload.enabled),
              locked: Boolean(e.payload.locked),
              position: e.payload.position ?? desktopLyricRef.current.position ?? null,
            };
            const turnedOn = next.enabled && !desktopLyricRef.current.enabled;
            desktopLyricRef.current = next;
            if (!next.enabled || turnedOn) lastDesktopLyricKeyRef.current = null;
            setDesktopLyric(next);
          });
          if (!active) unLyric();
          else offs.push(unLyric);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      offs.forEach(fn => fn());
    };
  }, []);

  // 事件驱动推送桌面悬浮歌词：仅在桌面歌词开启且当前行、歌名或播放态变化时触发
  useEffect(() => {
    if (!canDesktopLyric || !desktopLyric.enabled) {
      lastDesktopLyricKeyRef.current = null;
      return;
    }
    const currentLine = lyricIndex >= 0 ? lyrics[lyricIndex] : null;
    const titleText = song
      ? clipLyricField(artist(song) ? `${song.name} - ${artist(song)}` : song.name, 200)
      : '';
    let mainText = '';
    if (currentLine?.text) {
      mainText = currentLine.text;
    } else if (!song) {
      mainText = '还没有播放歌曲';
    } else if (lyricStatus === 'loading') {
      mainText = '正在加载歌词…';
    } else if (lyricStatus === 'instrumental') {
      mainText = '纯音乐，暂无歌词';
    } else if (lyricStatus === 'error') {
      mainText = '歌词加载失败';
    } else if (lyrics.length > 0) {
      mainText = song.name || '…';
    } else {
      mainText = '暂无歌词';
    }
    const payload = {
      text: clipLyricField(mainText),
      translation: clipLyricField(currentLine?.translation || ''),
      romaji: clipLyricField(currentLine?.romaji || ''),
      title: titleText,
      playing: Boolean(playing),
    };
    const key = JSON.stringify(payload);
    if (lastDesktopLyricKeyRef.current === key) return;
    lastDesktopLyricKeyRef.current = key;
    desktop.desktopLyricUpdate(payload).catch(() => {});
  }, [canDesktopLyric, desktopLyric.enabled, song, lyrics, lyricIndex, lyricStatus, playing]);

  // 单次下一句精准唤醒定时器（亚 30ms 节拍同步，零轮询，隐藏/暂停即撤销）
  useEffect(() => {
    if (!playing || !lyrics.length) return undefined;
    let timer = null;
    const scheduleNext = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof document !== 'undefined' && document.hidden) return;
      const a = audio.current;
      if (!a) return;
      const next = lyrics[lyricIndex + 1];
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
    const delayMsBound = ms => (Number.isFinite(ms) ? ms : 1000);
    scheduleNext();
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden && audio.current) {
        syncLyric(audio.current.currentTime || 0);
        scheduleNext();
      }
    };
    document?.addEventListener?.('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document?.removeEventListener?.('visibilitychange', onVisible);
    };
  }, [playing, lyrics, lyricIndex, playbackRate, song]);

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
            void loadLikedIds(accountToken, userId);
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
        } else if (showShortcuts) {
          setShowShortcuts(false);
          e.preventDefault();
        } else if (pickerTrack) {
          setPickerTrack(null);
          setPickerError('');
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
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (
          showQueue ||
          showShortcuts ||
          pickerTrack ||
          qr ||
          qqWebOpen ||
          showLyrics ||
          confirmRecent ||
          closeDialog
        )
          return;
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
        adjustVolume(e.key === 'ArrowUp' ? 0.05 : -0.05);
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

  const messageRole = /失败|无法|不可用|超时|过期|未获取|请先登录|只能修改|权限/.test(message)
    ? 'alert'
    : 'status';
  const noSearchResults =
    ws.trackOrigin === 'search' &&
    !ws.searching &&
    ['没有找到歌曲', '本页没有找到歌曲', '没有找到专辑', '没有找到歌手', '没有找到歌单'].includes(
      message
    );
  const neteaseSignedIn = !!(
    workspaces.netease.profile?.userId && !workspaces.netease.identityUnknown
  );
  const ownedPlaylists = workspaces.netease.lists.filter(l =>
    isOwnedPlaylist(l, workspaces.netease.profile?.userId)
  );
  const canRemoveFromPlaylist =
    activeProvider === 'netease' &&
    capabilities.netease.editPlaylistTracks &&
    ws.trackOrigin === 'playlist' &&
    isOwnedPlaylist(ws.qqPlaylist, profile?.userId);
  const neteaseMaxPage =
    ws.searchTotal != null ? Math.min(26, Math.max(1, Math.ceil(ws.searchTotal / 40))) : null;
  const showNeteasePagination =
    activeProvider === 'netease' &&
    capabilities.netease.searchPagination &&
    ws.trackOrigin === 'search' &&
    ws.page > 0 &&
    !ws.searching &&
    ((neteaseMaxPage != null && neteaseMaxPage > 1) ||
      ws.page > 1 ||
      (ws.searchType === 1 ? songs.length >= 40 : (ws.searchItems?.length || 0) >= 40));

  const isListLoading =
    ws.searching ||
    ['正在加载歌单…', '正在加载…', '正在搜索…', '正在读取本地记录…'].includes(message) ||
    (activeProvider === 'local' && localBusy);

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
        canLocalLibrary={canLocalLibrary}
        isListLoading={isListLoading}
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
          if (activeProvider === 'local') {
            selectLocalFolder(null);
            applyLocalView(localTracksRef.current, null, '');
            return;
          }
          recommendationPending.current = false;
          browse.current[activeProvider].next();
          update(activeProvider, {
            title: '发现音乐',
            songs: [],
            searchItems: [],
            searchTotal: null,
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
        localFolders={localFolders}
        localActiveFolderId={localActiveFolderId}
        localTotal={localTotal}
        localBusy={localBusy}
        localUnavailableIds={localUnavailableIds}
        onSelectLocalFolder={selectLocalFolder}
        onPickLocalFolder={pickLocalFolder}
        onRemoveLocalFolder={removeLocalFolder}
        onScanLocalLibrary={scanLocalLibrary}
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

            {activeProvider === 'netease' &&
              capabilities.netease.searchCategories &&
              ws.trackOrigin === 'search' && (
                <SearchCategoryBar
                  searchType={ws.searchType}
                  disabled={ws.searching}
                  onSelectType={typeId => {
                    if (typeId !== ws.searchType && ws.searchQuery) {
                      search(null, 1, ws.searchQuery, typeId);
                    }
                  }}
                />
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
            ) : activeProvider === 'netease' &&
              ws.trackOrigin === 'search' &&
              ws.searchType !== 1 &&
              ws.searchItems?.length ? (
              <SearchCategoryResults
                searchType={ws.searchType}
                items={ws.searchItems}
                onOpenPlaylist={list => openList(list)}
                onSearchKeyword={term => search(null, 1, term, 1)}
              />
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
                neteaseSignedIn={neteaseSignedIn}
                canLike={!!capabilities.netease.likeTrack}
                canCollect={!!capabilities.netease.editPlaylistTracks && ownedPlaylists.length > 0}
                canRemoveFromPlaylist={canRemoveFromPlaylist}
                likedIds={likedIds}
                likedBusyIds={likedBusyIds}
                removingTrackKey={removingTrackKey}
                onToggleLike={toggleLike}
                onOpenPlaylistPicker={openPlaylistPicker}
                onRemoveFromPlaylist={removeTrackFromCurrentPlaylist}
              />
            ) : isListLoading ? (
              <TrackListSkeleton
                message={
                  message || (activeProvider === 'local' ? '正在扫描本地曲库…' : '正在加载曲目…')
                }
              />
            ) : activeProvider === 'local' ? (
              <LocalEmptyState
                foldersCount={localFolders.length}
                hasQuery={Boolean(String(query || '').trim())}
                query={query}
                busy={localBusy}
                message={message}
                messageRole={messageRole}
                onPickFolder={pickLocalFolder}
                onScan={scanLocalLibrary}
                onClearQuery={() => applyLocalView(localTracksRef.current, localActiveFolderRef.current, '')}
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

            {activeProvider === 'local' && localHasMore && (
              <div className="nr-local-more">
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={localBusy}
                  onClick={loadMoreLocalTracks}
                >
                  {localBusy ? '加载中…' : `加载更多本地曲目（已加载 ${songs.length} / ${localTotal}）`}
                </button>
              </div>
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

            {showNeteasePagination && (
              <div className="pagination" aria-label="网易云搜索分页">
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={ws.page <= 1 || ws.searching}
                  onClick={() => search(null, ws.page - 1, ws.searchQuery, ws.searchType)}
                >
                  上一页
                </button>
                <span>
                  {neteaseMaxPage != null ? `第 ${ws.page} / ${neteaseMaxPage} 页` : `第 ${ws.page} 页`}
                </span>
                <button
                  type="button"
                  className="nr-soft-btn"
                  disabled={
                    ws.searching ||
                    ws.page >= 26 ||
                    (neteaseMaxPage != null && ws.page >= neteaseMaxPage)
                  }
                  onClick={() => search(null, ws.page + 1, ws.searchQuery, ws.searchType)}
                >
                  下一页
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
          trackQuality={trackQuality}
          neteaseSignedIn={neteaseSignedIn}
          canLike={!!capabilities.netease.likeTrack}
          canCollect={!!capabilities.netease.editPlaylistTracks && ownedPlaylists.length > 0}
          canTrashFm={!!capabilities.netease.trashFmTrack && playingQueue?.type === 'fm'}
          isLiked={song?.provider === 'netease' && likedIds.has(Number(song.id))}
          likeBusy={song?.provider === 'netease' && likedBusyIds.has(Number(song.id))}
          fmTrashBusy={fmTrashBusy}
          onToggleLike={() => toggleLike(song)}
          onOpenPlaylistPicker={() => openPlaylistPicker(song)}
          onTrashFm={trashCurrentFmTrack}
        />
      )}

      <MoreSettingsPanel
        showMore={showMore}
        setShowMore={setShowMore}
        playbackRate={playbackRate}
        onChangeRate={changePlaybackRate}
        sleepMode={sleepMode}
        onSelectSleep={selectSleepMode}
        canSelectQuality={!!capabilities.netease.playbackQuality}
        neteaseQuality={neteaseQuality}
        onChangeQuality={changeNeteaseQuality}
        song={song}
        trackQuality={trackQuality}
        onReloadWithQuality={() => {
          if (song?.provider === 'netease' && playingQueue) {
            setShowMore(false);
            play(song, playingQueue);
          }
        }}
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
        canDesktopLyric={canDesktopLyric}
        desktopLyric={desktopLyric}
        desktopLyricBusy={desktopLyricBusy}
        desktopLyricError={desktopLyricError}
        onToggleDesktopLyric={toggleDesktopLyric}
        onToggleDesktopLyricLock={toggleDesktopLyricLock}
        canGlobalShortcuts={canGlobalShortcuts}
        globalShortcuts={globalShortcuts}
        onOpenShortcuts={() => {
          setShowMore(false);
          setShortcutsError(globalShortcuts.error?.message || '');
          setShowShortcuts(true);
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
            (qqSaved.current.resume && song?.provider === 'qqmusic') ||
            (localSaved.current.resume && song?.provider === 'local')
          ) {
            const pending =
              song.provider === 'netease'
                ? saved.current.resume
                : song.provider === 'qqmusic'
                  ? qqSaved.current.resume
                  : localSaved.current.resume;
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
        trackQuality={trackQuality}
        neteaseSignedIn={neteaseSignedIn}
        canLike={!!capabilities.netease.likeTrack}
        canTrashFm={!!capabilities.netease.trashFmTrack && playingQueue?.type === 'fm'}
        isLiked={song?.provider === 'netease' && likedIds.has(Number(song.id))}
        likeBusy={song?.provider === 'netease' && likedBusyIds.has(Number(song.id))}
        fmTrashBusy={fmTrashBusy}
        onToggleLike={() => toggleLike(song)}
        onTrashFm={trashCurrentFmTrack}
        canDesktopLyric={canDesktopLyric}
        desktopLyricEnabled={desktopLyric.enabled}
        desktopLyricLocked={desktopLyric.locked}
        desktopLyricBusy={desktopLyricBusy}
        onToggleDesktopLyric={toggleDesktopLyric}
        onToggleDesktopLyricLock={toggleDesktopLyricLock}
      />

      {/* 全应用唯一 <audio> 实例，绝不因切换视图或平台重建 */}
      <audio
        ref={audio}
        onTimeUpdate={e => {
          const a = e.currentTarget;
          if (['netease', 'qqmusic', 'local'].includes(songRef.current?.provider)) scheduleSave();
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
        onLoadedMetadata={e => {
          syncLyric(e.currentTarget.currentTime);
        }}
        onPlay={e => {
          if (e.currentTarget.readyState < 3) setBuffering(true);
        }}
        onPlaying={e => {
          setBuffering(false);
          setPlaying(true);
          recordRecent();
          const a = e.currentTarget;
          syncLyric(a.currentTime);
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
            if (
              audio.current &&
              !saved.current.resume &&
              !qqSaved.current.resume &&
              !localSaved.current.resume
            ) {
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

      <PlaylistPickerDialog
        track={pickerTrack}
        playlists={ownedPlaylists}
        busyId={pickerBusyId}
        error={pickerError}
        onSelect={addTrackToPlaylist}
        onClose={() => {
          setPickerTrack(null);
          setPickerError('');
        }}
      />

      <GlobalShortcutsDialog
        open={showShortcuts}
        status={globalShortcuts}
        busy={shortcutsBusy}
        error={shortcutsError}
        onToggleEnabled={(nextEnabled, bindings) => {
          void updateGlobalShortcuts({ enabled: nextEnabled, bindings });
        }}
        onSaveBindings={bindings => {
          void updateGlobalShortcuts({ enabled: globalShortcuts.enabled, bindings });
        }}
        onClose={() => {
          setShowShortcuts(false);
          setShortcutsError('');
        }}
      />

      <QrDialog qr={qr} onClose={closeQr} />
    </div>
  );
}
