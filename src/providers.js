import {invoke} from '@tauri-apps/api/core';
export const unsupported = (name) => Object.assign(new Error(`${name}暂不支持`), {code:'unsupported'});
const no = name => async () => { throw unsupported(name); };
const neteaseLibraryCapabilities = enabled => ({
 playbackQuality:enabled,searchPagination:enabled,searchCategories:enabled,
 likeTrack:enabled,getLikedSongIds:enabled,trashFmTrack:enabled,editPlaylistTracks:enabled
});
export const capabilities = Object.freeze({
 desktop:Object.freeze({globalShortcuts:true,desktopLyric:true,appUpdater:true,autostart:false,customPlaylistsStorage:false}),
 local:Object.freeze({manageFolders:true,scanLibrary:true,getTracks:true,resolvePlayback:true,getLyrics:true,persistQueue:true,getCover:false}),
 netease:Object.freeze({login:true,logout:true,restoreSession:true,getUserProfile:true,search:true,getPlaylists:true,getPlaylistTracks:true,getLyrics:true,resolvePlayback:true,getRecommendations:true,reportListening:false,...neteaseLibraryCapabilities(true)}),
 qqmusic:Object.freeze({login:true,logout:true,restoreSession:true,getUserProfile:true,search:true,getPlaylists:true,getPlaylistTracks:true,getLyrics:true,resolvePlayback:true,getRecommendations:true,reportListening:false,...neteaseLibraryCapabilities(false)})
});
export function capabilitiesForHost(host) {
 if(typeof host?.qqMusic!=='boolean') return capabilities;
 return Object.freeze({
  ...capabilities,
  desktop:Object.freeze({
   globalShortcuts:host.globalShortcuts,
   desktopLyric:host.desktopLyric,
   closeBehavior:host.closeBehavior,
   appUpdater:host.appUpdater===true,
   customTitlebar:host.customTitlebar===true,
   autostart:host.autostart===true,
   customPlaylistsStorage:host.customPlaylistsStorage===true
  }),
  local:Object.freeze({...capabilities.local,getCover:host.localTrackCover===true}),
  qqmusic:Object.freeze({...capabilities.qqmusic,available:host.qqMusic})
 });
}
export const local = Object.freeze({
 capabilities:capabilities.local,
 getFolders:()=>invoke('local_library_folders_get'),
 pickFolder:()=>invoke('local_library_folder_pick'),
 removeFolder:id=>invoke('local_library_folder_remove',{id}),
 scan:()=>invoke('local_library_scan'),
 getTracks:({offset=0,limit=100}={})=>invoke('local_library_tracks_get',{offset,limit}),
 resolvePlayback:id=>invoke('local_track_resolve',{id}),
 getLyrics:id=>invoke('local_track_lyric',{id}),
 getCover:id=>invoke('local_track_cover',{id}),
 getQueue:()=>invoke('local_queue_get'),
 setQueue:queue=>invoke('local_queue_set',{queue})
});
export const desktop = Object.freeze({
 capabilities:capabilities.desktop,
 globalShortcutsGet:()=>invoke('global_shortcuts_get'),
 globalShortcutsSet:({enabled,bindings})=>invoke('global_shortcuts_set',{enabled,bindings}),
 desktopLyricGet:()=>invoke('desktop_lyric_get'),
 desktopLyricSet:({enabled,locked,style})=>invoke('desktop_lyric_set',{enabled,...(locked===undefined?{}:{locked}),...(style===undefined?{}:{style})}),
 desktopLyricUpdate:({text,translation,romaji,title,playing,nextText,elapsedMs,durationMs,rate,accentColor})=>invoke('desktop_lyric_update',{text,translation,romaji,title,playing,...(nextText===undefined?{}:{nextText}),...(elapsedMs===undefined?{}:{elapsedMs}),...(durationMs===undefined?{}:{durationMs}),...(rate===undefined?{}:{rate}),...(accentColor===undefined?{}:{accentColor})}),
 updaterConfigGet:()=>invoke('app_update_config_get'),
 updaterConfigSet:patch=>invoke('app_update_config_set',patch||{}),
 updaterCheck:options=>invoke('app_update_check',options||{}),
 updaterDownload:()=>invoke('app_update_download'),
 updaterInstall:()=>invoke('app_update_install'),
 customPlaylistsLoad:()=>invoke('custom_playlists_load'),
 customPlaylistsSave:data=>invoke('custom_playlists_save',{data}),
 autostartGet:()=>invoke('autostart_get'),
 autostartSet:enabled=>invoke('autostart_set',{enabled}),
 events:Object.freeze({globalShortcut:'prism:global-shortcut',desktopLyricState:'prism:desktop-lyric-state',updateProgress:'prism:app-update-progress'})
});
export const platformFlavor=Object.freeze({netease:'netease',qqmusic:'community'});
export const recommendationCapabilities=Object.freeze({
 netease:Object.freeze({daily:true,resources:true,playlists:true,fm:true,newsong:true}),
 qqmusic:Object.freeze({daily:false,resources:false,playlists:true,fm:false,newsong:true})
});
const recommendationCommands=Object.freeze({daily:'netease_daily_songs',resources:'netease_recommended_resources',playlists:'netease_personalized_playlists',newsong:'netease_recommended_new_songs',fm:'netease_private_fm'});
export const netease = Object.freeze({
 capabilities:capabilities.netease,recommendationCapabilities:recommendationCapabilities.netease, login:()=>invoke('netease_qr_start'), logout:()=>invoke('netease_logout'),
 restoreSession:()=>invoke('netease_account'), getUserProfile:()=>invoke('netease_account'),
 search:(query,{offset,searchType}={})=>invoke('netease_search',{
  query,...(offset===undefined?{}:{offset}),...(searchType===undefined?{}:{searchType})
 }),
 getPlaylists:()=>invoke('netease_playlists'),getPlaylistTracks:(id,options={})=>invoke('netease_playlist',options.page?{id,page:options.page}:{id}),
 getLyrics:id=>invoke('netease_lyric',{id}),
 resolvePlayback:(id,options)=>invoke('netease_url',options?.level===undefined?{id}:{id,level:options.level}),
 likeTrack:(id,like)=>invoke('netease_like',{id,like}),
 getLikedSongIds:()=>invoke('netease_likelist'),
 trashFmTrack:id=>invoke('netease_fm_trash',{id}),
 editPlaylistTracks:(op,pid,trackId)=>invoke('netease_playlist_tracks_op',{op,pid,trackId}),
 getRecommendations:async kind=>{if(!Object.hasOwn(recommendationCommands,kind))throw unsupported('该推荐类型');return invoke(recommendationCommands[kind]);},reportListening:no('收听上报'),
 getPrivateFm:()=>invoke('netease_private_fm'),
 qrStart:()=>invoke('netease_qr_start'),qrCheck:()=>invoke('netease_qr_check'),qrCancel:()=>invoke('netease_qr_cancel')
});
export const getProvider = async id => id==='netease'?netease:id==='local'?local:id==='qqmusic'?(await import('./qq-community.js')).qq:Promise.reject(unsupported('该平台'));
export function latestRequest(){let generation=0;return {next:()=>++generation,current:()=>generation,isCurrent:value=>value===generation};}
