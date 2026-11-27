import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const activateSong = el => el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
for (const n of ['MutationObserver', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  globalThis[n] = dom.window[n];
}

let paused = true;
let nextId = 1;
const callbacks = new Map();
const listeners = new Map();
const calls = [];
const restoredVolumeKey = 'F10';

let shortcutsState = {
  enabled: false,
  bindings: {
    togglePlayback: 'Ctrl+Alt+P',
    prevTrack: 'Ctrl+Alt+Left',
    nextTrack: 'Ctrl+Alt+Right',
    volumeUp: 'Ctrl+Alt+Up',
    volumeDown: 'Ctrl+Alt+Down',
    toggleDesktopLyric: 'Ctrl+Alt+D',
  },
};
let rejectNextShortcutConflict = false;
let lyricWindowState = {
  enabled: false,
  locked: false,
  position: null,
  style: {
    fontSize: 28,
    theme: 'night',
    layout: 'dual',
    align: 'center',
    panelOpacity: 82,
    karaoke: true,
    showTranslation: true,
    showRomaji: false,
    width: 720,
  },
};

Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'paused', {
  configurable: true,
  get() {
    return paused;
  },
});
dom.window.HTMLMediaElement.prototype.play = function () {
  paused = false;
  this.dispatchEvent(new Event('play'));
  this.dispatchEvent(new Event('playing'));
  return Promise.resolve();
};
dom.window.HTMLMediaElement.prototype.pause = function () {
  paused = true;
  this.dispatchEvent(new Event('pause'));
};
dom.window.HTMLMediaElement.prototype.load = function () {};

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
        return { profile: { userId: 101, nickname: '晴岚' } };
      case 'netease_likelist':
        return { code: 200, ids: [] };
      case 'netease_playlists':
        return {
          playlist: [{ id: 10, name: '夜车测试单', trackCount: 2, creator: { userId: 101 } }],
          more: false,
        };
      case 'netease_playlist':
        return {
          playlist: { id: 10, name: '夜车测试单', userId: 101, creator: { userId: 101 } },
          songs: [
            {
              id: 501,
              name: '夜车',
              artists: [{ name: '曾轶可' }],
              album: { name: '一只猫的旅行' },
              duration: 210000,
            },
            {
              id: 502,
              name: '想去海边',
              artists: [{ name: '夏日入侵企画' }],
              album: { name: '想去海边' },
              duration: 220000,
            },
          ],
          total: 2,
          hasMore: false,
        };
      case 'netease_url':
        return {
          data: [{ code: 200, url: `https://example.invalid/${args.id}.mp3`, level: 'standard', br: 128000 }],
        };
      case 'netease_lyric':
        return {
          lrc: { lyric: '[00:05.00]第一句夜景\n[00:15.00]第二句灯光' },
          tlyric: { lyric: '[00:05.00]First night view\n[00:15.00]Second street light' },
          romalrc: { lyric: '[00:05.00]di yi ju\n[00:15.00]di er ju' },
        };
      case 'global_shortcuts_get':
        return { ...shortcutsState, bindings: { ...shortcutsState.bindings } };
      case 'global_shortcuts_set': {
        if (rejectNextShortcutConflict) {
          rejectNextShortcutConflict = false;
          throw { code: 'conflict', message: '系统快捷键已被占用或无法注册' };
        }
        const bindings = { ...args.bindings };
        if (args.enabled && !shortcutsState.enabled) {
          bindings.volumeUp = `Ctrl+Alt+${restoredVolumeKey}`;
        }
        shortcutsState = { enabled: Boolean(args.enabled), bindings };
        return { ...shortcutsState, bindings: { ...shortcutsState.bindings } };
      }
      case 'desktop_lyric_get':
        return { ...lyricWindowState };
      case 'desktop_lyric_set': {
        lyricWindowState = {
          enabled: Boolean(args.enabled),
          locked: args.locked === undefined ? lyricWindowState.locked : Boolean(args.locked),
          position: args.enabled ? lyricWindowState.position || { x: 240, y: 640 } : lyricWindowState.position,
          style: {
            ...lyricWindowState.style,
            ...(args.style && typeof args.style === 'object' ? args.style : {}),
          },
        };
        return { ...lyricWindowState, style: { ...lyricWindowState.style } };
      }
      case 'desktop_lyric_update':
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
  throw Error('等待 P2-A 状态超时：' + label + '\n' + document.body.textContent);
};
const buttonByText = text => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
const buttonIncludes = text => [...document.querySelectorAll('button')].find(x => x.textContent.includes(text));
const countCmd = name => calls.filter(c => c.cmd === name).length;

