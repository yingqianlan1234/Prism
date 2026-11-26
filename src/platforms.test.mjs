const activateSong=el=>{const active=document.querySelector('.provider-switch button[aria-pressed="true"]');if(active?.textContent.trim()==='网易云')el.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));else el.click();};
import {JSDOM} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// 只在测试构建的 Provider 边界注入 QQ 延迟/失败；生产源码及构建不加测试开关。
const temp=await mkdtemp(join(tmpdir(),'music-platform-test-'));
const providerPath=resolve('src/providers.js').replaceAll('\\','/');
const testId='\0test:providers';
const mockPath=resolve('src/qq-mock.js').replaceAll('\\','/');
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
for(const name of ['MutationObserver','HTMLElement','Event'])globalThis[name]=dom.window[name];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const calls=[],pending=[];
let accountResult={profile:{userId:100,nickname:'网易账号A'}};
let pauses=0,plays=0,rejectNextPlay=false;
window.__TAURI_INTERNALS__={invoke(command,args){
 calls.push({command,args});
 if(command==='playback_state_load'&&args?.provider==='last')return Promise.resolve({status:'empty'});
 if(command==='netease_account')return accountResult instanceof Error?Promise.reject(accountResult):Promise.resolve(accountResult);
 if(command==='netease_playlists')return Promise.resolve({playlist:[{id:1,name:'网易同ID歌单'}],more:false});
 if(command==='netease_logout')return Promise.resolve({localCleared:true,remoteRevoked:false});
 const d=deferred();pending.push({command,args,...d});return d.promise;
}};
dom.window.HTMLMediaElement.prototype.play=function(){plays++;if(rejectNextPlay){rejectNextPlay=false;this.dispatchEvent(new Event('pause'));return Promise.reject(Error('自动播放被拒绝'));}this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve();};
dom.window.HTMLMediaElement.prototype.pause=function(){pauses++;this.dispatchEvent(new Event('pause'));};
dom.window.HTMLMediaElement.prototype.load=function(){};
globalThis.__qqTestOverrides={};
const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('等待超时：'+label+'\n'+document.body.textContent);};
const settle=()=>new Promise(r=>setTimeout(r,20));
const button=text=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text);
const rows=()=>[...document.querySelectorAll('.song')].map(x=>x.textContent);
const request=(command,value)=>pending.find(x=>x.command===command&&(x.args?.query===value||x.args?.id===value));
const search=async query=>{
 const input=document.querySelector('input[placeholder="搜索歌曲、歌手"]');
 Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,query);
 input.dispatchEvent(new Event('input',{bubbles:true}));await settle();
 input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
};
const switchTo=async name=>{button(name).click();await wait(()=>button(name).getAttribute('aria-pressed')==='true','切换'+name);};
try{
 const result=await build({configFile:false,logLevel:'error',plugins:[react(),{
  name:'test-provider-boundary',enforce:'pre',
  resolveId(source,importer){if(source==='./providers.js'&&importer?.replaceAll('\\','/').endsWith('/src/main.jsx'))return testId;},
  load(id){if(id===testId)return `export * from ${JSON.stringify(providerPath)};import {getProvider as original,capabilities as base} from ${JSON.stringify(providerPath)};export const platformFlavor={netease:'netease',qqmusic:'mock'};import {qq} from ${JSON.stringify(mockPath)};export const capabilities={...base,qqmusic:qq.capabilities};export const getProvider=async id=>{const p=id==='qqmusic'?qq:await original(id);return id==='qqmusic'?{...p,...globalThis.__qqTestOverrides}:p;};`;}
 }],build:{outDir:temp,emptyOutDir:false,rollupOptions:{input:resolve('src/main.jsx')}}});
 const entry=result.output.find(x=>x.type==='chunk'&&x.isEntry);
 await import(pathToFileURL(join(temp,entry.fileName)));
 await wait(()=>button('网易账号A · 刷新')&&button('网易同ID歌单'),'网易初始化');

 await search('网易搜索');await wait(()=>request('netease_search','网易搜索'),'网易搜索请求');
 request('netease_search','网易搜索').resolve({result:{songs:[{id:1,name:'网易同ID歌曲',artists:[{name:'网易歌手'}]},{id:3,name:'网易队列A第二首',artists:[{name:'网易歌手'}]},{id:4,name:'网易队列A第三首',artists:[{name:'网易歌手'}]}],songCount:3}});
 await wait(()=>rows().some(x=>x.includes('网易同ID歌曲')),'网易搜索展示');
 activateSong(document.querySelector('.song'));await wait(()=>request('netease_url',1),'网易播放请求');
 button('网易账号A · 刷新').click();await wait(()=>button('网易账号A · 刷新')&&!button('网易账号A · 刷新').disabled,'播放请求中同账号刷新');
 request('netease_lyric',1).resolve({lrc:{lyric:'[00:00]网易播放歌词'}});
 request('netease_url',1).resolve({data:[{code:200,url:'https://example.com/netease.mp3'}]});
 await wait(()=>document.querySelector('audio').src.includes('netease.mp3'),'网易播放');
 await wait(()=>document.body.textContent.includes('网易播放歌词'),'同账号刷新后歌词仍生效');
 activateSong(document.querySelector('.song'));await wait(()=>pending.filter(x=>x.command==='netease_url'&&x.args.id===1).length===2,'刷新失败前的播放请求');
 accountResult=new Error('账号刷新模拟失败');button('网易账号A · 刷新').click();await wait(()=>document.body.textContent.includes('账号刷新失败'),'同账号刷新失败');
 pending.filter(x=>x.command==='netease_lyric'&&x.args.id===1).at(-1).resolve({lrc:{lyric:'[00:00]刷新失败后歌词'}});
 pending.filter(x=>x.command==='netease_url'&&x.args.id===1).at(-1).resolve({data:[{code:200,url:'https://example.com/netease.mp3'}]});
 await wait(()=>document.body.textContent.includes('刷新失败后歌词'),'刷新失败不丢在途歌词');
 await wait(()=>!document.body.textContent.includes('正在获取歌曲'),'刷新失败不挂起播放');
 button('返回曲库').click();await wait(()=>document.querySelector('.app')?.dataset.view==='library');
 accountResult={profile:{userId:100,nickname:'网易账号A'}};
 const audio=document.querySelector('audio');let src=audio.src,pauseCount=pauses,playCount=plays;
 audio.currentTime=31;audio.dispatchEvent(new Event('timeupdate'));
 const unchanged=()=>{assert.equal(document.querySelectorAll('audio').length,1);assert.equal(document.querySelector('audio'),audio);assert.equal(audio.src,src);assert.equal(pauses,pauseCount);assert.equal(plays,playCount);assert.equal(audio.currentTime,31);assert.match(document.querySelector('footer .current small').textContent,/^(来源：)?网易云 · 网易歌手$/);assert.equal(document.querySelector('.play-toggle').getAttribute('aria-label'),'暂停');};

 button('发现音乐').click();await wait(()=>pending.some(x=>x.command==='netease_daily_songs'),'发现页默认每日请求');
 pending.filter(x=>x.command==='netease_daily_songs').at(-1).resolve({items:[]});await wait(()=>button('推荐新歌'),'展开右侧发现标签');
 button('推荐新歌').click();await wait(()=>pending.some(x=>x.command==='netease_recommended_new_songs'),'推荐新歌请求');
 pending.find(x=>x.command==='netease_recommended_new_songs').resolve({items:[{id:80,name:'合成推荐新歌'}]});await wait(()=>rows().some(x=>x.includes('合成推荐新歌')),'推荐新歌展示');unchanged();
 button('推荐新歌').click();await wait(()=>pending.filter(x=>x.command==='netease_recommended_new_songs').length===2,'新歌空状态请求');pending.filter(x=>x.command==='netease_recommended_new_songs').at(-1).resolve({items:[]});await wait(()=>document.body.textContent.includes('暂无推荐歌曲'),'新歌空状态');unchanged();
 button('推荐新歌').click();await wait(()=>pending.filter(x=>x.command==='netease_recommended_new_songs').length===3,'新歌错误请求');pending.filter(x=>x.command==='netease_recommended_new_songs').at(-1).reject(Error('新歌模拟失败'));await wait(()=>document.body.textContent.includes('推荐加载失败：新歌模拟失败'),'新歌错误状态');unchanged();
 button('推荐新歌').click();await wait(()=>pending.filter(x=>x.command==='netease_recommended_new_songs').length===4,'跨平台新歌请求');await switchTo('QQ 模拟');pending.filter(x=>x.command==='netease_recommended_new_songs').at(-1).resolve({items:[{id:88,name:'跨平台过期新歌'}]});await settle();assert(!document.body.textContent.includes('跨平台过期新歌'));unchanged();await switchTo('网易云');assert(!document.body.textContent.includes('跨平台过期新歌'));unchanged();
 button('每日推荐').click();await wait(()=>pending.filter(x=>x.command==='netease_daily_songs').length===2,'每日推荐请求');
 pending.filter(x=>x.command==='netease_daily_songs').at(-1).resolve({items:[{id:81,name:'合成每日歌曲',album:{name:'合成专辑'},al:{picUrl:'http://p1.music.126.net/synthetic.jpg'}}]});await wait(()=>rows().some(x=>x.includes('合成每日歌曲')),'每日推荐展示');const dailyCover=document.querySelector('.song img');assert.equal(dailyCover.src,'https://p1.music.126.net/synthetic.jpg?param=80y80');dailyCover.dispatchEvent(new Event('error'));await wait(()=>document.querySelector('.song .lw-cover-fallback'),'封面失败占位');unchanged();
 button('为你推荐的歌单').click();await wait(()=>pending.some(x=>x.command==='netease_recommended_resources'),'账号推荐歌单请求');
 pending.find(x=>x.command==='netease_recommended_resources').resolve({items:[{id:82,name:'合成推荐歌单'}]});await wait(()=>button('合成推荐歌单'),'推荐歌单展示');unchanged();
 assert(document.querySelector('.topbar form input'),'推荐歌单页显示顶部搜索');await search('推荐歌单搜索');await wait(()=>request('netease_search','推荐歌单搜索'),'推荐歌单直接搜索请求');request('netease_search','推荐歌单搜索').resolve({result:{songs:[{id:85,name:'推荐页搜索结果'}],songCount:1}});await wait(()=>rows().some(x=>x.includes('推荐页搜索结果')),'推荐页搜索结果');unchanged();
 button('发现音乐').click();await wait(()=>pending.filter(x=>x.command==='netease_daily_songs').length===3,'返回发现标签');
 pending.filter(x=>x.command==='netease_daily_songs').at(-1).resolve({items:[]});await wait(()=>button('推荐歌单'));
 button('推荐歌单').click();await wait(()=>pending.some(x=>x.command==='netease_personalized_playlists'),'推荐歌单请求');
 pending.find(x=>x.command==='netease_personalized_playlists').resolve({items:[]});await wait(()=>document.body.textContent.includes('暂无推荐歌单'),'推荐空状态');unchanged();
 assert(document.querySelector('.topbar form input'),'空推荐歌单页显示顶部搜索');await search('空歌单搜索');await wait(()=>request('netease_search','空歌单搜索'),'空歌单直接搜索请求');request('netease_search','空歌单搜索').resolve({result:{songs:[{id:86,name:'空歌单搜索结果'}],songCount:1}});await wait(()=>rows().some(x=>x.includes('空歌单搜索结果')),'空歌单搜索结果');unchanged();
 button('发现音乐').click();await wait(()=>pending.filter(x=>x.command==='netease_daily_songs').length===4,'每日推荐错误请求');
 pending.filter(x=>x.command==='netease_daily_songs').at(-1).reject(Error('合成接口错误'));await wait(()=>document.body.textContent.includes('推荐加载失败：合成接口错误'),'推荐错误状态');unchanged();
 button('每日推荐').click();await wait(()=>pending.filter(x=>x.command==='netease_daily_songs').length===5,'跨平台推荐请求');
 await switchTo('QQ 模拟');pending.filter(x=>x.command==='netease_daily_songs').at(-1).resolve({items:[{id:83,name:'跨平台过期推荐'}]});await settle();assert(!document.body.textContent.includes('跨平台过期推荐'));unchanged();
 await switchTo('网易云');assert(!document.body.textContent.includes('跨平台过期推荐'));unchanged();
 button('网易同ID歌单').click();await wait(()=>request('netease_playlist',1),'浏览不同歌单');
 request('netease_playlist',1).resolve({songs:[{id:2,name:'浏览列表B歌曲'}],hasMore:false,total:1});
 await wait(()=>rows().some(x=>x.includes('浏览列表B歌曲')),'列表B展示');unchanged();
 assert.equal(document.querySelector('footer .current b').textContent,'网易同ID歌曲');

 await search('跨平台旧搜索');await wait(()=>request('netease_search','跨平台旧搜索'),'跨平台请求');
 await switchTo('QQ 模拟');await wait(()=>button('进入模拟账号'),'QQ 匿名初始化');unchanged();
 assert.match(document.body.textContent,/未连接真实 QQ 账号/);assert(!rows().some(x=>x.includes('网易同ID歌曲')));assert(!button('网易同ID歌单'));
 await search('微光');await wait(()=>rows().some(x=>x.includes('微光')),'QQ 搜索');
 request('netease_search','跨平台旧搜索').resolve({result:{songs:[{id:2,name:'网易后台结果'}],songCount:1}});await settle();
 assert.deepEqual(rows().map(x=>x.includes('微光')),[true]);assert(!document.body.textContent.includes('网易后台结果'));unchanged();
 activateSong(document.querySelector('.song'));await wait(()=>document.body.textContent.includes('模拟模式不支持播放'),'QQ 播放 unsupported');unchanged();
 assert(!document.querySelector('.song.selected'),'跨平台同 ID 不应标成正在播放');
 const ipcBeforeQQ=calls.length;
 button('进入模拟账号').click();await wait(()=>button('模拟账号 · 刷新')&&button('模拟歌单'),'QQ 模拟登录');unchanged();
 button('模拟歌单').click();await wait(()=>rows().length===2,'QQ 歌单');assert(!button('网易同ID歌单'));
 assert.equal(calls.length,ipcBeforeQQ,'QQ 操作不应访问网易 IPC');

 globalThis.__qqTestOverrides.search=async()=>{throw Error('QQ 独立故障');};
 await search('失败查询');await wait(()=>document.body.textContent.includes('QQ 独立故障'),'QQ 失败展示');unchanged();
 delete globalThis.__qqTestOverrides.search;
 await switchTo('网易云');await wait(()=>rows().some(x=>x.includes('网易后台结果')),'网易后台结果保存在自己工作区');
 assert(!document.body.textContent.includes('QQ 独立故障'));assert(button('网易账号A · 刷新'));assert(button('网易同ID歌单'));unchanged();
 assert.equal(document.querySelector('input[placeholder="搜索歌曲、歌手"]').value,'跨平台旧搜索');
 await switchTo('QQ 模拟');assert.equal(document.querySelector('input[placeholder="搜索歌曲、歌手"]').value,'失败查询');assert(button('模拟歌单'));unchanged();

 const qqOld=deferred();globalThis.__qqTestOverrides.search=()=>qqOld.promise;
 await search('QQ旧请求');await settle();
 button('退出').click();await wait(()=>button('进入模拟账号'),'QQ 退出');unchanged();
 button('进入模拟账号').click();await wait(()=>button('模拟账号 · 刷新')&&button('模拟歌单'),'QQ 重新进入');
 qqOld.resolve({result:{songs:[{id:1,name:'QQ跨账号旧结果'}],songCount:1}});await settle();
 assert(!document.body.textContent.includes('QQ跨账号旧结果'));unchanged();delete globalThis.__qqTestOverrides.search;

 const urlsBeforeEnd=pending.filter(x=>x.command==='netease_url').length;
 audio.dispatchEvent(new Event('ended'));await wait(()=>request('netease_url',3),'QQ 浏览时按网易原队列自动下一首');
 assert.equal(pending.filter(x=>x.command==='netease_url').length,urlsBeforeEnd+1);
 assert(!request('netease_url',2),'不能误播浏览列表B歌曲');
 request('netease_lyric',3).resolve({lrc:{lyric:'[00:00]网易原队列第二首'}});
 request('netease_url',3).resolve({data:[{code:200,url:'https://example.com/netease-next.mp3'}]});
 await wait(()=>audio.src.includes('netease-next.mp3'),'网易队列下一首播放');
 assert.equal(button('QQ 模拟').getAttribute('aria-pressed'),'true');
 assert.equal(document.querySelector('footer .current b').textContent,'网易队列A第二首');
 assert.equal(document.querySelector('audio'),audio);assert.equal(pauses,pauseCount);
 src=audio.src;playCount=plays;audio.currentTime=31;unchanged();

 await switchTo('网易云');
 activateSong(document.querySelector('.song'));await wait(()=>request('netease_url',2),'手动选择C的在途URL');
 const pendingCount=pending.filter(x=>x.command==='netease_url').length;
 audio.dispatchEvent(new Event('ended'));await settle();
 assert.equal(pending.filter(x=>x.command==='netease_url').length,pendingCount,'ended 不能抢先新建自动续播请求');
 assert(!request('netease_url',4),'不得抢播原队列下一首');
 request('netease_lyric',2).resolve({lrc:{lyric:'[00:00]手动选歌C歌词'}});
 request('netease_url',2).resolve({data:[{code:200,url:'https://example.com/manual-c.mp3'}]});
 await wait(()=>audio.src.includes('manual-c.mp3'),'手动C请求没有被ended作废');
 button('返回曲库').click();await wait(()=>document.querySelector('.app')?.dataset.view==='library');
 assert.equal(document.querySelector('footer .current b').textContent,'网易后台结果');
 assert.equal(document.querySelector('.play-toggle').getAttribute('aria-label'),'暂停');

 await search('CD新队列');await wait(()=>request('netease_search','CD新队列'),'新队列搜索');
 request('netease_search','CD新队列').resolve({result:{songs:[{id:6,name:'新队列C'},{id:7,name:'新队列D'}],songCount:2}});
 await wait(()=>rows().some(x=>x.includes('新队列C')),'新队列展示');
 activateSong(document.querySelector('.song'));await wait(()=>request('netease_url',6),'新队列C播放请求');
 rejectNextPlay=true;
 request('netease_lyric',6).resolve({lrc:{lyric:''}});
 request('netease_url',6).resolve({data:[{code:200,url:'https://example.com/c-retry.mp3'}]});
 await wait(()=>document.body.textContent.includes('新歌曲播放失败，已尝试恢复上一首'),'失败后回滚');
 assert.equal(document.querySelector('footer .current b').textContent,'网易后台结果');
 assert(audio.src.includes('manual-c.mp3'),'失败后恢复上一首地址');
 activateSong(document.querySelector('.song'));await wait(()=>pending.filter(x=>x.command==='netease_url'&&x.args.id===6).length===2,'再次选择新歌曲');
 pending.filter(x=>x.command==='netease_lyric'&&x.args.id===6).at(-1).resolve({lrc:{lyric:''}});
 pending.filter(x=>x.command==='netease_url'&&x.args.id===6).at(-1).resolve({data:[{code:200,url:'https://example.com/c-retry.mp3'}]});
 await wait(()=>audio.src.includes('c-retry.mp3'),'重试成功');
 button('返回曲库').click();await wait(()=>document.querySelector('.app')?.dataset.view==='library');
 await wait(()=>document.querySelector('footer .current b')?.textContent==='新队列C','重试成功展示');
 audio.dispatchEvent(new Event('ended'));await wait(()=>request('netease_url',7),'重试成功后续播新队列D');
 request('netease_lyric',7).resolve({lrc:{lyric:''}});
 request('netease_url',7).resolve({data:[{code:200,url:'https://example.com/d-after-retry.mp3'}]});
 await wait(()=>audio.src.includes('d-after-retry.mp3'),'新队列D实际播放');
 assert.equal(document.querySelector('footer .current b').textContent,'新队列D');
 assert(!request('netease_url',4),'重试后不能恢复旧队列');
 await search('账号旧搜索');await wait(()=>request('netease_search','账号旧搜索'),'账号旧搜索请求');
 button('网易同ID歌单').click();await wait(()=>pending.filter(x=>x.command==='netease_playlist'&&x.args.id===1).length===2,'账号旧歌单请求');
 button('发现音乐').click();await wait(()=>pending.filter(x=>x.command==='netease_daily_songs').length===6,'跨账号推荐请求');
 button('推荐新歌').click();await wait(()=>pending.filter(x=>x.command==='netease_recommended_new_songs').length===5,'跨账号新歌请求');
 accountResult={profile:{userId:200,nickname:'网易账号B'}};
 button('网易账号A · 刷新').click();await wait(()=>button('网易账号B · 刷新'),'网易账号更换');
 pending.filter(x=>x.command==='netease_recommended_new_songs').at(-1).resolve({items:[{id:87,name:'跨账号过期新歌'}]});
 pending.filter(x=>x.command==='netease_daily_songs').at(-1).resolve({items:[{id:84,name:'跨账号过期推荐'}]});
 request('netease_search','账号旧搜索').resolve({result:{songs:[{id:1,name:'网易跨账号旧搜索'}],songCount:1}});
 pending.filter(x=>x.command==='netease_playlist'&&x.args.id===1).at(-1).resolve({songs:[{id:1,name:'网易跨账号旧歌单'}],hasMore:false,total:1});await settle();
 assert(!document.body.textContent.includes('跨账号过期新歌'));assert(!document.body.textContent.includes('跨账号过期推荐'));assert(!document.body.textContent.includes('网易跨账号旧搜索'));assert(!document.body.textContent.includes('网易跨账号旧歌单'));assert.equal(rows().length,0);assert(!audio.getAttribute('src'));
 await switchTo('QQ 模拟');assert(button('模拟账号 · 刷新'));assert(button('模拟歌单'));
 console.log('通过：平台/账号/同ID数据隔离、异步后台响应归属、搜索与歌单旧账号响应失效、QQ退出后旧请求失效、同账号刷新成功/失败保留在途播放与歌词、QQ错误隔离、active/playing独立、QQ unsupported、切换保留单一 audio/src/进度且不 pause/play、QQ操作不调用网易IPC、QQ浏览时ended沿网易原队列播放下一首而非浏览列表B、手动选C在途时ended不抢播、C自动播放拒绝后手动重试并续播新队列D');
}finally{
 dom.window.close();delete globalThis.__qqTestOverrides;
 assert(resolve(temp).startsWith(resolve(tmpdir(),'music-platform-test-')));
 await rm(temp,{recursive:true,force:true});
}
