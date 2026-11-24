import {unsupported} from './providers.js';
const capabilities={qqmusic:Object.freeze({login:true,logout:true,restoreSession:true,getUserProfile:true,search:true,getPlaylists:true,getPlaylistTracks:true,getLyrics:false,resolvePlayback:false,getRecommendations:false,reportListening:false})};
const mockRecommendationCapabilities=Object.freeze({daily:false,resources:false,playlists:false,fm:false,newsong:false});
let signedIn=false;
const profile={userId:'qq-mock-account',nickname:'模拟账号'};
const songs=[{id:1,name:'微光',artists:[{name:'模拟歌手'}],album:{name:'模拟专辑'},duration:205000},{id:2,name:'远方',artists:[{name:'模拟歌手'}],album:{name:'模拟专辑'},duration:192000}];
const no=name=>async()=>{throw unsupported(name)};
export const qq=Object.freeze({capabilities:capabilities.qqmusic,recommendationCapabilities:mockRecommendationCapabilities,
 login:async()=>{signedIn=true;return {profile}},logout:async()=>{signedIn=false;return {localCleared:true,remoteRevoked:false}},
 restoreSession:async()=>({profile:signedIn?profile:null}),getUserProfile:async()=>({profile:signedIn?profile:null}),
 search:async (q,options={})=>{if(options.fail)throw Error('模拟搜索失败');const found=songs.filter(s=>`${s.name} ${s.artists[0].name}`.includes(q));return {result:{songs:found,songCount:found.length}}},
 getPlaylists:async()=>{if(!signedIn)throw Object.assign(new Error('请先登录模拟账号'),{code:'auth'});return {playlist:[{id:1,name:'模拟歌单'}],more:false}},
 getPlaylistTracks:async id=>{if(!signedIn)throw Error('请先登录模拟账号');if(id!==1)throw Error('模拟歌单不存在');return {songs,hasMore:false,total:songs.length}},
 getLyrics:no('QQ 模拟歌词'),resolvePlayback:no('QQ 模拟播放'),getRecommendations:no('推荐'),reportListening:no('收听上报')});
