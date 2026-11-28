import {invoke} from '@tauri-apps/api/core';
import {capabilities,recommendationCapabilities,unsupported} from './providers.js';
const no=name=>async()=>{throw unsupported(name)};
const qqRecommendationCommands=Object.freeze({playlists:'qq_recommended_playlists',newsong:'qq_recommended_new_songs'});
export const qq=Object.freeze({capabilities:capabilities.qqmusic,recommendationCapabilities:recommendationCapabilities.qqmusic,
 login:()=>invoke('qq_web_login_open'),logout:()=>invoke('qq_web_logout'),restoreSession:()=>invoke('qq_web_account'),getUserProfile:()=>invoke('qq_web_account'),
 loginComplete:()=>invoke('qq_web_login_complete'),loginCancel:()=>invoke('qq_web_login_cancel'),
 search:(query,{page=1,pageSize=5}={})=>invoke('qq_search',{query,page,pageSize}),
 getPlaylists:({page=1}={})=>invoke('qq_web_playlists',{page}),getPlaylistTracks:(id,{page=1}={})=>invoke('qq_web_playlist_tracks',{id:String(id),page}),getLyrics:id=>invoke('qq_web_lyric',{mid:String(id)}),
 resolvePlayback:(id,mediaMid,opts)=>invoke('qq_web_resolve',{mid:String(id),mediaMid:mediaMid||null,...(opts?.level?{level:opts.level}:{})}),getRecommendations:async kind=>{if(!Object.hasOwn(qqRecommendationCommands,kind))throw unsupported('该 QQ 推荐类型');return invoke(qqRecommendationCommands[kind]);},reportListening:no('QQ 收听上报')});
