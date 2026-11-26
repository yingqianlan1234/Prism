import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
for (const n of ['MutationObserver', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  globalThis[n] = dom.window[n];
}

window.__VESPER_UPDATER_DELAY_MS__ = 20;

let nextId = 1;
const callbacks = new Map();
const listeners = new Map();
const calls = [];

let updaterConfig = {
  currentVersion: '1.1.0',
  autoCheck: true,
  source: 'github',
  customMirror: '',
  defaultMirror: 'https://gh-proxy.com/',
  skippedVersion: null,
  pubkeyConfigured: true,
};

let nextCheckHandler = ({ source }) => ({
  status: 'available',
  currentVersion: '1.1.0',
  version: '1.1.1',
  pubDate: '2026-11-26T08:00:00Z',
  notes: '[patch]\n- 修复桌面歌词拖动边缘闪烁',
  updateKind: 'patch',
  source,
  skipped: updaterConfig.skippedVersion === '1.1.1',
});

let downloadHandler = async () => {
  const emitProgress = listeners.get('prism:app-update-progress');
  emitProgress?.({
    payload: {
      version: '1.2.0',
      downloadedBytes: 6 * 1024 * 1024,
      totalBytes: 12 * 1024 * 1024,
      percent: 50,
    },
  });
  await new Promise(r => setTimeout(r, 40));
  emitProgress?.({
    payload: {
      version: '1.2.0',
      downloadedBytes: 12 * 1024 * 1024,
      totalBytes: 12 * 1024 * 1024,
      percent: 100,
    },
  });
  return { status: 'ready', version: '1.2.0', totalBytes: 12 * 1024 * 1024 };
};

window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
window.__TAURI_INTERNALS__ = {
  transformCallback(fn) {
    const id = nextId++;
    callbacks.set(id, fn);
    return id;
  },
  invoke: async (cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case 'plugin:event|listen':
        listeners.set(args.event, callbacks.get(args.handler));
        return nextId++;
      case 'plugin:event|unlisten':
        return;
      case 'playback_state_load':
        return { status: 'empty' };
      case 'playback_state_save':
        return { saved: true };
      case 'close_behavior_get':
        return { mode: 'ask', trayAvailable: true };
      case 'netease_account':
        return { profile: null };
      case 'global_shortcuts_get':
        return { enabled: false, bindings: {} };
      case 'desktop_lyric_get':
        return { enabled: false, locked: false, position: null };
      case 'app_update_config_get':
        return { ...updaterConfig };
      case 'app_update_config_set': {
        if (typeof args?.autoCheck === 'boolean') updaterConfig.autoCheck = args.autoCheck;
        if (args?.source === 'github' || args?.source === 'mirror') updaterConfig.source = args.source;
        if (typeof args?.customMirror === 'string') updaterConfig.customMirror = args.customMirror;
        if (typeof args?.skippedVersion === 'string') {
          updaterConfig.skippedVersion = args.skippedVersion || null;
        }
        return { ...updaterConfig };
      }
      case 'app_update_check': {
        const effectiveSource = args?.sourceOverride || updaterConfig.source;
        return nextCheckHandler({ source: effectiveSource });
      }
      case 'app_update_download':
        return downloadHandler();
      case 'app_update_install':
        return null;
      default:
        throw Error('unexpected IPC ' + cmd);
    }
  },
};

