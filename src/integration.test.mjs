const activateSong=el=>el.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost'});
globalThis.window=dom.window; globalThis.document=dom.window.document; Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.MutationObserver=dom.window.MutationObserver; globalThis.HTMLElement=dom.window.HTMLElement; globalThis.Event=dom.window.Event;
let calls=[]; let pending=[]; let accountResult=new Error('首次网络超时'); let qrProfile={userId:1,nickname:'测试'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
window.__TAURI_INTERNALS__={invoke(command,args){calls.push({command,args});if(command==='netease_account')return accountResult instanceof Error?Promise.reject(accountResult):Promise.resolve(accountResult);if(command==='netease_playlists')return Promise.resolve({playlist:[{id:10,name:'歌单一'},{id:20,name:'歌单二'}],more:true});if(command==='netease_logout')return Promise.resolve({localCleared:true,remoteRevoked:false});if(command==='netease_qr_start')return Promise.resolve({image:'data:image/png;base64,AA=='});if(command==='netease_qr_check')return Promise.resolve({code:803,profile:qrProfile});if(command==='netease_search'||command==='netease_playlist'||command==='netease_url'||command==='netease_lyric'){const d=deferred();pending.push({command,args,...d});return d.promise;}return Promise.resolve({});}};
dom.window.HTMLMediaElement.prototype.play=function(){this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve()};
dom.window.HTMLMediaElement.prototype.pause=function(){this.dispatchEvent(new Event('pause'))};
dom.window.HTMLMediaElement.prototype.load=function(){};
const html=await readFile('dist/index.html','utf8');
const file=html.match(/<script\b[^>]*\bsrc="([^"]+)"/)[1];
await import(pathToFileURL(process.cwd()+'/dist/'+file.replace(/^\//,'')));
const wait=async(fn)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('等待界面状态超时')};
const button=text=>[...document.querySelectorAll('button')].find(x=>x.textContent.includes(text));
const req=(name,value)=>pending.find(x=>x.command===name&&(x.args?.query===value||x.args?.id===value));
await wait(()=>document.body.textContent.includes('账号刷新失败'));
assert(button('刷新账号'));assert(button('退出本机账号'));
const initialCalls=calls.length;document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>document.body.textContent.includes('请先刷新账号，确认当前身份'));assert.equal(calls.length,initialCalls);
button('退出本机账号').click();await wait(()=>button('扫码登录'));assert.match(document.body.textContent,/本机已退出，远端状态未确认/);
const anonymousInput=document.querySelector('input[placeholder="搜索歌曲、歌手"]');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(anonymousInput,'匿名测试');anonymousInput.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));anonymousInput.closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>req('netease_search','匿名测试'));req('netease_search','匿名测试').resolve({result:{songs:[],songCount:0}});
button('扫码登录').click();await wait(()=>document.querySelector('.dialog img'));await wait(()=>button('测试 · 刷新'));await wait(()=>button('歌单一'));qrProfile={userId:2,nickname:'新账号'};
assert.match(document.body.textContent,/仅显示部分歌单/);
const input=()=>document.querySelector('input[placeholder="搜索歌曲、歌手"]');
const search=async q=>{const el=input();Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,q);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,0));el.closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>req('netease_search',q));};
await search('旧搜索');await search('新搜索');
req('netease_search','新搜索').resolve({result:{songs:[{id:2,name:'新歌曲'}],songCount:5}});
await wait(()=>document.body.textContent.includes('新歌曲'));
req('netease_search','旧搜索').resolve({result:{songs:[{id:1,name:'旧歌曲'}],songCount:1}});
await new Promise(r=>setTimeout(r,20));assert(!document.body.textContent.includes('旧歌曲'));assert.match(document.body.textContent,/共 5 首/);
button('歌单一').click();button('歌单二').click();await wait(()=>req('netease_playlist',20));
req('netease_playlist',20).resolve({songs:[{id:4,name:'第二首'},{id:5,name:'第三首'}],total:3,hasMore:true});await wait(()=>button('第二首'));
req('netease_playlist',10).resolve({songs:[{id:3,name:'第一首'}],total:1,hasMore:false});await new Promise(r=>setTimeout(r,20));assert(![...document.querySelectorAll('.song')].some(x=>x.textContent.includes('第一首')));
activateSong(button('第二首'));activateSong(button('第三首'));await wait(()=>req('netease_url',5));req('netease_lyric',5).reject({kind:'network',message:'歌词失败'});req('netease_url',5).resolve({data:[{url:'https://example.com/5.mp3'}]});await wait(()=>document.querySelector('audio').src.includes('5.mp3'));req('netease_url',4).resolve({data:[{url:'https://example.com/4.mp3'}]});req('netease_lyric',4).resolve({lrc:{lyric:'[00:00]旧歌词'}});await new Promise(r=>setTimeout(r,20));assert(document.querySelector('audio').src.includes('5.mp3'));assert(!document.body.textContent.includes('旧歌词'));
activateSong(button('第二首'));await wait(()=>pending.filter(x=>x.command==='netease_url'&&x.args.id===4).length===2);pending.filter(x=>x.command==='netease_url'&&x.args.id===4).at(-1).resolve({data:[{code:403,url:'https://example.com/forbidden.mp3'}]});pending.filter(x=>x.command==='netease_lyric'&&x.args.id===4).at(-1).resolve({lrc:{lyric:''}});await wait(()=>document.body.textContent.includes('未获取到播放资源'));assert(document.querySelector('audio').src.includes('5.mp3'));
accountResult=new Error('网络超时');button('测试 · 刷新').click();await wait(()=>document.body.textContent.includes('账号刷新失败'));assert(button('测试 · 刷新'));assert(button('歌单一'));assert(document.querySelector('audio').src.includes('5.mp3'));
activateSong(button('第二首'));await wait(()=>pending.filter(x=>x.command==='netease_url'&&x.args.id===4).length===3);const oldUrl=pending.filter(x=>x.command==='netease_url'&&x.args.id===4).at(-1);const oldLyric=pending.filter(x=>x.command==='netease_lyric'&&x.args.id===4).at(-1);
accountResult={profile:{userId:2,nickname:'账号B'}};button('测试 · 刷新').click();await wait(()=>button('账号B'));assert(!document.querySelector('audio').getAttribute('src'));assert(!document.querySelector('.song'));oldUrl.resolve({data:[{url:'https://example.com/stale.mp3'}]});oldLyric.resolve({lrc:{lyric:'[00:00]跨账号旧歌词'}});await new Promise(r=>setTimeout(r,20));assert(!document.querySelector('audio').getAttribute('src'));assert(!document.body.textContent.includes('跨账号旧歌词'));
accountResult={profile:{nickname:'缺少身份'}};button('账号B · 刷新').click();await wait(()=>button('刷新账号'));assert(!document.querySelector('audio').getAttribute('src'));const beforeUnknown=calls.length;input().closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>document.body.textContent.includes('请先刷新账号，确认当前身份'));assert.equal(calls.length,beforeUnknown);accountResult={profile:{userId:2,nickname:'账号B'}};button('刷新账号').click();await wait(()=>button('账号B'));
button('退出').click();await wait(()=>button('扫码登录'));assert.match(document.body.textContent,/本机已退出，远端状态未确认/);button('扫码登录').click();await wait(()=>document.querySelector('.dialog img'));document.querySelector('.close').click();await wait(()=>calls.some(x=>x.command==='netease_qr_cancel'));button('扫码登录').click();await wait(()=>document.querySelector('.dialog img'));await wait(()=>button('新账号'));await wait(()=>button('歌单一'));assert(calls.filter(x=>x.command==='netease_playlists').length>=4);
console.log('通过：首次恢复失败阻止请求、未知身份退出后匿名搜索、账号刷新失败保留身份、切换和缺失身份隔离、账号恢复、歌单截断提示、搜索、歌单和切歌乱序、歌词失败不阻止播放、非200音源不会播放、退出远端未确认、扫码取消及成功后加载歌单');dom.window.close();




