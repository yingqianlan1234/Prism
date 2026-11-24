const activateSong=el=>{const active=document.querySelector('.provider-switch button[aria-pressed="true"]');if(active?.textContent.trim()==='网易云')el.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));else el.click();};
import {JSDOM} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const temp=await mkdtemp(join(tmpdir(),'qq-stream-race-'));
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
for(const name of ['MutationObserver','HTMLElement','Event'])globalThis[name]=dom.window[name];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const pendingB=deferred(),pendingC=deferred();let bRequested=false,cRequests=0,playingStream=null,candidateStream=null,playCount=0;
const track=(id,name)=>({id,name,artists:[{name:'合成歌手'}],album:{name:'合成专辑'},duration:120000});
const qqa='http://prismmedia.localhost/SYNTHETICA',qqb='http://prismmedia.localhost/SYNTHETICB',netease='https://example.invalid/synthetic-c';
// Simulate the Rust boundary: resolving a new QQ URL only creates a candidate.
// The candidate becomes the playing stream only when the shared audio selects it.
const srcProperty=Object.getOwnPropertyDescriptor(dom.window.HTMLMediaElement.prototype,'src');
Object.defineProperty(dom.window.HTMLMediaElement.prototype,'src',{...srcProperty,set(value){srcProperty.set.call(this,value);if(value===qqa||value===qqb){assert.equal(value,candidateStream,'只有候选音频可转为正在播放');playingStream=value;}else playingStream=null;}});
dom.window.HTMLMediaElement.prototype.play=function(){playCount++;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve()};
dom.window.HTMLMediaElement.prototype.pause=function(){this.dispatchEvent(new Event('pause'))};dom.window.HTMLMediaElement.prototype.load=function(){};
window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{switch(cmd){
 case 'playback_state_load':return {status:'empty'};
 case 'playback_state_save':return {saved:true};
 case 'netease_account':return {profile:{userId:'200',nickname:'合成网易用户'}};
 case 'netease_playlists':return {playlist:[{id:1,name:'合成网易歌单'}],more:false};
 case 'netease_playlist':return {songs:[track(3,'合成网易 C')],hasMore:false};
 case 'netease_lyric':return {lrc:{lyric:''}};
 case 'netease_url':cRequests++;if(cRequests===1)return pendingC.promise;return {data:[{code:200,url:netease}]};
 case 'qq_web_account':return {profile:{userId:'100',nickname:'合成 QQ 用户'}};
 case 'qq_web_playlists':return {playlist:[{id:'1',name:'合成 QQ 歌单'}],more:null};
 case 'qq_web_playlist_tracks':return {songs:[track('A','合成 QQ A'),track('B','合成 QQ B')],hasMore:false,total:2};
 case 'qq_web_lyric':return {lrc:{lyric:''}};
 case 'qq_web_resolve':if(args.mid==='A'){candidateStream=qqa;return {data:[{code:200,url:qqa}]};}if(args.mid==='B'){bRequested=true;await pendingB.promise;candidateStream=qqb;return {data:[{code:200,url:qqb}]};}throw Error('意外的合成 QQ 曲目');
 default:throw Error('意外的合成 IPC: '+cmd);
}}};
const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('等待超时：'+label);};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
try{
 const built=await build({configFile:false,logLevel:'error',plugins:[react()],build:{outDir:temp,emptyOutDir:false,rollupOptions:{input:process.env.PRISM_TEST_ENTRY||resolve('src/main.jsx')}}});
 await import(pathToFileURL(join(temp,built.output.find(x=>x.type==='chunk'&&x.isEntry).fileName)));
 await wait(()=>button('合成网易歌单'),'网易初始化');button('QQ 音乐').click();await wait(()=>button('合成 QQ 歌单'),'QQ 歌单');button('合成 QQ 歌单').click();await wait(()=>document.querySelectorAll('.song').length===2,'QQ 曲目');
 activateSong(document.querySelectorAll('.song')[0]);await wait(()=>playingStream===qqa&&playCount===1,'QQ A 播放');const audio=document.querySelector('audio');assert.equal(audio.src,qqa);
 activateSong(document.querySelectorAll('.song')[1]);await wait(()=>bRequested,'QQ B 解析在途');button('网易云').click();await wait(()=>button('合成网易歌单'),'网易工作区');button('合成网易歌单').click();await wait(()=>document.querySelectorAll('.song').length===1,'网易 C 曲目');activateSong(document.querySelector('.song'));await wait(()=>cRequests===1,'网易 C 请求在途');
 pendingB.resolve();await wait(()=>candidateStream===qqb,'QQ B 返回候选');await new Promise(r=>setTimeout(r,30));assert.equal(audio.src,qqa,'过期 QQ B 不得覆盖 audio');assert.equal(playingStream,qqa,'QQ B 候选不得替换当前流');assert.equal(playCount,1);
 pendingC.reject(Error('合成 C 请求失败'));await wait(()=>document.body.textContent.includes('合成 C 请求失败'),'网易 C 失败');assert.equal(audio.src,qqa,'网易 C 失败后仍保留 QQ A');assert.equal(playingStream,qqa);
 activateSong(document.querySelector('.song'));await wait(()=>audio.src===netease&&playCount===2,'网易 C 重试成功');assert.equal(playingStream,null,'成功切换后 QQ A 不再是播放器当前流');assert.equal(document.querySelectorAll('audio').length,1);
 console.log('通过：QQ B 迟到与网易 C 失败不覆盖 QQ A；只有网易 C 成功才切换唯一 audio');
}finally{dom.window.close();if(resolve(temp).startsWith(resolve(tmpdir(),'qq-stream-race-')))await rm(temp,{recursive:true,force:true})}
