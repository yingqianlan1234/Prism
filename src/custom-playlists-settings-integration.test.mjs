import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const macos = process.argv.includes('--macos');
const localMediaOrigin = macos ? 'vesperlocal://localhost' : 'http://vesperlocal.localhost';
const qqMediaOrigin = macos ? 'vespermedia://localhost' : 'http://vespermedia.localhost';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.isTauri = true;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true });
for (const n of ['MutationObserver', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'Blob']) {
  globalThis[n] = dom.window[n];
}

let paused = true;
const calls = [];
let closeMode = 'ask';
let autostartEnabled = false;
let persistedPlaylists = { version: 1, playlists: [] };
const samplePngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

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
  metadata: { currentWindow: { label: 'main' } },
  transformCallback: () => 1,
  invoke: async (cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case 'host_capabilities':
        return {
          qqMusic: true,
          globalShortcuts: !macos,
          desktopLyric: !macos,
          closeBehavior: !macos,
          appUpdater: !macos,
          customTitlebar: !macos,
          autostart: !macos,
          customPlaylistsStorage: true,
          localTrackCover: true,
          feedback: true,
        };
      case 'custom_playlists_load':
        return persistedPlaylists.playlists.length
          ? { status: 'ok', data: persistedPlaylists }
          : { status: 'empty' };
      case 'custom_playlists_save':
        persistedPlaylists = args.data;
        return { saved: true };
      case 'autostart_get':
        return { enabled: autostartEnabled };
      case 'autostart_set':
        autostartEnabled = Boolean(args.enabled);
        return { enabled: autostartEnabled };
      case 'plugin:event|listen':
        return 1;
      case 'plugin:event|unlisten':
        return null;
      case 'playback_state_load':
        return { status: 'empty' };
      case 'playback_state_save':
        return { saved: true };
      case 'close_behavior_get':
        return { mode: closeMode, trayAvailable: true };
      case 'close_behavior_set':
        closeMode = args.mode;
        return null;
      case 'netease_account':
        return { profile: { userId: 101, nickname: '晴岚' } };
      case 'netease_likelist':
        return { code: 200, ids: [] };
      case 'netease_playlists':
        return {
          playlist: [{ id: 10, name: '网易原单', trackCount: 1, creator: { userId: 101 } }],
          more: false,
        };
      case 'netease_playlist':
        return {
          playlist: { id: 10, name: '网易原单', userId: 101, creator: { userId: 101 } },
          songs: [
            {
              id: 501,
              name: '夜车',
              artists: [{ name: '曾轶可' }],
              album: { name: '一只猫的旅行' },
              duration: 210000,
            },
          ],
          total: 1,
          hasMore: false,
        };
      case 'netease_url':
        return { data: [{ code: 200, url: `https://example.invalid/ne-${args.id}.mp3`, level: 'standard', br: 128000 }] };
      case 'netease_lyric':
        return { lrc: { lyric: '[00:05.00]网易云歌词' } };
      case 'qq_web_account':
        return { profile: { userId: macos ? '1234567890123456' : '888', nickname: 'QQ晴岚' } };
      case 'qq_web_playlists':
        return { playlist: [], more: null };
      case 'qq_search':
        return {
          result: {
            songs: [
              {
                id: 'QQ101',
                mediaMid: 'MID101',
                name: '海浪',
                artists: [{ name: 'december' }],
                album: { name: 'Ocean' },
                duration: 180000,
              },
            ],
            songCount: 1,
          },
        };
      case 'qq_web_resolve':
        return { data: [{ code: 200, url: `${qqMediaOrigin}/qq-${args.mid}.m4a` }] };
      case 'qq_web_lyric':
        return { lrc: { lyric: '[00:05.00]QQ音乐歌词' } };
      case 'local_library_folders_get':
        return [{ id: 'f1', name: '本地无损' }];
      case 'local_library_scan':
        return { total: 1, truncated: false, unavailableFolderIds: [] };
      case 'local_library_tracks_get':
        return {
          tracks: [
            {
              id: 'loc-1',
              folderId: 'f1',
              title: '凌晨录音',
              artist: '城市电台',
              album: 'Demo',
              durationMs: 120000,
            },
          ],
          total: 1,
          hasMore: false,
          scanned: true,
        };
      case 'local_queue_get':
        return { ids: [], index: null, position: 0 };
      case 'local_queue_set':
        return null;
      case 'local_track_resolve':
        return { url: `${localMediaOrigin}/${args.id}.flac` };
      case 'local_track_lyric':
        return '[00:05.00]本地歌词';
      case 'local_track_cover':
        return args.id === 'loc-1' ? samplePngDataUrl : null;
      case 'global_shortcuts_get':
        return { enabled: false, bindings: {} };
      case 'desktop_lyric_get':
        return { enabled: false, locked: false, position: null };
      case 'app_update_config_get':
        return {
          currentVersion: '1.1.0',
          autoCheck: false,
          source: 'github',
          customMirror: '',
          defaultMirror: 'https://gh-proxy.com/',
          skippedVersion: null,
          pubkeyConfigured: true,
        };
      case 'feedback_submit':
        if (args?.payload?.title?.includes('模拟失败')) {
          throw Error('反馈服务暂时不可用，请稍后重试');
        }
        return { ok: true, issueNumber: 18 };
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
  throw Error('等待跨源歌单/设置页状态超时：' + label + '\n' + document.body.textContent);
};
const buttonByText = text => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
const buttonIncludes = text => [...document.querySelectorAll('button')].find(x => x.textContent.includes(text));
const setInputValue = (input, val) => {
  const proto =
    input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(input, val);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

try {
  // 1. 登录并打开网易歌单，新建本机歌单「深夜混音」并加入网易云歌曲
  await wait(() => buttonIncludes('网易原单'), '网易歌单加载');
  buttonIncludes('网易原单').click();
  await wait(() => document.querySelector('[aria-label="收藏 夜车 到歌单"]'), '加载网易云歌曲');

  document.querySelector('[aria-label="收藏 夜车 到歌单"]').click();
  const newInput = await wait(() => document.querySelector('input[aria-label="新建本机歌单并加入"]'), '收藏弹窗打开');
  setInputValue(newInput, '深夜混音');
  buttonByText('新建并加入').click();
  await wait(() => !document.querySelector('.nr-picker-dialog'), '新建本机歌单并关闭弹窗');
  assert.equal(calls.filter(c => c.cmd === 'netease_playlist_tracks_op').length, 0, '加入本机歌单不应调用网易原接口');

  // 2. 切到 QQ 音乐搜索一首歌并加入「深夜混音」
  buttonByText('QQ 音乐').click();
  await wait(() => buttonIncludes('QQ晴岚'), 'QQ 账号恢复完成');
  const searchInput = await wait(() => document.querySelector('input[placeholder="搜索歌曲、歌手"]'), 'QQ 搜索框就绪');
  setInputValue(searchInput, '海浪');
  await new Promise(r => setTimeout(r, 0));
  searchInput.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => document.querySelector('[aria-label="收藏 海浪 到歌单"]'), 'QQ 搜索出结果');
  document.querySelector('[aria-label="收藏 海浪 到歌单"]').click();
  const customItem1 = await wait(
    () => [...document.querySelectorAll('.nr-custom-picker-item')].find(x => x.textContent.includes('深夜混音')),
    'QQ 歌曲弹窗出现本机歌单'
  );
  customItem1.click();
  await wait(() => !document.querySelector('.nr-picker-dialog'), 'QQ 歌曲加入完成');

  // 3. 切到本地曲库并加入一首本地歌曲到「深夜混音」
  buttonByText('本地').click();
  await wait(() => document.querySelector('[aria-label="收藏 凌晨录音 到歌单"]'), '本地曲库加载');
  document.querySelector('[aria-label="收藏 凌晨录音 到歌单"]').click();
  const customItem2 = await wait(
    () => [...document.querySelectorAll('.nr-custom-picker-item')].find(x => x.textContent.includes('深夜混音')),
    '本地歌曲弹窗出现本机歌单'
  );
  customItem2.click();
  await wait(() => !document.querySelector('.nr-picker-dialog'), '本地歌曲加入完成');
  await wait(
    () => persistedPlaylists.playlists.some(p => p.name === '深夜混音' && p.tracks.length === 3),
    '跨源歌单变更同步落盘到 app_data_dir'
  );

  // 4. 打开「深夜混音」，验证三源统计、歌单内筛选与跨源连续自动切歌（本地 -> QQ -> 网易）
  const customNavBtn = await wait(
    () => [...document.querySelectorAll('.nr-custom-playlist-btn')].find(x => x.textContent.includes('深夜混音')),
    '侧栏显示深夜混音'
  );
  customNavBtn.click();
  await wait(() => document.body.textContent.includes('网易云 1 · QQ 1 · 本地 1'), '显示三源数量统计');

  const filterInput = document.querySelector('input[aria-label="筛选本机歌单曲目"]');
  setInputValue(filterInput, '海浪');
  await wait(() => document.querySelectorAll('.row.song').length === 1, '筛选只留海浪');
  setInputValue(filterInput, '');
  await wait(() => document.querySelectorAll('.row.song').length === 3, '清空筛选恢复 3 首');

  const saveCountBeforeMixed = calls.filter(c => c.cmd === 'playback_state_save').length;
  const localSaveBeforeMixed = calls.filter(c => c.cmd === 'local_queue_set').length;

  const audio = document.querySelector('audio');
  document.querySelector('[aria-label="播放本机歌单第一首"]').click();
  await wait(() => audio.src === `${localMediaOrigin}/loc-1.flac`, '第1首本地曲目起播');
  await wait(() => document.querySelector('.app').dataset.view === 'stage', '点播本机歌单自动进入歌词舞台');

  // 返回曲库后，验证后台连播和底部切歌不会强行拽回舞台
  buttonByText('返回曲库').click();
  await wait(() => document.querySelector('.app').dataset.view === 'library', '返回曲库');
  audio.dispatchEvent(new Event('ended'));
  await wait(() => audio.src === `${qqMediaOrigin}/qq-QQ101.m4a`, '自动跨源连播第2首 QQ 曲目');
  assert.equal(document.querySelector('.app').dataset.view, 'library', '后台连播不应强行拉回舞台');
  audio.dispatchEvent(new Event('ended'));
  await wait(() => audio.src.includes('ne-501.mp3'), '自动跨源连播第3首网易云曲目');
  assert.equal(document.querySelector('.app').dataset.view, 'library', '两次自动切歌后仍停留在曲库');

  assert.equal(
    calls.filter(c => c.cmd === 'playback_state_save').length,
    saveCountBeforeMixed,
    '跨源混合队列播放不应写入单平台持久化'
  );
  assert.equal(
    calls.filter(c => c.cmd === 'local_queue_set').length,
    localSaveBeforeMixed,
    '跨源混合队列播放不应污染本地队列持久化'
  );

  // 5. 切入独立设置页，逐个切换 6 个分组并验证设置持久化和 Escape 返回不打断唯一 audio
  const navSettingsBtn = document.querySelector('.nr-top-settings-btn');
  navSettingsBtn.click();
  await wait(() => document.querySelector('.nr-settings-page'), '进入独立设置页');
  assert.equal(document.querySelector('.app').dataset.view, 'settings');
  assert.equal(document.querySelectorAll('audio').length, 1);
  assert.equal(paused, false, '进入设置页不能中断播放');
  assert.equal(Boolean(document.querySelector('.nr-win-controls')), !macos, '只在 Windows 显示自定义窗口按钮');
  assert.equal(document.querySelector('.topbar').hasAttribute('data-tauri-drag-region'), !macos);

  if (macos) {
    assert.equal(buttonByText('完全退出并停止播放'), undefined);
    assert.equal(buttonByText('开机自启'), undefined);
    assert.equal(
      calls.some(
        c =>
          c.cmd === 'close_behavior_get' ||
          c.cmd === 'app_update_config_get' ||
          c.cmd === 'autostart_get'
      ),
      false
    );
  } else {
    buttonByText('完全退出并停止播放').click();
    await wait(() => closeMode === 'exit', '独立设置页修改关闭行为生效');
    const autostartBtn = buttonByText('开机自启');
    assert(autostartBtn, 'Windows 设置页应显示开机自动启动选项');
    assert.equal(autostartBtn.getAttribute('aria-pressed'), 'false');
    autostartBtn.click();
    await wait(() => autostartEnabled === true && autostartBtn.getAttribute('aria-pressed') === 'true', '切换开启开机自启');
    buttonByText('关闭（默认）').click();
    await wait(() => autostartEnabled === false && autostartBtn.getAttribute('aria-pressed') === 'false', '切回关闭开机自启');
  }

  buttonByText('外观与主题').click();
  await wait(() => document.querySelectorAll('.nr-theme-card').length === 4, '展示 4 套主题预览卡片');

  document.querySelector('[data-theme-option="warm"]').click();
  await wait(() => document.documentElement.dataset.theme === 'warm', '切换暖炭玄岩主题');
  assert.equal(document.querySelector('.app').dataset.theme, 'warm');

  document.querySelector('[data-theme-option="crystal"]').click();
  await wait(() => document.documentElement.dataset.theme === 'crystal', '切换白昼冷晶浅色主题');

  document.querySelector('[data-theme-option="night-radio"]').click();
  await wait(() => document.documentElement.dataset.theme === 'night-radio', '切换深夜雨窗主题');

  document.querySelector('[data-theme-option="obsidian"]').click();
  await wait(() => document.documentElement.dataset.theme === 'obsidian', '切回深空黑曜主题');

  buttonByText('关闭').click();
  await wait(() => document.documentElement.dataset.ambient === 'off', '关闭环境光');
  buttonByText('浓郁').click();
  await wait(() => document.documentElement.dataset.ambient === 'rich', '切换浓郁环境光');

  const storedTheme = JSON.parse(dom.window.localStorage.getItem('vesper.themePrefs.v1'));
  assert.deepEqual(storedTheme, { theme: 'obsidian', ambient: 'rich' });

  buttonByText('播放与听感').click();
  await wait(() => document.body.textContent.includes('起播 / 恢复播放柔和淡入'), '进入播放与听感分组');
  const fadeBtn = [...document.querySelectorAll('.nr-settings-card .nr-shortcut-toggle')][0];
  assert.equal(fadeBtn.textContent.trim(), '已开启');
  fadeBtn.click();
  await wait(() => fadeBtn.textContent.trim() === '已关闭', '关闭柔和淡入');

  const autoStageBtn = document.querySelector('[data-setting-toggle="auto-open-stage"]');
  assert.equal(autoStageBtn.textContent.trim(), '已开启');
  autoStageBtn.click();
  await wait(() => autoStageBtn.textContent.trim() === '已关闭', '关闭点播自动进入歌词舞台');
  const storedAudioPrefs = JSON.parse(dom.window.localStorage.getItem('vesper.audioPrefs.v1'));
  assert.equal(storedAudioPrefs.autoOpenStageOnPlay, false, '设置页开关应持久化 autoOpenStageOnPlay');

  if (macos) {
    assert.equal(document.querySelectorAll('.nr-settings-aside nav button').length, 4);
  } else {
    buttonByText('桌面歌词').click();
    await wait(() => document.body.textContent.includes('原生 Direct2D 桌面悬浮字幕'), '进入桌面歌词分组');

    buttonByText('全局快捷键').click();
    await wait(() => document.body.textContent.includes('系统级热键响应'), '进入全局快捷键分组');

    buttonIncludes('更新与关于').click();
    await wait(() => document.body.textContent.includes('Vesper v1.1.0'), '进入应用更新分组');
  }

  // 问题反馈分组（Windows 与 macOS 均可用）
  buttonByText('问题反馈').click();
  await wait(() => document.body.textContent.includes('问题反馈与建议'), '进入问题反馈分组');
  buttonByText('播放与音质').click();
  buttonByText('查看内容').click();
  await wait(() => document.body.textContent.includes('Vesper v1.1.0'), '展示脱敏运行环境预览');
  const titleInput = document.querySelector('#nr-feedback-title');
  const descInput = document.querySelector('#nr-feedback-desc');
  setInputValue(titleInput, 'a');
  setInputValue(descInput, '太短');
  buttonByText('发送反馈').click();
  await wait(() => document.body.textContent.includes('标题至少需要 2 个字符'), '本地长度校验拦截无效提交');
  assert.equal(calls.filter(c => c.cmd === 'feedback_submit').length, 0);

  setInputValue(titleInput, 'QQ 无损回退测试反馈');
  setInputValue(descInput, '在设置页提交一条完整的问题反馈用于验证前后端联调。');
  buttonByText('发送反馈').click();
  await wait(() => document.body.textContent.includes('已登记为 #18'), '成功提交反馈并展示 Issue 编号');
  const fbCall = calls.filter(c => c.cmd === 'feedback_submit').at(-1);
  assert.equal(fbCall.args.payload.category, 'playback');
  assert.equal(fbCall.args.payload.includeEnv, true);
  assert.equal(fbCall.args.payload.context.theme, 'obsidian');

  setInputValue(titleInput, '模拟失败反馈提交');
  setInputValue(descInput, '再次提交以测试网络或服务失败时保留内容并展示错误提示。');
  buttonByText('发送反馈').click();
  await wait(() => document.body.textContent.includes('反馈服务暂时不可用，请稍后重试'), '提交失败时显示错误提示');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(() => document.querySelector('.app').dataset.view === 'library', '按 Escape 返回曲库');
  assert.equal(paused, false, '退出设置页仍继续播放');

  // 关闭开关后，再次在曲库点播应停留在曲库不自动跳转舞台
  document.querySelector('[aria-label="播放本机歌单第一首"]').click();
  await wait(() => audio.src.includes('loc-1.flac'), '关闭自动进舞台后再次点播');
  assert.equal(document.querySelector('.app').dataset.view, 'library', '关闭自动进舞台开关后点播停留在曲库');

  console.log(`通过：${macos ? 'macOS' : 'Windows'} 顶栏、三源自动连播、独立设置页和主题切换`);
} finally {
  dom.window.close();
}
