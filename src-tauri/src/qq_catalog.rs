//! QQ catalog response mapping; network activation stays gated until account validation.
use serde_json::{json, Value};
use crate::{err, Result};

fn id(value:&Value)->Option<String>{
 let s=value.as_str().map(str::to_owned).or_else(||value.as_u64().map(|n|n.to_string()))?;
 if !s.is_empty()&&s.len()<=32&&s.bytes().all(|c|c.is_ascii_alphanumeric()){Some(s)}else{None}
}
fn field<'a>(v:&'a Value,keys:&[&str])->Option<&'a Value>{keys.iter().find_map(|k|v.get(*k).filter(|x|!x.is_null()))}
fn name(v:&Value,keys:&[&str])->Option<String>{field(v,keys)?.as_str().map(str::trim).filter(|x|!x.is_empty()&&x.chars().count()<=500).map(str::to_owned)}
fn playlist_cover(v:&Value)->Option<String>{
 let raw=field(v,&["diss_cover","logo","picurl","cover"])?.as_str()?.trim();
 if raw.len()>2048{return None}let mut url=reqwest::Url::parse(raw).ok()?;
 let host=url.host_str()?;if !(host=="qq.com"||host.ends_with(".qq.com")||host=="gtimg.cn"||host.ends_with(".gtimg.cn")||host=="qpic.cn"||host.ends_with(".qpic.cn")){return None}
 if !matches!(url.scheme(),"http"|"https")||!url.username().is_empty()||url.password().is_some()||url.port().is_some(){return None}
 url.set_scheme("https").ok()?;Some(url.to_string())
}
fn root_ok(v:&Value)->Result<()> {if v.get("code").and_then(Value::as_i64)==Some(0){Ok(())}else{Err(err("upstream","QQ 歌单服务返回失败"))}}

