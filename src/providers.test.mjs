import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {qqLocalHandle} from './utils/format.js';

const calls=[];
globalThis.window={__TAURI_INTERNALS__:{invoke:async(command,args)=>{calls.push({command,args});return {command,args};}}};
const {getProvider,capabilities,capabilitiesForHost,recommendationCapabilities,desktop}=await import('./providers.js');

test('macOS 保留三个音乐来源，Windows 桌面能力随宿主关闭',()=>{
 const mac=capabilitiesForHost({qqMusic:true,globalShortcuts:false,desktopLyric:false,closeBehavior:false});
 assert.equal(mac.local,capabilities.local);
 assert.equal(mac.netease,capabilities.netease);
 assert.equal(mac.qqmusic.available,true);
 assert.deepEqual(mac.desktop,{globalShortcuts:false,desktopLyric:false,closeBehavior:false});
 const windows=capabilitiesForHost({qqMusic:true,globalShortcuts:true,desktopLyric:true,closeBehavior:true});
 assert.equal(windows.qqmusic.available,true);
 assert.deepEqual(windows.desktop,{globalShortcuts:true,desktopLyric:true,closeBehavior:true});
 assert.equal(capabilitiesForHost(undefined),capabilities);
});

test('QQ 播放回滚只接受 Windows 和 macOS 的本地媒体句柄',()=>{
 const handle='a'.repeat(40);
 assert.equal(qqLocalHandle(`http://prismmedia.localhost/${handle}`),handle);
 assert.equal(qqLocalHandle(`prismmedia://localhost/${handle}`),handle);
 for(const url of [`prismmedia://example.com/${handle}`,`prismmedia://localhost/${handle}?token=x`,`http://prismmedia.localhost:8000/${handle}`]){
  assert.equal(qqLocalHandle(url),null);
 }
});

test('本地曲库由独立 provider 注入，IPC 参数只包含曲库标识和状态', async () => {
 const local=await getProvider('local');
 assert.equal(local.capabilities,capabilities.local);
 assert.deepEqual(capabilities.local,{manageFolders:true,scanLibrary:true,getTracks:true,resolvePlayback:true,getLyrics:true,persistQueue:true});
 const queue={ids:['a'.repeat(64)],index:0,position:3};
 for(const [method,params,command,args] of [
  ['getFolders',[],'local_library_folders_get',{}],
  ['pickFolder',[],'local_library_folder_pick',{}],
  ['removeFolder',['folder'],'local_library_folder_remove',{id:'folder'}],
  ['scan',[],'local_library_scan',{}],
  ['getTracks',[{offset:200,limit:20}],'local_library_tracks_get',{offset:200,limit:20}],
  ['resolvePlayback',['track'],'local_track_resolve',{id:'track'}],
  ['getLyrics',['track'],'local_track_lyric',{id:'track'}],
  ['getQueue',[],'local_queue_get',{}],
  ['setQueue',[queue],'local_queue_set',{queue}]
 ]){
  await local[method](...params);
  assert.deepEqual(calls.at(-1),{command,args});
 }
});
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
 assert.equal(config.productName,'Vesper');assert.equal(config.mainBinaryName,'Vesper');assert.equal(config.identifier,'local.xianyu.music');
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
 const handlers=rust.match(/tauri::generate_handler!\[(.*?)\]\)/s)?.[1];
 assert(handlers);assert(!handlers.includes('qq_login::'));assert(handlers.includes('qq_search'));assert(handlers.includes('qq_web_auth::qq_web_login_open'));assert(handlers.includes('qq_recommended_playlists'));assert(handlers.includes('qq_recommended_new_songs'));
});

test('QQ 社区仅匿名搜索并映射固定 IPC 参数',async()=>{
 const qq=await getProvider('qqmusic');
 await qq.search('默认页');assert.deepEqual(calls.at(-1),{command:'qq_search',args:{query:'默认页',page:1,pageSize:5}});
 await qq.search('合成查询',{page:2,pageSize:5});
 assert.deepEqual(calls.at(-1),{command:'qq_search',args:{query:'合成查询',page:2,pageSize:5}});
 for(const [name,command] of [['login','qq_web_login_open'],['loginComplete','qq_web_login_complete'],['loginCancel','qq_web_login_cancel'],['logout','qq_web_logout'],['getUserProfile','qq_web_account'],['restoreSession','qq_web_account']]){await qq[name]();assert.equal(calls.at(-1).command,command);}
 await qq.getPlaylists({page:2});assert.deepEqual(calls.at(-1),{command:'qq_web_playlists',args:{page:2}});await qq.getPlaylistTracks('123',{page:3});assert.deepEqual(calls.at(-1),{command:'qq_web_playlist_tracks',args:{id:'123',page:3}});await qq.getLyrics('MID1');assert.deepEqual(calls.at(-1),{command:'qq_web_lyric',args:{mid:'MID1'}});await qq.resolvePlayback('MID1','MEDIA1');assert.deepEqual(calls.at(-1),{command:'qq_web_resolve',args:{mid:'MID1',mediaMid:'MEDIA1'}});
 await qq.getRecommendations('playlists');assert.deepEqual(calls.at(-1),{command:'qq_recommended_playlists',args:{}});
 await qq.getRecommendations('newsong');assert.deepEqual(calls.at(-1),{command:'qq_recommended_new_songs',args:{}});
 const before=calls.length;
 for(const kind of ['daily','resources','fm','unknown','constructor',undefined])await assert.rejects(qq.getRecommendations(kind),e=>e.code==='unsupported');
 assert.equal(calls.length,before);
 await assert.rejects(qq.reportListening(),e=>e.code==='unsupported');
});

