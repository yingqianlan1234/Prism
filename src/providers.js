import {invoke} from '@tauri-apps/api/core';
export const unsupported = (name) => Object.assign(new Error(`${name}暂不支持`), {code:'unsupported'});
const no = name => async () => { throw unsupported(name); };
export const capabilities = Object.freeze({
 netease:Object.freeze({login:true,logout:true,restoreSession:true,getUserProfile:true,search:true,getPlaylists:true,getPlaylistTracks:true,getLyrics:true,resolvePlayback:true,getRecommendations:true,reportListening:false}),
 qqmusic:Object.freeze({login:true,logout:true,restoreSession:true,getUserProfile:true,search:true,getPlaylists:true,getPlaylistTracks:true,getLyrics:true,resolvePlayback:true,getRecommendations:false,reportListening:false})
});
export const platformFlavor=Object.freeze({netease:'netease',qqmusic:'community'});
export const recommendationCapabilities=Object.freeze({
 netease:Object.freeze({daily:true,resources:true,playlists:true,fm:true,newsong:true}),
 qqmusic:Object.freeze({daily:false,resources:false,playlists:false,fm:false,newsong:false})
});
const recommendationCommands=Object.freeze({daily:'netease_daily_songs',resources:'netease_recommended_resources',playlists:'netease_personalized_playlists',newsong:'netease_recommended_new_songs',fm:'netease_private_fm'});
export const netease = Object.freeze({
 capabilities:capabilities.netease,recommendationCapabilities:recommendationCapabilities.netease, login:()=>invoke('netease_qr_start'), logout:()=>invoke('netease_logout'),
 restoreSession:()=>invoke('netease_account'), getUserProfile:()=>invoke('netease_account'),
 search:query=>invoke('netease_search',{query}),getPlaylists:()=>invoke('netease_playlists'),getPlaylistTracks:(id,options={})=>invoke('netease_playlist',options.page?{id,page:options.page}:{id}),
 getLyrics:id=>invoke('netease_lyric',{id}),resolvePlayback:id=>invoke('netease_url',{id}),
 getRecommendations:async kind=>{if(!Object.hasOwn(recommendationCommands,kind))throw unsupported('该推荐类型');return invoke(recommendationCommands[kind]);},reportListening:no('收听上报'),
 getPrivateFm:()=>invoke('netease_private_fm'),
 qrStart:()=>invoke('netease_qr_start'),qrCheck:()=>invoke('netease_qr_check'),qrCancel:()=>invoke('netease_qr_cancel')
});
export const getProvider = async id => id==='netease'?netease:id==='qqmusic'?(await import('./qq-community.js')).qq:Promise.reject(unsupported('该平台'));
export function latestRequest(){let generation=0;return {next:()=>++generation,current:()=>generation,isCurrent:value=>value===generation};}
