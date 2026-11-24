//! QQ catalog mapping and anonymous public recommendations.
use serde_json::{json, Value};
use std::time::Duration;
use tauri::WebviewWindow;
use crate::{err, qq_web_auth::main_only, Result};

fn id(value:&Value)->Option<String>{
 let s=value.as_str().map(str::to_owned).or_else(||value.as_u64().map(|n|n.to_string()))?;
 if !s.is_empty()&&s.len()<=32&&s.bytes().all(|c|c.is_ascii_alphanumeric()){Some(s)}else{None}
}
fn field<'a>(v:&'a Value,keys:&[&str])->Option<&'a Value>{keys.iter().find_map(|k|v.get(*k).filter(|x|!x.is_null()))}
fn name(v:&Value,keys:&[&str])->Option<String>{field(v,keys)?.as_str().map(str::trim).filter(|x|!x.is_empty()&&x.chars().count()<=500).map(str::to_owned)}
fn playlist_cover(v:&Value)->Option<String>{
 let raw=v.as_str()?.trim();
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
  let cover=field(item,&["diss_cover","logo","picurl","cover"]).and_then(playlist_cover);
  out.push(json!({"id":key,"name":title,"kind":kind,"coverImgUrl":cover}));
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
 let cover=album_mid.map(|m|format!("https://y.gtimg.cn/music/photo_new/T002R300x300M000{m}.jpg"));
 let seconds=field(inner,&["interval"]).and_then(Value::as_u64).unwrap_or(0).min(86400);
 let media=inner.pointer("/file/media_mid").and_then(id);
 let vip=inner.pointer("/pay/pay_play").and_then(Value::as_i64)==Some(1);
 Ok(json!({"id":mid,"name":title,"artists":artists,"album":{"name":album_name,"picUrl":cover},"duration":seconds*1000,"mediaMid":media,"vip":vip}))
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

const RECOMMENDATION_URL: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const MAX_RECOMMENDATION_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy)]
enum Recommendation { HotPlaylists, NewSongs }

impl Recommendation {
 fn key(self) -> &'static str {
  match self { Self::HotPlaylists => "hot", Self::NewSongs => "newsong" }
 }

 fn request(self, client: &reqwest::Client) -> reqwest::RequestBuilder {
  let block = match self {
   Self::HotPlaylists => json!({"module":"playlist.HotRecommendServer","method":"get_hot_recommend","param":{"async":1,"cmd":2}}),
   Self::NewSongs => json!({"module":"newsong.NewSongServer","method":"get_new_song_info","param":{"type":5}}),
  };
  let body = json!({
   "comm":{"ct":24,"cv":4747474,"platform":"yqq.json","format":"json"},
   (self.key()):block
  });
  client.post(RECOMMENDATION_URL).header(reqwest::header::REFERER, "https://y.qq.com/")
      .header(reqwest::header::ORIGIN, "https://y.qq.com").json(&body)
 }

 fn map(self, root: &Value) -> Result<Value> {
  let block = root.get(self.key());
  if root.get("code").and_then(Value::as_i64) != Some(0)
      || block.and_then(|v| v.get("code")).and_then(Value::as_i64) != Some(0) {
   return Err(err("upstream", "QQ 公开推荐服务返回失败"));
  }
  let path = match self { Self::HotPlaylists => "/data/v_hot", Self::NewSongs => "/data/songlist" };
  let list = block.and_then(|v| v.pointer(path)).and_then(Value::as_array)
      .ok_or(err("upstream", "QQ 公开推荐列表格式异常"))?;
  let items: Vec<Value> = match self {
   Self::HotPlaylists => list.iter().filter_map(recommended_playlist).take(30).collect(),
   Self::NewSongs => list.iter().filter_map(|item| track(item).ok()).take(50).collect(),
  };
  Ok(json!({"items":items}))
 }

 async fn fetch(self) -> Result<Value> {
  let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(15))
      .redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never())
      .build().map_err(|_|err("network", "无法初始化 QQ 公开推荐请求"))?;
  let network_error = |e: reqwest::Error| {
   if e.is_timeout() {err("timeout", "QQ 公开推荐请求超时")}
   else {err("network", "无法读取 QQ 公开推荐")}
  };
  let mut response = self.request(&client).send().await.map_err(network_error)?;
  if !response.status().is_success() {return Err(err("upstream", "QQ 公开推荐请求失败"));}
  let too_large=||err("upstream", "QQ 公开推荐响应过大");
  if response.content_length().is_some_and(|n| n > MAX_RECOMMENDATION_BYTES as u64) {return Err(too_large());}
  let mut body = Vec::new();
  while let Some(chunk) = response.chunk().await.map_err(network_error)? {
   if chunk.len() > MAX_RECOMMENDATION_BYTES - body.len() {return Err(too_large());}
   body.extend_from_slice(&chunk);
  }
  let root=serde_json::from_slice(&body).map_err(|_|err("upstream", "QQ 公开推荐响应格式异常"))?;
  self.map(&root)
 }
}

