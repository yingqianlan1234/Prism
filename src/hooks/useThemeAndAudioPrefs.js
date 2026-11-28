import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { coverUrl } from '../cover.js';
import { extractAccent } from '../accent.js';
import { accentFor } from '../utils/format.js';
import { loadLocalCover } from '../local-cover-cache.js';
import {
  loadAudioPrefs,
  saveAudioPrefs,
  supportsAudioOutputSelection,
  listAudioOutputDevices,
  applyAudioOutputDevice,
  runSmoothFadeIn,
} from '../audio-prefs.js';
import {
  loadThemePrefs,
  saveThemePrefs,
  applyThemePrefsToDocument,
} from '../theme-prefs.js';
import { validHexColor } from './useDesktopControls.js';

if (typeof window !== 'undefined') window.__extractAccent = extractAccent;

/**
 * 封装主题外观、环境波浪速率、封面漫反射取色、音频输出设备、平滑淡入、倍速与睡眠定时。
 */
export function useThemeAndAudioPrefs({
  audio,
  settings,
  song,
  songRef,
  activeRef,
  playing,
  canLocalCover,
  local,
  update,
  onAccentChange,
}) {
  // 睡眠定时（纯前端实用辅助，单次定时器驱动）
  const [sleepMode, setSleepMode] = useState('off');
  const sleepRef = useRef({ mode: 'off', timer: null });

  const [audioPrefs, setAudioPrefs] = useState(() => loadAudioPrefs());
  const audioPrefsRef = useRef(audioPrefs);
  const [audioOutputSupported, setAudioOutputSupported] = useState(false);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [audioOutputError, setAudioOutputError] = useState('');
  const fadeActiveRef = useRef(false);
  const cancelFadeRef = useRef(null);

  const [themePrefs, setThemePrefs] = useState(() => loadThemePrefs());
  const ambientLayerRef = useRef(null);
  const ambientRateRef = useRef({ rate: 0.38, initialized: false, rafId: null });
  const currentAccentRef = useRef('#F2A65A');

  const onAccentChangeRef = useRef(onAccentChange);
  onAccentChangeRef.current = onAccentChange;

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

  const refreshAudioOutputDevices = async () => {
    const res = await listAudioOutputDevices();
    setAudioOutputDevices(res.devices);
    return res;
  };

  const handleToggleSmoothFadeIn = nextEnabled => {
    const savedPrefs = saveAudioPrefs({
      ...audioPrefsRef.current,
      smoothFadeIn: Boolean(nextEnabled),
    });
    audioPrefsRef.current = savedPrefs;
    setAudioPrefs(savedPrefs);
  };

  const handleToggleAutoOpenStage = nextEnabled => {
    const savedPrefs = saveAudioPrefs({
      ...audioPrefsRef.current,
      autoOpenStageOnPlay: Boolean(nextEnabled),
    });
    audioPrefsRef.current = savedPrefs;
    setAudioPrefs(savedPrefs);
  };

  const handleSelectOutputDevice = async deviceId => {
    setAudioOutputError('');
    const result = await applyAudioOutputDevice(audio.current, deviceId);
    if (!result.ok && !result.unsupported) {
      setAudioOutputError(result.error);
      return;
    }
    const savedPrefs = saveAudioPrefs({
      ...audioPrefsRef.current,
      outputDeviceId: deviceId || '',
    });
    audioPrefsRef.current = savedPrefs;
    setAudioPrefs(savedPrefs);
  };

  const handleChangeTheme = themeId => {
    setThemePrefs(prev => saveThemePrefs({ ...prev, theme: themeId }));
  };

  const handleChangeAmbient = ambientId => {
    setThemePrefs(prev => saveThemePrefs({ ...prev, ambient: ambientId }));
  };

  const stopSmoothFade = ({ restoreVolume = true } = {}) => {
    if (cancelFadeRef.current) {
      const cancel = cancelFadeRef.current;
      cancelFadeRef.current = null;
      cancel();
    }
    if (fadeActiveRef.current) {
      fadeActiveRef.current = false;
      if (restoreVolume && audio.current) {
        audio.current.volume = settings.current.volume;
      }
    }
  };

  const triggerSmoothFade = targetVol => {
    stopSmoothFade({ restoreVolume: false });
    if (!audioPrefsRef.current.smoothFadeIn || !audio.current || audio.current.muted) return;
    fadeActiveRef.current = true;
    const cancel = runSmoothFadeIn(audio.current, targetVol, true, 140);
    cancelFadeRef.current = () => {
      cancel();
      fadeActiveRef.current = false;
    };
    setTimeout(() => {
      if (cancelFadeRef.current) {
        cancelFadeRef.current = null;
        fadeActiveRef.current = false;
      }
    }, 180);
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
    applyThemePrefsToDocument(themePrefs);
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      Promise.resolve(invoke('window_theme_sync', { theme: themePrefs.theme })).catch(() => {});
    }
  }, [themePrefs]);

  // 音频输出设备初始化与清理淡入
  useEffect(() => {
    const el = audio.current;
    const supported = supportsAudioOutputSelection(el);
    setAudioOutputSupported(supported);
    if (supported) {
      void listAudioOutputDevices().then(res => setAudioOutputDevices(res.devices));
      if (audioPrefsRef.current.outputDeviceId) {
        void applyAudioOutputDevice(el, audioPrefsRef.current.outputDeviceId);
      }
    }
    return () => {
      stopSmoothFade({ restoreVolume: false });
    };
  }, []);

  // 封面漫反射取色：一次性离屏取色，仅写入根节点 CSS 变量，不进 React state
  useEffect(() => {
    const root = document.documentElement;
    const apply = c => {
      let nextAccent = '#F2A65A';
      if (c && c.a) {
        nextAccent = validHexColor(c.a);
        root.style.setProperty('--nr-glow', c.a);
        root.style.setProperty('--lw-a', c.a);
        root.style.setProperty('--lw-on', c.on);
        root.dataset.accent = c.monochrome ? 'mono' : 'color';
      } else {
        const fb = accentFor(song);
        nextAccent = validHexColor(fb);
        root.style.setProperty('--nr-glow', fb);
        root.style.setProperty('--lw-a', fb);
        root.style.setProperty('--lw-on', '#161C26');
        root.dataset.accent = 'fallback';
      }
      if (currentAccentRef.current !== nextAccent) {
        currentAccentRef.current = nextAccent;
        onAccentChangeRef.current?.();
      }
    };
    const directSrc = coverUrl(song, 500);
    if (directSrc) {
      root.dataset.accentSrc = directSrc;
      let live = true;
      extractAccent(directSrc).then(c => {
        if (live) apply(c);
      });
      return () => {
        live = false;
      };
    }
    if (song?.provider === 'local' && song?.id && canLocalCover) {
      let live = true;
      root.dataset.accentSrc = '';
      apply(null);
      void loadLocalCover(String(song.id), id => local.getCover(id)).then(dataUrl => {
        if (!live) return;
        if (!dataUrl) {
          root.dataset.accentSrc = '';
          apply(null);
          return;
        }
        root.dataset.accentSrc = dataUrl;
        extractAccent(dataUrl).then(c => {
          if (live) apply(c);
        });
      });
      return () => {
        live = false;
      };
    }
    root.dataset.accentSrc = '';
    apply(null);
    return undefined;
  }, [song, canLocalCover]);

  // 暂停 <-> 播放平滑调节环境波浪速率（Web Animations API playbackRate 缓动，零跳变、无常驻 rAF）
  useEffect(() => {
    const state = ambientRateRef.current;
    if (state.rafId != null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    const reduced =
      typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const layer = ambientLayerRef.current;
    if (
      themePrefs.ambient === 'off' ||
      reduced ||
      !layer ||
      typeof layer.getAnimations !== 'function'
    ) {
      state.rate = playing ? 1 : 0.38;
      state.initialized = false;
      return undefined;
    }

    const applyRate = nextRate => {
      state.rate = nextRate;
      const anims = layer.getAnimations({ subtree: true });
      for (const anim of anims) {
        try {
          if (anim.playbackRate !== nextRate) anim.playbackRate = nextRate;
        } catch {}
      }
    };

    const targetRate = playing ? 1 : 0.38;
    if (
      !state.initialized ||
      typeof globalThis.requestAnimationFrame !== 'function' ||
      typeof globalThis.cancelAnimationFrame !== 'function'
    ) {
      state.initialized = true;
      applyRate(targetRate);
      return undefined;
    }

    const startRate = state.rate;
    if (Math.abs(targetRate - startRate) < 0.005) {
      applyRate(targetRate);
      return undefined;
    }

    const duration = 720;
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = now => {
      const elapsed = Math.max(0, (typeof now === 'number' ? now : Date.now()) - startTime);
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      applyRate(startRate + (targetRate - startRate) * eased);
      if (t < 1) {
        state.rafId = globalThis.requestAnimationFrame(step);
      } else {
        state.rafId = null;
      }
    };
    state.rafId = globalThis.requestAnimationFrame(step);

    return () => {
      if (state.rafId != null) {
        globalThis.cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }
    };
  }, [playing, themePrefs.ambient]);

  return {
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
  };
}
