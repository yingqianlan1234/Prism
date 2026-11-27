import {JSDOM} from 'jsdom';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const temp=await mkdtemp(join(tmpdir(),'prism-restore-lyric-race-'));
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
globalThis.window=dom.window;globalThis.document=dom.window.document;Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
for(const n of ['MutationObserver','HTMLElement','Event'])globalThis[n]=dom.window[n];
dom.window.HTMLMediaElement.prototype.pause=function(){};dom.window.HTMLMediaElement.prototype.load=function(){};dom.window.HTMLMediaElement.prototype.play=function(){this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve();};
let profile={userId:100,nickname:'合成账号甲'};const pending=[];
const record=()=>({version:1,provider:'netease',accountId:String(profile.userId),normalQueue:{tracks:[{id:1,name:'合成同一歌曲',artists:[],album:'',duration:120000}],index:0,source:'playlist'},fmQueue:null,current:{kind:'normal',index:0,position:17},mode:'sequential',volume:1,muted:false});
window.__TAURI_INTERNALS__={invoke:async(cmd,args)=>{switch(cmd){case 'playback_state_load':return args?.provider==='last'?{status:'empty'}:{status:'ok',state:record()};case 'netease_account':return {profile};case 'netease_playlists':return {playlist:[],more:false};case 'netease_lyric':return new Promise(resolve=>pending.push(resolve));case 'netease_url':return {data:[{code:200,url:'https://example.invalid/audio'}]};case 'netease_recent_add':return {saved:true};case 'playback_state_save':return {saved:true};default:throw Error('unexpected '+cmd)}}};
const wait=async(f,label)=>{for(let i=0;i<400;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('等待超时：'+label)};
const button=t=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===t);
try{
 const built=await build({configFile:false,logLevel:'error',plugins:[react()],build:{outDir:temp,emptyOutDir:false,rollupOptions:{input:resolve('src/main.jsx')}}});
 await import(pathToFileURL(join(temp,built.output.find(x=>x.type==='chunk'&&x.isEntry).fileName)));
 await wait(()=>{
  const refresh=button('合成账号甲 · 刷新');
  return pending.length===1&&refresh&&!refresh.disabled;
 },'账号甲恢复歌词且刷新按钮可用');
 profile={userId:200,nickname:'合成账号乙'};button('合成账号甲 · 刷新').click();
 await wait(()=>{
  const play=document.querySelector('.play-toggle');
  return button('合成账号乙 · 刷新')&&pending.length===2&&play&&!play.disabled;
 },'账号乙恢复相同歌曲且可播放');
 document.querySelector('.play-toggle').click();await wait(()=>pending.length===3,'新账号主动播放再次请求歌词');
 pending[2]({lrc:{lyric:'[00:01]新账号新会话歌词'}});await wait(()=>document.body.textContent.includes('新账号新会话歌词'),'新账号新会话歌词');
 pending[1]({lrc:{lyric:'[00:01]新账号旧会话歌词'}});pending[0]({lrc:{lyric:'[00:01]旧账号歌词'}});await new Promise(r=>setTimeout(r,30));
 assert(!document.body.textContent.includes('旧账号歌词'),'旧账号的恢复歌词不得覆盖相同歌曲');
 assert(!document.body.textContent.includes('新账号旧会话歌词'),'旧播放代次的恢复歌词不得覆盖新会话');
 assert(document.body.textContent.includes('新账号新会话歌词'));assert.equal(document.querySelectorAll('audio').length,1);
 console.log('通过：恢复歌词的旧账号和旧播放代次不能覆盖新会话');
}finally{dom.window.close();if(resolve(temp).startsWith(resolve(tmpdir(),'prism-restore-lyric-race-')))await rm(temp,{recursive:true,force:true});}

