import {invoke} from '@tauri-apps/api/core';
import {capabilities,recommendationCapabilities,unsupported} from './providers.js';
const no=name=>async()=>{throw unsupported(name)};
export const qq=Object.freeze({capabilities:capabilities.qqmusic,recommendationCapabilities:recommendationCapabilities.qqmusic,
 login:()=>invoke('qq_web_login_open'),logout:()=>invoke('qq_web_logout'),restoreSession:()=>invoke('qq_web_account'),getUserProfile:()=>invoke('qq_web_account'),
 loginComplete:()=>invoke('qq_web_login_complete'),loginCancel:()=>invoke('qq_web_login_cancel'),
 search:(query,{page=1,pageSize=5}={})=>invoke('qq_search',{query,page,pageSize}),
 getPlaylists:({page=1}={})=>invoke('qq_web_playlists',{page}),getPlaylistTracks:(id,{page=1}={})=>invoke('qq_web_playlist_tracks',{id:String(id),page}),getLyrics:id=>invoke('qq_web_lyric',{mid:String(id)}),
 resolvePlayback:(id,mediaMid)=>invoke('qq_web_resolve',{mid:String(id),mediaMid:mediaMid||null}),getRecommendations:no('QQ 推荐'),reportListening:no('QQ 收听上报')});
