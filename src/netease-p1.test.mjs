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

const calls = [];
let ownedTracks = [
  { id: 10, name: '自建歌一', artists: [{ name: '歌手甲' }], album: { name: '专辑甲' }, duration: 180000 },
  { id: 20, name: '自建歌二', artists: [{ name: '歌手乙' }], album: { name: '专辑乙' }, duration: 200000 },
];
let fmBatch = [
  { id: 301, name: 'FM 首曲', artists: [{ name: '歌手丙' }], album: { name: '专辑丙' }, duration: 210000 },
  { id: 302, name: 'FM 次曲', artists: [{ name: '歌手丁' }], album: { name: '专辑丁' }, duration: 220000 },
];

window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case 'playback_state_load':
        return { status: 'empty' };
      case 'playback_state_save':
        return { saved: true };
      case 'netease_account':
        return { profile: { userId: 777, nickname: '晴岚' } };
      case 'netease_likelist':
        return { code: 200, ids: [10] };
      case 'netease_playlists':
        return {
          playlist: [
            { id: 1001, name: '我的深夜电台', trackCount: ownedTracks.length, creator: { userId: 777 } },
            { id: 1002, name: '他人精选集', trackCount: 1, creator: { userId: 999 } },
          ],
          more: false,
        };
      case 'netease_playlist':
        if (args.id === 1001) {
          return {
            playlist: { id: 1001, name: '我的深夜电台', userId: 777, creator: { userId: 777 } },
            songs: ownedTracks,
            total: ownedTracks.length,
            hasMore: false,
          };
        }
        return {
          playlist: { id: args.id, name: '他人歌单', userId: 999, creator: { userId: 999 } },
          songs: [{ id: 88, name: '收藏歌一', artists: [{ name: '歌手戊' }], album: { name: '专辑戊' }, duration: 190000 }],
          total: 1,
          hasMore: false,
        };
      case 'netease_url':
        return {
          data: [
            {
              code: 200,
              url: `https://example.invalid/${args.id}.flac`,
              level: args.level || 'standard',
              br: args.level === 'lossless' ? 999000 : 128000,
              freeTrialInfo: args.id === 10 ? { start: 0, end: 30 } : null,
            },
          ],
        };
      case 'netease_lyric':
        return { lrc: { lyric: '[00:01.00]测试歌词' } };
      case 'netease_search': {
        if (args.searchType === 1000) {
          return {
            result: {
              playlists: [{ id: 1002, name: '搜索到他人歌单', trackCount: 1, creator: { userId: 999, nickname: '别人' } }],
              playlistCount: 1,
            },
          };
        }
        if (args.searchType === 10) {
          return {
            result: {
              albums: [{ id: 501, name: '专辑测试', artist: { name: '歌手己' }, size: 8 }],
              albumCount: 1,
            },
          };
        }
        const offset = args.offset || 0;
        return {
          result: {
            songs: Array.from({ length: offset ? 2 : 40 }, (_, idx) => ({
              id: 2000 + offset + idx,
              name: `搜索曲${offset + idx + 1}`,
              artists: [{ name: '搜歌手' }],
              album: { name: '搜专辑' },
              duration: 180000,
            })),
            songCount: 42,
          },
        };
      }
      case 'netease_like':
        return { code: 200 };
      case 'netease_fm_trash':
        fmBatch = fmBatch.filter(t => t.id !== args.id);
        return { code: 200 };
      case 'netease_private_fm':
        return { items: fmBatch };
      case 'netease_playlist_tracks_op':
        if (args.op === 'del') {
          ownedTracks = ownedTracks.filter(t => t.id !== args.trackId);
        }
        return { code: 200 };
      default:
        throw Error('unexpected command: ' + cmd);
    }
  },
};

