const activateSong=el=>{const active=document.querySelector('.provider-switch button[aria-pressed="true"]');if(active?.textContent.trim()==='网易云')el.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));else el.click();};
import {JSDOM} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'music-fm-test-'));
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
for(const n of ['MutationObserver','HTMLElement','Event'])globalThis[n]=dom.window[n];
let count=0,finishOld;const calls=[];let profile={userId:1,nickname:'账号甲'};
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{calls.push(command);
 if(command==='netease_account')return {profile};
 if(command==='qq_web_account')return {profile:null};
 if(command==='netease_playlists')return {playlist:[],more:false};
 if(command==='netease_likelist')return {code:200,ids:[]};
 if(command==='netease_private_fm'){count++;if(count===1)return {items:[{id:1,name:'合成 FM 一',album:{name:'合成专辑',picUrl:'http://p1.music.126.net/synthetic-fm.jpg'}},{id:2,name:'合成 FM 二'}]};if(count===2)throw Error('模拟续取失败');if(count===5)return new Promise(resolve=>{finishOld=resolve});return {items:[{id:2,name:'重复歌曲'},{id:3,name:'合成 FM 三'}]};}
 if(command==='netease_lyric')return {lrc:{lyric:''}};
 if(command==='netease_url')return {data:[{code:200,url:'https://example.invalid/'+args.id}]};
 throw Error('unexpected '+command);
}};
dom.window.HTMLMediaElement.prototype.play=function(){this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve()};
dom.window.HTMLMediaElement.prototype.pause=function(){this.dispatchEvent(new Event('pause'))};
dom.window.HTMLMediaElement.prototype.load=function(){};
const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw Error('等待状态超时')};
const button=t=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===t);
try{
 const built=await build({configFile:false,logLevel:'error',plugins:[react()],build:{outDir:temp,emptyOutDir:false,rollupOptions:{input:resolve('src/main.jsx')}}});
 await import(pathToFileURL(join(temp,built.output.find(x=>x.type==='chunk'&&x.isEntry).fileName)));
 await wait(()=>button('私人 FM'));assert(!button('听歌上报：关闭（未开放）'));assert(!button('本地计时诊断：关'));button('私人 FM').click();await wait(()=>document.querySelector('.app')?.dataset.view==='stage'&&document.querySelector('.lyric-panel'));await wait(()=>document.body.textContent.includes('模拟续取失败'));assert.equal(count,2);assert(!document.querySelector('.song'));assert.equal(document.querySelector('.lw-stage-image').src,'https://p1.music.126.net/synthetic-fm.jpg?param=800y800');
 button('曲库').click();await wait(()=>document.querySelector('.app')?.dataset.view==='library');assert(document.querySelector('.nr-fm-card'));assert(!document.querySelector('.song'));document.querySelector('.nr-current-trigger').click();await wait(()=>document.querySelector('.app')?.dataset.view==='stage'&&document.querySelector('.lyric-panel'));button('播放详情').click();await wait(()=>document.querySelector('.app')?.dataset.view==='stage'&&!document.querySelector('.lyric-panel'));button('曲库').click();await wait(()=>document.querySelector('.app')?.dataset.view==='library');assert.equal(count,2);assert(button('重试私人 FM'));
 button('重试私人 FM').click();await wait(()=>count===3&&!button('重试私人 FM'));assert(!document.body.textContent.includes('重复歌曲'));
 const audio=document.querySelector('audio');assert(audio.src.endsWith('/1'));button('QQ 音乐').click();await wait(()=>document.body.textContent.includes('登录后可查看 QQ 歌单'));assert(audio.src.endsWith('/1'));audio.dispatchEvent(new Event('ended'));await wait(()=>audio.src.endsWith('/2'));audio.dispatchEvent(new Event('ended'));await wait(()=>audio.src.endsWith('/3'));assert(document.body.textContent.includes('合成 FM 三'));
 assert.equal(count,4); // New track near tail permits one additional refill, never an automatic retry loop.
 button('网易云').click();await wait(()=>button('账号甲 · 刷新'));await wait(()=>button('重试私人 FM'));button('重试私人 FM').click();await wait(()=>finishOld);profile={userId:2,nickname:'账号乙'};button('账号甲 · 刷新').click();await wait(()=>button('账号乙 · 刷新'));finishOld({items:[{id:9,name:'旧账号迟到歌曲'}]});await new Promise(r=>setTimeout(r,20));assert(!audio.getAttribute('src'));assert(!document.body.textContent.includes('合成 FM 三'));assert(!document.body.textContent.includes('旧账号迟到歌曲'));
 assert.equal(document.querySelectorAll('audio').length,1);assert(!calls.some(c=>/report|scrobble|netease_like$|trash/.test(c)));console.log('通过：FM 首批、去重、失败手动重试、续播、平台切换及单音频');
}finally{dom.window.close();if(resolve(temp).startsWith(resolve(tmpdir(),'music-fm-test-')))await rm(temp,{recursive:true,force:true});}
