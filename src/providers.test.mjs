import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const calls=[];
globalThis.window={__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push({command,args});return {command,args};}}};
const {getProvider,capabilities,recommendationCapabilities}=await import('./providers.js');
const features=['login','logout','restoreSession','getUserProfile','search','getPlaylists','getPlaylistTracks','getLyrics','resolvePlayback','getRecommendations','reportListening'];
const libraryFeatures=['playbackQuality','searchPagination','searchCategories','likeTrack','getLikedSongIds','trashFmTrack','editPlaylistTracks'];

test('两平台独立声明基础能力和网易增强能力；未知平台明确拒绝',async()=>{
 for(const id of ['netease','qqmusic']){
  const provider=await getProvider(id);
  assert.deepEqual(Object.keys(provider.capabilities).sort(),[...features,...libraryFeatures].sort());
  assert.equal(provider.capabilities,capabilities[id]);
  assert.equal(provider.recommendationCapabilities,recommendationCapabilities[id]);
  assert(Object.isFrozen(provider.recommendationCapabilities));
  for(const feature of features){assert.equal(typeof provider.capabilities[feature],'boolean');assert.equal(typeof provider[feature],'function');}
  for(const feature of libraryFeatures)assert.equal(provider.capabilities[feature],id==='netease');
 }
 assert.notEqual(capabilities.netease,capabilities.qqmusic);
 await assert.rejects(getProvider('missing'),e=>e.code==='unsupported'&&!!e.message);
});

test('网易 P1 使用固定 IPC 命令和 camelCase 参数，保留旧播放调用',async()=>{
 const provider=await getProvider('netease');
 await provider.search('合成查询',{offset:40,searchType:1000});
 assert.deepEqual(calls.at(-1),{command:'netease_search',args:{query:'合成查询',offset:40,searchType:1000}});
 await provider.resolvePlayback(1,{level:'lossless'});
 assert.deepEqual(calls.at(-1),{command:'netease_url',args:{id:1,level:'lossless'}});
 await provider.resolvePlayback(1,null);
 assert.deepEqual(calls.at(-1),{command:'netease_url',args:{id:1}});
 for(const [method,params,command,args] of [
  ['likeTrack',[1,false],'netease_like',{id:1,like:false}],
  ['getLikedSongIds',[],'netease_likelist',{}],
  ['trashFmTrack',[1],'netease_fm_trash',{id:1}],
  ['editPlaylistTracks',['del',2,1],'netease_playlist_tracks_op',{op:'del',pid:2,trackId:1}]
 ]){
  await provider[method](...params);
  assert.deepEqual(calls.at(-1),{command,args});
 }
});

test('网易能力仍映射原受控 IPC，二维码扩展保留',async()=>{
 const provider=await getProvider('netease');
 const expected=[['login','netease_qr_start'],['logout','netease_logout'],['restoreSession','netease_account'],['getUserProfile','netease_account'],['search','netease_search','同名',{query:'同名'}],['getPlaylists','netease_playlists'],['getPlaylistTracks','netease_playlist',1,{id:1}],['getLyrics','netease_lyric',1,{id:1}],['resolvePlayback','netease_url',1,{id:1}],['qrStart','netease_qr_start'],['qrCheck','netease_qr_check'],['qrCancel','netease_qr_cancel']];
 for(const [method,command,arg,args] of expected){await provider[method](arg);assert.deepEqual(calls.at(-1),{command,args:args||{}});}
 assert.equal(provider.capabilities.getRecommendations,true);
 assert.deepEqual(provider.recommendationCapabilities,{daily:true,resources:true,playlists:true,fm:true,newsong:true});
 for(const [kind,command] of [['daily','netease_daily_songs'],['resources','netease_recommended_resources'],['playlists','netease_personalized_playlists'],['newsong','netease_recommended_new_songs'],['fm','netease_private_fm']]){await provider.getRecommendations(kind);assert.deepEqual(calls.at(-1),{command,args:{}});}
 const before=calls.length;for(const kind of ['unknown','constructor',undefined])await assert.rejects(provider.getRecommendations(kind),e=>e.code==='unsupported');assert.equal(calls.length,before);
 await assert.rejects(provider.reportListening(),e=>e.code==='unsupported'&&!!e.message);
});