dom.window.HTMLMediaElement.prototype.play = function () {
  this.dispatchEvent(new Event('play'));
  this.dispatchEvent(new Event('playing'));
  return Promise.resolve();
};
dom.window.HTMLMediaElement.prototype.pause = function () {
  this.dispatchEvent(new Event('pause'));
};
dom.window.HTMLMediaElement.prototype.load = function () {};

const html = await readFile('dist/index.html', 'utf8');
const file = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)[1];
await import(pathToFileURL(process.cwd() + '/dist/' + file.replace(/^\//, '')));

const wait = async fn => {
  for (let i = 0; i < 400; i++) {
    const val = fn();
    if (val) return val;
    await new Promise(r => setTimeout(r, 10));
  }
  throw Error('等待 P1 交互状态超时: ' + document.body.textContent);
};
const buttonByText = text => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
const buttonIncludes = text => [...document.querySelectorAll('button')].find(x => x.textContent.includes(text));

try {
  // 1. 登录后同步红心列表与自建歌单
  await wait(() => buttonIncludes('我的深夜电台'));
  buttonIncludes('我的深夜电台').click();
  await wait(() => document.querySelector('[aria-label="取消喜欢 自建歌一"]'));
  assert(document.querySelector('[aria-label="从歌单移出 自建歌一"]'), '自建歌单应显示移出按钮');

  // 2. 在更多设置切换到无损音质后播放歌曲，检验 level 与试听徽章
  document.querySelector('[aria-label="更多设置"]').click();
  await wait(() => buttonByText('无损'));
  buttonByText('无损').click();
  activateSong([...document.querySelectorAll('.song')][0]);
  await wait(() => document.querySelector('.nr-quality-chip')?.textContent === '无损 SQ');
  const urlCall = calls.filter(c => c.cmd === 'netease_url').at(-1);
  assert.deepEqual(urlCall.args, { id: 10, level: 'lossless' });
  assert.equal(document.querySelector('.nr-trial-chip')?.textContent, '试听');

  // 3. 点赞取消喜欢 + 收藏到自建歌单 + 从自建歌单移出
  document.querySelector('[aria-label="取消喜欢 自建歌一"]').click();
  await wait(() => document.querySelector('[aria-label="喜欢 自建歌一"]'));
  assert.deepEqual(calls.filter(c => c.cmd === 'netease_like').at(-1).args, { id: 10, like: false });

  document.querySelector('[aria-label="收藏 自建歌二 到歌单"]').click();
  await wait(() => document.querySelector('.nr-picker-dialog'));
  const pickerTarget = [...document.querySelectorAll('.nr-picker-item')].find(x =>
    x.textContent.includes('我的深夜电台')
  );
  assert(pickerTarget, '收藏弹窗仅应列出自建歌单');
  assert(
    ![...document.querySelectorAll('.nr-picker-item')].some(x => x.textContent.includes('他人精选集')),
    '收藏弹窗不应列出他人歌单'
  );
  pickerTarget.click();
  await wait(() => !document.querySelector('.nr-picker-dialog'));
  assert.deepEqual(calls.filter(c => c.cmd === 'netease_playlist_tracks_op').at(-1).args, {
    op: 'add',
    pid: 1001,
    trackId: 20,
  });

  document.querySelector('[aria-label="从歌单移出 自建歌二"]').click();
  await wait(() => ![...document.querySelectorAll('.song')].some(x => x.textContent.includes('自建歌二')));
  assert.deepEqual(calls.filter(c => c.cmd === 'netease_playlist_tracks_op').at(-1).args, {
    op: 'del',
    pid: 1001,
    trackId: 20,
  });

  // 4. 打开他人歌单不应显示移出按钮
  buttonIncludes('他人精选集').click();
  await wait(() => document.body.textContent.includes('收藏歌一'));
  assert(!document.querySelector('[aria-label^="从歌单移出"]'), '他人歌单不应显示移出按钮');

  // 5. 网易云搜索分页与分类（单曲第2页 -> 专辑 -> 歌单）
  const input = document.querySelector('input[placeholder="搜索歌曲、歌手"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '夜车');
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));
  input.closest('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(() => document.body.textContent.includes('搜索曲1'));
  buttonByText('下一页').click();
  await wait(() => document.body.textContent.includes('搜索曲41'));
  assert.deepEqual(calls.filter(c => c.cmd === 'netease_search').at(-1).args, {
    query: '夜车',
    offset: 40,
  });

  buttonByText('专辑').click();
  await wait(() => document.body.textContent.includes('专辑测试'));
  assert.equal(calls.filter(c => c.cmd === 'netease_search').at(-1).args.searchType, 10);

  buttonByText('歌单').click();
  await wait(() => document.body.textContent.includes('搜索到他人歌单'));
  assert.equal(calls.filter(c => c.cmd === 'netease_search').at(-1).args.searchType, 1000);

  // 6. 私人 FM 不喜欢并跳过
  buttonByText('私人 FM').click();
  await wait(() => document.body.textContent.includes('FM 首曲'));
  activateSong([...document.querySelectorAll('.song')][0]);
  await wait(() => document.querySelector('[aria-label="私人 FM 不喜欢并跳过"]'));
  document.querySelector('[aria-label="私人 FM 不喜欢并跳过"]').click();
  await wait(() => document.querySelector('.nr-current-copy b')?.textContent === 'FM 次曲');
  assert.deepEqual(calls.filter(c => c.cmd === 'netease_fm_trash').at(-1).args, { id: 301 });

  // 7. AbortError（play() 在途被 pause() 打断）与 Space 长按 repeat 不应报错或误回滚
  const audio = document.querySelector('audio');
  const originalPlay = dom.window.HTMLMediaElement.prototype.play;
  let resumePlayCalls = 0;
  audio.play = () => {
    resumePlayCalls += 1;
    return Promise.reject(
      Object.assign(Error('The play() request was interrupted by a call to pause.'), {
        name: 'AbortError',
      })
    );
  };
  document.querySelector('.play-toggle').click();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(resumePlayCalls, 1);
  assert(!document.body.textContent.includes('播放失败'), 'AbortError 不应提示播放失败');
  assert(
    !document.body.textContent.includes('interrupted by a call to pause'),
    'AbortError 不应把原始英文中断信息暴露到界面'
  );

  // 长按 Space（repeat: true）不应重复触发播放/暂停
  window.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true })
  );
  await new Promise(r => setTimeout(r, 20));
  assert.equal(resumePlayCalls, 1, '长按 Space repeat 不应再次触发 play');

  // 切歌时若 play() 被 pause() 中断（AbortError），应停留在新歌暂停态且不误回滚到上一首
  buttonByText('私人 FM');
  delete audio.play;
  dom.window.HTMLMediaElement.prototype.play = function () {
    return Promise.reject(
      Object.assign(Error('The play() request was interrupted by a call to pause.'), {
        name: 'AbortError',
      })
    );
  };
  buttonIncludes('我的深夜电台').click();
  const ownedFirst = await wait(() =>
    [...document.querySelectorAll('.song')].find(x => x.textContent.includes('自建歌一'))
  );
  activateSong(ownedFirst);
  await wait(() => document.querySelector('.nr-current-copy b')?.textContent === '自建歌一');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(
    document.querySelector('.nr-current-copy b')?.textContent,
    '自建歌一',
    '切歌 AbortError 不应错误回滚到上一首'
  );
  assert(!document.body.textContent.includes('播放失败'), '切歌 AbortError 不应提示播放失败');
  dom.window.HTMLMediaElement.prototype.play = originalPlay;
  document.querySelector('.play-toggle').click();
  await wait(() => document.querySelector('.play-toggle')?.dataset.state === 'pause');

  console.log('通过：网易云 P1 音质切换、试听标识、红心同步与喜欢、歌单增删、搜索分类分页及 FM 跳过');
} finally {
  dom.window.close();
}
