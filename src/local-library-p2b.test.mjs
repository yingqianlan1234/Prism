import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.isTauri = true;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
for (const n of ['MutationObserver', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent']) {
  globalThis[n] = dom.window[n];
}

let paused = true;
const calls = [];
let folders = [{ id: 'f1', name: '夜晚常听' }];
let allLocalTracks = [
  { id: 'loc-1', folderId: 'f1', title: '雨夜归途', artist: '林间电台', album: '深夜信号', durationMs: 210000 },
  { id: 'loc-2', folderId: 'f1', title: '海边收音机', artist: '晚风乐队', album: '蓝调时刻', durationMs: 195000 },
];
let savedQueue = { ids: ['loc-1', 'loc-2'], index: 0, position: 42 };
let pickStep = 0;

Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'paused', {
  configurable: true,
  get() {
    return paused;
  },
});
Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'duration', {
  configurable: true,
  get() {
    return 210;
  },
});
Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'readyState', {
  configurable: true,
  get() {
    return 4;
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

window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case 'host_capabilities':
        return { qqMusic: false, globalShortcuts: false, desktopLyric: false, closeBehavior: false };
      case 'playback_state_load':
        if (args.provider === 'last') return { status: 'ok', provider: 'qqmusic' };
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
      case 'local_library_folders_get':
        return folders;
      case 'local_library_folder_pick': {
        pickStep += 1;
        if (pickStep === 1) return null;
        const added = { id: 'f2', name: '无损合集' };
        folders = [...folders, added];
        allLocalTracks = [
          ...allLocalTracks,
          { id: 'loc-3', folderId: 'f2', title: '清晨广播', artist: '城市之声', album: '早安', durationMs: 240000 },
        ];
        return added;
      }
      case 'local_library_folder_remove':
        folders = folders.filter(f => f.id !== args.id);
        allLocalTracks = allLocalTracks.filter(t => t.folderId !== args.id);
        return null;
      case 'local_library_scan':
        return { total: allLocalTracks.length, truncated: false, unavailableFolderIds: [] };
      case 'local_library_tracks_get': {
        const off = args?.offset || 0;
        const lim = args?.limit || 100;
        const slice = allLocalTracks.slice(off, off + lim);
        return {
          tracks: slice,
          total: allLocalTracks.length,
          hasMore: off + slice.length < allLocalTracks.length,
          scanned: true,
        };
      }
      case 'local_track_resolve':
        return { url: `prismlocal://localhost/${args.id}.flac`, contentType: 'audio/flac' };
      case 'local_track_lyric':
        if (args.id === 'loc-1') return '[00:10.00]窗外雨滴落下来\n[00:50.00]耳机里正播到半夜';
        return null;
      case 'local_queue_get':
        return savedQueue;
      case 'local_queue_set':
        savedQueue = args.queue;
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
  throw Error('等待 P2-B 本地曲库状态超时：' + label + '\n' + document.body.textContent);
};
const buttonByText = text => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
const buttonIncludes = text => [...document.querySelectorAll('button')].find(x => x.textContent.includes(text));
const countCmd = name => calls.filter(c => c.cmd === name).length;

try {
  // 1. 启动不切本地前不主动扫描本地曲库；切入「本地」工作区后扫描并恢复本地队列与歌词
  await wait(() => buttonByText('本地'), '顶栏本地入口');
  assert.equal(buttonByText('QQ 音乐'), undefined, '未启用 QQ 能力时隐藏对应工作区');
  assert.equal(countCmd('global_shortcuts_get'), 0, '未启用快捷键能力时不调用快捷键命令');
  assert.equal(countCmd('close_behavior_get'), 0, '未启用托盘行为配置时不调用对应命令');
  assert.equal(countCmd('qq_web_account'), 0, '未启用 QQ 能力时忽略保存的 QQ 播放来源');
  assert.equal(countCmd('local_library_scan'), 0, '切入本地前不应触发扫描');
  buttonByText('本地').click();

  await wait(() => [...document.querySelectorAll('.song')].some(x => x.textContent.includes('雨夜归途')), '展示本地曲目');
  await wait(() => document.querySelector('.nr-current-copy b')?.textContent === '雨夜归途', '恢复上次本地曲目');
  await wait(
    () => document.querySelector('input[aria-label="播放进度"]')?.value === '42',
    '恢复本地播放位置 42 秒'
  );
  assert.equal(paused, true, '恢复后默认停留在暂停状态');

  const audio = document.querySelector('audio');
  document.querySelector('.play-toggle').click();
  await wait(() => audio.src === 'prismlocal://localhost/loc-1.flac' && !paused, '点击播放恢复的本地歌曲');
  audio.dispatchEvent(new Event('loadedmetadata'));
  await wait(() => Math.round(audio.currentTime) === 42, '恢复位置跳至 42 秒');

  // 2. 同名 .lrc 歌词高亮同步（点击底部封面进入一体舞台）
  document.querySelector('.nr-current-trigger').click();
  await wait(() => document.querySelector('.lyric-panel'), '打开一体舞台歌词');
  audio.currentTime = 52;
  audio.dispatchEvent(new Event('timeupdate'));
  await wait(() => document.querySelector('.lyric-panel .current-line')?.textContent === '耳机里正播到半夜', '本地 LRC 歌词同步高亮');
  document.querySelector('.nr-top-back').click();
  await wait(() => document.querySelector('.app')?.dataset.view === 'library', '返回曲库');

  // 3. 取消选目录 -> 添加新目录 -> 按目录与关键词筛选 -> 移除目录
  buttonIncludes('添加文件夹').click();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(countCmd('local_library_scan'), 1, '取消选择目录不应触发额外扫描');

  buttonIncludes('添加文件夹').click();
  await wait(() => [...document.querySelectorAll('.song')].some(x => x.textContent.includes('清晨广播')), '新增目录并扫出新歌');
  buttonIncludes('无损合集').click();
  await wait(() => document.querySelectorAll('.song').length === 1 && document.body.textContent.includes('清晨广播'), '按目录筛选');

  const filterInput = document.querySelector('input[placeholder="筛选本地歌曲、歌手、专辑"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(filterInput, '广播');
  filterInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await wait(() => document.querySelectorAll('.song').length === 1, '关键词筛选');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(filterInput, '');
  filterInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  buttonIncludes('全部本地歌曲').click();
  await wait(() => document.querySelectorAll('.song').length === 3, '切回全部本地歌曲');

  document.querySelector('[aria-label="移除文件夹 无损合集"]').click();
  await wait(() => document.querySelectorAll('.song').length === 2, '移除目录后同步更新列表');

  // 4. 切换回网易云浏览时保持本地音频持续播放与「来源：本地音乐」标记
  buttonByText('网易云').click();
  await wait(() => buttonByText('网易云').getAttribute('aria-pressed') === 'true', '切回网易云工作区');
  assert.equal(paused, false, '切回网易云不能打断本地歌曲播放');
  assert(document.querySelector('footer .current small')?.textContent.includes('来源：本地音乐'), '底栏应标明来源：本地音乐');

  // 5. 切回本地并清空本地队列，确认 local_queue_set 持久化清空
  buttonByText('本地').click();
  await wait(() => document.querySelector('[aria-label="打开播放队列"]'), '等待队列按钮');
  document.querySelector('[aria-label="打开播放队列"]').click();
  await wait(() => buttonByText('清空队列'), '打开本地播放队列');
  buttonByText('清空队列').click();
  await wait(() => buttonByText('确认清空'), '确认清空弹出');
  buttonByText('确认清空').click();
  await wait(() => savedQueue && Array.isArray(savedQueue.ids) && savedQueue.ids.length === 0, '清空本地队列持久化');
  assert.equal(savedQueue.index, null);
  assert.equal(document.querySelectorAll('audio').length, 1, '全过程仅一个 audio');

  console.log('通过：P2-B 本地曲库按需扫描、目录增删筛选、队列恢复与进度跳播、本地 LRC 歌词及跨工作区单 audio 播放');
} finally {
  dom.window.close();
}
