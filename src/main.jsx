import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import './styles/tokens.css';
import './styles/night-radio.css';
import * as providers from './providers.js';
import { ListeningTracker } from './listening.js';
import { applyThemePrefsToDocument, loadThemePrefs } from './theme-prefs.js';
import { App } from './App.jsx';

applyThemePrefsToDocument(loadThemePrefs());

async function start() {
  let host;
  if (isTauri()) {
    try { host = await invoke('host_capabilities'); } catch {}
  }
  const capabilities = host
    ? providers.capabilitiesForHost?.(host) ?? providers.capabilities
    : providers.capabilities;
  createRoot(document.getElementById('root')).render(
    <App providers={{ ...providers, capabilities }} ListeningTracker={ListeningTracker} />
  );
}

void start();

// 窗口以 visible:false 创建：等首帧真正画完再显示，避免 WebView2 白底闪一下。
// 非 Tauri 环境（浏览器预览、jsdom 测试）静默跳过；Rust 侧另有 4 秒兜底显示。
if (typeof requestAnimationFrame === 'function') {
  let revealTries = 0;
  const revealWindow = () => {
    try {
      const pending = invoke('reveal_main_window');
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {}
  };
  const waitFirstPaint = () => {
    if (document.getElementById('root')?.childElementCount) {
      setTimeout(revealWindow, 80);
      return;
    }
    if (++revealTries < 40) requestAnimationFrame(waitFirstPaint);
  };
  requestAnimationFrame(waitFirstPaint);
}
