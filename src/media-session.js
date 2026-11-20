import {artworkUrl,songAlbum} from './cover.js';
export function installMediaSession(session,handlers){
 if(!session?.setActionHandler)return ()=>{};
 const actions=['play','pause','previoustrack','nexttrack'];
 for(const action of actions){try{session.setActionHandler(action,handlers[action]||null);}catch{}}
 return ()=>{for(const action of actions){try{session.setActionHandler(action,null);}catch{}}};
}
export function updateMediaSession(session,Metadata,song,playing){
 if(!session)return;
 try{session.playbackState=song?(playing?'playing':'paused'):'none';}catch{}
 if(!Metadata)return;
 try{const album=songAlbum(song),cover=artworkUrl(album.picUrl);session.metadata=song?new Metadata({title:song.name||'',artist:(song.artists||song.ar||[]).map(a=>a.name).join(' / '),album:album.name||'',artwork:cover?[{src:cover}]:[]}):null;}catch{}
}
