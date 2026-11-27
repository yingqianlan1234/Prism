use serde::{Deserialize, Serialize};
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::{Read,Write},path::PathBuf};
use tauri::{AppHandle,Manager};
use crate::{err,Result};

const MAX_BYTES:usize=4*1024*1024;
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Track { id:u64,name:String,artists:Vec<String>,album:String,duration:u64,#[serde(default,skip_serializing_if="Option::is_none")] cover_url:Option<String> }
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Queue { tracks:Vec<Track>, index:usize, source:String }
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Current { kind:String,index:usize,position:f64 }
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Snapshot { version:u64,provider:String,account_id:String,normal_queue:Option<Queue>,fm_queue:Option<Queue>,current:Option<Current>,mode:String,volume:f64,muted:bool }
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct QqTrack {
 id:String,name:String,artists:Vec<String>,album:String,duration:u64,media_mid:Option<String>,
 #[serde(default,skip_serializing_if="Option::is_none")]
 cover_url:Option<String>,
}
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct QqQueue { tracks:Vec<QqTrack>,index:usize,source:String }
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct QqSnapshot { version:u64,provider:String,account_id:String,queue:Option<QqQueue>,position:f64,mode:String,volume:f64,muted:bool }
#[derive(Debug,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
struct LastProvider {version:u64,provider:String}
fn decode_last(raw:&[u8])->std::result::Result<LastProvider,&'static str>{
 if raw.len()>1024{return Err("too_large")}
 let value:LastProvider=serde_json::from_slice(raw).map_err(|_|"invalid")?;
 if value.version!=1{return Err("unsupported_version")}
 if !matches!(value.provider.as_str(),"netease"|"qqmusic"){return Err("invalid")}
 Ok(value)
}
fn qq_id(s:&str,max:usize)->bool {!s.is_empty()&&s.len()<=max&&s.bytes().all(|b|b.is_ascii_alphanumeric())}
pub(crate) fn valid_qq_cover(raw:&str)->bool {
 if raw.len()>2048{return false}
 let Some(path)=raw.strip_prefix("https://y.gtimg.cn/music/photo_new/T002R").and_then(|s|s.strip_suffix(".jpg")) else{return false};
 let Some((width,rest))=path.split_once('x') else{return false};
 let Some((height,mid))=rest.split_once("M000") else{return false};
 let valid_size=|value:&str|(2..=4).contains(&value.len())&&value.bytes().all(|b|b.is_ascii_digit());
 valid_size(width)&&valid_size(height)&&!mid.is_empty()&&mid.bytes().all(|b|b.is_ascii_alphanumeric())
}
fn decode_qq(raw:&[u8])->std::result::Result<QqSnapshot,&'static str>{
 if raw.len()>MAX_BYTES{return Err("too_large")}
 let s:QqSnapshot=serde_json::from_slice(raw).map_err(|_|"invalid")?;
 if s.version!=1{return Err("unsupported_version")}
 if s.provider!="qqmusic"||s.account_id.is_empty()||s.account_id.len()>32||!s.account_id.bytes().all(|b|b.is_ascii_digit())||!matches!(s.mode.as_str(),"sequential"|"repeat-one"|"shuffle")||!s.volume.is_finite()||!(0.0..=1.0).contains(&s.volume)||!s.position.is_finite()||!(0.0..=86400.0).contains(&s.position){return Err("invalid")}
 if let Some(q)=&s.queue {if q.tracks.is_empty()||q.tracks.len()>2000||q.index>=q.tracks.len()||!matches!(q.source.as_str(),"playlist"|"search"|"recommendation"|"unknown"){return Err("invalid")}
  for t in &q.tracks {
   if t.cover_url.as_deref().is_some_and(|url|!valid_qq_cover(url)){return Err("invalid")}
   if !qq_id(&t.id,64)||t.media_mid.as_ref().is_some_and(|m|!qq_id(m,64))||t.name.trim().is_empty()||t.name.chars().count()>500||t.album.chars().count()>500||t.artists.len()>30||t.artists.iter().any(|a|a.chars().count()>500)||t.duration>86_400_000{return Err("invalid")}
  }
 } else if s.position!=0.0{return Err("invalid")}
 Ok(s)
}
fn valid_fm_cover(raw:&str)->bool {
 let Ok(u)=reqwest::Url::parse(raw) else{return false};
 let Some(host)=u.host_str() else{return false};let Some(prefix)=host.strip_suffix(".music.126.net") else{return false};
 if u.scheme()!="https"||!u.username().is_empty()||u.password().is_some()||u.port().is_some()||u.query().is_some()||u.fragment().is_some()||!prefix.starts_with('p')||prefix.len()<2||!prefix[1..].bytes().all(|b|b.is_ascii_digit()){return false}
 let parts:Vec<_>=u.path().trim_start_matches('/').split('/').collect();if parts.len()!=2||parts[0].is_empty()||!parts[0].bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'||b==b'='){return false}
 parts[1].strip_suffix(".jpg").is_some_and(|id|!id.is_empty()&&id.bytes().all(|b|b.is_ascii_digit()))
}
// Keep only the non-sensitive image-size parameter; old queues remain readable.
fn valid_size_param(value:&str)->bool {
 let Some((w,h))=value.split_once('y') else{return false};
 !w.is_empty()&&!h.is_empty()&&w.len()<=4&&h.len()<=4&&w.bytes().all(|b|b.is_ascii_digit())&&h.bytes().all(|b|b.is_ascii_digit())
}
fn sanitize_cover(raw:&str)->Option<String>{
 if raw.len()>2048{return None}let mut url=reqwest::Url::parse(raw).ok()?;
 let size=url.query_pairs().find(|(key,_)|key=="param").map(|(_,value)|value.into_owned()).filter(|v|valid_size_param(v));
 url.set_query(None);if let Some(size)=size{url.query_pairs_mut().append_pair("param",&size);}
 let safe=url.to_string();valid_cover(&safe).then_some(safe)
}
// 普通队列的封面：允许 ?param 查询串（真实封面 URL 带它），仅限 https 网易图域名。
pub(crate) fn valid_cover(raw:&str)->bool {
 if raw.len()>2048 {return false}
 let Ok(u)=reqwest::Url::parse(raw) else{return false};
 let Some(host)=u.host_str() else{return false};
 if u.scheme()!="https"||!u.username().is_empty()||u.password().is_some()||u.port().is_some()||u.fragment().is_some(){return false}
 if u.path().trim_start_matches('/').is_empty(){return false}
 let pairs:Vec<_>=u.query_pairs().collect();if pairs.len()>1||pairs.iter().any(|(key,value)|key!="param"||!valid_size_param(value)){return false}
 if host=="music.126.net" {return true}
 match host.strip_suffix(".music.126.net") {Some(p)=>!p.is_empty()&&p.starts_with('p')&&p.len()>1&&p[1..].bytes().all(|b|b.is_ascii_digit()),None=>false}
}
fn decode(raw:&[u8])->std::result::Result<Snapshot,&'static str>{
 if raw.len()>MAX_BYTES{return Err("too_large")};
 let mut v:Value=serde_json::from_slice(raw).map_err(|_|"invalid")?;
 let version=v.get("version").and_then(Value::as_u64).ok_or("invalid")?;
 if version==0 {let obj=v.as_object_mut().ok_or("invalid")?;if let Some(q)=obj.remove("queue"){if obj.contains_key("normalQueue"){return Err("invalid")};obj.insert("normalQueue".into(),q);}for (key,value) in [("normalQueue",Value::Null),("fmQueue",Value::Null),("current",Value::Null),("mode",json!("sequential")),("volume",json!(1.0)),("muted",json!(false))]{obj.entry(key).or_insert(value);}obj.insert("version".into(),json!(1));} else if version!=1{return Err("unsupported_version")}
 let mut s:Snapshot=serde_json::from_value(v).map_err(|_|"invalid")?;
 if let Some(q)=s.normal_queue.as_mut(){for t in &mut q.tracks{t.cover_url=t.cover_url.as_deref().and_then(sanitize_cover);}}
 if s.provider!="netease"||s.account_id.is_empty()||s.account_id.len()>32||!s.account_id.bytes().all(|b|b.is_ascii_digit())||!matches!(s.mode.as_str(),"sequential"|"list-loop"|"repeat-one"|"shuffle")||!s.volume.is_finite()||!(0.0..=1.0).contains(&s.volume){return Err("invalid")}
 for (q,kind) in [(&s.normal_queue,"normal"),(&s.fm_queue,"fm")] {if let Some(q)=q {
  if q.tracks.is_empty()||q.tracks.len()>2000||q.index>=q.tracks.len()||!matches!(q.source.as_str(),"fm"|"playlist"|"search"|"recommendation"|"unknown")||(kind=="fm")!=(q.source=="fm"){return Err("invalid")}
  for t in &q.tracks {if t.cover_url.as_ref().is_some_and(|url|if kind=="fm"{!valid_fm_cover(url)}else{!valid_cover(url)})||t.id==0||t.id>9_007_199_254_740_991||t.name.trim().is_empty()||t.name.chars().count()>500||t.album.chars().count()>500||t.artists.len()>30||t.artists.iter().any(|a|a.chars().count()>500)||t.duration>86_400_000{return Err("invalid")}}
 }}
 if let Some(c)=&s.current{let q=match c.kind.as_str(){"normal"=>&s.normal_queue,"fm"=>&s.fm_queue,_=>return Err("invalid")};if !c.position.is_finite()||c.position<0.0||c.position>86400.0||q.as_ref().is_none_or(|q|c.index>=q.tracks.len()||c.index!=q.index){return Err("invalid")}}
 Ok(s)
}
pub(crate) fn read_limited(input:impl Read,limit:usize)->std::io::Result<Vec<u8>> {let mut raw=Vec::new();input.take(limit as u64+1).read_to_end(&mut raw)?;Ok(raw)}
fn state_path(app:&AppHandle,provider:&str)->Result<PathBuf>{let dir=app.path().app_data_dir().map_err(|_|err("storage","无法确定应用数据目录"))?;Ok(dir.join(match provider{"netease"=>"playback-state.json","qqmusic"=>"playback-state-qqmusic.json","last"=>"playback-state-last.json",_=>return Err(err("validation","播放平台无效"))}))}
fn atomic_write(path:&std::path::Path,body:&[u8])->std::io::Result<()> {
 let dir=path.parent().ok_or_else(||std::io::Error::other("missing parent"))?;fs::create_dir_all(dir)?;
 let temp=dir.join(format!(".playback-state-{:016x}.tmp",rand::random::<u64>()));
 let result=(||{let mut f=OpenOptions::new().write(true).create_new(true).open(&temp)?;f.write_all(body)?;f.sync_all()?;drop(f);fs::rename(&temp,path)})();
 if result.is_err(){let _=fs::remove_file(&temp);}result
}
pub(crate) fn write_if_changed(path:&std::path::Path,body:&[u8])->std::io::Result<bool>{
 match fs::File::open(path){Ok(file)=>{if read_limited(file,body.len())?==body{return Ok(false)}},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>return Err(e)}
 atomic_write(path,body)?;Ok(true)
}
#[tauri::command]
pub(crate) fn playback_state_load(app:AppHandle,provider:Option<String>)->Result<Value>{let provider=provider.as_deref().unwrap_or("netease");let path=state_path(&app,provider)?;let file=match fs::File::open(path){Ok(f)=>f,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(json!({"status":"empty"})),Err(_)=>return Err(err("storage","无法读取播放状态"))};let limit=if provider=="last"{1024}else{MAX_BYTES};let raw=read_limited(file,limit).map_err(|_|err("storage","无法读取播放状态"))?;if provider=="last"{return Ok(match decode_last(&raw){Ok(value)=>json!({"status":"ok","provider":value.provider}),Err(reason)=>json!({"status":reason})})}if provider=="qqmusic"{return match decode_qq(&raw){Ok(s)=>Ok(json!({"status":"ok","state":s})),Err(reason)=>Ok(json!({"status":reason}))}}match decode(&raw){Ok(s)=>Ok(json!({"status":"ok","state":s})),Err(reason)=>Ok(json!({"status":reason}))}}
#[tauri::command]
pub(crate) fn playback_state_save(app:AppHandle,state:Value,mark_current:Option<bool>)->Result<Value>{let raw=serde_json::to_vec(&state).map_err(|_|err("storage","播放状态格式错误"))?;let provider=state.get("provider").and_then(Value::as_str).ok_or(err("validation","播放平台无效"))?;let canonical=match provider{"netease"=>serde_json::to_vec(&decode(&raw).map_err(|_|err("validation","播放状态无效"))?),"qqmusic"=>serde_json::to_vec(&decode_qq(&raw).map_err(|_|err("validation","播放状态无效"))?),_=>return Err(err("validation","播放平台无效"))}.map_err(|_|err("storage","播放状态编码失败"))?;write_if_changed(&state_path(&app,provider)?,&canonical).map_err(|_|err("storage","无法保存播放状态"))?;if mark_current.unwrap_or(false){let last=serde_json::to_vec(&LastProvider{version:1,provider:provider.to_owned()}).map_err(|_|err("storage","无法编码播放来源"))?;write_if_changed(&state_path(&app,"last")?,&last).map_err(|_|err("storage","无法保存播放来源"))?;}Ok(json!({"saved":true}))}
#[cfg(test)] mod tests {use super::*;
 #[test] fn oversized_input_is_read_only_to_limit(){let data=vec![0u8;200];let read=read_limited(data.as_slice(),10).unwrap();assert_eq!(read.len(),11);assert_eq!(decode_last(&read).unwrap_err(),"invalid");}
 #[test] fn last_provider_is_versioned_and_strict(){assert_eq!(decode_last(br#"{"version":1,"provider":"qqmusic"}"#).unwrap().provider,"qqmusic");assert_eq!(decode_last(br#"{"version":2,"provider":"qqmusic"}"#).unwrap_err(),"unsupported_version");for bad in [br#"{"version":1,"provider":"other"}"#.as_slice(),br#"{"version":1,"provider":"qqmusic","token":"secret"}"#.as_slice(),b"qqmusic".as_slice()]{assert_eq!(decode_last(bad).unwrap_err(),"invalid");}}
 fn sample_qq()->Value{json!({"version":1,"provider":"qqmusic","accountId":"123","queue":{"tracks":[{"id":"MID1","name":"合成","artists":[],"album":"","duration":1000,"mediaMid":"FILE1"}],"index":0,"source":"playlist"},"position":1.5,"mode":"sequential","volume":0.5,"muted":false})}
 #[test] fn qq_snapshot_rejects_urls_and_foreign_schema(){let mut v=sample_qq();assert!(decode_qq(v.to_string().as_bytes()).is_ok());assert!(decode(v.to_string().as_bytes()).is_err());v["queue"]["tracks"][0]["url"]=json!("https://example.invalid");assert!(decode_qq(v.to_string().as_bytes()).is_err());v["queue"]["tracks"][0].as_object_mut().unwrap().remove("url");v["queue"]["tracks"][0]["id"]=json!("https://example.invalid");assert!(decode_qq(v.to_string().as_bytes()).is_err());}
 #[test] fn qq_album_cover_roundtrips_only_when_it_matches_the_allowlist(){
  let mut v=sample_qq();
  let old=decode_qq(v.to_string().as_bytes()).unwrap();
  assert!(serde_json::to_value(old).unwrap()["queue"]["tracks"][0].get("coverUrl").is_none());
  let cover="https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg";
  v["queue"]["tracks"][0]["coverUrl"]=json!(cover);
  let decoded=decode_qq(v.to_string().as_bytes()).unwrap();
  assert_eq!(serde_json::to_value(decoded).unwrap()["queue"]["tracks"][0]["coverUrl"],cover);
  for bad in [
   format!("{cover}?size=300"),
   format!("{cover}#preview"),
   cover.replace("y.gtimg.cn","evil.invalid"),
   cover.replace("y.gtimg.cn","user@y.gtimg.cn"),
   cover.replace("y.gtimg.cn","y.gtimg.cn:443"),
   cover.replace("https://","http://"),
   cover.replace("M000ALB1","M000"),
   cover.replace("ALB1",&"A".repeat(2048)),
  ] {
   v["queue"]["tracks"][0]["coverUrl"]=json!(bad);
   assert_eq!(decode_qq(v.to_string().as_bytes()).unwrap_err(),"invalid");
  }
 }
 fn sample()->Value{json!({"version":1,"provider":"netease","accountId":"123","normalQueue":{"tracks":[{"id":1,"name":"合成歌曲","artists":["合成歌手"],"album":"合成专辑","duration":123000}],"index":0,"source":"playlist"},"fmQueue":null,"current":{"kind":"normal","index":0,"position":5.5},"mode":"sequential","volume":0.7,"muted":false})}
 #[test] fn rejects_credentials_urls_bad_owner_and_missing_queue(){for (key,val) in [("cookie",json!("synthetic")),("url",json!("https://example.invalid"))]{let mut v=sample();v["normalQueue"]["tracks"][0][key]=val;assert!(decode(v.to_string().as_bytes()).is_err())}let mut v=sample();v["accountId"]=json!("guest");assert!(decode(v.to_string().as_bytes()).is_err());let mut v=sample();v["current"]["kind"]=json!("fm");assert!(decode(v.to_string().as_bytes()).is_err());}
 #[test] fn normal_cover_sanitizes_old_secrets_without_losing_queue(){let mut v=sample();v["normalQueue"]["tracks"][0]["coverUrl"]=json!("https://p1.music.126.net/img/1.jpg?token=synthetic&param=300y300");let decoded=decode(v.to_string().as_bytes()).unwrap();let track=&decoded.normal_queue.as_ref().unwrap().tracks[0];assert_eq!(track.cover_url.as_deref(),Some("https://p1.music.126.net/img/1.jpg?param=300y300"));assert!(!serde_json::to_string(&decoded).unwrap().contains("synthetic"));v["normalQueue"]["tracks"][0]["coverUrl"]=json!("https://other.invalid/img.jpg?token=synthetic");let decoded=decode(v.to_string().as_bytes()).unwrap();assert_eq!(decoded.normal_queue.unwrap().tracks[0].cover_url,None);assert!(!valid_cover("https://p1.music.126.net/img/1.jpg?token=synthetic"));}
 #[test] fn fm_cover_is_optional_and_strictly_validated(){let mut v=sample();v["fmQueue"]=json!({"tracks":[{"id":2,"name":"合成","artists":[],"album":"专辑","duration":1000}],"index":0,"source":"fm"});assert!(decode(v.to_string().as_bytes()).is_ok());for cover in ["https://p1.music.126.net/Ab_c-1/123.jpg","https://p1.music.126.net/Ab_c-1==/123.jpg"]{v["fmQueue"]["tracks"][0]["coverUrl"]=json!(cover);let decoded=decode(v.to_string().as_bytes()).unwrap();assert_eq!(decoded.fm_queue.unwrap().tracks[0].cover_url.as_deref(),Some(cover));}for bad in ["https://p1.music.126.net/Ab==/123.jpg?token=secret","https://evil.invalid/Ab==/123.jpg","https://p1.music.126.net/Ab==/secret.jpg"]{v["fmQueue"]["tracks"][0]["coverUrl"]=json!(bad);assert!(decode(v.to_string().as_bytes()).is_err())}}
 #[test] fn migrates_version_zero_and_rejects_future(){let mut v=sample();v["version"]=json!(0);let obj=v.as_object_mut().unwrap();let q=obj.remove("normalQueue").unwrap();obj.insert("queue".into(),q);for k in ["fmQueue","mode","volume","muted"]{obj.remove(k);}let migrated=decode(v.to_string().as_bytes()).unwrap();assert_eq!(migrated.version,1);assert_eq!(migrated.mode,"sequential");assert_eq!(migrated.normal_queue.unwrap().tracks[0].id,1);assert!(migrated.fm_queue.is_none());v["version"]=json!(99);assert_eq!(decode(v.to_string().as_bytes()).unwrap_err(),"unsupported_version");assert_eq!(decode(b"{" ).unwrap_err(),"invalid");assert_eq!(decode(&vec![b' ';MAX_BYTES+1]).unwrap_err(),"too_large");}
 #[test] fn atomic_file_replaces_prior_and_roundtrips(){let root=std::env::temp_dir().join(format!("xianyu-storage-test-{:016x}",rand::random::<u64>()));let path=root.join("state.json");let first=sample().to_string();atomic_write(&path,first.as_bytes()).unwrap();let mut v=sample();v["current"]["position"]=json!(9);atomic_write(&path,v.to_string().as_bytes()).unwrap();assert_eq!(decode(&fs::read(&path).unwrap()).unwrap().current.unwrap().position,9.0);fs::remove_file(path).unwrap();fs::remove_dir(root).unwrap();}
 #[test] fn unchanged_state_skips_replace_but_changes_are_saved(){let root=std::env::temp_dir().join(format!("prism-p1-test-{:016x}",rand::random::<u64>()));let path=root.join("state.json");assert!(write_if_changed(&path,b"one").unwrap());assert!(!write_if_changed(&path,b"one").unwrap());assert!(write_if_changed(&path,b"two").unwrap());assert_eq!(fs::read(&path).unwrap(),b"two");fs::remove_file(path).unwrap();fs::remove_dir(root).unwrap();}
}
