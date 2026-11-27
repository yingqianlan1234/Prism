import {artworkUrl,songAlbum} from './cover.js';
const finite=(n,min,max,fallback)=>Number.isFinite(n)&&n>=min&&n<=max?n:fallback;
const text=(value)=>typeof value==='string'?value.slice(0,500):'';
export function cleanTrack(s){const id=Number(s.id),name=text(s.name);if(!Number.isSafeInteger(id)||id<=0||!name.trim())throw Error('歌曲信息不完整');const source=s.artists||s.ar||[];return {id,name,artists:Array.isArray(source)?source.slice(0,30).map(v=>text(typeof v==='string'?v:v?.name)):[],album:text((s.album||s.al||{}).name),duration:Math.round(finite(Number(s.duration||s.dt||0),0,86400000,0))};}
// Only stable, unsigned NetEase image paths may be retained; playback URLs never are.
export function fmCoverForStorage(song){const raw=songAlbum(song).picUrl;if(typeof raw!=='string')return null;try{const u=new URL(raw);if(!/^p[0-9]+\.music\.126\.net$/.test(u.hostname)||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.search||u.hash||!/^\/[A-Za-z0-9_=-]+\/[0-9]+\.jpg$/.test(u.pathname))return null;return artworkUrl(raw);}catch{return null;}}
// 普通队列的封面快照：自动将受信任的 http 网易图升级为 https，并保留 ?param 参数。
export function coverForStorage(song){const raw=songAlbum(song).picUrl;if(typeof raw!=='string'||!raw||raw.length>2048)return null;try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.hash)return null;const netease=u.hostname==='music.126.net'||u.hostname.endsWith('.music.126.net');if(!netease)return null;if(u.hostname.endsWith('.music.126.net')&&!/^p[0-9]+$/.test(u.hostname.slice(0,-'.music.126.net'.length)))return null;u.protocol='https:';const param=u.searchParams.get('param');u.search='';if(param&&/^\d{1,4}y\d{1,4}$/.test(param))u.searchParams.set('param',param);return u.href.length<=2048?u.href:null;}catch{return null;}}
export function qqCoverForStorage(song){const raw=songAlbum(song).picUrl;if(typeof raw!=='string'||!raw||raw.length>2048)return null;try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.hostname!=='y.gtimg.cn'||u.username||u.password||u.port||u.search||u.hash)return null;if(!/^\/music\/photo_new\/T002R\d{2,4}x\d{2,4}M000[A-Za-z0-9]+\.jpg$/.test(u.pathname))return null;u.protocol='https:';return u.href;}catch{return null;}}
function serializeQueue(q,kind){if(!q?.tracks?.length)return null;const source=kind==='fm'?'fm':(['playlist','search','recommendation','unknown'].includes(q.source)?q.source:'unknown');return {tracks:q.tracks.map(song=>{const t=cleanTrack(song),cover=kind==='fm'?fmCoverForStorage(song):coverForStorage(song);return cover?{...t,coverUrl:cover}:t;}),index:q.index,source};}
export function makePlaybackState({accountId,normalQueue,fmQueue,current,mode,volume,muted}){if(!/^\d{1,32}$/.test(String(accountId||'')))return null;const normal=serializeQueue(normalQueue,'normal'),fm=serializeQueue(fmQueue,'fm');const c=current&&current.provider==='netease'?{kind:current.kind,index:current.index,position:finite(Number(current.position),0,86400,0)}:null;return {version:1,provider:'netease',accountId:String(accountId),normalQueue:normal,fmQueue:fm,current:c,mode:['sequential','list-loop','repeat-one','shuffle'].includes(mode)?mode:'sequential',volume:finite(volume,0,1,1),muted:!!muted};}
export function restorePlaybackState(record,accountId){if(!record||record.version!==1||record.provider!=='netease'||String(record.accountId)!==String(accountId||''))return null;const decode=q=>q?{...q,tracks:q.tracks.map(t=>({id:t.id,name:t.name,artists:t.artists.map(name=>({name})),album:{name:t.album,picUrl:t.coverUrl||undefined},duration:t.duration,provider:'netease',accountId}))}:null;return {...record,normalQueue:decode(record.normalQueue),fmQueue:decode(record.fmQueue)};}
export function makeQqPlaybackState({accountId,queue,position,mode,volume,muted}){if(!/^\d{1,32}$/.test(String(accountId||'')))return null;const validId=id=>typeof id==='string'&&/^[a-z0-9]{1,64}$/i.test(id);const tracks=queue?.tracks?.map(s=>{if(!validId(s.id)||!text(s.name).trim()||(s.mediaMid!=null&&!validId(s.mediaMid)))throw Error('歌曲信息不完整');const artists=s.artists||s.ar||[];const cover=qqCoverForStorage(s);return {id:s.id,name:text(s.name),artists:Array.isArray(artists)?artists.slice(0,30).map(a=>text(typeof a==='string'?a:a?.name)):[],album:text((s.album||s.al||{}).name),duration:Math.round(finite(Number(s.duration||s.dt||0),0,86400000,0)),mediaMid:s.mediaMid||null,...(cover?{coverUrl:cover}:{})}});return {version:1,provider:'qqmusic',accountId:String(accountId),queue:tracks?.length?{tracks,index:queue.index,source:['playlist','search','recommendation','unknown'].includes(queue.source)?queue.source:'unknown'}:null,position:tracks?.length?finite(Number(position),0,86400,0):0,mode:['sequential','repeat-one','shuffle'].includes(mode)?mode:'sequential',volume:finite(volume,0,1,1),muted:!!muted};}
export function restoreQqPlaybackState(record,accountId){if(!record||record.version!==1||record.provider!=='qqmusic'||String(record.accountId)!==String(accountId||''))return null;const q=record.queue;return {...record,queue:q?{...q,provider:'qqmusic',accountId,tracks:q.tracks.map(t=>({id:t.id,name:t.name,artists:t.artists.map(name=>({name})),album:{name:t.album,picUrl:t.coverUrl||undefined},duration:t.duration,mediaMid:t.mediaMid,provider:'qqmusic',accountId}))}:null};}
export function nextIndex(mode,index,length,random=Math.random){if(length<=0)return -1;if(mode==='repeat-one')return index;if(mode==='list-loop')return (index+1)%length;if(mode==='shuffle'){if(length===1)return 0;return (index+1+Math.floor(random()*(length-1)))%length;}return index+1<length?index+1:-1;}