test('QQ 实际 mock 所有能力均不访问网络、IPC、Worker 或浏览器凭据存储',async()=>{
 const attempts=[];
 const forbidden=name=>function(){attempts.push(name);throw Error('禁止副作用：'+name);};
 const saved=new Map();
 for(const name of ['fetch','WebSocket','Worker','SharedWorker','XMLHttpRequest','EventSource']){
  saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:forbidden(name)});
  window[name]=globalThis[name];
 }
 const before=calls.length;
 window.localStorage={getItem:forbidden('localStorage.getItem'),setItem:forbidden('localStorage.setItem')};
 window.sessionStorage={getItem:forbidden('sessionStorage.getItem'),setItem:forbidden('sessionStorage.setItem')};
 const invoke=window.__TAURI_INTERNALS__.invoke;
 window.__TAURI_INTERNALS__.invoke=forbidden('IPC');
 try{
  const {qq}=await import('./qq-mock.js');
  assert.equal((await qq.restoreSession()).profile,null);
  assert.equal((await qq.getUserProfile()).profile,null);
  await assert.rejects(qq.getPlaylists(),e=>e.code==='auth'||/登录/.test(e.message));
  const login=await qq.login();assert.equal(login.profile.userId,'qq-mock-account');
  assert.equal((await qq.getUserProfile()).profile.userId,login.profile.userId);
  const lists=await qq.getPlaylists();assert(lists.playlist.length>0);
  const tracks=await qq.getPlaylistTracks(lists.playlist[0].id);assert(tracks.songs.length>0);
  const result=await qq.search(tracks.songs[0].name);assert.equal(result.result.songs[0].id,tracks.songs[0].id);
  await assert.rejects(qq.search('微光',{fail:true}),/模拟搜索失败/);
  assert.deepEqual(qq.recommendationCapabilities,{daily:false,resources:false,playlists:false,fm:false,newsong:false});
  for(const kind of ['daily','resources','playlists','fm','newsong'])await assert.rejects(qq.getRecommendations(kind),e=>e.code==='unsupported');
  for(const name of ['getLyrics','resolvePlayback','getRecommendations','reportListening']){
   assert.equal(qq.capabilities[name],false);
   await assert.rejects(qq[name](tracks.songs[0].id),e=>e.code==='unsupported'&&!!e.message);
  }
  await assert.rejects(qq.getPlaylistTracks('不存在'),/模拟歌单不存在/);
  assert.equal((await qq.logout()).localCleared,true);
  assert.equal((await qq.restoreSession()).profile,null);
  await assert.rejects(qq.getPlaylists(),e=>e.code==='auth'||/登录/.test(e.message));
  assert.equal(calls.length,before);assert.deepEqual(attempts,[]);
 }finally{
  window.__TAURI_INTERNALS__.invoke=invoke;
  for(const [name,descriptor] of saved)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];
 }
});

test('Release 构建配置使用静态前端且未配置 Node 后台服务（静态检查）',async()=>{
 const config=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 assert.equal(config.productName,'Prism');assert.equal(config.mainBinaryName,'Prism');assert.equal(config.identifier,'local.xianyu.music');
 assert.equal(config.build.frontendDist,'../dist');
 assert.equal(config.build.beforeBuildCommand,'npm run build');
 assert.equal(config.bundle.externalBin,undefined);
 assert(!Object.keys(pkg.dependencies).some(x=>/netease|concurrently|express/.test(x)));
 const rust=await readFile('src-tauri/src/main.rs','utf8');
 assert(rust.includes('keyring::Entry::new("local.xianyu.music", "netease-session")'));
 assert(!/Command::new\s*\(\s*"(?:node|npm|npx)|\.sidecar\s*\(/.test(rust));
});

test('生产 IPC 只注册受限网页登录原型，不注册旧二维码登录',async()=>{
 const rust=await readFile('src-tauri/src/main.rs','utf8');
 const handlers=rust.match(/tauri::generate_handler!\[([^\]]*)\]/s)?.[1];
 assert(handlers);assert(!handlers.includes('qq_login::'));assert(handlers.includes('qq_search'));assert(handlers.includes('qq_web_auth::qq_web_login_open'));
});

test('QQ 社区仅匿名搜索并映射固定 IPC 参数',async()=>{
 const qq=await getProvider('qqmusic');
 await qq.search('默认页');assert.deepEqual(calls.at(-1),{command:'qq_search',args:{query:'默认页',page:1,pageSize:5}});
 await qq.search('合成查询',{page:2,pageSize:5});
 assert.deepEqual(calls.at(-1),{command:'qq_search',args:{query:'合成查询',page:2,pageSize:5}});
 for(const [name,command] of [['login','qq_web_login_open'],['loginComplete','qq_web_login_complete'],['loginCancel','qq_web_login_cancel'],['logout','qq_web_logout'],['getUserProfile','qq_web_account'],['restoreSession','qq_web_account']]){await qq[name]();assert.equal(calls.at(-1).command,command);}
 await qq.getPlaylists({page:2});assert.deepEqual(calls.at(-1),{command:'qq_web_playlists',args:{page:2}});await qq.getPlaylistTracks('123',{page:3});assert.deepEqual(calls.at(-1),{command:'qq_web_playlist_tracks',args:{id:'123',page:3}});await qq.getLyrics('MID1');assert.deepEqual(calls.at(-1),{command:'qq_web_lyric',args:{mid:'MID1'}});await qq.resolvePlayback('MID1','MEDIA1');assert.deepEqual(calls.at(-1),{command:'qq_web_resolve',args:{mid:'MID1',mediaMid:'MEDIA1'}});for(const name of ['getRecommendations','reportListening'])await assert.rejects(qq[name](),e=>e.code==='unsupported');
});

test('QQ Mock 与社区适配器分别声明真实能力',async()=>{
 const {qq:mock}=await import('./qq-mock.js');
 const community=await getProvider('qqmusic');
 assert.notEqual(mock.capabilities,community.capabilities);
 assert(Object.isFrozen(mock.capabilities));
 for(const name of ['login','logout','getUserProfile','restoreSession','getPlaylists','getPlaylistTracks','search']){assert.equal(mock.capabilities[name],true);assert.equal(community.capabilities[name],true);}
 for(const name of ['getLyrics','resolvePlayback']){assert.equal(mock.capabilities[name],false);assert.equal(community.capabilities[name],true);await assert.rejects(mock[name](),e=>e.code==='unsupported');}
 for(const name of ['getRecommendations','reportListening']){assert.equal(mock.capabilities[name],false);assert.equal(community.capabilities[name],false);await assert.rejects(mock[name](),e=>e.code==='unsupported');await assert.rejects(community[name](),e=>e.code==='unsupported');}
 assert.deepEqual(mock.recommendationCapabilities,{daily:false,resources:false,playlists:false,fm:false,newsong:false});
 assert.deepEqual(community.recommendationCapabilities,mock.recommendationCapabilities);
});
