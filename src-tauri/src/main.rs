#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod netease_recent;
mod window_state;
#[cfg(windows)]
mod desktop_shortcuts;
#[cfg(windows)]
mod desktop_lyric;
#[cfg(windows)]
mod local_library;
#[cfg(windows)]
mod local_media;
#[cfg(windows)]
mod background;
#[cfg(windows)]
mod window_dwm;
mod qq_login_offline;
#[cfg(windows)]
mod qq_web_auth;
#[cfg(test)]
#[allow(dead_code)]
mod qq_login;
#[cfg(test)]
mod qq_research;
mod qq_search_candidate;
#[cfg(windows)]
mod qq_catalog;
mod netease_recommendations;
mod netease_library;
mod playback_storage;
use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD, Engine};
use num_bigint::BigUint;
use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use serde_json::{json, Value};
use std::{future::Future, sync::Mutex, time::Duration};
use tauri::{State, Manager};

#[derive(Debug, Serialize)]
struct Error { #[serde(rename = "code")] kind: &'static str, message: &'static str }
type Result<T> = std::result::Result<T, Error>;
fn err(kind: &'static str, message: &'static str) -> Error { Error { kind, message } }
fn business_error(path: &str, code: i64) -> Error {
    match code {
        301 | 302 | 401 => err("auth", "登录状态已失效"),
        -460 => err("permission", "音乐服务认为当前网络存在风险"),
        403 => err("permission", "当前账号无权访问"),
        _ if path == "register/anonimous" => err("upstream", "游客播放暂不可用，请登录后重试"),
        _ => err("upstream", "音乐服务返回失败"),
    }
}
#[derive(Default)]
struct Session { cookie: Option<String>, anonymous: Option<String>, qr: Option<String>, generation: u64, storage_error: bool, account_id:Option<u64> }
struct App { client: reqwest::Client, session: Mutex<Session> }
fn entry() -> Result<keyring::Entry> { keyring::Entry::new("local.xianyu.music", "netease-session").map_err(|_|err("storage", "系统凭据存储不可用")) }
fn prepare_weapi_data(mut data: Value) -> Value {
    if data.get("csrf_token").is_none() { data["csrf_token"] = json!(""); }
    data
}
fn weapi(data: Value) -> Result<Vec<(String, String)>> {
    let text = serde_json::to_string(&prepare_weapi_data(data)).map_err(|_|err("upstream", "请求编码失败"))?;
    let secret: String = rand::thread_rng().sample_iter(&Alphanumeric).take(16).map(char::from).collect();
    let encrypt = |bytes: &[u8], key: &[u8]| -> String {
        let cipher = cbc::Encryptor::<aes::Aes128>::new_from_slices(key, b"0102030405060708").expect("fixed key size");
        STANDARD.encode(cipher.encrypt_padded_vec_mut::<Pkcs7>(bytes))
    };
    let first = encrypt(text.as_bytes(), b"0CoJUm6Qyw8W8jud");
    let params = encrypt(first.as_bytes(), secret.as_bytes());
    // Public WEAPI key from the MIT-licensed installed API package.
    let modulus = BigUint::parse_bytes(b"e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",16).ok_or(err("upstream", "请求加密失败"))?;
    let reversed: Vec<u8> = secret.bytes().rev().collect();
    let encrypted = BigUint::from_bytes_be(&reversed).modpow(&BigUint::from(65537u32), &modulus);
    Ok(vec![("params".into(), params), ("encSecKey".into(), format!("{encrypted:0>256x}"))])
}
fn anonymous_username(device: &str) -> String {
    let xor: Vec<u8> = device.bytes().zip(b"3go8&$8*3*3h0k(2)2".iter().cycle()).map(|(a,b)|a^b).collect();
    STANDARD.encode(format!("{device} {}",STANDARD.encode(md5::compute(xor).0)))
}
fn ensure_account_snapshot(state: &Session, cookie: Option<&str>) -> Result<()> {
    if state.cookie.as_deref() != cookie { Err(err("auth","账号已切换，请重试")) } else { Ok(()) }
}
fn ensure_generation(state: &Session, generation: u64) -> Result<()> {
    if state.generation != generation { Err(err("auth","账号已切换，请重试")) } else { Ok(()) }
}
async fn anonymous_url<D, DF, R, RF>(direct: D, register: R) -> Result<(Value, Option<String>)>
where D: FnOnce() -> DF, DF: Future<Output=Result<(Value, Option<String>)>>,
      R: FnOnce() -> RF, RF: Future<Output=Result<(Value, Option<String>)>> {
    match direct().await {
        Err(e) if e.kind == "auth" => register().await,
        other => other,
    }
}
impl App {
    fn cookie(&self) -> Result<Option<String>> { self.account_snapshot().map(|(cookie, _)| cookie) }
    fn account_snapshot(&self) -> Result<(Option<String>, u64)> {
        let state = self.session.lock().map_err(|_|err("storage", "会话不可用"))?;
        if state.storage_error { return Err(err("storage", "无法读取系统凭据")); }
        Ok((state.cookie.clone(), state.generation))
    }
    async fn request_raw(&self, path: &str, mut data: Value, cookie: Option<&str>, qr: bool) -> Result<(Value, Option<String>)> {
        if let Some(token)=cookie.and_then(|c|c.split(';').map(str::trim).find_map(|v|v.strip_prefix("__csrf="))) {data["csrf_token"]=json!(token);}
        let full_cookie=format!("{}; os=pc; appver=3.1.17.204416; channel=netease; __remember_me=true",cookie.unwrap_or(""));
        let mut req = self.client.post(format!("https://music.163.com/weapi/{path}"))
            .header("Referer", "https://music.163.com/")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36")
            .form(&weapi(data)?);
        if path != "register/anonimous" && !(path == "song/enhance/player/url/v1" && cookie.is_none()) { req = req.header("Cookie", full_cookie); }
        let res = req.send().await.map_err(|e| if e.is_timeout() {err("timeout","音乐服务请求超时")} else {err("network","无法连接音乐服务")})?;
        if !res.status().is_success() { return Err(err("upstream","音乐服务请求失败")); }
        let mut cookies = Vec::new();
        if qr {
            for value in res.headers().get_all(reqwest::header::SET_COOKIE) {
                if let Ok(line) = value.to_str() {
                    let pair = line.split(';').next().unwrap_or("");
                    if ["MUSIC_U=", "MUSIC_A=", "__csrf="].iter().any(|p| pair.starts_with(p)) && !pair.contains(['\r','\n']) { cookies.push(pair.to_string()); }
                }
            }
        }
        let value: Value = res.json().await.map_err(|_|err("upstream","音乐服务返回格式异常"))?;
        let code = value.get("code").and_then(Value::as_i64).ok_or(err("upstream","音乐服务返回缺少状态"))?;
        #[cfg(test)] if code != 200 && !(qr && (800..=803).contains(&code)) { eprintln!("upstream endpoint={path} code={code}"); }
        if code != 200 && !(qr && (800..=803).contains(&code)) {
            return Err(business_error(path, code));
        }
        Ok((value, if cookies.is_empty() { None } else { Some(cookies.join("; ")) }))
    }
    async fn request(&self, path: &str, data: Value, cookie: Option<&str>, qr: bool) -> Result<(Value, Option<String>)> {
        let generation={let state=self.session.lock().map_err(|_|err("storage","会话不可用"))?;
            if !path.starts_with("login/qrcode/") {ensure_account_snapshot(&state,cookie)?;} state.generation};
        let wants_anonymous = cookie.is_none() && path == "song/enhance/player/url/v1";
        if !wants_anonymous {
            let result=self.request_raw(path,data,cookie,qr).await?;
            if self.session.lock().map_err(|_|err("storage","会话不可用"))?.generation != generation {return Err(err("auth","账号或扫码状态已变化，请重试"));}
            return Ok(result);
        }
        let direct_data = data.clone();
        let result = anonymous_url(
            || self.request_raw(path, direct_data, None, qr),
            || async {
                if self.session.lock().map_err(|_|err("storage","会话不可用"))?.generation != generation {return Err(err("auth","账号已切换，请重试"));}
                let existing = self.session.lock().map_err(|_|err("storage","会话不可用"))?.anonymous.clone();
                let anonymous = if let Some(v) = existing { v } else {
                    let bytes: [u8; 26] = rand::random();
                    let device: String = bytes.iter().map(|b|format!("{b:02X}")).collect();
                    let username=anonymous_username(&device);
                    let (_, cookies)=self.request_raw("register/anonimous",json!({"username":username}),None,true).await?;
                    let token=cookies.and_then(|c| c.split("; ").find(|x| x.starts_with("MUSIC_A=") && x.len()>8).map(str::to_owned)).ok_or(err("upstream","游客播放暂不可用，请登录后重试"))?;
                    let mut state=self.session.lock().map_err(|_|err("storage","会话不可用"))?;
                    if state.generation != generation {return Err(err("auth","账号已切换，请重试"));}
                    state.anonymous=Some(token.clone());
                    token
                };
                self.request_raw(path,data,Some(&anonymous),qr).await
            }
        ).await?;
        let state=self.session.lock().map_err(|_|err("storage","会话不可用"))?;
        ensure_generation(&state,generation)?;
        Ok(result)
    }

}
fn valid_id(id: u64) -> Result<()> { if id == 0 || id > 9_007_199_254_740_991 {Err(err("validation","歌曲或歌单 ID 无效"))} else {Ok(())} }
/// 窗口以 visible:false 创建，由前端首帧绘制后调用本命令显示。
/// 显示与标题栏着色放在同一个调用栈里：隐藏窗口不会被 DWM 合成，属性要等窗口显示后才生效，
/// 先设一次、show 之后再设一次，把白标题栏压缩到不足一帧。
#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    #[cfg(windows)] if !background::may_reveal(&app){return;}
    #[cfg(windows)]
    window_dwm::apply_for(&window);
    let _ = window.show();
    // 镂空窗口图标只在显示后设置：隐藏窗口设置图标同样不生效。
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/window-icon.png")) {
        let _ = window.set_icon(icon);
    }
    #[cfg(windows)]
    window_dwm::apply_for(&window);
}
#[tauri::command]
async fn qq_search(query: String, page: u32, page_size: u32) -> Result<Value> {
    qq_search_candidate::search(&query, page, page_size).await.map(|(_, data)| data).map_err(qq_search_error)
}
fn qq_search_error(e: qq_search_candidate::SearchError) -> Error {
    let (kind, message) = qq_search_candidate::error_message(e);
    err(kind, message)
}
#[tauri::command]
async fn netease_search(app: State<'_, App>, query: String, offset: Option<Value>, search_type: Option<Value>) -> Result<Value> {
    let payload = netease_search_payload(&query, offset.as_ref(), search_type.as_ref())?;
    Ok(app.request("cloudsearch/pc", payload, app.cookie()?.as_deref(), false).await?.0)
}
fn netease_search_payload(query: &str, offset: Option<&Value>, search_type: Option<&Value>) -> Result<Value> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return Err(err("validation", "搜索内容无效"));
    }
    let offset = match offset {
        None => 0,
        Some(value) => value.as_u64().filter(|offset| *offset <= 1000).ok_or(err("validation", "搜索偏移须为 0 到 1000 的整数"))?,
    };
    let search_type = match search_type {
        None => 1,
        Some(value) => value.as_u64().filter(|kind| matches!(kind, 1 | 10 | 100 | 1000)).ok_or(err("validation", "搜索类型无效"))?,
    };
    Ok(json!({"s":query,"type":search_type,"limit":40,"offset":offset,"total":true}))
}
#[tauri::command]
async fn netease_lyric(app: State<'_, App>, id: u64) -> Result<Value> { valid_id(id)?; Ok(app.request("song/lyric",json!({"id":id,"tv":-1,"lv":-1,"rv":-1,"kv":-1,"_nmclfl":1}),app.cookie()?.as_deref(),false).await?.0) }
#[tauri::command]
async fn netease_url(app: State<'_, App>, id: u64, level: Option<Value>) -> Result<Value> {
    valid_id(id)?;
    let level = netease_playback_level(level.as_ref())?;
    let (cookie, generation) = app.account_snapshot()?;
    let request = |level| app.request("song/enhance/player/url/v1", json!({
        "ids":format!("[{id}]"), "level":level, "encodeType":"flac"
    }), cookie.as_deref(), false);
    let (response, _) = request(level).await?;
    if level != "standard" && netease_should_fallback(&response) {
        {
            let state = app.session.lock().map_err(|_|err("storage", "会话不可用"))?;
            ensure_generation(&state, generation)?;
        }
        return Ok(request("standard").await?.0);
    }
    // Preserve actual upstream level/br and freeTrialInfo on each track.
    Ok(response)
}
fn netease_playback_level(level: Option<&Value>) -> Result<&str> {
    match level {
        None => Ok("standard"),
        Some(value) => value.as_str()
            .filter(|level| matches!(*level, "standard" | "exhigh" | "lossless" | "hires"))
            .ok_or(err("validation", "音质档位无效")),
    }
}
fn netease_should_fallback(response: &Value) -> bool {
    response.pointer("/data/0").is_some_and(|track| {
        track.is_object() && (track.get("url").is_some_and(Value::is_null)
            || track.get("url").and_then(Value::as_str).is_some_and(|url| url.trim().is_empty()))
    })
}
#[tauri::command]
async fn netease_qr_start(app: State<'_, App>) -> Result<Value> {
    let generation = { let mut s=app.session.lock().map_err(|_|err("storage","会话不可用"))?; s.generation+=1; s.qr=None; s.generation };
    let data=app.request("login/qrcode/unikey",json!({"type":3}),None,false).await?.0;
    let key=data.get("unikey").and_then(Value::as_str).filter(|v| v.len()<=128 && v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')).ok_or(err("upstream","二维码生成失败"))?.to_owned();
    let qr=qrcode::QrCode::new(format!("https://music.163.com/login?codekey={key}")).map_err(|_|err("upstream","二维码生成失败"))?;
    let svg=qr.render::<qrcode::render::svg::Color>().min_dimensions(240,240).build();
    let mut s=app.session.lock().map_err(|_|err("storage","会话不可用"))?;
    if s.generation != generation {return Err(err("validation","扫码已取消"));} s.qr=Some(key);
    Ok(json!({"image":format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg))}))
}
#[tauri::command]
async fn netease_qr_cancel(app: State<'_, App>) -> Result<()> { let mut s=app.session.lock().map_err(|_|err("storage","会话不可用"))?; s.generation+=1; s.qr=None; Ok(()) }
#[tauri::command]
async fn netease_qr_check(app: State<'_, App>) -> Result<Value> {
    let (key,generation)={let s=app.session.lock().map_err(|_|err("storage","会话不可用"))?;(s.qr.clone().ok_or(err("validation","请先获取二维码"))?,s.generation)};
    let (data,cookie)=app.request("login/qrcode/client/login",json!({"key":key,"type":3}),None,true).await?;
    let code=data["code"].as_i64().unwrap_or(0);
    if code != 803 {return Ok(json!({"code":code}));}
    let cookie=cookie.filter(|c| c.split("; ").any(|v| v.starts_with("MUSIC_U=") && v.len()>8)).ok_or(err("auth","登录未返回有效凭据"))?;
    let profile=app.request_raw("nuser/account/get",json!({}),Some(&cookie),false).await?.0.get("profile").filter(|p| !p.is_null()).cloned().ok_or(err("auth","无法读取登录资料"))?;
    let mut s=app.session.lock().map_err(|_|err("storage","会话不可用"))?;
    if s.generation != generation || s.qr.as_deref()!=Some(&key) {return Err(err("validation","扫码已取消"));}
    entry()?.set_password(&cookie).map_err(|_|err("storage","无法安全保存登录凭据"))?;
    s.cookie=Some(cookie);s.account_id=None;s.storage_error=false;s.qr=None;s.generation+=1;
    Ok(json!({"code":803,"profile":profile}))
}
#[tauri::command]
async fn netease_account(app: State<'_, App>) -> Result<Value> {
    let cookie=app.cookie()?; let Some(cookie)=cookie else {return Ok(json!({"profile":null}));};
    let generation=app.session.lock().map_err(|_|err("storage","会话不可用"))?.generation;
    let data=app.request("nuser/account/get",json!({}),Some(&cookie),false).await?.0;
    let profile=data.get("profile").filter(|v| !v.is_null()).ok_or(err("auth","登录状态已失效"))?;
    let id=profile.get("userId").and_then(Value::as_u64).ok_or(err("upstream","账号资料不完整"))?;
    {let mut state=app.session.lock().map_err(|_|err("storage","会话不可用"))?;ensure_generation(&state,generation)?;ensure_account_snapshot(&state,Some(&cookie))?;state.account_id=Some(id);}
    Ok(json!({"profile":profile}))
}
#[tauri::command]
async fn netease_playlists(app: State<'_, App>) -> Result<Value> {
    let cookie=app.cookie()?.ok_or(err("auth","请先登录"))?;
    let account=app.request("nuser/account/get",json!({}),Some(&cookie),false).await?.0;
    let uid=account.pointer("/profile/userId").and_then(Value::as_u64).ok_or(err("auth","登录状态已失效"))?;
    Ok(app.request("user/playlist",json!({"uid":uid,"limit":100,"offset":0,"includeVideo":true}),Some(&cookie),false).await?.0)
}
fn playlist_page_ids(ids:&[Value],page:u32)->Result<Vec<Value>>{
    if !(1..=10000).contains(&page){return Err(err("validation","歌单页码无效"));}
    Ok(ids.iter().skip((page as usize-1)*100).take(100).map(|v|v.get("id").and_then(Value::as_u64).map(|id|json!({"id":id})).ok_or(err("upstream","歌单曲目数据异常"))).collect::<Result<Vec<_>>>()?)
}
#[tauri::command]
async fn netease_playlist(app: State<'_, App>, id: u64, page: Option<u32>) -> Result<Value> {
    valid_id(id)?;let page=page.unwrap_or(1);if !(1..=10000).contains(&page){return Err(err("validation","歌单页码无效"));} let cookie=app.cookie()?;
    let detail=app.request("v6/playlist/detail",json!({"id":id,"n":100000,"s":8}),cookie.as_deref(),false).await?.0;
    let ids=detail.pointer("/playlist/trackIds").and_then(Value::as_array).ok_or(err("upstream","歌单数据不完整或无权访问"))?;
    let playlist=json!({"name":detail.pointer("/playlist/name"),"coverImgUrl":detail.pointer("/playlist/coverImgUrl"),"creator":detail.pointer("/playlist/creator/nickname")});
    let total=ids.len();let offset=(page as usize-1)*100; let selected=playlist_page_ids(ids,page)?;
    if selected.is_empty() {return Ok(json!({"songs":[],"total":total,"hasMore":false,"page":page,"playlist":playlist}));}
    let data=app.request("v3/song/detail",json!({"c":serde_json::to_string(&selected).map_err(|_|err("upstream","歌单数据异常"))?}),cookie.as_deref(),false).await?.0;
    let songs=data.get("songs").and_then(Value::as_array).ok_or(err("upstream","歌单歌曲数据不完整"))?;
    Ok(json!({"songs":songs,"total":total,"hasMore":total>offset+selected.len(),"page":page,"playlist":playlist}))
}
#[tauri::command]
async fn netease_logout(app: State<'_, App>) -> Result<Value> {
    let mut s=app.session.lock().map_err(|_|err("storage","会话不可用"))?;
    match entry()?.delete_credential() {Ok(())|Err(keyring::Error::NoEntry)=>{}, Err(_)=>return Err(err("storage","无法删除系统凭据"))};
    s.generation+=1; s.qr=None; s.storage_error=false; s.cookie=None;s.account_id=None;
    Ok(json!({"localCleared":true,"remoteRevoked":false}))
}
fn main() {
    let cookie=entry().and_then(|e| match e.get_password() {Ok(v)=>Ok(Some(v)),Err(keyring::Error::NoEntry)=>Ok(None),Err(_)=>Err(err("storage","无法读取系统凭据"))});
    let (cookie, storage_error) = match cookie {Ok(c)=>(c,false),Err(_)=>(None,true)};
    let client=reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().expect("HTTP client");
    tauri::Builder::default().setup(|app|{window_state::install(app);#[cfg(windows)]local_library::install(app.handle());#[cfg(windows)]background::install(app);#[cfg(windows)]desktop_shortcuts::install(app);#[cfg(windows)]window_dwm::install(app);if let Some(window)=app.get_webview_window("main"){if let Ok(icon)=tauri::image::Image::from_bytes(include_bytes!("../icons/window-icon.png")){let _=window.set_icon(icon);}}if let Some(window)=app.get_webview_window("main"){let fallback=window.clone();std::thread::spawn(move||{std::thread::sleep(Duration::from_secs(4));#[cfg(windows)]if !background::may_reveal(fallback.app_handle()){return;}#[cfg(windows)]window_dwm::apply_for(&fallback);let _=fallback.show();#[cfg(windows)]window_dwm::apply_for(&fallback);});}Ok(())}).register_asynchronous_uri_scheme_protocol("prismmedia", |ctx, request, responder| {
        if ctx.webview_label() != "main" || request.method() != tauri::http::Method::GET {
            responder.respond(tauri::http::Response::builder().status(403).body(Vec::new()).unwrap()); return;
        }
        let app=ctx.app_handle().clone(); let handle=request.uri().path().trim_start_matches('/').to_owned();
        let range=request.headers().get(tauri::http::header::RANGE).and_then(|v|v.to_str().ok()).map(str::to_owned);
        tauri::async_runtime::spawn(async move {
            let state=app.state::<qq_web_auth::QqWebAuth>();
            let result=qq_web_auth::stream_chunk(&state,&handle,range.as_deref()).await;
            responder.respond(result.unwrap_or_else(|_|tauri::http::Response::builder().status(403).body(Vec::new()).unwrap()));
        });
    }).register_asynchronous_uri_scheme_protocol("prismlocal", local_library::protocol).manage(qq_web_auth::QqWebAuth::new()).manage(App{client,session:Mutex::new(Session{cookie,storage_error,..Default::default()})}).invoke_handler(tauri::generate_handler![reveal_main_window,local_library::local_library_folders_get,local_library::local_library_folder_pick,local_library::local_library_folder_remove,local_library::local_library_scan,local_library::local_library_tracks_get,local_library::local_track_resolve,local_library::local_track_lyric,local_library::local_queue_get,local_library::local_queue_set,desktop_shortcuts::global_shortcuts_get,desktop_shortcuts::global_shortcuts_set,desktop_lyric::desktop_lyric_get,desktop_lyric::desktop_lyric_set,desktop_lyric::desktop_lyric_update,background::close_behavior_get,background::close_behavior_set,background::close_behavior_finish_exit,qq_web_auth::qq_web_login_open,qq_web_auth::qq_web_login_complete,qq_web_auth::qq_web_login_cancel,qq_web_auth::qq_web_account,qq_web_auth::qq_web_logout,qq_web_auth::qq_web_playlists,qq_web_auth::qq_web_playlist_tracks,qq_web_auth::qq_web_resolve,qq_web_auth::qq_web_restore_previous,qq_web_auth::qq_playback_diagnostic,qq_web_auth::qq_web_lyric,netease_recent::netease_recent_get,netease_recent::netease_recent_add,netease_recent::netease_recent_clear,playback_storage::playback_state_load,playback_storage::playback_state_save,qq_search,netease_search,netease_lyric,netease_url,netease_library::netease_like,netease_library::netease_likelist,netease_library::netease_fm_trash,netease_library::netease_playlist_tracks_op,netease_qr_start,netease_qr_check,netease_qr_cancel,netease_account,netease_playlists,netease_playlist,netease_logout,netease_recommendations::netease_daily_songs,netease_recommendations::netease_recommended_resources,netease_recommendations::netease_personalized_playlists,netease_recommendations::netease_recommended_new_songs,netease_recommendations::netease_private_fm]).run(tauri::generate_context!()).expect("运行失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn playlist_pages_are_bounded_and_validate_ids(){let ids:Vec<Value>=(1..=250).map(|id|json!({"id":id})).collect();assert_eq!(playlist_page_ids(&ids,1).unwrap().len(),100);assert_eq!(playlist_page_ids(&ids,3).unwrap().len(),50);assert!(playlist_page_ids(&ids,0).is_err());assert!(playlist_page_ids(&[json!({})],1).is_err());}
    #[test]
    fn netease_p1_search_validates_bounds_and_preserves_defaults() {
        assert_eq!(netease_search_payload("  合成  ", None, None).unwrap(),
            json!({"s":"合成","type":1,"limit":40,"offset":0,"total":true}));
        for kind in [1, 10, 100, 1000] {
            let payload = netease_search_payload("合成", Some(&json!(1000)), Some(&json!(kind))).unwrap();
            assert_eq!((payload["offset"].as_u64(), payload["type"].as_i64()), (Some(1000), Some(kind)));
        }
        for invalid in [json!(-1), json!(1001), json!(1.5), json!("40")] {
            assert_eq!(netease_search_payload("合成", Some(&invalid), None).unwrap_err().kind, "validation");
        }
        let error = netease_search_payload("合成", None, Some(&json!(1002))).unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap(), json!({"code":"validation","message":"搜索类型无效"}));
    }
    #[test]
    fn netease_p1_playback_preserves_trial_and_actual_quality() {
        assert_eq!(netease_playback_level(None).unwrap(), "standard");
        for level in ["standard", "exhigh", "lossless", "hires"] {
            assert_eq!(netease_playback_level(Some(&json!(level))).unwrap(), level);
        }
        assert_eq!(netease_playback_level(Some(&json!("vip"))).unwrap_err().kind, "validation");
        let trial = json!({"data":[{"url":"https://example.invalid/trial","level":"standard","br":128000,"freeTrialInfo":{"start":0,"end":30}}]});
        assert!(!netease_should_fallback(&trial));
        assert!(netease_should_fallback(&json!({"data":[{"url":null,"code":404}]})));
        assert!(!netease_should_fallback(&json!({"data":null})));
    }
    #[test]
    fn input_and_encryption_contract() {
        let registration = business_error("register/anonimous", 400);
        assert_eq!((registration.kind, registration.message), ("upstream", "游客播放暂不可用，请登录后重试"));
        assert_eq!(business_error("register/anonimous", 403).kind, "permission");
        assert_eq!(business_error("register/anonimous", -460).kind, "permission");
        assert_eq!(business_error("song/lyric", 400).message, "音乐服务返回失败");
        assert_eq!(anonymous_username("0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123"), "MDEyMzQ1Njc4OUFCQ0RFRjAxMjM0NTY3ODlBQkNERUYwMTIzNDU2Nzg5QUJDREVGMDEyMyBYa2pIc2o5dnlXcTVRNDdCdXYyVWNnPT0=");
        assert_eq!(prepare_weapi_data(json!({"csrf_token":"csrf-test"}))["csrf_token"],"csrf-test");
        assert_eq!(prepare_weapi_data(json!({}))["csrf_token"],"");
        let mut session=Session::default();
        assert!(ensure_account_snapshot(&session,None).is_ok());
        session.cookie=Some("account-a".into());
        assert!(ensure_account_snapshot(&session,None).is_err());
        assert!(ensure_account_snapshot(&session,Some("account-a")).is_ok());
        session.cookie=Some("account-b".into());
        assert!(ensure_account_snapshot(&session,Some("account-a")).is_err());
        session.cookie=None;
        assert!(ensure_account_snapshot(&session,Some("account-b")).is_err());
        let generation = session.generation;
        assert!(ensure_generation(&session,generation).is_ok());
        session.generation += 1;
        assert!(ensure_generation(&session,generation).is_err());
        assert!(valid_id(0).is_err());
        assert!(valid_id(186016).is_ok());
        let form=weapi(json!({"test":"value"})).unwrap();
        assert_eq!(form[1].1.len(),256);
        assert!(!form[0].1.contains("value"));
    }
    #[test]
    fn anonymous_url_preserves_results_and_only_registers_for_auth() {
        use std::cell::Cell;
        tauri::async_runtime::block_on(async {
            for response in [
                json!({"code":200,"data":[{"code":200,"url":"https://example.invalid/audio","fee":0,"freeTrialInfo":null}]}),
                json!({"code":200,"data":[{"code":200,"url":"https://example.invalid/trial","fee":1,"freeTrialInfo":{"start":0,"end":30}}]}),
                json!({"code":200,"data":[{"code":403,"url":null,"fee":1,"freeTrialInfo":null}]}),
            ] {
                let calls=Cell::new(0);
                let expected=response.clone();
                let result=anonymous_url(|| async { Ok((response,None)) }, || async {calls.set(calls.get()+1); Err(err("upstream","registration should not run"))}).await.unwrap();
                assert_eq!(result.0,expected);
                assert_eq!(calls.get(),0);
            }
            for kind in ["network","timeout","permission","upstream"] {
                let calls=Cell::new(0);
                let result=anonymous_url(|| async {Err(err(kind,"failure"))},|| async {calls.set(calls.get()+1);Ok((json!({}),None))}).await;
                assert_eq!(result.unwrap_err().kind,kind);
                assert_eq!(calls.get(),0);
            }
            let calls=Cell::new(0);
            let result=anonymous_url(|| async {Err(err("auth","login required"))},|| async {calls.set(calls.get()+1);Err(business_error("register/anonimous",400))}).await;
            assert_eq!(calls.get(),1);
            assert_eq!(result.unwrap_err().message,"游客播放暂不可用，请登录后重试");
        });
    }
    fn anonymous_app() -> App {
        App { client:reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().unwrap(), session:Mutex::new(Session::default()) }
    }
    #[test]
    #[ignore = "requires network; anonymous read-only"]
    fn anonymous_search() {
        tauri::async_runtime::block_on(async {
            let app=anonymous_app();
            let result=app.request("cloudsearch/pc",json!({"s":"海阔天空","type":1,"limit":3,"offset":0,"total":true}),None,false).await.unwrap().0;
            let songs=result.pointer("/result/songs").and_then(Value::as_array).unwrap();
            assert!(!songs.is_empty());
            println!("anonymous search count={}",songs.len());
        });
    }
    #[test]
    #[ignore = "requires network; anonymous read-only"]
    fn anonymous_lyric() {
        tauri::async_runtime::block_on(async {
            let app=anonymous_app();
            let lyric=app.request("song/lyric",json!({"id":347230,"tv":-1,"lv":-1,"rv":-1,"kv":-1,"_nmclfl":1}),None,false).await.unwrap().0;
            assert!(lyric.get("lrc").is_some() || lyric.get("nolyric").is_some() || lyric.get("uncollected").is_some());
            println!("anonymous lyric response=true");
        });
    }
    #[test]
    #[ignore = "requires network; anonymous read-only"]
    fn anonymous_qr() {
        tauri::async_runtime::block_on(async {
            let app=anonymous_app();
            let key=app.request("login/qrcode/unikey",json!({"type":3}),None,false).await.unwrap().0;
            let code=key["unikey"].as_str().filter(|k| k.len() <= 128 && k.bytes().all(|b|b.is_ascii_alphanumeric() || b==b'-' || b==b'_')).expect("usable QR key");
            let status=app.request("login/qrcode/client/login",json!({"key":code,"type":3}),None,true).await.unwrap().0;
            assert!([800,801,802].contains(&status["code"].as_i64().unwrap_or(0)));
            println!("qr_key=true poll_status={}",status["code"]);
        });
    }
    #[test]
    #[ignore = "requires network; anonymous read-only"]
    fn anonymous_media() {
        tauri::async_runtime::block_on(async {
            let app=anonymous_app();
            let url=app.request("song/enhance/player/url/v1",json!({"ids":"[29722242]","level":"standard","encodeType":"flac"}),None,false).await.unwrap().0;
            assert_eq!(url.pointer("/data/0/code").and_then(Value::as_i64),Some(200));
            assert_eq!(url.pointer("/data/0/fee").and_then(Value::as_i64),Some(0));
            assert!(url.pointer("/data/0/freeTrialInfo").is_some_and(Value::is_null));
            let media=url.pointer("/data/0/url").and_then(Value::as_str).expect("sample must have a playable URL");
            let response=app.client.get(media).header("Range","bytes=0-4095").send().await.expect("media request");
            assert_eq!(response.status().as_u16(),206);
            let media_type=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).unwrap_or("");
            println!("song_url_present=true media_status={} type={}",response.status(),media_type);
            assert!(media_type.starts_with("audio/") || media_type.starts_with("application/octet-stream"));
        });
    }
}