try {
  // 1. 启动拉取全局快捷键与桌面歌词状态，未开桌面歌词时零次推送歌词
  await wait(
    () =>
      countCmd('global_shortcuts_get') >= 1 &&
      countCmd('desktop_lyric_get') >= 1 &&
      listeners.has('prism:global-shortcut') &&
      listeners.has('prism:desktop-lyric-state') &&
      buttonIncludes('夜车测试单'),
    'P2-A 初始化'
  );
  assert.equal(countCmd('desktop_lyric_update'), 0, '桌面歌词关闭时不应推送内容');

  // 选歌播放第一首
  buttonIncludes('夜车测试单').click();
  await wait(() => [...document.querySelectorAll('.song')].some(x => x.textContent.includes('夜车')), '加载歌单');
  activateSong([...document.querySelectorAll('.song')].find(x => x.textContent.includes('夜车')));
  const audio = document.querySelector('audio');
  await wait(() => audio.src.endsWith('/501.mp3') && !paused, '播放第一首');
  assert.equal(countCmd('desktop_lyric_update'), 0, '未开启桌面歌词时播歌也不应推送');

  // 2. 打开设置页 -> 全局快捷键 -> 开启、冲突回滚提示、修改保存
  document.querySelector('.nr-top-settings-btn').click();
  await wait(() => document.querySelector('.nr-settings-page'), '打开独立设置页');
  buttonByText('全局快捷键').click();
  await wait(() => buttonByText('已关闭'), '进入全局快捷键设置');

  buttonByText('已关闭').click();
  await wait(() => {
    const volumeKey = document.querySelector('select[aria-label="增大音量 主键"]');
    return buttonByText('已开启') && volumeKey?.value === restoredVolumeKey && !volumeKey.disabled;
  }, '总开关已开启且配置已同步到设置页');
  assert.equal(calls.filter(c => c.cmd === 'global_shortcuts_set').at(-1).args.enabled, true);

  // 模拟系统快捷键冲突
  rejectNextShortcutConflict = true;
  const modSelect = document.querySelector('select[aria-label="播放 / 暂停 修饰键"]');
  modSelect.value = 'Ctrl+Shift';
  modSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await wait(() => buttonByText('保存快捷键') && !buttonByText('保存快捷键').disabled, '保存按钮可点击');
  buttonByText('保存快捷键').click();
  await wait(
    () => document.querySelector('.nr-settings-card [role="alert"]')?.textContent.includes('系统快捷键已被占用'),
    '展示快捷键冲突原因'
  );
  assert.equal(shortcutsState.bindings.togglePlayback, 'Ctrl+Alt+P', '冲突时不得覆盖原有效绑定');

  // 切选 Ctrl+Shift+Left 时提示文本选中风险，再改用 Space 并保存成功
  const prevModSelect = document.querySelector('select[aria-label="上一首 修饰键"]');
  prevModSelect.value = 'Ctrl+Shift';
  prevModSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await wait(
    () => document.querySelector('.nr-shortcut-hint')?.textContent.includes('选中文字'),
    '展示 Ctrl+Shift+方向键温和提示'
  );
  prevModSelect.value = 'Ctrl+Alt';
  prevModSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  const keySelect = document.querySelector('select[aria-label="播放 / 暂停 主键"]');
  keySelect.value = 'Space';
  keySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  // 再次保存成功
  buttonByText('保存快捷键').click();
  await wait(() => shortcutsState.bindings.togglePlayback === 'Ctrl+Shift+Space', '修改绑定保存成功');
  assert.equal(document.querySelector('.nr-settings-card [role="alert"]'), null);
  buttonByText('返回音乐库').click();
  await wait(() => document.querySelector('.app').dataset.view === 'library', '退出设置页返回音乐库');

  // 3. 验证 prism:global-shortcut 全动作驱动唯一 <audio>
  listeners.get('prism:global-shortcut')({ payload: { action: 'togglePlayback' } });
  await wait(() => paused, '全局热键暂停');
  listeners.get('prism:global-shortcut')({ payload: { action: 'togglePlayback' } });
  await wait(() => !paused, '全局热键继续播放');

  listeners.get('prism:global-shortcut')({ payload: { action: 'volumeDown' } });
  await wait(() => Math.abs(audio.volume - 0.95) < 0.001, '全局热键减小音量');
  listeners.get('prism:global-shortcut')({ payload: { action: 'volumeUp' } });
  await wait(() => Math.abs(audio.volume - 1) < 0.001, '全局热键增大音量');

  listeners.get('prism:global-shortcut')({ payload: { action: 'nextTrack' } });
  await wait(() => audio.src.endsWith('/502.mp3'), '全局热键下一首');
  listeners.get('prism:global-shortcut')({ payload: { action: 'prevTrack' } });
  await wait(() => audio.src.endsWith('/501.mp3'), '全局热键上一首');
  assert.equal(document.querySelectorAll('audio').length, 1, '全过程仅一个 audio');

  // 4. 桌面悬浮歌词开关、事件驱动推送、同句零重复推送、锁定与外部状态同步关闭
  const lyricUpdatesBefore = countCmd('desktop_lyric_update');
  listeners.get('prism:global-shortcut')({ payload: { action: 'toggleDesktopLyric' } });
  await wait(() => document.querySelector('[aria-label="关闭桌面歌词"]'), '快捷键开启桌面歌词');
  await wait(() => countCmd('desktop_lyric_update') > lyricUpdatesBefore, '开启后推送首帧');

  audio.currentTime = 6;
  audio.dispatchEvent(new Event('timeupdate'));
  await wait(
    () => calls.filter(c => c.cmd === 'desktop_lyric_update').at(-1)?.args?.text === '第一句夜景',
    '切到第一句推送歌词'
  );
  const firstUpdate = calls.filter(c => c.cmd === 'desktop_lyric_update').at(-1).args;
  assert.equal(firstUpdate.translation, 'First night view');
  assert.equal(firstUpdate.romaji, 'di yi ju');
  assert.equal(firstUpdate.title, '夜车 - 曾轶可');
  assert.equal(firstUpdate.playing, true);
  assert.equal(firstUpdate.nextText, '第二句灯光');
  assert.equal(firstUpdate.durationMs, 10000);
  assert.equal(firstUpdate.rate, 1);
  assert.match(firstUpdate.accentColor, /^#[0-9a-fA-F]{6}$/);

  // 同句内多次 timeupdate 不得重复推送
  const countAtLine1 = countCmd('desktop_lyric_update');
  for (let t = 7; t <= 11; t++) {
    audio.currentTime = t;
    audio.dispatchEvent(new Event('timeupdate'));
  }
  await new Promise(r => setTimeout(r, 40));
  assert.equal(countCmd('desktop_lyric_update'), countAtLine1, '同一歌词行内不得重复调用 desktop_lyric_update');

  // 切到第二句
  audio.currentTime = 16;
  audio.dispatchEvent(new Event('timeupdate'));
  await wait(
    () => calls.filter(c => c.cmd === 'desktop_lyric_update').at(-1)?.args?.text === '第二句灯光',
    '切到第二句推送歌词'
  );

  // 设置页桌面歌词内锁定穿透 -> 底栏出现解锁图标 -> 点击解锁
  document.querySelector('.nr-top-settings-btn').click();
  await wait(() => document.querySelector('.nr-settings-page'), '打开设置页');
  buttonByText('桌面歌词').click();
  await wait(() => buttonIncludes('穿透锁定：未锁定'), '设置页锁定入口');
  buttonIncludes('穿透锁定：未锁定').click();
  await wait(() => document.querySelector('[aria-label="解除桌面歌词锁定"]'), '底栏出现锁定解锁键');
  assert.deepEqual(calls.filter(c => c.cmd === 'desktop_lyric_set').at(-1).args, {
    enabled: true,
    locked: true,
  });

  document.querySelector('[aria-label="解除桌面歌词锁定"]').click();
  await wait(() => !document.querySelector('[aria-label="解除桌面歌词锁定"]'), '点击底栏解除锁定');
  assert.deepEqual(calls.filter(c => c.cmd === 'desktop_lyric_set').at(-1).args, {
    enabled: true,
    locked: false,
  });

  // 在设置页桌面歌词面板切换主题/字号/模式/推进/透明度
  buttonByText('高对比').click();
  await wait(() => lyricWindowState.style.theme === 'contrast', '切换桌面歌词配色');
  buttonByText('单行').click();
  await wait(() => lyricWindowState.style.layout === 'single', '切换单行字幕模式');
  buttonByText('大').click();
  await wait(() => lyricWindowState.style.fontSize === 34, '切换桌面歌词字号');
  buttonByText('暖光推进').click();
  await wait(() => lyricWindowState.style.karaoke === false, '关闭暖光推进');
  buttonByText('音译').click();
  await wait(() => lyricWindowState.style.showRomaji === true, '开启音译字幕');

  const opacitySlider = document.querySelector('#nr-settings-dlyric-opacity');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(
    opacitySlider,
    '64'
  );
  opacitySlider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  opacitySlider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  opacitySlider.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
  await wait(() => lyricWindowState.style.panelOpacity === 64, '更新桌面歌词底板透明度');

  // 模拟从悬浮窗控制条触发的事件回传同步到主界面
  listeners.get('prism:desktop-lyric-state')({
    payload: {
      enabled: true,
      locked: false,
      position: { x: 160, y: 520 },
      style: { ...lyricWindowState.style, fontSize: 38, layout: 'dual' },
    },
  });
  await wait(() => document.querySelector('.nr-settings-page')?.textContent.includes('38px'), '同步悬浮窗修改字号');

  // 模拟原生桌面歌词窗关闭 -> 派发 prism:desktop-lyric-state
  const beforeCloseCount = countCmd('desktop_lyric_update');
  listeners.get('prism:desktop-lyric-state')({
    payload: { enabled: false, locked: false, position: { x: 160, y: 520 } },
  });
  await wait(() => document.querySelector('[aria-label="开启桌面歌词"]'), '同步原生窗口关闭态');

  audio.currentTime = 6;
  audio.dispatchEvent(new Event('timeupdate'));
  await new Promise(r => setTimeout(r, 40));
  assert.equal(countCmd('desktop_lyric_update'), beforeCloseCount, '桌面歌词关闭后切行不再推送');

  console.log('通过：P2-A 全局快捷键设置与冲突提示、系统热键响应、桌面悬浮歌词事件驱动同步与锁定恢复');
} finally {
  dom.window.close();
}
