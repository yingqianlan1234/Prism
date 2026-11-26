import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customTrackKey,
  sanitizeCustomTrack,
  createCustomPlaylist,
  renameCustomPlaylist,
  deleteCustomPlaylist,
  addTrackToCustomPlaylist,
  removeTrackFromCustomPlaylist,
  filterCustomPlaylistTracks,
  summarizeCustomPlaylistSources,
  exportCustomPlaylistsJson,
  importCustomPlaylistsJson,
  loadCustomPlaylists,
  saveCustomPlaylists,
  hydrateCustomTrack,
} from './custom-playlists.js';
import {
  DEFAULT_AUDIO_PREFS,
  loadAudioPrefs,
  saveAudioPrefs,
  applyAudioOutputDevice,
} from './audio-prefs.js';

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test('sanitizeCustomTrack 保留三源合法曲目并剔除敏感与临时直链字段', () => {
  const ne = sanitizeCustomTrack({
    provider: 'netease',
    id: 501,
    name: '夜车',
    ar: [{ name: '曾轶可' }],
    al: { name: '一只猫的旅行', picUrl: 'http://p1.music.126.net/a/1.jpg?param=200y200&token=secret' },
    dt: 210000,
    url: 'https://temp.invalid/1.mp3',
    cookie: 'MUSIC_U=secret',
  });
  assert.equal(ne.provider, 'netease');
  assert.equal(ne.id, 501);
  assert.deepEqual(ne.artists, ['曾轶可']);
  assert.equal(ne.coverUrl, 'https://p1.music.126.net/a/1.jpg?param=200y200');
  assert.equal(ne.url, undefined);
  assert.equal(ne.cookie, undefined);

  const qq = sanitizeCustomTrack({
    provider: 'qqmusic',
    id: '001Abc',
    mediaMid: '002Def',
    name: '海浪',
    artists: ['december'],
    album: 'Ocean',
    duration: 180000,
    al: { picUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000XYZ.jpg' },
  });
  assert.equal(qq.mediaMid, '002Def');
  assert.equal(qq.coverUrl, 'https://y.gtimg.cn/music/photo_new/T002R300x300M000XYZ.jpg');

  const loc = sanitizeCustomTrack({
    provider: 'local',
    id: 'hash-local-1',
    name: '本地清唱',
    artists: ['测试歌手'],
    album: '本地专辑',
    duration: 95000,
  });
  assert.equal(loc.provider, 'local');
  assert.equal(loc.coverUrl, undefined);

  assert.equal(sanitizeCustomTrack({ provider: 'spotify', id: 1, name: 'x' }), null);
  assert.equal(sanitizeCustomTrack({ provider: 'netease', id: -1, name: 'x' }), null);
  assert.equal(sanitizeCustomTrack({ provider: 'qqmusic', id: 'bad/id', name: 'x' }), null);
});

test('跨源本机歌单支持增删改查、去重、筛选、导出与合并导入', () => {
  const storage = makeMemoryStorage();
  let state = createCustomPlaylist([], '深夜混音');
  assert.equal(state.created.name, '深夜混音');
  assert.equal(createCustomPlaylist(state.playlists, '深夜混音').error, '已存在同名歌单「深夜混音」');

  const pid = state.created.id;
  const neTrack = { provider: 'netease', id: 101, name: '夜车', artists: ['曾轶可'], album: '猫' };
  const qqTrack = { provider: 'qqmusic', id: 'QQ1', mediaMid: 'M1', name: '晴天', artists: ['周杰伦'], album: '叶惠美' };
  const locTrack = { provider: 'local', id: 'L1', name: '雨夜录音', artists: ['独立音乐人'], album: 'Demo' };

  for (const t of [neTrack, qqTrack, locTrack]) {
    const added = addTrackToCustomPlaylist(state.playlists, pid, t);
    assert.equal(added.added, true);
    state = added;
  }
  assert.equal(addTrackToCustomPlaylist(state.playlists, pid, neTrack).duplicate, true);
  assert.deepEqual(summarizeCustomPlaylistSources(state.playlists[0].tracks), {
    netease: 1,
    qqmusic: 1,
    local: 1,
  });
  assert.equal(filterCustomPlaylistTracks(state.playlists[0].tracks, 'qq').length, 1);
  assert.equal(filterCustomPlaylistTracks(state.playlists[0].tracks, '夜车').length, 1);

  assert.equal(saveCustomPlaylists(state.playlists, storage), true);
  const loaded = loadCustomPlaylists(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].tracks.length, 3);

  const renamed = renameCustomPlaylist(loaded, pid, '凌晨电台');
  assert.equal(renamed.renamed.name, '凌晨电台');

  const exported = exportCustomPlaylistsJson(renamed.playlists);
  const imported = importCustomPlaylistsJson(exported, []);
  assert.equal(imported.addedPlaylists, 1);
  assert.equal(imported.addedTracks, 3);

  const removed = removeTrackFromCustomPlaylist(imported.playlists, imported.playlists[0].id, customTrackKey(qqTrack));
  assert.equal(removed.removed, true);
  assert.equal(removed.playlists[0].tracks.length, 2);

  const deleted = deleteCustomPlaylist(removed.playlists, imported.playlists[0].id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.playlists.length, 0);

  storage.setItem('vesper.customPlaylists.v1', '{broken-json');
  assert.deepEqual(loadCustomPlaylists(storage), []);
});

test('hydrateCustomTrack 与 audio-prefs 正确处理账号映射与输出设备降级', async () => {
  const track = hydrateCustomTrack(
    { provider: 'qqmusic', id: 'Q9', mediaMid: 'M9', name: '海', artists: ['歌手'], album: '海' },
    { qqmusic: { profile: { userId: '888' } } }
  );
  assert.equal(track.accountId, '888');
  assert.equal(track.al.name, '海');

  const storage = makeMemoryStorage();
  assert.deepEqual(loadAudioPrefs(storage), DEFAULT_AUDIO_PREFS);
  assert.equal(DEFAULT_AUDIO_PREFS.autoOpenStageOnPlay, true);
  saveAudioPrefs({ smoothFadeIn: false, autoOpenStageOnPlay: false, outputDeviceId: 'headphone-1' }, storage);
  assert.deepEqual(loadAudioPrefs(storage), {
    smoothFadeIn: false,
    autoOpenStageOnPlay: false,
    outputDeviceId: 'headphone-1',
  });

  const unsupportedRes = await applyAudioOutputDevice({}, 'headphone-1');
  assert.equal(unsupportedRes.unsupported, true);
  let sinkApplied = '';
  const okRes = await applyAudioOutputDevice(
    { setSinkId: async id => { sinkApplied = id; } },
    'headphone-1'
  );
  assert.equal(okRes.ok, true);
  assert.equal(sinkApplied, 'headphone-1');
});