pub(crate) fn map_playlists(created:Value,collected:Value)->Result<Value>{
 root_ok(&created)?;root_ok(&collected)?;
 let a=created.pointer("/data/disslist").and_then(Value::as_array).ok_or(err("upstream","QQ 创建歌单格式异常"))?;
 let b=collected.pointer("/data/cdlist").and_then(Value::as_array).ok_or(err("upstream","QQ 收藏歌单格式异常"))?;
 let mut seen=std::collections::HashSet::new();let mut out=Vec::new();
 for (kind,items) in [("created",a),("collected",b)] {for item in items {
  let raw=field(item,&["dissid","tid","id","diss_id"]).and_then(id);
  let is_liked=kind=="created"&&item.get("dirid").and_then(Value::as_u64)==Some(201);
  let key=if is_liked{"liked:201".to_owned()}else{raw.ok_or(err("upstream","QQ 歌单标识缺失"))?};
  if !seen.insert(key.clone()){continue}let title=name(item,&["diss_name","dissname","name","title"]).ok_or(err("upstream","QQ 歌单名称缺失"))?;
  out.push(json!({"id":key,"name":title,"kind":kind,"coverImgUrl":playlist_cover(item)}));
 }}
 Ok(json!({"playlist":out,"more":null}))
}
fn track(v:&Value)->Result<Value>{
 let inner=field(v,&["track_info","songInfo","songinfo","song"]).filter(|x|x.is_object()).unwrap_or(v);
 let mid=field(inner,&["mid","songmid"]).and_then(id).ok_or(err("upstream","QQ 曲目标识缺失"))?;
 let title=name(inner,&["name","songname","title"]).ok_or(err("upstream","QQ 曲目名称缺失"))?;
 let singers=field(inner,&["singer","singers"]).and_then(Value::as_array).ok_or(err("upstream","QQ 歌手数据缺失"))?;
 let artists:Vec<Value>=singers.iter().map(|s|name(s,&["name"]).map(|n|json!({"name":n})).ok_or(err("upstream","QQ 歌手数据异常"))).collect::<Result<_>>()?;
 if artists.is_empty(){return Err(err("upstream","QQ 歌手数据缺失"));}
 let album=inner.get("album").filter(|v|v.is_object());let album_name=album.and_then(|v|name(v,&["name","title"])).unwrap_or_default();
 let album_mid=album.and_then(|v|field(v,&["mid","pmid"])).and_then(id);
 let cover=album_mid.map(|m|format!("https://y.gtimg.cn/music/photo_new/T002R300x300M{m}.jpg"));
 let seconds=field(inner,&["interval"]).and_then(Value::as_u64).unwrap_or(0).min(86400);
 let media=inner.pointer("/file/media_mid").and_then(id);
 Ok(json!({"id":mid,"name":title,"artists":artists,"album":{"name":album_name,"picUrl":cover},"duration":seconds*1000,"mediaMid":media}))
}
pub(crate) fn map_tracks(root:Value)->Result<Value>{
 root_ok(&root)?;let block=root.get("playlist").ok_or(err("upstream","QQ 歌单返回异常"))?;
 if block.get("code").and_then(Value::as_i64)!=Some(0){return Err(err("upstream","QQ 歌单返回失败"));}
 let data=block.get("data").ok_or(err("upstream","QQ 歌单数据缺失"))?;
 for key in ["code","subcode"]{if data.get(key).and_then(Value::as_i64).is_some_and(|v|v!=0){return Err(err("upstream","QQ 歌单返回失败"));}}
 let values=data.get("songlist").and_then(Value::as_array).ok_or(err("upstream","QQ 歌曲列表缺失"))?;
 if values.len()>100{return Err(err("upstream","QQ 歌曲列表过大"));}
 let songs:Vec<Value>=values.iter().map(track).collect::<Result<_>>()?;
 let total=field(data,&["total_song_num","songlist_size","totalNum"]).and_then(|v|v.as_u64().or_else(||v.as_str().and_then(|s|s.parse().ok())));
 let more=data.get("hasmore").or_else(||data.get("hasMore")).and_then(|v|v.as_bool().or_else(||v.as_u64().map(|n|n>0)));
 Ok(json!({"songs":songs,"total":total,"hasMore":more}))
}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn map_synthetic_created_collected_without_claiming_more(){let c=json!({"code":0,"data":{"disslist":[{"dissid":1,"diss_name":"合成创建"}]}});let f=json!({"code":0,"data":{"cdlist":[{"dissid":2,"dissname":"合成收藏"}]}});let x=map_playlists(c,f).unwrap();assert_eq!(x["playlist"].as_array().unwrap().len(),2);assert!(x["more"].is_null());}
 #[test] fn accepts_known_playlist_cover_fields_and_rejects_untrusted_hosts(){let c=json!({"code":0,"data":{"disslist":[{"dissid":1,"diss_name":"合成创建","diss_cover":"http://y.gtimg.cn/synthetic.jpg"}]}});let f=json!({"code":0,"data":{"cdlist":[{"dissid":2,"dissname":"合成收藏","logo":"https://y.gtimg.cn/other.jpg"},{"dissid":3,"dissname":"无效","logo":"https://attacker.invalid/image"}]}});let x=map_playlists(c,f).unwrap();assert_eq!(x["playlist"][0]["coverImgUrl"],"https://y.gtimg.cn/synthetic.jpg");assert_eq!(x["playlist"][1]["coverImgUrl"],"https://y.gtimg.cn/other.jpg");assert!(x["playlist"][2]["coverImgUrl"].is_null());}
 #[test] fn rejects_one_failed_side_and_malformed(){assert!(map_playlists(json!({"code":0,"data":{"disslist":[]}}),json!({"code":500})).is_err());assert!(map_playlists(json!({"code":0}),json!({"code":0,"data":{"cdlist":[]}})).is_err());}
 #[test] fn maps_tracks_and_preserves_unknown_pagination(){let x=map_tracks(json!({"code":0,"playlist":{"code":0,"data":{"songlist":[{"mid":"ABC1","name":"合成歌曲","singer":[{"name":"合成歌手"}],"album":{"name":"合成专辑","mid":"ALB1"},"interval":120,"file":{"media_mid":"MED1"}}]}}})).unwrap();assert_eq!(x["songs"][0]["id"],"ABC1");assert_eq!(x["songs"][0]["duration"],120000);assert!(x["songs"][0]["album"]["picUrl"].as_str().unwrap().starts_with("https://y.gtimg.cn/"));assert!(x["hasMore"].is_null());}
 #[test] fn rejects_bad_business_or_missing_items(){assert!(map_tracks(json!({"code":0,"playlist":{"code":7,"data":{"songlist":[]}}})).is_err());assert!(map_tracks(json!({"code":0,"playlist":{"code":0,"data":{"songlist":[{"mid":"X"}]}}})).is_err());}
}