const html = await readFile('dist/index.html', 'utf8');
const file = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)[1];
await import(pathToFileURL(process.cwd() + '/dist/' + file.replace(/^\//, '')));

const wait = async (fn, label) => {
  for (let i = 0; i < 400; i++) {
    const val = fn();
    if (val) return val;
    await new Promise(r => setTimeout(r, 10));
  }
  throw Error('等待更新集成状态超时：' + label + '\n' + document.body.textContent);
};
const buttonByText = text => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
const countCmd = name => calls.filter(c => c.cmd === name).length;

try {
  // 1. 启动自动检查返回 Patch 更新：不主动弹窗，仅设置齿轮点亮暖琥珀点
  await wait(
    () =>
      countCmd('app_update_config_get') >= 1 &&
      countCmd('app_update_check') >= 1 &&
      listeners.has('prism:app-update-progress'),
    '启动静默检查完成'
  );
  await new Promise(r => setTimeout(r, 40));
  assert.equal(document.querySelector('.nr-update-dialog'), null, 'Patch 更新不应主动弹窗');

  const settingsDot = await wait(
    () => document.querySelector('.nr-top-settings-btn .lw-dot[data-on="true"]'),
    '齿轮暖琥珀点亮起'
  );
  assert(settingsDot, 'Patch 更新应点亮设置图标提示点');

  document.querySelector('.nr-top-settings-btn').click();
  await wait(() => document.querySelector('.nr-settings-page'), '打开独立设置页');
  [...document.querySelectorAll('button')].find(x => x.textContent.includes('更新与关于')).click();
  await wait(() => document.querySelector('.nr-settings-page')?.textContent.includes('v1.1.1'), '设置页显示新版本 v1.1.1');

  // 2. 验证双源切换、自定义镜像校验与错误一键切源重试
  buttonByText('国内加速镜像').click();
  await wait(
    () =>
      calls.some(c => c.cmd === 'app_update_config_set' && c.args?.source === 'mirror') &&
      document.querySelector('.nr-update-source-tag')?.textContent.includes('国内加速镜像'),
    '切换至国内加速镜像'
  );

  const mirrorInput = await wait(() => document.querySelector('.nr-update-mirror-input'), '显示镜像输入框');
  const setInputValue = (input, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setInputValue(mirrorInput, 'http://bad.example.com');
  buttonByText('保存镜像').click();
  await wait(() => document.body.textContent.includes('必须以 https:// 开头'), '拦截非 HTTPS 自定义镜像');

  setInputValue(mirrorInput, 'https://mirror.example.com');
  buttonByText('保存镜像').click();
  await wait(
    () => calls.some(c => c.cmd === 'app_update_config_set' && c.args?.customMirror === 'https://mirror.example.com/'),
    '保存合法自定义镜像'
  );

  // 模拟跳过 Patch 版本，验证设置灯熄灭
  const skipBtn = await wait(() => {
    const b = buttonByText('跳过此版本');
    return b && !b.disabled ? b : null;
  }, '跳过按钮恢复可点击');
  skipBtn.click();
  await wait(
    () => document.querySelector('.nr-top-settings-btn .lw-dot[data-on="false"]'),
    '跳过版本后设置灯熄灭'
  );

  // 3. 验证网络错误一键切源重试 & Feature 版本推送流程
  nextCheckHandler = async ({ source }) => {
    if (source === 'mirror') {
      throw { code: 'network', message: '无法连接加速镜像' };
    }
    return {
      status: 'available',
      currentVersion: '1.1.0',
      version: '1.2.0',
      pubDate: '2026-11-26T09:00:00Z',
      notes: '[feature]\n## 更新亮点\n- 支持客户端双通道在线更新',
      updateKind: 'feature',
      source,
      skipped: false,
    };
  };

  buttonByText('检查更新').click();
  const retryAltBtn = await wait(() => buttonByText('切换至GitHub 直连并重试'), '显示一键切源重试按钮');
  retryAltBtn.click();
  await wait(
    () =>
      document.querySelector('.nr-update-ver')?.textContent.includes('v1.1.0 → v1.2.0') &&
      document.body.textContent.includes('支持客户端双通道在线更新'),
    '切源重试拿到 Feature 新版本'
  );

  // 4. 点击立即更新 -> 后台进度推送 -> 完成后点击重启并安装
  let resolveDownload;
  downloadHandler = async () => {
    const emitProgress = listeners.get('prism:app-update-progress');
    emitProgress?.({
      payload: {
        version: '1.2.0',
        downloadedBytes: 6 * 1024 * 1024,
        totalBytes: 12 * 1024 * 1024,
        percent: 50,
      },
    });
    await new Promise(resolve => {
      resolveDownload = resolve;
    });
    emitProgress?.({
      payload: {
        version: '1.2.0',
        downloadedBytes: 12 * 1024 * 1024,
        totalBytes: 12 * 1024 * 1024,
        percent: 100,
      },
    });
    return { status: 'ready', version: '1.2.0', totalBytes: 12 * 1024 * 1024 };
  };

  buttonByText('立即更新').click();
  await wait(() => document.querySelector('.nr-update-progress')?.textContent.includes('50%'), '显示下载进度 50%');

  resolveDownload();
  const installBtn = await wait(() => buttonByText('重启并安装'), '出现重启并安装按钮');
  installBtn.click();
  await wait(() => countCmd('app_update_install') === 1, '调用 app_update_install 完成安装触发');

  console.log('通过：Patch 静默亮灯、Feature 更新日志、双源切换/镜像校验/切源重试、后台下载与重启安装全链路验证通过');
} finally {
  delete globalThis.window.__VESPER_UPDATER_DELAY_MS__;
  dom.window.close();
}
