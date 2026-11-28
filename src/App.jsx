import React, { useEffect, useRef, useState } from 'react';
import * as defaultProviders from './providers.js';
import { ListeningTracker as DefaultListeningTracker } from './listening.js';
import { nextIndex, queueMode } from './playback-state.js';
import {
  artist,
  accentFor,
  isOwnedPlaylist,
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
import { SettingsPage } from './components/SettingsPage.jsx';
import {
  QueueDrawer,
  QqAuthDialog,
  CloseBehaviorDialog,
  QrDialog,
  PlaylistPickerDialog,
  GlobalShortcutsDialog,
  AppUpdateDialog,
} from './components/Overlays.jsx';
import {
  filterCustomPlaylistTracks,
  summarizeCustomPlaylistSources,
  hydrateCustomTrack,
} from './custom-playlists.js';
import { useUpdater } from './hooks/useUpdater.js';
import { useCustomPlaylists } from './hooks/useCustomPlaylists.js';
import { useDesktopControls } from './hooks/useDesktopControls.js';
import { useLocalLibrary } from './hooks/useLocalLibrary.js';
import { useThemeAndAudioPrefs } from './hooks/useThemeAndAudioPrefs.js';
import { useLibraryBrowse } from './hooks/useLibraryBrowse.js';
import { usePlayback } from './hooks/usePlayback.js';
import { useAccounts } from './hooks/useAccounts.js';

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
  const { netease, getProvider, capabilities, recommendationCapabilities, platformFlavor, latestRequest, desktop, local } = providers;
  const canGlobalShortcuts = Boolean(capabilities?.desktop?.globalShortcuts && desktop?.globalShortcutsGet);
  const canDesktopLyric = Boolean(capabilities?.desktop?.desktopLyric && desktop?.desktopLyricGet);
  const canAppUpdater = Boolean(capabilities?.desktop?.appUpdater && desktop?.updaterConfigGet);
  const canLocalLibrary = Boolean(capabilities?.local?.getTracks && local?.getFolders);
  const canLocalCover = Boolean(capabilities?.local?.getCover && local?.getCover);
  const canCustomPlaylistsStorage = Boolean(
    capabilities?.desktop?.customPlaylistsStorage &&
      desktop?.customPlaylistsLoad &&
      desktop?.customPlaylistsSave
  );
  const canAutostart = Boolean(
    capabilities?.desktop?.autostart && desktop?.autostartGet && desktop?.autostartSet
  );
  const canFeedback = Boolean(capabilities?.desktop?.feedback && desktop?.feedbackSubmit);
  const canUseQq = capabilities?.qqmusic?.available !== false;
  const canChooseCloseBehavior = capabilities?.desktop?.closeBehavior !== false;

  const [view, setView] = useState('library');
  const [settingsSection, setSettingsSection] = useState('general');
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
  const [mixedQueue, setMixedQueue] = useState(null);
  const mixedQueueRef = useRef(null);

  const [reportAllowed, setReportAllowed] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [, setDiagnosticVersion] = useState(0);
  const [, setLastDiagnostic] = useState(null);
  const listening = useRef(null);
  const diagnosticsOn = useRef(false);
  if (!listening.current) listening.current = new ListeningTracker();

  const fm = useRef({
    accountId: null,
    tracks: [],
    seen: new Set(),
    pending: null,
    error: '',
    generation: 0,
  });
  const fmAutoStartRef = useRef(null);
  const searchInput = useRef(null);

  const recommendation = useRef(latestRequest());
  const recommendationPending = useRef(false);
  const browse = useRef({
    netease: latestRequest(),
    qqmusic: latestRequest(),
    local: latestRequest(),
  });
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
  const tagged = (items, id, accountId) => items.map(item => ({ ...item, provider: id, accountId }));
  const sampleListening = a => {
    if (a && !a.seeking) listening.current.progress(a.currentTime, performance.now(), a.playbackRate);
  };
  const diagnosticsChanged = () => {
    if (diagnosticsOn.current) setDiagnosticVersion(v => v + 1);
  };

  const playbackDepsRef = useRef({});
  const {
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
  } = usePlayback({
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
  });

  const {
    sleepMode,
    setSleepMode,
    sleepRef,
    selectSleepMode,
    audioPrefs,
    audioPrefsRef,
    audioOutputSupported,
    audioOutputDevices,
    audioOutputError,
    fadeActiveRef,
    refreshAudioOutputDevices,
    handleToggleSmoothFadeIn,
    handleToggleAutoOpenStage,
    handleSelectOutputDevice,
    stopSmoothFade,
    triggerSmoothFade,
    themePrefs,
    ambientLayerRef,
    handleChangeTheme,
    handleChangeAmbient,
    currentAccentRef,
  } = useThemeAndAudioPrefs({
    audio,
    settings,
    song,
    songRef,
    activeRef,
    playing,
    canLocalCover,
    local,
    update,
    onAccentChange: () => {
      if (desktopLyricRef.current.enabled && desktopLyricRef.current.style?.theme === 'accent') {
        triggerDesktopLyricSync();
      }
    },
  });

  const {
    closeMode,
    trayAvailable,
    closeDialog,
    setCloseDialog,
    closeError,
    closeBusy,
    chooseClose,
    handleChooseCloseMode,
    autostartEnabled,
    autostartBusy,
    autostartError,
    handleToggleAutostart,
    globalShortcuts,
    showShortcuts,
    setShowShortcuts,
    shortcutsBusy,
    shortcutsError,
    setShortcutsError,
    updateGlobalShortcuts,
    desktopLyric,
    desktopLyricRef,
    desktopLyricBusy,
    desktopLyricError,
    triggerDesktopLyricSync,
    toggleDesktopLyric,
    toggleDesktopLyricLock,
    updateDesktopLyricStyle,
  } = useDesktopControls({
    canChooseCloseBehavior,
    canAutostart,
    canGlobalShortcuts,
    canDesktopLyric,
    desktop,
    song,
    lyrics,
    playing,
    playbackRate,
    lyricStatus,
    audio,
    lyricIndexStore,
    currentAccentRef,
    errorText,
    beforeExit: async () => {
      scheduleSave(true);
      await saved.current.chain.catch(() => {});
    },
    shortcutActions: {
      togglePlayback,
      prevTrack: () => skipTrack(-1),
      nextTrack: () => skipTrack(1),
      volumeUp: () => adjustVolume(0.05),
      volumeDown: () => adjustVolume(-0.05),
    },
  });

  const {
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
  } = useLocalLibrary({
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
  });

  const {
    pickerTrack,
    setPickerTrack,
    pickerBusyId,
    setPickerBusyId,
    pickerError,
    setPickerError,
    customPlaylists,
    activeCustomPlaylistId,
    setActiveCustomPlaylistId,
    customPlaylistFilter,
    setCustomPlaylistFilter,
    customPlaylistNotice,
    setCustomPlaylistNotice,
    renamingCustomPlaylist,
    setRenamingCustomPlaylist,
    renameCustomDraft,
    setRenameCustomDraft,
    confirmDeleteCustom,
    setConfirmDeleteCustom,
    customImportStatus,
    activeCustomPlaylist,
    customTotalTracks,
    openPlaylistPicker,
    handleCreateCustomPlaylist,
    handleOpenCustomPlaylist,
    handleRenameCustomPlaylist,
    handleDeleteCustomPlaylist,
    handleAddTrackToCustom,
    handleCreateAndAddCustom,
    handleRemoveTrackFromCustom,
    handleExportCustomPlaylists,
    handleImportCustomPlaylists,
  } = useCustomPlaylists({
    canCustomPlaylistsStorage,
    desktop,
    activeRef,
    view,
    setView,
    update,
    mixedQueueRef,
    setMixedQueue,
  });

  const {
    updateConfig,
    updateState,
    showUpdaterDialog,
    setShowUpdaterDialog,
    updaterBusy,
    updateSummary,
    updateAttention,
    runUpdateCheck,
    handleChangeUpdateSource,
    handleSaveCustomMirror,
    handleToggleAutoCheck,
    handleSkipUpdateVersion,
    handleRemindLater,
    handleSwitchSourceAndRetry,
    startUpdateDownload,
    installDownloadedUpdate,
  } = useUpdater({
    canAppUpdater,
    desktop,
    errorText,
    beforeInstall: async () => {
      scheduleSave(true);
      await saved.current.chain.catch(() => {});
    },
  });

  const {
    searchHistory,
    clearProviderSearchHistory,
    neteaseQuality,
    qualityRef,
    qqQuality,
    qqQualityRef,
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
    changeQqQuality,
    toggleLike,
    trashCurrentFmTrack,
    addTrackToPlaylist,
    removeTrackFromCurrentPlaylist,
  } = useLibraryBrowse({
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
  });

  const {
    qr,
    qqWebOpen,
    qqDiagnostic,
    qqDiagnosticEnabled,
    refreshQqDiagnostic,
    toggleQqDiagnostic,
    loadLists,
    restore,
    closeQr,
    login,
    cancelQqWeb,
    completeQqWeb,
    logout,
  } = useAccounts({
    getProvider,
    capabilities,
    platformFlavor,
    canUseQq,
    activeRef,
    workRef,
    update,
    account,
    identity,
    browse,
    qrRequest,
    fm,
    fmAutoStartRef,
    recommendationPending,
    listening,
    saved,
    playback,
    errorText,
    clearProviderSavedState,
    stopProviderPlayback,
    restoreSaved,
    restoreQq,
    loadLikedIds,
    resetNeteaseBrowseState,
    clearPicker: () => {
      setPickerTrack(null);
      setPickerBusyId(null);
      setPickerError('');
    },
  });

  playbackDepsRef.current = {
    stopSmoothFade,
    triggerSmoothFade,
    audioPrefsRef,
    localInitRef,
    setCustomPlaylistNotice,
    qualityRef,
    qqQualityRef,
    setFmError,
    setFmStageFocus,
    loadFm,
    refreshQqDiagnostic,
  };

  const setQuery = value => {
    if (activeRef.current === 'local') {
      applyLocalView(localTracksRef.current, localActiveFolderRef.current, value);
    } else {
      update(activeRef.current, { query: value });
    }
  };

  const switchProvider = id => {
    setActiveCustomPlaylistId(null);
    setRenamingCustomPlaylist(false);
    setConfirmDeleteCustom(false);
    if (view === 'settings') setView('library');
    if (activeRef.current !== id) {
      const prevId = activeRef.current;
      fmAutoStartRef.current = null;
      recommendation.current.next();
      if (recommendationPending.current) {
        recommendationPending.current = false;
        update(prevId, { message: '推荐加载已取消' });
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

  // 模态弹窗焦点陷阱与关闭返还焦点
  useEffect(() => {
    const selector = showQueue
      ? '.queue-dialog'
      : showShortcuts
        ? '.nr-shortcuts-dialog'
        : showUpdaterDialog
          ? '.nr-update-dialog'
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
  }, [
    showQueue,
    showShortcuts,
    Boolean(showUpdaterDialog),
    !!pickerTrack,
    !!qr,
    qqWebOpen,
  ]);

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
        } else if (showUpdaterDialog) {
          setShowUpdaterDialog(false);
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
        } else if (showNowDetails && view === 'library') {
          setShowNowDetails(false);
          e.preventDefault();
        } else if (view === 'stage' || view === 'settings') {
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
        if (view !== 'library') {
          setView('library');
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
          showUpdaterDialog ||
          pickerTrack ||
          qr ||
          qqWebOpen ||
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

  const playingQueue = mixedQueue || (song ? workspaces[song.provider]?.queue : ws.queue);
  const customFilteredSongs = activeCustomPlaylist
    ? filterCustomPlaylistTracks(activeCustomPlaylist.tracks, customPlaylistFilter).map(t =>
        hydrateCustomTrack(t, workRef.current)
      )
    : [];
  const customSourceCounts = activeCustomPlaylist
    ? summarizeCustomPlaylistSources(activeCustomPlaylist.tracks)
    : null;
  const playCustomTrack = (track, list = customFilteredSongs) => {
    if (!activeCustomPlaylist || !list.length) return;
    const idx = list.findIndex(t => t.provider === track.provider && t.id === track.id);
    if (idx < 0) return;
    void play(
      list[idx],
      {
        type: 'custom',
        source: 'custom-playlist',
        playlistId: activeCustomPlaylist.id,
        playlistName: activeCustomPlaylist.name,
        tracks: list,
        index: idx,
      },
      { autoOpenStage: true }
    );
  };

  const sleepLabel =
    sleepMode === 'off' ? '' : sleepMode === 'track' ? '播完本首' : `${sleepMode}分`;

  return (
    <div
      className="app"
      data-skin="night-radio"
      data-theme={themePrefs.theme}
      data-ambient={themePrefs.ambient}
      data-view={view}
      data-details={showNowDetails ? 'open' : 'closed'}
      data-playing={playing ? 'true' : 'false'}
      style={{ '--lw-accent': accentFor(song) }}
    >
      <div className="nr-ambient-layer" ref={ambientLayerRef} aria-hidden="true">
        <span className="nr-ambient-grid" />
        <div className="nr-ambient-orbs">
          <span className="nr-orb is-tide" />
          <span className="nr-orb is-warm" />
          <span className="nr-orb is-cool" />
        </div>
      </div>
      <AppHeader
        capabilities={capabilities}
        platformFlavor={platformFlavor}
        canLocalLibrary={canLocalLibrary}
        isListLoading={isListLoading}
        view={view}
        setView={setView}
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
        updateAttention={updateAttention}
        updateHint={updateSummary?.hint || ''}
        onHome={() => {
          setActiveCustomPlaylistId(null);
          setRenamingCustomPlaylist(false);
          setConfirmDeleteCustom(false);
          if (view !== 'library') setView('library');
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
        qqRecommendationCapabilities={
          capabilities?.qqmusic?.getRecommendations
            ? recommendationCapabilities?.qqmusic || null
            : null
        }
        lists={lists}
        openList={openList}
        listStatus={listStatus}
        ws={ws}
        isFmPlaying={Boolean(song?.provider === 'netease' && playingQueue?.type === 'fm')}
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
        customPlaylists={customPlaylists}
        activeCustomPlaylistId={activeCustomPlaylistId}
        onOpenCustomPlaylist={handleOpenCustomPlaylist}
        onCreateCustomPlaylist={handleCreateCustomPlaylist}
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
            mixedQueue={mixedQueue}
            lyrics={lyrics}
            lyricIndexStore={lyricIndexStore}
            lyricStatus={lyricStatus}
            showLyrics={view === 'stage'}
            setShowLyrics={next => setView(next ? 'stage' : 'library')}
            setShowNowDetails={setShowNowDetails}
            setView={setView}
            setShowQueue={setShowQueue}
            setConfirmClear={setConfirmClear}
            qqDiagnosticEnabled={qqDiagnosticEnabled}
            qqDiagnostic={qqDiagnostic}
            toggleQqDiagnostic={toggleQqDiagnostic}
          />

          <section className="content">
            {activeCustomPlaylist ? (
              <>
                <div className="section-label">
                  <span>本机跨源歌单</span>
                  <span>
                    {`共 ${activeCustomPlaylist.tracks.length} 首 · 网易云 ${customSourceCounts.netease} · QQ ${customSourceCounts.qqmusic} · 本地 ${customSourceCounts.local}`}
                  </span>
                </div>

                {customPlaylistNotice && (
                  <InlineNotice
                    tone={/失败|无法|请先|不支持|重名|已存在/.test(customPlaylistNotice) ? 'err' : 'ok'}
                    role={/失败|无法|请先|不支持|重名|已存在/.test(customPlaylistNotice) ? 'alert' : 'status'}
                  >
                    {customPlaylistNotice}
                  </InlineNotice>
                )}

                <div className="heading">
                  <div>
                    <h1>{activeCustomPlaylist.name}</h1>
                    <p>保存在本机，可混搭网易云 / QQ 音乐 / 本地曲目连播，绝不回写原平台接口</p>
                  </div>

                  {customFilteredSongs.length > 0 && (
                    <button
                      type="button"
                      className="primary"
                      aria-label="播放本机歌单第一首"
                      onClick={() => playCustomTrack(customFilteredSongs[0], customFilteredSongs)}
                    >
                      ▶ <span>播放全部</span>
                    </button>
                  )}
                </div>

                <div className="nr-custom-hero-bar">
                  <input
                    type="search"
                    className="nr-custom-filter-input"
                    value={customPlaylistFilter}
                    placeholder="在本机歌单内筛选歌名、歌手、来源…"
                    aria-label="筛选本机歌单曲目"
                    onChange={e => setCustomPlaylistFilter(e.target.value)}
                  />
                  <div className="nr-custom-toolbar-actions">
                    <button
                      type="button"
                      className="nr-soft-btn"
                      onClick={() => {
                        setRenamingCustomPlaylist(v => !v);
                        setRenameCustomDraft(activeCustomPlaylist.name);
                      }}
                    >
                      重命名
                    </button>
                    <button type="button" className="nr-soft-btn" onClick={handleExportCustomPlaylists}>
                      导出备份
                    </button>
                    {!confirmDeleteCustom ? (
                      <button
                        type="button"
                        className="nr-danger-btn"
                        onClick={() => setConfirmDeleteCustom(true)}
                      >
                        删除歌单
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="nr-danger-btn"
                          onClick={() => handleDeleteCustomPlaylist(activeCustomPlaylist.id)}
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          className="nr-soft-btn"
                          onClick={() => setConfirmDeleteCustom(false)}
                        >
                          取消
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {renamingCustomPlaylist && (
                  <form
                    className="nr-custom-rename-form"
                    onSubmit={e => {
                      e.preventDefault();
                      handleRenameCustomPlaylist(renameCustomDraft);
                    }}
                  >
                    <input
                      type="text"
                      className="nr-custom-side-input"
                      maxLength={40}
                      value={renameCustomDraft}
                      aria-label="新歌单名称"
                      onChange={e => setRenameCustomDraft(e.target.value)}
                    />
                    <button type="submit" className="nr-primary-btn nr-custom-side-submit">
                      保存名称
                    </button>
                    <button
                      type="button"
                      className="nr-soft-btn"
                      onClick={() => setRenamingCustomPlaylist(false)}
                    >
                      取消
                    </button>
                  </form>
                )}

                {customFilteredSongs.length > 0 ? (
                  <SongList
                    songs={customFilteredSongs}
                    ws={ws}
                    activeProvider={activeProvider}
                    song={song}
                    selectedTrack={selectedTrack}
                    playing={playing}
                    buffering={buffering}
                    play={t => playCustomTrack(t, customFilteredSongs)}
                    setSelectedTrack={setSelectedTrack}
                    neteaseSignedIn={neteaseSignedIn}
                    canLike={false}
                    canCollect={false}
                    canCollectCustom={true}
                    canRemoveFromPlaylist={false}
                    canRemoveCustom={true}
                    showSourceTag={true}
                    likedIds={likedIds}
                    likedBusyIds={likedBusyIds}
                    removingTrackKey={removingTrackKey}
                    onToggleLike={toggleLike}
                    onOpenPlaylistPicker={openPlaylistPicker}
                    onRemoveFromCustom={t => handleRemoveTrackFromCustom(activeCustomPlaylist.id, t)}
                  />
                ) : (
                  <div className="empty">
                    <h2>{activeCustomPlaylist.tracks.length ? '没有匹配的歌曲' : '歌单还是空的'}</h2>
                    <p>
                      {activeCustomPlaylist.tracks.length
                        ? '换个关键词或清空筛选条件试试。'
                        : '在网易云、QQ 音乐或本地曲库任意歌曲右侧点击「+」，即可混搭加入此歌单。'}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="section-label">
                  <span>音乐库</span>
                  <span>{songs.length ? `当前页 ${songs.length} 首` : '搜索与收藏'}</span>
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
                      onClick={() => play(songs[0], undefined, { autoOpenStage: true })}
                    >
                      ▶ <span>播放第一首</span>
                    </button>
                  )}
                </div>

                {activeProvider === 'netease' &&
                  profile &&
                  !identityUnknown &&
                  (ws.trackOrigin === 'recommendation' ||
                    ['每日推荐', '推荐新歌', '为你推荐的歌单', '推荐歌单'].includes(title)) && (
                    <div className="nr-discover-tabs" role="tablist" aria-label="发现音乐分类">
                      {[
                        { id: 'daily', label: '每日推荐' },
                        { id: 'newsong', label: '推荐新歌' },
                        { id: 'resources', label: '为你推荐的歌单' },
                        { id: 'playlists', label: '推荐歌单' },
                      ].map(tab => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={title === tab.label}
                          className={'nr-discover-tab' + (title === tab.label ? ' is-active' : '')}
                          onClick={() => recommend(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}

                {activeProvider === 'qqmusic' &&
                  profile &&
                  !identityUnknown &&
                  platformFlavor.qqmusic !== 'mock' &&
                  (ws.trackOrigin === 'recommendation' ||
                    ['推荐新歌', '推荐歌单'].includes(title)) && (
                    <div className="nr-discover-tabs" role="tablist" aria-label="QQ 发现分类">
                      {capabilities?.qqmusic?.getRecommendations &&
                        recommendationCapabilities?.qqmusic?.newsong && (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={title === '推荐新歌'}
                            className={'nr-discover-tab' + (title === '推荐新歌' ? ' is-active' : '')}
                            onClick={() => recommend('newsong')}
                          >
                            推荐新歌
                          </button>
                        )}
                      {capabilities?.qqmusic?.getRecommendations &&
                        recommendationCapabilities?.qqmusic?.playlists && (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={title === '推荐歌单'}
                            className={'nr-discover-tab' + (title === '推荐歌单' ? ' is-active' : '')}
                            onClick={() => recommend('playlists')}
                          >
                            推荐歌单
                          </button>
                        )}
                    </div>
                  )}

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
                    <span className="lw-card-cover">
                      <PlaylistCover className="nr-rec-cover" url={l.picUrl || l.coverImgUrl} />
                    </span>
                    <span className="nr-rec-title">{l.name}</span>
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
                play={s => play(s, undefined, { autoOpenStage: true })}
                setSelectedTrack={setSelectedTrack}
                neteaseSignedIn={neteaseSignedIn}
                canLike={!!capabilities.netease.likeTrack}
                canCollect={!!capabilities.netease.editPlaylistTracks && ownedPlaylists.length > 0}
                canCollectCustom={true}
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
                onClearHistory={() => clearProviderSearchHistory(activeProvider)}
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
              </>
            )}
          </section>
        </div>
      </main>

      {view === 'settings' && (
        <SettingsPage
          activeSection={settingsSection}
          onSelectSection={setSettingsSection}
          onBackToLibrary={() => setView('library')}
          themePrefs={themePrefs}
          onChangeTheme={handleChangeTheme}
          onChangeAmbient={handleChangeAmbient}
          closeMode={closeMode}
          closeBusy={closeBusy}
          trayAvailable={trayAvailable}
          closeError={closeError}
          onChooseCloseMode={canChooseCloseBehavior ? handleChooseCloseMode : null}
          canAutostart={canAutostart}
          autostartEnabled={autostartEnabled}
          autostartBusy={autostartBusy}
          autostartError={autostartError}
          onToggleAutostart={handleToggleAutostart}
          customPlaylistCount={customPlaylists.length}
          customTrackCount={customTotalTracks}
          onExportCustomPlaylists={handleExportCustomPlaylists}
          onImportCustomPlaylists={handleImportCustomPlaylists}
          customImportStatus={customImportStatus}
          playbackRate={playbackRate}
          onChangeRate={changePlaybackRate}
          sleepMode={sleepMode}
          onSelectSleep={selectSleepMode}
          canSelectQuality={!!capabilities.netease.playbackQuality}
          neteaseQuality={neteaseQuality}
          onChangeQuality={changeNeteaseQuality}
          canSelectQqQuality={!!capabilities.qqmusic.playbackQuality}
          qqQuality={qqQuality}
          onChangeQqQuality={changeQqQuality}
          song={song}
          trackQuality={trackQuality}
          onReloadWithQuality={() => {
            if (song?.provider === 'netease' && playingQueue) {
              play(song, playingQueue);
            }
          }}
          onReloadQqWithQuality={() => {
            if (song?.provider === 'qqmusic' && playingQueue) {
              play(song, playingQueue);
            }
          }}
          audioPrefs={audioPrefs}
          onToggleSmoothFadeIn={handleToggleSmoothFadeIn}
          onToggleAutoOpenStage={handleToggleAutoOpenStage}
          audioOutputSupported={audioOutputSupported}
          audioOutputDevices={audioOutputDevices}
          audioOutputError={audioOutputError}
          onSelectOutputDevice={handleSelectOutputDevice}
          onRefreshOutputDevices={refreshAudioOutputDevices}
          canDesktopLyric={canDesktopLyric}
          desktopLyric={desktopLyric}
          desktopLyricBusy={desktopLyricBusy}
          desktopLyricError={desktopLyricError}
          onToggleDesktopLyric={toggleDesktopLyric}
          onToggleDesktopLyricLock={toggleDesktopLyricLock}
          onUpdateDesktopLyricStyle={updateDesktopLyricStyle}
          canGlobalShortcuts={canGlobalShortcuts}
          globalShortcuts={globalShortcuts}
          shortcutsBusy={shortcutsBusy}
          shortcutsError={shortcutsError}
          onToggleShortcutsEnabled={(nextEnabled, bindings) => {
            void updateGlobalShortcuts({ enabled: nextEnabled, bindings });
          }}
          onSaveShortcutBindings={bindings => {
            void updateGlobalShortcuts({ enabled: globalShortcuts.enabled, bindings });
          }}
          canAppUpdater={canAppUpdater}
          updateConfig={updateConfig}
          updateState={updateState}
          updateSummary={updateSummary}
          updaterBusy={updaterBusy}
          onCheckUpdate={() => {
            void runUpdateCheck({ silent: false });
          }}
          onDownloadUpdate={() => {
            void startUpdateDownload();
          }}
          onInstallUpdate={() => {
            void installDownloadedUpdate();
          }}
          onSkipUpdateVersion={version => {
            void handleSkipUpdateVersion(version);
          }}
          onChangeUpdateSource={nextSource => {
            void handleChangeUpdateSource(nextSource);
          }}
          onSaveMirror={nextMirror => {
            void handleSaveCustomMirror(nextMirror);
          }}
          onToggleAutoCheck={nextAutoCheck => {
            void handleToggleAutoCheck(nextAutoCheck);
          }}
          onSwitchSourceAndRetry={nextSource => {
            void handleSwitchSourceAndRetry(nextSource);
          }}
          canFeedback={canFeedback}
          feedbackContext={{
            appVersion: updateConfig?.currentVersion || '1.3.0',
            activeProvider,
            neteaseQuality,
            qqQuality,
            theme: themePrefs?.theme || 'night-radio',
          }}
          onSubmitFeedback={payload => desktop.feedbackSubmit(payload)}
        />
      )}

      {view === 'stage' && (
        <RadioStage
          song={song}
          playing={playing}
          buffering={buffering}
          pending={!!pendingPlay.current}
          activeProvider={activeProvider}
          playingQueue={playingQueue}
          lyricSlot={
            <LyricPanel
              stage
              embedded
              lyrics={lyrics}
              indexStore={lyricIndexStore}
              status={lyricStatus}
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
          }
          togglePlayback={togglePlayback}
          play={play}
          trackQuality={trackQuality}
          neteaseSignedIn={neteaseSignedIn}
          canLike={!!capabilities.netease.likeTrack}
          canCollect={Boolean(song)}
          canTrashFm={!!capabilities.netease.trashFmTrack && playingQueue?.type === 'fm'}
          isLiked={song?.provider === 'netease' && likedIds.has(Number(song.id))}
          likeBusy={song?.provider === 'netease' && likedBusyIds.has(Number(song.id))}
          fmTrashBusy={fmTrashBusy}
          fmError={
            activeProvider === 'netease' || song?.provider === 'netease' || fmStageFocus ? fmError : ''
          }
          fmStageFocus={fmStageFocus}
          onRetryFm={retryFm}
          onToggleLike={() => toggleLike(song)}
          onOpenPlaylistPicker={() => openPlaylistPicker(song)}
          onTrashFm={trashCurrentFmTrack}
        />
      )}

      <FloatingDock
        view={view}
        song={song}
        playing={playing}
        buffering={buffering}
        pending={!!pendingPlay.current}
        activeProvider={activeProvider}
        audio={audio}
        restoredProgress={restoredProgress}
        onToggleStage={() => {
          setShowNowDetails(false);
          setView(v => (v === 'stage' ? 'library' : 'stage'));
        }}
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
          stopSmoothFade({ restoreVolume: false });
          audio.current.muted = !audio.current.muted;
        }}
        onVolumeChange={v => {
          stopSmoothFade({ restoreVolume: false });
          audio.current.volume = v;
        }}
        onVolumeCommit={() => scheduleSave(true)}
        onOpenQueue={() => {
          setShowQueue(true);
          setConfirmClear(false);
        }}
        playbackRate={playbackRate}
        onChangeRate={changePlaybackRate}
        sleepMode={sleepMode}
        sleepLabel={sleepLabel}
        onSelectSleep={selectSleepMode}
        canSelectQuality={!!capabilities.netease.playbackQuality}
        neteaseQuality={neteaseQuality}
        onChangeQuality={changeNeteaseQuality}
        canSelectQqQuality={!!capabilities.qqmusic.playbackQuality}
        qqQuality={qqQuality}
        onChangeQqQuality={changeQqQuality}
        onReloadWithQuality={() => {
          if ((song?.provider === 'netease' || song?.provider === 'qqmusic') && playingQueue) {
            play(song, playingQueue);
          }
        }}
        queueCount={mixedQueue ? mixedQueue.tracks.length : (ws.queue?.tracks?.length || 0)}
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
          if (desktopLyricRef.current.enabled) triggerDesktopLyricSync();
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
          if (fadeActiveRef.current) return;
          const a = e.currentTarget;
          settings.current.volume = a.volume;
          settings.current.muted = a.muted;
          setVolume(a.volume);
          setMuted(a.muted);
          scheduleSave();
        }}
        onPause={e => {
          stopSmoothFade();
          setBuffering(false);
          scheduleSave(true);
          sampleListening(e.currentTarget);
          listening.current.interrupt('pause');
          diagnosticsChanged();
          setPlaying(false);
        }}
        onEnded={async e => {
          stopSmoothFade();
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
          const mq = mixedQueueRef.current;
          if (
            mq &&
            mq.tracks[mq.index]?.provider === current.provider &&
            mq.tracks[mq.index]?.id === current.id
          ) {
            const nextIdx = nextIndex(settings.current.mode, mq.index, mq.tracks.length);
            if (nextIdx >= 0) {
              const nextTrack = hydrateCustomTrack(mq.tracks[nextIdx], workRef.current);
              void play(nextTrack, { ...mq, index: nextIdx });
            }
            return;
          }
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
          stopSmoothFade();
          setBuffering(false);
          setPlaying(false);
          listening.current.interrupt();
          const current = songRef.current;
          if (current) {
            if (mixedQueueRef.current) setCustomPlaylistNotice('音频加载失败，请重试或切下一首');
            else update(current.provider, { message: '音频加载失败，请重试' });
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
        mixedQueue={mixedQueue}
        song={song}
        pendingPlay={!!pendingPlay.current}
        selectedTrack={selectedTrack}
        setSelectedTrack={setSelectedTrack}
        play={play}
        editQueue={editQueue}
        editMixedQueue={editMixedQueue}
        reorderQueue={reorderQueue}
        reorderMixedQueue={reorderMixedQueue}
      />

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
        customPlaylists={customPlaylists}
        canNeteaseCollect={
          neteaseSignedIn &&
          !!capabilities.netease.editPlaylistTracks &&
          ownedPlaylists.length > 0
        }
        busyId={pickerBusyId}
        error={pickerError}
        onSelect={addTrackToPlaylist}
        onSelectCustom={handleAddTrackToCustom}
        onCreateAndSelectCustom={handleCreateAndAddCustom}
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

      <AppUpdateDialog
        open={Boolean(showUpdaterDialog)}
        mode={showUpdaterDialog || 'manual'}
        config={updateConfig}
        state={updateState}
        busy={updaterBusy}
        onCheck={() => {
          void runUpdateCheck({ silent: false });
        }}
        onDownload={() => {
          void startUpdateDownload();
        }}
        onInstall={() => {
          void installDownloadedUpdate();
        }}
        onSkipVersion={version => {
          void handleSkipUpdateVersion(version);
        }}
        onRemindLater={handleRemindLater}
        onChangeSource={nextSource => {
          void handleChangeUpdateSource(nextSource);
        }}
        onSaveMirror={nextMirror => {
          void handleSaveCustomMirror(nextMirror);
        }}
        onToggleAutoCheck={nextAutoCheck => {
          void handleToggleAutoCheck(nextAutoCheck);
        }}
        onSwitchSourceAndRetry={nextSource => {
          void handleSwitchSourceAndRetry(nextSource);
        }}
        onClose={() => setShowUpdaterDialog(false)}
      />

      <QrDialog qr={qr} onClose={closeQr} />
    </div>
  );
}
