export const AUDIO_PREFS_STORAGE_KEY = 'vesper.audioPrefs.v1';

export const DEFAULT_AUDIO_PREFS = Object.freeze({
  smoothFadeIn: true,
  autoOpenStageOnPlay: true,
  outputDeviceId: '',
});

export function loadAudioPrefs(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem?.(AUDIO_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_AUDIO_PREFS };
    return {
      smoothFadeIn: parsed.smoothFadeIn !== false,
      autoOpenStageOnPlay: parsed.autoOpenStageOnPlay !== false,
      outputDeviceId: typeof parsed.outputDeviceId === 'string' ? parsed.outputDeviceId.slice(0, 256) : '',
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function saveAudioPrefs(prefs, storage = globalThis?.localStorage) {
  const normalized = {
    smoothFadeIn: prefs?.smoothFadeIn !== false,
    autoOpenStageOnPlay: prefs?.autoOpenStageOnPlay !== false,
    outputDeviceId: typeof prefs?.outputDeviceId === 'string' ? prefs.outputDeviceId.slice(0, 256) : '',
  };
  try {
    storage?.setItem?.(AUDIO_PREFS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
  return normalized;
}

export function supportsAudioOutputSelection(audioEl) {
  return Boolean(audioEl && typeof audioEl.setSinkId === 'function');
}

export async function listAudioOutputDevices(nav = globalThis?.navigator) {
  if (!nav?.mediaDevices || typeof nav.mediaDevices.enumerateDevices !== 'function') {
    return { supported: false, devices: [] };
  }
  try {
    const all = await nav.mediaDevices.enumerateDevices();
    const devices = all
      .filter(d => d && d.kind === 'audiooutput')
      .map((d, idx) => ({
        deviceId: d.deviceId || '',
        label: d.label || (d.deviceId === 'default' || !d.deviceId ? '系统默认输出' : `音频输出设备 ${idx + 1}`),
      }));
    return { supported: true, devices };
  } catch {
    return { supported: false, devices: [] };
  }
}

export async function applyAudioOutputDevice(audioEl, deviceId) {
  if (!supportsAudioOutputSelection(audioEl)) {
    return { ok: false, unsupported: true, error: '当前运行环境不支持切换音频输出设备' };
  }
  try {
    await audioEl.setSinkId(typeof deviceId === 'string' ? deviceId : '');
    return { ok: true, unsupported: false, error: '' };
  } catch (err) {
    return {
      ok: false,
      unsupported: false,
      error: err?.message || '无法切换到选定音频输出设备',
    };
  }
}

export function runSmoothFadeIn(audioEl, targetVolume, enabled, durationMs = 140) {
  const target = Math.max(0, Math.min(1, Number(targetVolume) || 0));
  if (
    !enabled ||
    !audioEl ||
    target <= 0.02 ||
    typeof globalThis.requestAnimationFrame !== 'function' ||
    typeof globalThis.cancelAnimationFrame !== 'function' ||
    (typeof globalThis.matchMedia === 'function' &&
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ) {
    if (audioEl) audioEl.volume = target;
    return () => {};
  }

  let cancelled = false;
  let rafId = null;
  const startVolume = Math.max(0.02, target * 0.08);
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  audioEl.volume = startVolume;

  const step = now => {
    if (cancelled) return;
    const elapsed = Math.max(0, (typeof now === 'number' ? now : Date.now()) - startTime);
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - t, 2);
    audioEl.volume = Math.min(target, startVolume + (target - startVolume) * eased);
    if (t < 1) {
      rafId = globalThis.requestAnimationFrame(step);
    } else {
      audioEl.volume = target;
    }
  };

  rafId = globalThis.requestAnimationFrame(step);
  return () => {
    cancelled = true;
    if (rafId != null) globalThis.cancelAnimationFrame(rafId);
  };
}