export function manualIndex(mode,index,length,delta,random=Math.random){if(length<=0)return -1;if(mode==='shuffle'&&length>1)return (index+1+Math.floor(random()*(length-1)))%length;const next=index+delta;if(mode==='list-loop')return (next+length)%length;return next>=0&&next<length?next:-1;}

export function queueMode(mode,queue){return queue?.type==='fm'||queue?.source==='fm'?'sequential':mode;}

export function reorderQueueTracks(tracks, currentIndex, fromIndex, toIndex) {
  if (!Array.isArray(tracks) || tracks.length < 2) return null;
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return null;
  if (fromIndex < 0 || fromIndex >= tracks.length || toIndex < 0 || toIndex >= tracks.length) return null;
  if (fromIndex === toIndex) return null;
  const nextTracks = [...tracks];
  const [moved] = nextTracks.splice(fromIndex, 1);
  nextTracks.splice(toIndex, 0, moved);
  let nextIndex = Number.isInteger(currentIndex) ? currentIndex : 0;
  if (nextIndex === fromIndex) nextIndex = toIndex;
  else if (fromIndex < nextIndex && toIndex >= nextIndex) nextIndex -= 1;
  else if (fromIndex > nextIndex && toIndex <= nextIndex) nextIndex += 1;
  return { tracks: nextTracks, index: Math.max(0, Math.min(nextTracks.length - 1, nextIndex)) };
}

export function computePlayNextTarget(currentIndex, fromIndex, total) {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(fromIndex) || !Number.isInteger(total)) return -1;
  if (total < 2 || currentIndex < 0 || currentIndex >= total || fromIndex < 0 || fromIndex >= total) return -1;
  if (fromIndex === currentIndex || fromIndex === currentIndex + 1) return -1;
  return fromIndex > currentIndex ? currentIndex + 1 : currentIndex;
}
