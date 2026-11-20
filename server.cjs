const express = require('express');
const api = require('@neteasecloudmusicapienhanced/api');
const app = express();
let cookie = '';
app.use((req,res,next)=>{const origin=req.headers.origin;if(req.get('x-music-client')!=='local' || (origin && origin!=='http://127.0.0.1:1420')) return res.sendStatus(403);res.set('Cache-Control','no-store');next();});
app.get('/api/:action',async(req,res)=>{
 try {
  let r, q={cookie};
  switch(req.params.action){
   case 'search': r=await api.cloudsearch({...q,keywords:String(req.query.q||''),limit:40}); break;
   case 'lyric': r=await api.lyric({...q,id:req.query.id}); break;
   case 'url': r=await api.song_url_v1({...q,id:req.query.id,level:'standard'}); break;
   case 'qr': {const key=await api.login_qr_key({});const k=key.body?.data?.unikey;if(!k) throw Error('二维码生成失败');r=await api.login_qr_create({key:k,qrimg:true});return res.json({key:k,image:r.body?.data?.qrimg});}
   case 'qrcheck': {r=await api.login_qr_check({key:req.query.key});if(r.body?.code===803&&r.body.cookie){cookie=r.body.cookie;const account=await api.user_account({cookie});return res.json({code:803,profile:account.body?.profile});}return res.json({code:r.body?.code});}
   case 'playlists': r=await api.user_playlist({...q,uid:req.query.uid,limit:100});break;
   case 'playlist': r=await api.playlist_track_all({...q,id:req.query.id,limit:200});break;
   default:return res.sendStatus(404);
  }
  res.json(r.body);
 }catch(e){res.status(502).json({error:'音乐服务暂时不可用，请重试'});}
});
app.listen(1421,'127.0.0.1',()=>console.log('本地音乐接口已启动'));