fn recommended_playlist(item: &Value) -> Option<Value> {
 let content_id = item.get("content_id")?;
 let id = content_id.as_u64().or_else(|| {
  let value = content_id.as_str()?;
  value.bytes().all(|byte| byte.is_ascii_digit()).then(|| value.parse().ok()).flatten()
 }).filter(|&n| n > 0)?;
 let cover = item.get("cover").and_then(playlist_cover);
 let mut playlist = json!({"id":id.to_string(),"name":name(item,&["title"])?,"coverImgUrl":cover});
 if let Some(nickname) = name(item,&["username"]) {playlist["creator"] = json!({"nickname":nickname});}
 Some(playlist)
}

#[tauri::command]
pub(crate) async fn qq_recommended_playlists(caller: WebviewWindow) -> Result<Value> {
 main_only(&caller)?;
 Recommendation::HotPlaylists.fetch().await
}

#[tauri::command]
pub(crate) async fn qq_recommended_new_songs(caller: WebviewWindow) -> Result<Value> {
 main_only(&caller)?;
 Recommendation::NewSongs.fetch().await
}

#[cfg(test)] mod tests {
 use super::*;
 #[test] fn map_synthetic_created_collected_without_claiming_more(){let c=json!({"code":0,"data":{"disslist":[{"dissid":1,"diss_name":"合成创建"}]}});let f=json!({"code":0,"data":{"cdlist":[{"dissid":2,"dissname":"合成收藏"}]}});let x=map_playlists(c,f).unwrap();assert_eq!(x["playlist"].as_array().unwrap().len(),2);assert!(x["more"].is_null());}
 #[test] fn accepts_known_playlist_cover_fields_and_rejects_untrusted_hosts(){let c=json!({"code":0,"data":{"disslist":[{"dissid":1,"diss_name":"合成创建","diss_cover":"http://y.gtimg.cn/synthetic.jpg"}]}});let f=json!({"code":0,"data":{"cdlist":[{"dissid":2,"dissname":"合成收藏","logo":"https://y.gtimg.cn/other.jpg"},{"dissid":3,"dissname":"无效","logo":"https://attacker.invalid/image"}]}});let x=map_playlists(c,f).unwrap();assert_eq!(x["playlist"][0]["coverImgUrl"],"https://y.gtimg.cn/synthetic.jpg");assert_eq!(x["playlist"][1]["coverImgUrl"],"https://y.gtimg.cn/other.jpg");assert!(x["playlist"][2]["coverImgUrl"].is_null());}
 #[test] fn rejects_one_failed_side_and_malformed(){assert!(map_playlists(json!({"code":0,"data":{"disslist":[]}}),json!({"code":500})).is_err());assert!(map_playlists(json!({"code":0}),json!({"code":0,"data":{"cdlist":[]}})).is_err());}
 #[test] fn maps_tracks_and_preserves_unknown_pagination(){
  let song=json!({"mid":"ABC1","name":"合成歌曲","singer":[{"name":"合成歌手"}],"album":{"name":"合成专辑","mid":"ALB1"},"interval":120,"file":{"media_mid":"MED1"}});
  let paid=json!({"track_info":{"mid":"ABC2","name":"合成付费曲目","singer":[{"name":"合成歌手"}],"pay":{"pay_play":1}}});
  let mut free=song.clone();
  free["pay"]=json!({"pay_play":0});
  let x=map_tracks(json!({"code":0,"playlist":{"code":0,"data":{"songlist":[song,paid,free]}}})).unwrap();
  assert_eq!(x["songs"][0]["id"],"ABC1");
  assert_eq!(x["songs"][0]["duration"],120000);
  assert_eq!(x["songs"][0]["album"]["picUrl"],"https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg");
  assert_eq!(x["songs"][0]["vip"],false);
  assert_eq!(x["songs"][1]["vip"],true);
  assert_eq!(x["songs"][2]["vip"],false);
  assert!(x["hasMore"].is_null());
 }
 #[test] fn rejects_bad_business_or_missing_items(){assert!(map_tracks(json!({"code":0,"playlist":{"code":7,"data":{"songlist":[]}}})).is_err());assert!(map_tracks(json!({"code":0,"playlist":{"code":0,"data":{"songlist":[{"mid":"X"}]}}})).is_err());}

 #[test]
 fn public_recommendations_build_fixed_unsigned_requests_without_cookies() {
  let client=reqwest::Client::new();
  for (kind, block) in [
   (Recommendation::HotPlaylists, json!({"module":"playlist.HotRecommendServer","method":"get_hot_recommend","param":{"async":1,"cmd":2}})),
   (Recommendation::NewSongs, json!({"module":"newsong.NewSongServer","method":"get_new_song_info","param":{"type":5}})),
  ] {
   let request=kind.request(&client).build().unwrap();
   assert_eq!(request.url().as_str(), "https://u.y.qq.com/cgi-bin/musicu.fcg");
   assert_eq!(request.method(), reqwest::Method::POST);
   assert_eq!(request.headers()[reqwest::header::REFERER], "https://y.qq.com/");
   assert_eq!(request.headers()[reqwest::header::ORIGIN], "https://y.qq.com");
   assert!(!request.headers().contains_key(reqwest::header::COOKIE));
   assert!(!request.headers().contains_key(reqwest::header::AUTHORIZATION));
   let payload: Value=serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
   assert_eq!(payload,json!({"comm":{"ct":24,"cv":4747474,"platform":"yqq.json","format":"json"}, (kind.key()):block}));
  }
 }

 #[test]
 fn public_playlists_validate_ids_creators_and_cover_origins() {
  let root=json!({"code":0,"hot":{"code":0,"data":{"v_hot":[
   {"content_id":"0012","title":" 合成歌单 ","cover":"http://y.gtimg.cn/example.jpg","username":"合成用户"},
   {"content_id":13,"title":"无可信封面","cover":"https://y.gtimg.cn.attacker.invalid/example.jpg"},
   {"content_id":"-1","title":"不应出现"},
   {"content_id":0,"title":"不应出现"},
   {"content_id":14,"title":" "}
  ]}}});
  assert_eq!(Recommendation::HotPlaylists.map(&root).unwrap(),json!({"items":[
   {"id":"12","name":"合成歌单","coverImgUrl":"https://y.gtimg.cn/example.jpg","creator":{"nickname":"合成用户"}},
   {"id":"13","name":"无可信封面","coverImgUrl":null}
  ]}));
 }

 #[test]
 fn public_new_songs_reuse_catalog_metadata() {
  let root=json!({"code":0,"newsong":{"code":0,"data":{"songlist":[
   {"track_info":{"mid":"TRACK1","name":"合成新歌","singer":[{"name":"合成歌手"}],
    "album":{"name":"合成专辑","mid":"ALB1"},"file":{"media_mid":"MEDIA1"},"pay":{"pay_play":1},"interval":123}}
  ]}}});
  assert_eq!(Recommendation::NewSongs.map(&root).unwrap(),json!({"items":[
   {"id":"TRACK1","name":"合成新歌","artists":[{"name":"合成歌手"}],
    "album":{"name":"合成专辑","picUrl":"https://y.gtimg.cn/music/photo_new/T002R300x300M000ALB1.jpg"},
    "mediaMid":"MEDIA1","vip":true,"duration":123000}
  ]}));
 }

 #[test]
 fn public_recommendations_require_success_codes_and_list_shape() {
  for (kind, field) in [(Recommendation::HotPlaylists,"v_hot"),(Recommendation::NewSongs,"songlist")] {
   let key=kind.key();
   for invalid in [
    json!({"code":104003,(key):{"code":0,"data":{(field):[]}}}),
    json!({"code":0,(key):{"code":104009,"data":{(field):[]}}}),
    json!({"code":0,(key):{"data":{(field):[]}}}),
    json!({"code":0,(key):{"code":0,"data":{(field):{}}}}),
   ] {
    let failure=kind.map(&invalid).unwrap_err();
    assert_eq!(serde_json::to_value(failure).unwrap()["code"],"upstream");
   }
   assert_eq!(kind.map(&json!({"code":0,(key):{"code":0,"data":{(field):[]}}})).unwrap(),json!({"items":[]}));
  }
 }

 #[test]
 fn public_recommendations_truncate_after_filtering_invalid_rows() {
  let mut lists=vec![json!(null)];
  lists.extend((1..=31).map(|i|json!({"content_id":i,"title":"合成歌单"})));
  let mut songs=vec![json!(null)];
  songs.extend((1..=51).map(|i|json!({"mid":format!("TRACK{i}"),"name":"合成歌曲","singer":[{"name":"合成歌手"}]})));
  let lists=Recommendation::HotPlaylists.map(&json!({"code":0,"hot":{"code":0,"data":{"v_hot":lists}}})).unwrap();
  let songs=Recommendation::NewSongs.map(&json!({"code":0,"newsong":{"code":0,"data":{"songlist":songs}}})).unwrap();
  assert_eq!(lists["items"].as_array().unwrap().len(),30);
  assert_eq!(lists["items"][29]["id"],"30");
  assert_eq!(songs["items"].as_array().unwrap().len(),50);
  assert_eq!(songs["items"][49]["id"],"TRACK50");
 }
}
