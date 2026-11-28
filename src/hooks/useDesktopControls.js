import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { artist, DEFAULT_SHORTCUT_BINDINGS, clipLyricField } from '../utils/format.js';

const DEFAULT_DESKTOP_LYRIC_STYLE = Object.freeze({
  fontSize: 28,
  theme: 'night',
  layout: 'dual',
  align: 'center',
  panelOpacity: 82,
  karaoke: true,
  showTranslation: true,
  showRomaji: false,
  width: 720,
});

const normalizeDesktopLyricState = (res, prev) => ({
  enabled: Boolean(res?.enabled),
  locked: Boolean(res?.locked),
  position: res?.position ?? prev?.position ?? null,
  style: {
    ...DEFAULT_DESKTOP_LYRIC_STYLE,
    ...(prev?.style || {}),
    ...(res?.style && typeof res.style === 'object' ? res.style : {}),
  },
});

export const validHexColor = color =>
  typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#F2A65A';

/**
 * 封装原生桌面能力：关闭行为与托盘同步、开机自启、全局快捷键、桌面悬浮歌词以及窗口标题。
 */
export function useDesktopControls({
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
  beforeExit,
  shortcutActions,
}) {
  const [closeMode, setCloseMode] = useState('ask');
  const [trayAvailable, setTrayAvailable] = useState(false);
  const [closeDialog, setCloseDialog] = useState(null);
  const [closeError, setCloseError] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);

  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState('');

  const [globalShortcuts, setGlobalShortcuts] = useState(() => ({
    enabled: false,
    bindings: { ...DEFAULT_SHORTCUT_BINDINGS },
    error: null,
  }));
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [shortcutsBusy, setShortcutsBusy] = useState(false);
  const [shortcutsError, setShortcutsError] = useState('');

  const [desktopLyric, setDesktopLyric] = useState({
    enabled: false,
    locked: false,
    position: null,
    style: { ...DEFAULT_DESKTOP_LYRIC_STYLE },
  });
  const desktopLyricRef = useRef({
    enabled: false,
    locked: false,
    position: null,
    style: { ...DEFAULT_DESKTOP_LYRIC_STYLE },
  });
  const [desktopLyricBusy, setDesktopLyricBusy] = useState(false);
  const [desktopLyricError, setDesktopLyricError] = useState('');
  const [desktopLyricSyncTick, setDesktopLyricSyncTick] = useState(0);
  const lastDesktopLyricKeyRef = useRef(null);
  const desktopLyricStyleChainRef = useRef(Promise.resolve());

  const beforeExitRef = useRef(beforeExit);
  beforeExitRef.current = beforeExit;

  const desktopHandlersRef = useRef({});

  const triggerDesktopLyricSync = () => setDesktopLyricSyncTick(t => t + 1);

  const setDesktopLyricState = async ({ enabled, locked, style }) => {
    if (!canDesktopLyric || desktopLyricBusy) return;
    setDesktopLyricBusy(true);
    setDesktopLyricError('');
    try {
      const res = await desktop.desktopLyricSet({ enabled, locked, style });
      const next = normalizeDesktopLyricState(res, desktopLyricRef.current);
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

  const updateDesktopLyricStyle = patch => {
    if (!canDesktopLyric || !patch || typeof patch !== 'object') return;
    setDesktopLyricError('');
    desktopLyricStyleChainRef.current = desktopLyricStyleChainRef.current
      .catch(() => {})
      .then(async () => {
        const res = await desktop.desktopLyricSet({
          enabled: desktopLyricRef.current.enabled,
          style: patch,
        });
        const next = normalizeDesktopLyricState(res, desktopLyricRef.current);
        desktopLyricRef.current = next;
        setDesktopLyric(next);
      })
      .catch(e => {
        setDesktopLyricError(errorText(e));
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
    ...(shortcutActions || {}),
    toggleDesktopLyric,
  };

  const chooseClose = async nextMode => {
    if (closeBusy) return;
    setCloseBusy(true);
    setCloseError('');
    try {
      if (closeDialog === 'close' && nextMode === 'exit') {
        await beforeExitRef.current?.();
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

  const handleChooseCloseMode = nextMode => {
    if (closeBusy) return;
    setCloseBusy(true);
    setCloseError('');
    invoke('close_behavior_set', { mode: nextMode, closeNow: false })
      .then(() => setCloseMode(nextMode))
      .catch(e => setCloseError(e?.message || '无法保存关闭设置，请重试'))
      .finally(() => setCloseBusy(false));
  };

  const handleToggleAutostart = nextEnabled => {
    if (!canAutostart || autostartBusy) return;
    setAutostartBusy(true);
    setAutostartError('');
    desktop
      .autostartSet(Boolean(nextEnabled))
      .then(res => setAutostartEnabled(Boolean(res?.enabled)))
      .catch(e => setAutostartError(e?.message || '无法更新开机自启设置，请重试'))
      .finally(() => setAutostartBusy(false));
  };

  // 关闭行为初始化与托盘关闭事件监听
  useEffect(() => {
    if (!canChooseCloseBehavior) return;
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
        const a = await listen('vesper-close-choice', () => {
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
        const b = await listen('vesper-close-error', e => {
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
        const c = await listen('vesper-tray-exit', async () => {
          try {
            await beforeExitRef.current?.();
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
  }, [canChooseCloseBehavior]);

  // 关闭确认弹窗焦点陷阱
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

  // 同步 Windows 开机自动启动状态
  useEffect(() => {
    if (!canAutostart) return undefined;
    let active = true;
    desktop
      .autostartGet()
      .then(res => {
        if (active) setAutostartEnabled(Boolean(res?.enabled));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [canAutostart]);

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
          const next = normalizeDesktopLyricState(res, desktopLyricRef.current);
          desktopLyricRef.current = next;
          setDesktopLyric(next);
        })
        .catch(() => {});
    }
    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        if (canGlobalShortcuts) {
          const eventName = desktop?.events?.globalShortcut || 'vesper:global-shortcut';
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
          const eventName = desktop?.events?.desktopLyricState || 'vesper:desktop-lyric-state';
          const unLyric = await listen(eventName, e => {
            if (!active || !e?.payload || typeof e.payload.enabled !== 'boolean') return;
            const next = normalizeDesktopLyricState(e.payload, desktopLyricRef.current);
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

  // 事件驱动推送桌面悬浮歌词：仅在桌面歌词开启且当前行、歌名、播放态、倍速或手动拖动变化时触发
  useEffect(() => {
    if (!canDesktopLyric || !desktopLyric.enabled) {
      lastDesktopLyricKeyRef.current = null;
      return undefined;
    }
    const pushDesktopLyric = () => {
      const idx = lyricIndexStore.getSnapshot();
      const currentLine = idx >= 0 ? lyrics[idx] : null;
      const nextLine = idx >= 0 && idx + 1 < lyrics.length ? lyrics[idx + 1] : null;
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
      let elapsedMs = 0;
      let durationMs = 0;
      if (currentLine && Number.isFinite(currentLine.at)) {
        const startSec = currentLine.at;
        const nextAt = nextLine && Number.isFinite(nextLine.at) ? nextLine.at : null;
        const audioEl = audio.current;
        const trackDur =
          audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > startSec
            ? audioEl.duration
            : null;
        const rawDurationMs =
          nextAt != null
            ? Math.round((nextAt - startSec) * 1000)
            : trackDur != null
              ? Math.round((trackDur - startSec) * 1000)
              : 5000;
        durationMs = Math.min(600000, Math.max(0, rawDurationMs));
        const curSec =
          audioEl && Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : startSec;
        elapsedMs =
          durationMs > 0
            ? Math.min(durationMs, Math.max(0, Math.round((curSec - startSec) * 1000)))
            : 0;
      }
      const rate =
        Number.isFinite(audio.current?.playbackRate) && audio.current.playbackRate > 0
          ? audio.current.playbackRate
          : playbackRate || 1;
      const payload = {
        text: clipLyricField(mainText),
        translation: clipLyricField(currentLine?.translation || ''),
        romaji: clipLyricField(currentLine?.romaji || ''),
        title: titleText,
        playing: Boolean(playing),
        nextText: clipLyricField(nextLine?.text || ''),
        elapsedMs,
        durationMs,
        rate,
        accentColor: validHexColor(currentAccentRef.current),
      };
      const key = JSON.stringify(payload);
      if (lastDesktopLyricKeyRef.current === key) return;
      lastDesktopLyricKeyRef.current = key;
      desktop.desktopLyricUpdate(payload).catch(() => {});
    };
    pushDesktopLyric();
    return lyricIndexStore.subscribe(pushDesktopLyric);
  }, [
    canDesktopLyric,
    desktopLyric.enabled,
    song,
    lyrics,
    lyricStatus,
    playing,
    playbackRate,
    desktopLyricSyncTick,
  ]);

  // 原生窗口标题跟随实际播放曲目
  useEffect(() => {
    const nextTitle = song ? [song.name, artist(song)].filter(Boolean).join(' — ') : 'Vesper';
    try {
      const pending = getCurrentWindow().setTitle(nextTitle);
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {}
    return undefined;
  }, [song]);

  // Windows 系统托盘 Tooltip 与播控菜单文案同步
  useEffect(() => {
    if (!trayAvailable || typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return undefined;
    }
    try {
      const pending = invoke('tray_status_sync', {
        title: song?.name || null,
        artist: song ? artist(song) || null : null,
        playing: Boolean(playing),
      });
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {}
    return undefined;
  }, [trayAvailable, song, playing]);

  return {
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
  };
}