test('QQ Mock 与社区适配器分别声明真实能力',async()=>{
 const {qq:mock}=await import('./qq-mock.js');
 const community=await getProvider('qqmusic');
 assert.notEqual(mock.capabilities,community.capabilities);
 assert(Object.isFrozen(mock.capabilities));
 for(const name of ['login','logout','getUserProfile','restoreSession','getPlaylists','getPlaylistTracks','search']){assert.equal(mock.capabilities[name],true);assert.equal(community.capabilities[name],true);}
 for(const name of ['getLyrics','resolvePlayback','getRecommendations']){assert.equal(mock.capabilities[name],false);assert.equal(community.capabilities[name],true);await assert.rejects(mock[name](),e=>e.code==='unsupported');}
 assert.equal(mock.capabilities.reportListening,false);assert.equal(community.capabilities.reportListening,false);await assert.rejects(mock.reportListening(),e=>e.code==='unsupported');await assert.rejects(community.reportListening(),e=>e.code==='unsupported');
 assert.deepEqual(mock.recommendationCapabilities,{daily:false,resources:false,playlists:false,fm:false,newsong:false});
 assert.deepEqual(community.recommendationCapabilities,{daily:false,resources:false,playlists:true,fm:false,newsong:true});
});

test('桌面功能能力位、事件名与 P2-A IPC 命令参数映射正确',async()=>{
 assert.deepEqual(capabilities.desktop,{globalShortcuts:true,desktopLyric:true});
 assert(Object.isFrozen(capabilities.desktop));
 assert.equal(desktop.capabilities,capabilities.desktop);
 assert.deepEqual(desktop.events,{globalShortcut:'prism:global-shortcut',desktopLyricState:'prism:desktop-lyric-state'});
 assert(Object.isFrozen(desktop.events));
 await desktop.globalShortcutsGet();
 assert.deepEqual(calls.at(-1),{command:'global_shortcuts_get',args:{}});
 const bindings={togglePlayback:'Ctrl+Shift+F5',prevTrack:'Ctrl+Alt+F6'};
 await desktop.globalShortcutsSet({enabled:true,bindings});
 assert.deepEqual(calls.at(-1),{command:'global_shortcuts_set',args:{enabled:true,bindings}});
 await desktop.desktopLyricGet();
 assert.deepEqual(calls.at(-1),{command:'desktop_lyric_get',args:{}});
 await desktop.desktopLyricSet({enabled:true});
 assert.deepEqual(calls.at(-1),{command:'desktop_lyric_set',args:{enabled:true}});
 await desktop.desktopLyricSet({enabled:true,locked:true});
 assert.deepEqual(calls.at(-1),{command:'desktop_lyric_set',args:{enabled:true,locked:true}});
 await desktop.desktopLyricUpdate({text:'第一行',translation:'line 1',romaji:'dai ichi',title:'夜车 - 曾轶可',playing:true});
 assert.deepEqual(calls.at(-1),{command:'desktop_lyric_update',args:{text:'第一行',translation:'line 1',romaji:'dai ichi',title:'夜车 - 曾轶可',playing:true}});
 const lyricStyle={layout:'single',theme:'contrast',fontSize:34,karaoke:false};
 await desktop.desktopLyricSet({enabled:true,style:lyricStyle});
 assert.deepEqual(calls.at(-1),{command:'desktop_lyric_set',args:{enabled:true,style:lyricStyle}});
 await desktop.desktopLyricUpdate({text:'第一行',translation:'line 1',romaji:'dai ichi',title:'夜车 - 曾轶可',playing:true,nextText:'第二行',elapsedMs:1200,durationMs:4000,rate:1.25,accentColor:'#F2A65A'});
 assert.deepEqual(calls.at(-1),{command:'desktop_lyric_update',args:{text:'第一行',translation:'line 1',romaji:'dai ichi',title:'夜车 - 曾轶可',playing:true,nextText:'第二行',elapsedMs:1200,durationMs:4000,rate:1.25,accentColor:'#F2A65A'}});
});
