import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_UPDATER_CONFIG,
  buildUpdateSummary,
  hasUpdateBadge,
  shouldAutoPromptUpdate,
} from '../updater.js';

export function useUpdater({ canAppUpdater, desktop, errorText, beforeInstall }) {
  const [updateConfig, setUpdateConfig] = useState(() => ({ ...DEFAULT_UPDATER_CONFIG }));
  const updateConfigRef = useRef(updateConfig);
  const [updateState, setUpdateState] = useState({
    phase: 'idle',
    info: null,
    progress: null,
    error: '',
    errorCode: '',
  });
  const updateStateRef = useRef(updateState);
  const [showUpdaterDialog, setShowUpdaterDialog] = useState(false);
  const [updaterBusy, setUpdaterBusy] = useState(false);
  const dismissedUpdateVersionsRef = useRef(new Set());
  const updateMountedRef = useRef(true);
  const beforeInstallRef = useRef(beforeInstall);
  beforeInstallRef.current = beforeInstall;

  const commitUpdateConfig = next => {
    const normalized = {
      ...DEFAULT_UPDATER_CONFIG,
      ...updateConfigRef.current,
      ...(next && typeof next === 'object' ? next : {}),
      source:
        next?.source === 'mirror'
          ? 'mirror'
          : next?.source === 'github'
            ? 'github'
            : updateConfigRef.current.source,
      customMirror:
        typeof next?.customMirror === 'string'
          ? next.customMirror
          : updateConfigRef.current.customMirror || '',
      skippedVersion:
        next && Object.hasOwn(next, 'skippedVersion')
          ? next.skippedVersion || null
          : updateConfigRef.current.skippedVersion || null,
      autoCheck:
        next && Object.hasOwn(next, 'autoCheck')
          ? Boolean(next.autoCheck)
          : updateConfigRef.current.autoCheck,
      pubkeyConfigured:
        next && Object.hasOwn(next, 'pubkeyConfigured')
          ? Boolean(next.pubkeyConfigured)
          : updateConfigRef.current.pubkeyConfigured,
    };
    updateConfigRef.current = normalized;
    setUpdateConfig(normalized);
    return normalized;
  };

  const commitUpdateState = updater => {
    const next = typeof updater === 'function' ? updater(updateStateRef.current) : updater;
    updateStateRef.current = next;
    setUpdateState(next);
    return next;
  };

  const runUpdateCheck = async ({ silent = false, sourceOverride } = {}) => {
    if (!canAppUpdater) return null;
    const currentPhase = updateStateRef.current.phase;
    if (currentPhase === 'checking' || currentPhase === 'downloading' || currentPhase === 'ready') {
      return null;
    }
    if (!silent) {
      commitUpdateState(prev => ({ ...prev, phase: 'checking', error: '', errorCode: '' }));
    }
    try {
      const res = await desktop.updaterCheck(sourceOverride ? { sourceOverride } : {});
      if (!updateMountedRef.current) return null;
      if (res?.status === 'available' && res.version) {
        commitUpdateState({
          phase: 'available',
          info: res,
          progress: null,
          error: '',
          errorCode: '',
        });
        if (
          silent &&
          shouldAutoPromptUpdate({
            checkResult: res,
            config: updateConfigRef.current,
            dismissedVersions: dismissedUpdateVersionsRef.current,
          })
        ) {
          setShowUpdaterDialog(cur => cur || 'auto');
        }
      } else {
        commitUpdateState({
          phase: 'up-to-date',
          info: res || null,
          progress: null,
          error: '',
          errorCode: '',
        });
      }
      return res;
    } catch (e) {
      if (!updateMountedRef.current) return null;
      if (!silent) {
        commitUpdateState(prev => ({
          ...prev,
          phase: 'error',
          error: errorText(e),
          errorCode: e?.code || 'unknown',
        }));
      }
      return null;
    }
  };

  const saveUpdateConfig = async patch => {
    if (!canAppUpdater || updaterBusy) return null;
    setUpdaterBusy(true);
    try {
      const res = await desktop.updaterConfigSet(patch);
      if (!updateMountedRef.current) return null;
      return commitUpdateConfig(res);
    } catch (e) {
      if (!updateMountedRef.current) return null;
      commitUpdateState(prev => ({
        ...prev,
        phase: 'error',
        error: errorText(e),
        errorCode: e?.code || 'unknown',
      }));
      return null;
    } finally {
      if (updateMountedRef.current) setUpdaterBusy(false);
    }
  };

  const handleChangeUpdateSource = async nextSource => {
    if (nextSource !== 'github' && nextSource !== 'mirror') return;
    const saved = await saveUpdateConfig({ source: nextSource });
    if (saved && updateStateRef.current.phase === 'available') {
      void runUpdateCheck({ silent: true, sourceOverride: nextSource });
    }
  };

  const handleSaveCustomMirror = async nextMirror => {
    const saved = await saveUpdateConfig({ customMirror: nextMirror });
    if (saved && saved.source === 'mirror' && updateStateRef.current.phase === 'available') {
      void runUpdateCheck({ silent: true, sourceOverride: 'mirror' });
    }
  };

  const handleToggleAutoCheck = async nextAutoCheck => {
    await saveUpdateConfig({ autoCheck: Boolean(nextAutoCheck) });
  };

  const handleSkipUpdateVersion = async version => {
    if (!version) return;
    const saved = await saveUpdateConfig({ skippedVersion: version });
    if (saved) {
      if (
        updateStateRef.current.phase === 'available' &&
        updateStateRef.current.info?.version === version
      ) {
        commitUpdateState({
          phase: 'idle',
          info: null,
          progress: null,
          error: '',
          errorCode: '',
        });
      }
      setShowUpdaterDialog(false);
    }
  };

  const handleRemindLater = version => {
    if (version) dismissedUpdateVersionsRef.current.add(version);
    setShowUpdaterDialog(false);
  };

  const handleSwitchSourceAndRetry = async nextSource => {
    if (nextSource !== 'github' && nextSource !== 'mirror') return;
    const saved = await saveUpdateConfig({ source: nextSource });
    if (saved) {
      await runUpdateCheck({ silent: false, sourceOverride: nextSource });
    }
  };

  const startUpdateDownload = async () => {
    if (!canAppUpdater || updateStateRef.current.phase === 'downloading') return;
    const targetVersion = updateStateRef.current.info?.version || '';
    commitUpdateState(prev => ({
      ...prev,
      phase: 'downloading',
      progress: { version: targetVersion, downloadedBytes: 0, totalBytes: null, percent: 0 },
      error: '',
      errorCode: '',
    }));
    try {
      const res = await desktop.updaterDownload();
      if (!updateMountedRef.current) return;
      commitUpdateState(prev => ({
        ...prev,
        phase: 'ready',
        progress: {
          version: res?.version || prev.info?.version || targetVersion,
          downloadedBytes: res?.totalBytes ?? prev.progress?.downloadedBytes ?? 0,
          totalBytes: res?.totalBytes ?? prev.progress?.totalBytes ?? null,
          percent: 100,
        },
        error: '',
        errorCode: '',
      }));
    } catch (e) {
      if (!updateMountedRef.current) return;
      commitUpdateState(prev => ({
        ...prev,
        phase: 'error',
        error: errorText(e),
        errorCode: e?.code || 'unknown',
      }));
    }
  };

  const installDownloadedUpdate = async () => {
    if (!canAppUpdater || updaterBusy) return;
    setUpdaterBusy(true);
    try {
      await beforeInstallRef.current?.();
      await desktop.updaterInstall();
    } catch (e) {
      if (!updateMountedRef.current) return;
      commitUpdateState(prev => ({
        ...prev,
        phase: 'error',
        error: errorText(e),
        errorCode: e?.code || 'unknown',
      }));
    } finally {
      if (updateMountedRef.current) setUpdaterBusy(false);
    }
  };

  // 客户端更新：启动配置读取、延迟静默检查与下载进度监听
  useEffect(() => {
    if (!canAppUpdater) return undefined;
    updateMountedRef.current = true;
    let active = true;
    let checkTimer = null;
    let unlistenProgress = null;

    desktop
      .updaterConfigGet()
      .then(cfg => {
        if (!active || !cfg) return;
        const normalized = commitUpdateConfig(cfg);
        if (normalized.autoCheck && normalized.pubkeyConfigured) {
          const delayMs =
            typeof window !== 'undefined' && Number.isFinite(window.__VESPER_UPDATER_DELAY_MS__)
              ? Math.max(0, Number(window.__VESPER_UPDATER_DELAY_MS__))
              : 4000;
          checkTimer = setTimeout(() => {
            if (active) void runUpdateCheck({ silent: true });
          }, delayMs);
        }
      })
      .catch(() => {});

    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const eventName = desktop?.events?.updateProgress || 'prism:app-update-progress';
        const un = await listen(eventName, e => {
          if (!active || !e?.payload) return;
          const payload = e.payload;
          commitUpdateState(prev => ({
            ...prev,
            phase: prev.phase === 'ready' ? 'ready' : 'downloading',
            progress: {
              version: payload.version || prev.info?.version || '',
              downloadedBytes: Number(payload.downloadedBytes) || 0,
              totalBytes:
                payload.totalBytes != null
                  ? Number(payload.totalBytes)
                  : (prev.progress?.totalBytes ?? null),
              percent: Number.isFinite(Number(payload.percent))
                ? Number(payload.percent)
                : (prev.progress?.percent ?? 0),
            },
          }));
        });
        if (!active) un();
        else unlistenProgress = un;
      })
      .catch(() => {});

    return () => {
      active = false;
      updateMountedRef.current = false;
      if (checkTimer) clearTimeout(checkTimer);
      if (unlistenProgress) unlistenProgress();
    };
  }, [canAppUpdater]);

  const updateSummary = canAppUpdater ? buildUpdateSummary({ updateConfig, updateState }) : null;
  const updateAttention = canAppUpdater && hasUpdateBadge({ updateState, config: updateConfig });

  return {
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
  };
}
