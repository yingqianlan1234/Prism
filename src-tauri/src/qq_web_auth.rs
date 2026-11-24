//! User-operated, isolated QQ web session. Sensitive session data stays in Rust.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
use windows::{core::Interface, core::BOOL};

use crate::{err, Result};
use crate::qq_login_offline::{Credential, CredentialStore, WindowsStore};

const LABEL: &str = "qq-auth";
const PROFILE_URL: &str = "https://y.qq.com/n/ryqq_v2/profile";
const COOKIE_URL: &str = "https://y.qq.com/";
const API_URL: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const MAX_BODY: usize = 1024 * 1024;

#[derive(Default)]
struct Inner { generation: u64, directory: Option<PathBuf>, completing: bool, stream: Option<Stream>, candidate:Option<Stream>, previous:Option<Stream>, diagnostic: Option<PlaybackDiagnostic>, diagnostic_revision:u64, resolve_revision:u64, resolve_status:ResolveStatus }
#[derive(Clone,Copy,PartialEq,Eq,Default)]
enum ResolveStatus {#[default] Idle,Pending,Failed,Succeeded}
struct ResolveGuard {inner:Arc<Mutex<Inner>>,revision:u64}
impl Drop for ResolveGuard {fn drop(&mut self){if let Ok(mut inner)=self.inner.lock(){if inner.resolve_revision==self.revision&&inner.resolve_status==ResolveStatus::Pending{inner.resolve_status=ResolveStatus::Failed;}}}}
#[derive(Default, serde::Serialize)]
struct PlaybackDiagnostic {
    stage: &'static str,
    session_fields: bool,
    session_expiry: &'static str,
    session_validity: &'static str,
    upstream_identity_match: &'static str,
    uses_login: bool,
    media_mid_present: bool,
    media_mid_matches_song_mid: Option<bool>,
    request_complete: bool,
    top_code: Option<i64>,
    module_code: Option<i64>,
    business_code: Option<i64>,
    valid_url: bool,
    generation_match: Option<bool>,
    failure: Option<&'static str>,
}
#[derive(Clone)]
struct Stream { handle:String, url:String, mime:&'static str, generation:u64, expires:Instant, diagnostic_revision:u64, resolve_revision:u64 }

pub struct QqWebAuth {
    inner: Arc<Mutex<Inner>>,
    client: reqwest::Client,
    cleanup_failed: Arc<AtomicBool>,
}

impl QqWebAuth {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            cleanup_failed: Arc::new(AtomicBool::new(false)),
            client: reqwest::Client::builder().timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never())
                .build().expect("QQ HTTP client"),
        }
    }
}

pub(crate) fn main_only(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" { Ok(()) } else { Err(err("permission", "仅主窗口可以操作 QQ 会话")) }
}

fn update_diagnostic_for(state:&QqWebAuth, revision:u64, f:impl FnOnce(&mut PlaybackDiagnostic)) {
    if let Ok(mut inner)=state.inner.lock() { if inner.diagnostic_revision==revision { if let Some(d)=inner.diagnostic.as_mut() { f(d); } } }
}
fn install_stream(inner:&mut Inner,generation:u64,revision:u64,stream:Stream)->Result<()> {
    if inner.generation!=generation||inner.resolve_revision!=revision {return Err(err("cancelled","QQ 播放请求已过期"));}
    inner.candidate=Some(stream);Ok(())
}
#[derive(Clone,Copy)]
enum StreamSlot { Active, Candidate, Previous }
fn acquire_stream(inner:&Inner,handle:&str)->Result<(Stream,StreamSlot)>{
    [(inner.stream.as_ref(),StreamSlot::Active),(inner.candidate.as_ref(),StreamSlot::Candidate),(inner.previous.as_ref(),StreamSlot::Previous)].into_iter().find_map(|(s,slot)|s.filter(|x|x.handle==handle&&x.generation==inner.generation&&x.expires>Instant::now()).map(|x|(x.clone(),slot))).ok_or(err("auth","音频会话已过期"))
}
fn accept_stream(inner:&mut Inner,handle:&str,observed:StreamSlot)->Result<()> {
    let (_,current)=acquire_stream(inner,handle)?;
    match (observed,current) {
        (StreamSlot::Active,StreamSlot::Active)|(StreamSlot::Candidate,StreamSlot::Active)|(StreamSlot::Previous,StreamSlot::Active)=>Ok(()),
        (StreamSlot::Candidate,StreamSlot::Candidate)=>{inner.previous=inner.stream.take();inner.stream=inner.candidate.take();Ok(())},
        (StreamSlot::Previous,StreamSlot::Previous)=>Ok(()),
        _=>Err(err("cancelled","QQ 音频请求已过期")),
    }
}
fn restore_previous(inner:&mut Inner,current:&str,previous:&str)->Result<()> {
    let valid=|s:&Stream|s.generation==inner.generation&&s.expires>Instant::now();
    let latest=|s:&Stream|s.resolve_revision==inner.resolve_revision||(inner.resolve_status==ResolveStatus::Failed&&s.resolve_revision<inner.resolve_revision);
    if inner.candidate.as_ref().is_some_and(|s|s.handle==current&&latest(s)&&valid(s)) && inner.previous.as_ref().is_some_and(|s|s.handle==previous&&valid(s)) && inner.stream.as_ref().is_some_and(|s|s.generation==inner.generation) {
        inner.candidate=None;std::mem::swap(&mut inner.stream,&mut inner.previous);return Ok(());
    }
    if inner.stream.as_ref().is_some_and(|s|s.handle==previous&&valid(s)) && inner.candidate.as_ref().is_some_and(|s|s.handle==current&&latest(s)&&valid(s)) {
        inner.candidate=None;return Ok(());
    }
    if inner.stream.as_ref().is_some_and(|s|s.handle==current&&latest(s)&&valid(s)) && inner.previous.as_ref().is_some_and(|s|s.handle==previous&&valid(s)) {
        std::mem::swap(&mut inner.stream,&mut inner.previous);return Ok(());
    }
    Err(err("cancelled","QQ 上一音频会话不可恢复"))
}
#[tauri::command]
pub fn qq_web_restore_previous(caller:WebviewWindow,state:State<'_,QqWebAuth>,current_handle:String,previous_handle:String)->Result<Value>{
    main_only(&caller)?;
    if current_handle.len()!=40||previous_handle.len()!=40||!valid_mid(&current_handle)||!valid_mid(&previous_handle){return Err(err("validation","音频会话无效"));}
    let mut inner=state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?;
    restore_previous(&mut inner,&current_handle,&previous_handle)?;Ok(json!({"restored":true}))
}

#[tauri::command]
pub fn qq_playback_diagnostic(caller:WebviewWindow,state:State<'_,QqWebAuth>,enabled:Option<bool>)->Result<Value>{
    main_only(&caller)?;
    let mut inner=state.inner.lock().map_err(|_|err("storage","QQ 诊断不可用"))?;
    if let Some(on)=enabled {
        inner.diagnostic_revision=inner.diagnostic_revision.wrapping_add(1);
        inner.diagnostic=if on {Some(PlaybackDiagnostic{stage:"等待播放",session_expiry:"未知",session_validity:"未检查",upstream_identity_match:"未知",..Default::default()})} else {None};
    }
    Ok(json!({"enabled":inner.diagnostic.is_some(),"diagnostic":inner.diagnostic}))
}

// Only known QQ page origins are eligible for top-level navigation; subresources remain browser-managed.
fn allowed_navigation(url: &tauri::Url) -> bool {
    if url.scheme() != "https" || url.port_or_known_default() != Some(443)
        || !url.username().is_empty() || url.password().is_some()
    { return false; }
    match url.host_str() {
        Some("y.qq.com") => url.path().starts_with("/n/ryqq/")
            || url.path().starts_with("/n/ryqq_v2/")
            || url.path() == "/portal/wx_redirect.html",
        Some("graph.qq.com") => matches!(url.path(), "/oauth2.0/show" | "/oauth2.0/authorize" | "/oauth2.0/login_jump"),
        Some("xui.ptlogin2.qq.com") => url.path() == "/cgi-bin/xlogin",
        Some("ssl.ptlogin2.qq.com") => matches!(url.path(), "/ptqrshow" | "/ptqrlogin" | "/check_sig"),
        Some("ssl.ptlogin2.graph.qq.com") => url.path() == "/check_sig",
        _ => false,
    }
}

fn safe_cookie_value(v: &str) -> bool {
    !v.is_empty() && v.len() <= 2048
        && v.bytes().all(|b| b.is_ascii_graphic() && b != b';' && b != b',' && b != b'"')
}

// QQ-only prototype: conflicting aliases fail closed instead of guessing an identity.
fn select_session(items: impl IntoIterator<Item = (String, String)>) -> Result<(String, String)> {
    let mut values = BTreeMap::<String, String>::new();
    for (name, value) in items {
        if !matches!(name.as_str(), "uin" | "qqmusic_uin" | "qm_keyst" | "qqmusic_key" | "music_key") {
            continue;
        }
        if !safe_cookie_value(&value) { return Err(err("auth", "QQ 会话数据无效")); }
        if values.get(&name).is_some_and(|old| old != &value) { return Err(err("auth", "QQ 会话存在冲突")); }
        values.insert(name, value);
    }
    let mut accounts = values.iter().filter(|(k, _)| matches!(k.as_str(), "uin" | "qqmusic_uin"))
        .map(|(_, value)| value.trim_start_matches('o').trim_start_matches('0').to_string());
    let account = accounts.next().filter(|v| !v.is_empty() && v.len() <= 20 && v.bytes().all(|b| b.is_ascii_digit()))
        .ok_or(err("auth", "请在 QQ 音乐页面完成登录"))?;
    if accounts.any(|v| v != account) { return Err(err("auth", "QQ 账号会话存在冲突")); }
    let mut keys = values.iter().filter(|(k, _)| matches!(k.as_str(), "qm_keyst" | "qqmusic_key" | "music_key"))
        .map(|(_, value)| value.as_str());
    let key = keys.next().ok_or(err("auth", "QQ 音乐会话尚未就绪"))?;
    if keys.any(|v| v != key) { return Err(err("auth", "QQ 音乐会话存在冲突")); }
    Ok((account, key.to_string()))
}

fn profile_data(data: Value, account: &str) -> Result<Value> {
    if data.get("code").and_then(Value::as_i64) != Some(0)
        || data.pointer("/req_0/code").and_then(Value::as_i64) != Some(0)
    { return Err(err("auth", "QQ 音乐资料验证失败或登录已过期")); }
    let name = data.pointer("/req_0/data/info/nick")
        .or_else(|| data.pointer("/req_0/data/nickname"))
        .and_then(Value::as_str).filter(|s| !s.trim().is_empty())
        .ok_or(err("upstream", "QQ 音乐账号资料不完整"))?;
    Ok(json!({"userId":account,"nickname":name}))
}

fn hash33(s: &str) -> u32 {
    s.bytes().fold(5381_u32, |h, b| h.wrapping_mul(33).wrapping_add(b as u32)) & 0x7fff_ffff
}

async fn profile(client: &reqwest::Client, account: &str, key: &str) -> Result<Value> {
    let gtk = hash33(key);
    let request = json!({
        "comm":{"ct":24,"cv":4747474,"platform":"yqq.json","uin":account,"authst":key,"g_tk":gtk,"g_tk_new_20200303":gtk,"format":"json"},
        "req_0":{"module":"music.UserInfo.userInfoServer","method":"GetLoginUserInfo","param":{}}
    });
    let cookie = format!("uin={account}; qqmusic_uin={account}; qm_keyst={key}; qqmusic_key={key}");
    let mut response = client.post(API_URL).header("Referer", "https://y.qq.com/")
        .header("Cookie", cookie).json(&request).send().await.map_err(|e| {
            if e.is_timeout() { err("timeout", "QQ 资料验证超时") } else { err("network", "无法连接 QQ 音乐") }
        })?;
    if !response.status().is_success() { return Err(err("upstream", "QQ 资料请求失败")); }
    if response.content_length().is_some_and(|n| n > MAX_BODY as u64) {
        return Err(err("upstream", "QQ 资料响应过大"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| err("network", "QQ 资料读取失败"))? {
        if chunk.len() > MAX_BODY - body.len() { return Err(err("upstream", "QQ 资料响应过大")); }
        body.extend_from_slice(&chunk);
    }
    let data = serde_json::from_slice(&body).map_err(|_| err("upstream", "QQ 资料格式异常"))?;
    profile_data(data, account)
}

fn new_profile_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app.path().app_local_data_dir().map_err(|_| err("storage", "无法创建授权隔离目录"))?;
    let root = base.join("qq-auth-transient");
    std::fs::create_dir_all(&root).map_err(|_| err("storage", "无法创建授权隔离目录"))?;
    let base = base.canonicalize().map_err(|_| err("storage", "无法校验授权隔离目录"))?;
    let root = root.canonicalize().map_err(|_| err("storage", "无法校验授权隔离目录"))?;
    if root.parent() != Some(base.as_path()) { return Err(err("storage", "授权隔离目录位置异常")); }
    let random: String = rand::thread_rng().sample_iter(&Alphanumeric).take(24).map(char::from).collect();
    let dir = root.join(format!("session_{random}"));
    std::fs::create_dir(&dir).map_err(|_| err("storage", "无法创建授权隔离目录"))?;
    Ok(dir)
}

// Never remove paths outside the canonical fixed application directory.
fn remove_profile(app: &AppHandle, path: &Path) -> bool {
    let Ok(base) = app.path().app_local_data_dir() else { return false };
    let Ok(root) = base.join("qq-auth-transient").canonicalize() else { return false };
    let Ok(base) = base.canonicalize() else { return false };
    if root.parent() != Some(base.as_path()) { return false; }
    let Ok(path) = path.canonicalize() else { return false };
    if path.parent() != Some(root.as_path())
        || !path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("session_"))
    { return false; }
    std::fs::remove_dir_all(path).is_ok()
}

fn destroy_later(app: AppHandle, path: PathBuf, failure: Arc<AtomicBool>) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        if !remove_profile(&app, &path) {
            failure.store(true, Ordering::Release);
            let _ = app.emit_to("main", "qq-auth-cleanup-failed", ());
        }
    });
}

struct CompletionGuard { inner: Arc<Mutex<Inner>>, generation: u64 }
impl Drop for CompletionGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = self.inner.lock() {
            if s.generation == self.generation { s.completing = false; }
        }
    }
}

fn hardened(window: &WebviewWindow) -> Result<()> {
    let (tx, rx) = mpsc::sync_channel(1);
    window.with_webview(move |wv| {
        let ok = (|| -> windows::core::Result<bool> {
            unsafe {
                let core = wv.controller().CoreWebView2()?;
                let settings: ICoreWebView2Settings4 = core.Settings()?.cast()?;
                settings.SetIsPasswordAutosaveEnabled(false)?;
                settings.SetIsGeneralAutofillEnabled(false)?;
                let mut passwords = BOOL(1);
                let mut autofill = BOOL(1);
                settings.IsPasswordAutosaveEnabled(&mut passwords)?;
                settings.IsGeneralAutofillEnabled(&mut autofill)?;
                Ok(!passwords.as_bool() && !autofill.as_bool())
            }
        })().unwrap_or(false);
        let _ = tx.send(ok);
    }).map_err(|_| err("security", "无法检查 QQ 授权窗口安全设置"))?;
    if rx.recv_timeout(Duration::from_secs(10)).unwrap_or(false) { Ok(()) }
    else { Err(err("security", "无法关闭密码保存和自动填充，已停止 QQ 登录")) }
}

#[tauri::command]
pub async fn qq_web_login_open(app: AppHandle, caller: WebviewWindow, state: State<'_, QqWebAuth>) -> Result<Value> {
    main_only(&caller)?;
    if state.cleanup_failed.load(Ordering::Acquire) {
        return Err(err("storage", "上次 QQ 授权临时数据未清理，请检查后再试"));
    }
    if app.get_webview_window(LABEL).is_some() { return Err(err("validation", "QQ 授权窗口已经打开")); }
    let directory = new_profile_dir(&app)?;
    let generation = {
        let mut s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?;
        if s.directory.is_some() {
            drop(s);
            if !remove_profile(&app, &directory) { state.cleanup_failed.store(true, Ordering::Release); }
            return Err(err("validation", "QQ 授权窗口已经打开或正在关闭"));
        }
        s.generation += 1;
        s.directory = Some(directory.clone());
        s.generation
    };
    let popup_app = app.clone();
    let auth = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External("about:blank".parse().unwrap()))
        .title("QQ 音乐授权").inner_size(920.0, 720.0).visible(false)
        .data_directory(directory.clone()).incognito(true).general_autofill_enabled(false)
        .on_navigation(|url| (url.scheme() == "about" && url.path() == "blank") || allowed_navigation(url))
        .on_new_window(move |url, _| {
            if allowed_navigation(&url) {
                if let Some(window) = popup_app.get_webview_window(LABEL) {
                    tauri::async_runtime::spawn(async move { let _ = window.navigate(url); });
                }
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build();
    let auth = match auth {
        Ok(auth) => auth,
        Err(_) => {
            if let Ok(mut s) = state.inner.lock() { if s.generation == generation { s.directory = None; } }
            if !remove_profile(&app, &directory) { state.cleanup_failed.store(true, Ordering::Release); }
            return Err(err("security", "无法创建 QQ 授权窗口"));
        }
    };
    let close_state = state.inner.clone();
    let close_app = app.clone();
    let close_path = directory.clone();
    let close_failure = state.cleanup_failed.clone();
    auth.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut s) = close_state.lock() {
                if s.directory.as_ref() == Some(&close_path) {
                    s.generation += 1; s.directory = None; s.completing = false;
                }
            }
            destroy_later(close_app.clone(), close_path.clone(), close_failure.clone());
        }
    });
    let check_window = auth.clone();
    let secured = match tauri::async_runtime::spawn_blocking(move || hardened(&check_window)).await {
        Ok(result) => result,
        Err(_) => { let _ = auth.close(); return Err(err("security", "无法检查 QQ 授权窗口安全设置")); }
    };
    if let Err(e) = secured { let _ = auth.close(); return Err(e); }
    let still_current = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?.generation == generation;
    if !still_current { let _ = auth.close(); return Err(err("cancelled", "QQ 授权已取消")); }
    if auth.navigate(PROFILE_URL.parse().unwrap()).is_err() {
        let _ = auth.close(); return Err(err("network", "无法打开 QQ 授权页面"));
    }
    if auth.show().is_err() {
        let _ = auth.close(); return Err(err("upstream", "无法显示 QQ 授权窗口"));
    }
    Ok(json!({"opened":true}))
}

#[tauri::command]
pub async fn qq_web_login_complete(app: AppHandle, caller: WebviewWindow, state: State<'_, QqWebAuth>) -> Result<Value> {
    main_only(&caller)?;
    let generation = {
        let mut s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?;
        if s.directory.is_none() || s.completing { return Err(err("validation", "QQ 授权窗口未打开或正在验证")); }
        s.completing = true;
        s.generation
    };
    let _guard = CompletionGuard { inner: state.inner.clone(), generation };
    let auth = app.get_webview_window(LABEL).ok_or(err("validation", "QQ 授权窗口未打开"))?;
    let get_cookies = auth.clone();
    let pairs = tauri::async_runtime::spawn_blocking(move || {
        get_cookies.cookies_for_url(COOKIE_URL.parse().unwrap()).map(|cookies| cookies.into_iter()
            .filter(|c| matches!(c.name(), "uin" | "qqmusic_uin" | "qm_keyst" | "qqmusic_key" | "music_key"))
            .map(|c| (c.name().to_owned(), c.value().to_owned())).collect::<Vec<_>>())
    }).await.map_err(|_| err("storage", "无法读取 QQ 授权窗口会话"))?
        .map_err(|_| err("storage", "无法读取 QQ 授权窗口会话"))?;
    let (account, key) = select_session(pairs)?;
    {
        let s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?;
        if s.generation != generation || s.directory.is_none() { return Err(err("cancelled", "QQ 授权已取消")); }
    }
    let info = profile(&state.client, &account, &key).await?;
    {
        let s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?;
        if s.generation != generation || s.directory.is_none() { return Err(err("cancelled", "QQ 授权已取消")); }
    }
    let secret = Credential::new(serde_json::to_string(&json!({"musicid":account,"musickey":key}))
        .map_err(|_| err("storage", "无法保存 QQ 会话"))?)
        .map_err(|_| err("storage", "无法保存 QQ 会话"))?;
    {
        let mut s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?;
        if s.generation != generation || s.directory.is_none() { return Err(err("cancelled", "QQ 授权已取消")); }
        WindowsStore.save(&secret).map_err(|_| err("storage", "无法安全保存 QQ 登录状态"))?;
        s.generation += 1;
    }
    let clear_window = auth.clone();
    let cleared = tauri::async_runtime::spawn_blocking(move || clear_window.clear_all_browsing_data().is_ok())
        .await.unwrap_or(false);
    let _ = auth.close();
    if !cleared { return Err(err("storage", "QQ 登录已验证，但授权窗口临时数据清理失败")); }
    Ok(json!({"profile":info}))
}

#[tauri::command]
pub fn qq_web_login_cancel(app: AppHandle, caller: WebviewWindow, state: State<'_, QqWebAuth>) -> Result<Value> {
    main_only(&caller)?;
    { let mut s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?; s.generation += 1; }
    if let Some(auth) = app.get_webview_window(LABEL) { let _ = auth.close(); }
    Ok(json!({"cancelled":true}))
}

#[tauri::command]
pub async fn qq_web_account(caller: WebviewWindow, state: State<'_, QqWebAuth>) -> Result<Value> {
    main_only(&caller)?;
    let generation = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?.generation;
    let credential = WindowsStore.load().map_err(|_| err("storage", "无法读取 QQ 登录状态"))?;
    let Some(credential) = credential else { return Ok(json!({"profile":null})); };
    let data: Value = serde_json::from_str(credential.expose()).map_err(|_| err("storage", "QQ 登录状态格式异常"))?;
    let account = data.get("musicid").and_then(Value::as_str).filter(|v| v.bytes().all(|b| b.is_ascii_digit()))
        .ok_or(err("storage", "QQ 登录状态格式异常"))?;
    let key = data.get("musickey").and_then(Value::as_str).filter(|v| safe_cookie_value(v))
        .ok_or(err("storage", "QQ 登录状态格式异常"))?;
    let info = profile(&state.client, account, key).await?;
    if state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?.generation != generation {
        return Err(err("cancelled", "QQ 账号已变化"));
    }
    Ok(json!({"profile":info}))
}

#[tauri::command]
pub fn qq_web_logout(app: AppHandle, caller: WebviewWindow, state: State<'_, QqWebAuth>) -> Result<Value> {
    main_only(&caller)?;
    let mut s = state.inner.lock().map_err(|_| err("storage", "QQ 会话不可用"))?;
    WindowsStore.clear().map_err(|_| err("storage", "无法清理 QQ 本地登录状态"))?;
    s.generation += 1;
    s.diagnostic_revision=s.diagnostic_revision.wrapping_add(1);
    if let Some(d)=s.diagnostic.as_mut(){*d=PlaybackDiagnostic{stage:"账号已退出",session_expiry:"未知",session_validity:"未检查",upstream_identity_match:"未知",..Default::default()};}
    s.completing = false;
    s.stream = None;
    s.candidate = None;
    s.previous = None;
    drop(s);
    if let Some(auth) = app.get_webview_window(LABEL) { let _ = auth.close(); }
    Ok(json!({"localCleared":true,"remoteRevoked":false}))
}


fn account_snapshot(state:&QqWebAuth)->Result<(u64,String,String)>{
 let generation=state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?.generation;
 let secret=WindowsStore.load().map_err(|_|err("storage","无法读取 QQ 登录状态"))?.ok_or(err("auth","请先登录 QQ 音乐"))?;
 let value:Value=serde_json::from_str(secret.expose()).map_err(|_|err("storage","QQ 登录状态格式异常"))?;
 let account=value.get("musicid").and_then(Value::as_str).filter(|v|!v.is_empty()&&v.bytes().all(|b|b.is_ascii_digit())).ok_or(err("storage","QQ 登录状态格式异常"))?.to_owned();
 let key=value.get("musickey").and_then(Value::as_str).filter(|v|safe_cookie_value(v)).ok_or(err("storage","QQ 登录状态格式异常"))?.to_owned();
 Ok((generation,account,key))
}
fn require_generation(state:&QqWebAuth,generation:u64)->Result<()> {
 if state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?.generation!=generation {Err(err("cancelled","QQ 账号已变化"))}else{Ok(())}
}
fn session_cookie(account:&str,key:&str)->String {format!("uin={account}; qqmusic_uin={account}; qm_keyst={key}; qqmusic_key={key}")}
async fn read_json(mut response:reqwest::Response)->Result<Value>{
 if response.status()==reqwest::StatusCode::UNAUTHORIZED||response.status()==reqwest::StatusCode::FORBIDDEN{return Err(err("auth","QQ 登录已过期或没有权限"));}
 if !response.status().is_success(){return Err(err("upstream","QQ 服务请求失败"));}
 if response.content_length().is_some_and(|n|n>MAX_BODY as u64){return Err(err("upstream","QQ 响应过大"));}
 let mut body=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|err("network","QQ 响应读取失败"))? {if chunk.len()>MAX_BODY-body.len(){return Err(err("upstream","QQ 响应过大"));}body.extend_from_slice(&chunk);}
 serde_json::from_slice(&body).map_err(|_|err("upstream","QQ 响应格式异常"))
}
#[tauri::command]
pub async fn qq_web_playlists(caller:WebviewWindow,state:State<'_,QqWebAuth>,page:u32)->Result<Value>{
 main_only(&caller)?;if !(1..=50).contains(&page){return Err(err("validation","QQ 歌单页码无效"));}
 let (generation,account,key)=account_snapshot(&state)?;let start=((page-1)*40).to_string();let end=((page-1)*40+39).to_string();let cookie=session_cookie(&account,&key);
 let created=state.client.get("https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss")
  .header("Referer","https://y.qq.com/portal/profile.html").header("Cookie",&cookie)
  .query(&[("hostUin","0"),("hostuin",account.as_str()),("sin",start.as_str()),("size","40"),("g_tk","5381"),("loginUin",account.as_str()),("format","json"),("inCharset","utf8"),("outCharset","utf-8"),("notice","0"),("platform","yqq.json"),("needNewCode","0")]).send().await.map_err(|e|if e.is_timeout(){err("timeout","QQ 歌单请求超时")}else{err("network","无法连接 QQ 歌单服务")})?;
 let created=read_json(created).await?;require_generation(&state,generation)?;
 let collected=state.client.get("https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg")
  .header("Referer","https://y.qq.com/portal/profile.html").header("Cookie",&cookie)
  .query(&[("ct","20"),("cid","205360956"),("userid",account.as_str()),("reqtype","3"),("sin",start.as_str()),("ein",end.as_str()),("format","json")]).send().await.map_err(|e|if e.is_timeout(){err("timeout","QQ 歌单请求超时")}else{err("network","无法连接 QQ 歌单服务")})?;
 let collected=read_json(collected).await?;require_generation(&state,generation)?;
 let mut result=crate::qq_catalog::map_playlists(created,collected)?;result["page"]=json!(page);Ok(result)
}
#[tauri::command]
pub async fn qq_web_playlist_tracks(caller:WebviewWindow,state:State<'_,QqWebAuth>,id:String,page:u32)->Result<Value>{
 main_only(&caller)?;if !(1..=100).contains(&page){return Err(err("validation","QQ 歌曲页码无效"));}
 let liked=id=="liked:201";let diss=if liked{0}else{id.parse::<u64>().ok().filter(|n|*n>0&&*n<=9_007_199_254_740_991).ok_or(err("validation","QQ 歌单标识无效"))?};
 let (generation,account,key)=account_snapshot(&state)?;let gtk=hash33(&key);
 let request=json!({"comm":{"ct":24,"cv":4747474,"platform":"yqq.json","uin":account,"authst":key,"g_tk":gtk,"format":"json"},"playlist":{"module":"music.srfDissInfo.DissInfo","method":"CgiGetDiss","param":{"disstid":diss,"dirid":if liked{201}else{0},"tag":true,"song_begin":(page-1)*50,"song_num":50,"userinfo":true,"orderlist":true,"onlysonglist":false}}});
 let response=state.client.post(API_URL).header("Referer","https://y.qq.com/").header("Cookie",session_cookie(&account,&key)).json(&request).send().await.map_err(|e|if e.is_timeout(){err("timeout","QQ 歌曲请求超时")}else{err("network","无法连接 QQ 音乐")})?;
 let data=read_json(response).await?;require_generation(&state,generation)?;let mut out=crate::qq_catalog::map_tracks(data)?;out["page"]=json!(page);Ok(out)
}

fn valid_mid(value:&str)->bool {!value.is_empty()&&value.len()<=64&&value.bytes().all(|b|b.is_ascii_alphanumeric())}
fn vkey_filename(mid:&str,media_mid:Option<&str>)->Result<String>{
 if !valid_mid(mid)||media_mid.is_some_and(|v|!valid_mid(v)){return Err(err("validation","QQ 曲目标识无效"));}
 Ok(format!("C400{}.m4a",media_mid.unwrap_or(mid)))
}
fn allowed_media_url(base:&str,purl:&str)->Result<tauri::Url>{
 let invalid=||err("upstream","QQ 音频地址无效");
 let unsupported=||err("permission","QQ 音频来源不受支持");
 let mut base=tauri::Url::parse(base).map_err(|_|invalid())?;
 let host=base.host_str().ok_or_else(invalid)?;
 let official=host.ends_with(".qqmusic.qq.com") || host=="aqqmusic.tc.qq.com"
     || host.ends_with(".music.tc.qq.com");
 if !matches!(base.scheme(),"https"|"http") || base.port().is_some()
     || !base.username().is_empty() || base.password().is_some() || !official {
     return Err(unsupported());
 }
 if base.scheme()=="http" {base.set_scheme("https").map_err(|_|unsupported())?;}

 let path=purl.split('?').next().unwrap_or_default().to_ascii_lowercase();
 if path.is_empty() || purl!=purl.trim() || purl.bytes().any(|b|b.is_ascii_control())
     || purl.starts_with('/') || purl.contains(['#','\\']) || purl.contains("..")
     || tauri::Url::parse(purl).is_ok() || path.contains("%2f") || path.contains("%5c")
     || path.split('/').any(|segment|matches!(segment,"%2e%2e"|".%2e"|"%2e.")) {
     return Err(invalid());
 }
 let url=base.join(purl).map_err(|_|invalid())?;
 if url.scheme()!="https" || url.host_str()!=base.host_str()
     || url.port_or_known_default()!=Some(443) || !url.username().is_empty() || url.password().is_some() {
     return Err(unsupported());
 }
 Ok(url)
}
fn parse_media_response(data:&Value)->Result<(String,&'static str)>{
 if data.get("code").and_then(Value::as_i64)!=Some(0)||data.pointer("/req_0/code").and_then(Value::as_i64)!=Some(0){return Err(err("upstream","QQ 音频服务返回失败"));}
 let detail=data.pointer("/req_0/data").ok_or(err("upstream","QQ 音频数据不完整"))?;
 match detail.pointer("/midurlinfo/0/result").and_then(Value::as_i64){
  Some(0)=>{},
  Some(104003)=>return Err(err("upstream","该曲目暂时无法在 Prism 播放，可能受 QQ 绿钻、版权或播放方式限制（104003）")),
  Some(_)=>return Err(err("upstream","QQ 音乐拒绝本次播放请求，具体原因未知")),
  None=>return Err(err("upstream","QQ 音乐未返回曲目业务结果")),
 }
 let path=detail.pointer("/midurlinfo/0/purl").and_then(Value::as_str).filter(|x|!x.trim().is_empty()).ok_or(err("upstream","QQ 未返回播放地址，具体原因未知"))?;
 let bases=detail.get("sip").and_then(Value::as_array).ok_or(err("upstream","QQ 音频来源缺失"))?;
 let url=bases.iter().filter_map(Value::as_str).find_map(|base|allowed_media_url(base,path).ok())
     .ok_or(err("permission","QQ 音频来源不受支持"))?;
 let extension=url.path().rsplit_once('.').map(|(_, ext)|ext).unwrap_or_default();
 let mime=if extension.eq_ignore_ascii_case("m4a") {"audio/mp4"}
     else if extension.eq_ignore_ascii_case("mp3") {"audio/mpeg"}
     else {return Err(err("upstream","QQ 返回的音频格式不受支持"));};
 Ok((url.into(),mime))
}
fn media_request(client:&reqwest::Client,account:&str,key:&str,guid:&str,mid:&str,filename:&str)->reqwest::RequestBuilder{
 let gtk=hash33(key);
 let request=json!({
     "comm":{"ct":24,"cv":4747474,"platform":"yqq.json","uin":account,"authst":key,"g_tk":gtk,"g_tk_new_20200303":gtk,"format":"json"},
     "req_0":{"module":"vkey.GetVkeyServer","method":"CgiGetVkey","param":{"guid":guid,"songmid":[mid],"songtype":[0],"uin":account,"loginflag":1,"platform":"20","filename":[filename]}}
 });
 client.post(API_URL).header("Referer","https://y.qq.com/").header(reqwest::header::ORIGIN,"https://y.qq.com")
     .header("Cookie",session_cookie(account,key)).json(&request)
}
#[tauri::command]
pub async fn qq_web_resolve(caller:WebviewWindow,state:State<'_,QqWebAuth>,mid:String,media_mid:Option<String>)->Result<Value>{
 main_only(&caller)?;
 let (diag_rev,resolve_rev)={let mut inner=state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?;inner.diagnostic_revision=inner.diagnostic_revision.wrapping_add(1);inner.resolve_revision=inner.resolve_revision.wrapping_add(1);inner.resolve_status=ResolveStatus::Pending;let rev=(inner.diagnostic_revision,inner.resolve_revision);if let Some(d)=inner.diagnostic.as_mut(){*d=PlaybackDiagnostic{stage:"会话检查",session_expiry:"未知",session_validity:"未检查",upstream_identity_match:"未知",..Default::default()};}rev};
 let _resolve_guard=ResolveGuard{inner:state.inner.clone(),revision:resolve_rev};
 let filename=vkey_filename(&mid,media_mid.as_deref()).map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|d.failure=Some("输入无效"));e})?;
 let (generation,account,key)=account_snapshot(&state).map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|d.failure=Some("会话不可用"));e})?;
 update_diagnostic_for(&state,diag_rev,|d|{d.session_fields=true;d.session_validity="本地结构有效，服务端未知";d.stage="请求构造";d.media_mid_present=media_mid.is_some();d.media_mid_matches_song_mid=media_mid.as_ref().map(|m|m==&mid);});
 require_generation(&state,generation).map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|{d.generation_match=Some(false);d.failure=Some("账号代次冲突");});e})?;
 let guid:String=rand::thread_rng().gen_range(10_000_000_u64..99_999_999).to_string();
 update_diagnostic_for(&state,diag_rev,|d|{d.stage="接口响应";d.request_complete=true;d.uses_login=true;d.generation_match=Some(true);});
 let response=media_request(&state.client,&account,&key,&guid,&mid,&filename).send().await.map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|d.failure=Some("网络或超时"));if e.is_timeout(){err("timeout","QQ 音频请求超时")}else{err("network","无法连接 QQ 音乐")}})?;
 let data=read_json(response).await.map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|d.failure=Some("接口响应错误"));e})?;
 require_generation(&state,generation).map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|{d.generation_match=Some(false);d.failure=Some("账号代次冲突");});e})?;
 update_diagnostic_for(&state,diag_rev,|d|{d.stage="URL 解析";d.top_code=data.get("code").and_then(Value::as_i64);d.module_code=data.pointer("/req_0/code").and_then(Value::as_i64);d.business_code=data.pointer("/req_0/data/midurlinfo/0/result").and_then(Value::as_i64);});
 let (url,mime)=parse_media_response(&data).map_err(|e|{update_diagnostic_for(&state,diag_rev,|d|d.failure=Some("未获得有效播放地址"));e})?;
 let handle:String=rand::thread_rng().sample_iter(&Alphanumeric).take(40).map(char::from).collect();
 {let mut inner=state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?;if inner.generation!=generation {if inner.diagnostic_revision==diag_rev {if let Some(d)=inner.diagnostic.as_mut(){d.generation_match=Some(false);d.failure=Some("账号代次冲突");}}return Err(err("cancelled","QQ 账号已变化"));}install_stream(&mut inner,generation,resolve_rev,Stream{handle:handle.clone(),url,mime,generation,expires:Instant::now()+Duration::from_secs(600),diagnostic_revision:diag_rev,resolve_revision:resolve_rev})?;inner.resolve_status=ResolveStatus::Succeeded;if inner.diagnostic_revision==diag_rev {if let Some(d)=inner.diagnostic.as_mut(){d.valid_url=true;d.stage="等待音频加载";}}}
 Ok(json!({"data":[{"code":200,"url":format!("http://prismmedia.localhost/{handle}")}] }))
}
fn bounded_range(value:Option<&str>)->Result<(u64,u64)>{
 let raw=value.unwrap_or("bytes=0-").strip_prefix("bytes=").ok_or(err("validation","音频范围无效"))?;
 let (start,end)=raw.split_once('-').ok_or(err("validation","音频范围无效"))?;
 let start=start.parse::<u64>().map_err(|_|err("validation","音频范围无效"))?;if start>1_073_741_824{return Err(err("validation","音频范围无效"));}
 let cap=start.saturating_add(512*1024-1);let requested=if end.is_empty(){cap}else{end.parse::<u64>().map_err(|_|err("validation","音频范围无效"))?};
 if requested<start{return Err(err("validation","音频范围无效"));}Ok((start,requested.min(cap)))
}
fn content_range_len(value:&str,start:u64,max_end:u64)->Result<usize>{
 let raw=value.strip_prefix("bytes ").ok_or(err("upstream","QQ 音频分段信息异常"))?;
 let (span,total)=raw.split_once('/').ok_or(err("upstream","QQ 音频分段信息异常"))?;
 let (first,last)=span.split_once('-').ok_or(err("upstream","QQ 音频分段信息异常"))?;
 let first=first.parse::<u64>().map_err(|_|err("upstream","QQ 音频分段信息异常"))?;
 let last=last.parse::<u64>().map_err(|_|err("upstream","QQ 音频分段信息异常"))?;
 let total=total.parse::<u64>().map_err(|_|err("upstream","QQ 音频分段信息异常"))?;
 if first!=start||last<first||last>max_end||total<=last{return Err(err("upstream","QQ 音频分段信息异常"));}
 usize::try_from(last-first+1).map_err(|_|err("upstream","QQ 音频分段信息异常"))
}
pub(crate) async fn stream_chunk(state:&QqWebAuth,handle:&str,range:Option<&str>)->Result<tauri::http::Response<Vec<u8>>>{
 let revision=state.inner.lock().ok().and_then(|s|acquire_stream(&s,handle).ok().map(|(x,_)|x.diagnostic_revision));
 let result=stream_chunk_inner(state,handle,range).await;
 if let Some(revision)=revision {update_diagnostic_for(state,revision,|d|{d.stage="音频加载";if result.is_err(){d.failure=Some("音频分段加载失败");}});}
 result
}
async fn stream_chunk_inner(state:&QqWebAuth,handle:&str,range:Option<&str>)->Result<tauri::http::Response<Vec<u8>>>{
 if !valid_mid(handle)||handle.len()!=40{return Err(err("validation","音频会话无效"));}
 let (url,mime,generation,slot)={let s=state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?;let (stream,slot)=acquire_stream(&s,handle)?;(stream.url,stream.mime,stream.generation,slot)};
 let(start,end)=bounded_range(range)?;let mut response=state.client.get(&url).header("Range",format!("bytes={start}-{end}")).header("Referer","https://y.qq.com/").send().await.map_err(|e|if e.is_timeout(){err("timeout","QQ 音频读取超时")}else{err("network","QQ 音频读取失败")})?;
 if response.status()!=reqwest::StatusCode::PARTIAL_CONTENT{return Err(err("upstream","QQ 音频不支持分段播放"));}
 let cr=response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v|v.to_str().ok()).filter(|s|s.len()<=80).ok_or(err("upstream","QQ 音频分段信息异常"))?.to_owned();
 let expected=content_range_len(&cr,start,end)?;
 if response.content_length().is_some_and(|n|n>512*1024){return Err(err("upstream","QQ 音频分段过大"));}
 let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|err("network","QQ 音频读取失败"))?{if chunk.len()>512*1024-bytes.len(){return Err(err("upstream","QQ 音频分段过大"));}bytes.extend_from_slice(&chunk);}if bytes.len()!=expected{return Err(err("upstream","QQ 音频分段长度异常"));}require_generation(state,generation)?;{let mut s=state.inner.lock().map_err(|_|err("storage","QQ 会话不可用"))?;accept_stream(&mut s,handle,slot)?;}
 tauri::http::Response::builder().status(206).header("Content-Type",mime).header("Accept-Ranges","bytes").header("Content-Range",cr).header("Content-Length",bytes.len().to_string()).header("Cache-Control","no-store").body(bytes).map_err(|_|err("upstream","QQ 音频响应失败"))
}
#[tauri::command]
pub async fn qq_web_lyric(caller:WebviewWindow,state:State<'_,QqWebAuth>,mid:String)->Result<Value>{
 main_only(&caller)?;if !valid_mid(&mid){return Err(err("validation","QQ 曲目标识无效"));}let(generation,account,key)=account_snapshot(&state)?;require_generation(&state,generation)?;
 let request=json!({"comm":{"ct":24,"cv":0},"lyric":{"module":"music.musichallSong.PlayLyricInfo","method":"GetPlayLyricInfo","param":{"songMID":mid}}});
 let response=state.client.post(API_URL).header("Referer","https://y.qq.com/").header("Cookie",session_cookie(&account,&key)).json(&request).send().await.map_err(|e|if e.is_timeout(){err("timeout","QQ 歌词请求超时")}else{err("network","QQ 歌词请求失败")})?;
 let data=read_json(response).await?;require_generation(&state,generation)?;if data.get("code").and_then(Value::as_i64)!=Some(0)||data.pointer("/lyric/code").and_then(Value::as_i64)!=Some(0){return Err(err("upstream","QQ 歌词服务返回失败"));}
 let encoded=data.pointer("/lyric/data/lyric").and_then(Value::as_str).unwrap_or("");let decoded=base64::engine::general_purpose::STANDARD.decode(encoded).ok().and_then(|b|String::from_utf8(b).ok()).unwrap_or_else(||encoded.to_owned());Ok(json!({"lrc":{"lyric":decoded}}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn playback_diagnostic_is_disabled_by_default_and_allowlisted() {
        let state=QqWebAuth::new();
        update_diagnostic_for(&state,0,|d|d.stage="接口响应");
        assert!(state.inner.lock().unwrap().diagnostic.is_none());
        state.inner.lock().unwrap().diagnostic=Some(PlaybackDiagnostic{stage:"等待播放",session_expiry:"未知",session_validity:"未检查",upstream_identity_match:"未知",..Default::default()});
        update_diagnostic_for(&state,1,|d|d.business_code=Some(999));
        update_diagnostic_for(&state,0,|d|{d.session_fields=true;d.business_code=Some(104003);});
        let inner=state.inner.lock().unwrap();let encoded=serde_json::to_value(inner.diagnostic.as_ref().unwrap()).unwrap();
        assert_eq!(encoded["business_code"],104003);assert_eq!(encoded["session_expiry"],"未知");
        let keys=encoded.as_object().unwrap().keys().map(String::as_str).collect::<std::collections::HashSet<_>>();
        assert_eq!(keys,std::collections::HashSet::from(["stage","session_fields","session_expiry","session_validity","upstream_identity_match","uses_login","media_mid_present","media_mid_matches_song_mid","request_complete","top_code","module_code","business_code","valid_url","generation_match","failure"]));
    }
    #[test] fn stale_resolve_cannot_replace_newer_stream() {
        let mut inner=Inner{generation:7,resolve_revision:2,..Default::default()};
        let stream=|name:&str|Stream{handle:name.to_owned(),url:"https://synthetic.invalid/".to_owned(),mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(1),diagnostic_revision:0,resolve_revision:2};
        assert!(install_stream(&mut inner,7,2,stream("NEW")).is_ok());
        assert!(install_stream(&mut inner,7,1,stream("OLD")).is_err());
        assert!(install_stream(&mut inner,6,2,stream("OLD_ACCOUNT")).is_err());
        assert_eq!(inner.candidate.as_ref().unwrap().handle,"NEW");
        inner.stream=Some(stream("PLAYING"));
        assert_eq!(acquire_stream(&inner,"PLAYING").unwrap().0.handle,"PLAYING");
        assert_eq!(acquire_stream(&inner,"NEW").unwrap().0.handle,"NEW");
        assert_eq!(inner.stream.as_ref().unwrap().handle,"PLAYING");
        accept_stream(&mut inner,"NEW",StreamSlot::Candidate).unwrap();
        assert!(accept_stream(&mut inner,"PLAYING",StreamSlot::Active).is_err());
        accept_stream(&mut inner,"PLAYING",StreamSlot::Previous).unwrap();
        assert_eq!(inner.stream.as_ref().unwrap().handle,"NEW");
        assert_eq!(inner.previous.as_ref().unwrap().handle,"PLAYING");
        inner.generation+=1;
        assert!(acquire_stream(&inner,"NEW").is_err());
    }
    #[test] fn restore_previous_checks_both_handles_and_revision() {
        let stream=|name:&str,revision|Stream{handle:name.to_owned(),url:"https://synthetic.invalid/".into(),mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(10),diagnostic_revision:0,resolve_revision:revision};
        let mut inner=Inner{generation:7,resolve_revision:2,stream:Some(stream("OLD",1)),candidate:Some(stream("NEW",2)),..Default::default()};
        assert!(restore_previous(&mut inner,"NEW","OLD").is_ok());assert!(inner.candidate.is_none());
        inner.candidate=Some(stream("NEW",2));accept_stream(&mut inner,"NEW",StreamSlot::Candidate).unwrap();
        assert!(restore_previous(&mut inner,"NEW","WRONG").is_err());
        inner.resolve_revision=3;assert!(restore_previous(&mut inner,"NEW","OLD").is_err());
        inner.resolve_revision=2;assert!(restore_previous(&mut inner,"NEW","OLD").is_ok());
        assert_eq!(inner.stream.as_ref().unwrap().handle,"OLD");
        assert!(accept_stream(&mut inner,"NEW",StreamSlot::Active).is_err());
        inner.resolve_revision=3;inner.candidate=Some(stream("NEXT",3));accept_stream(&mut inner,"NEXT",StreamSlot::Candidate).unwrap();
        assert!(restore_previous(&mut inner,"NEXT","OLD").is_ok());assert_eq!(inner.stream.as_ref().unwrap().handle,"OLD");
        inner.generation=8;assert!(restore_previous(&mut inner,"NEXT","OLD").is_err());
    }
    #[test] fn rollback_after_newer_failed_resolve_but_not_pending_or_successful() {
        let stream=|name:&str,revision|Stream{handle:name.into(),url:"https://synthetic.invalid/".into(),mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(10),diagnostic_revision:0,resolve_revision:revision};
        let mut inner=Inner{generation:7,resolve_revision:3,resolve_status:ResolveStatus::Pending,stream:Some(stream("NEW",2)),previous:Some(stream("OLD",1)),..Default::default()};
        assert!(restore_previous(&mut inner,"NEW","OLD").is_err());
        inner.resolve_status=ResolveStatus::Succeeded;assert!(restore_previous(&mut inner,"NEW","OLD").is_err());
        inner.resolve_status=ResolveStatus::Failed;assert!(restore_previous(&mut inner,"NEW","OLD").is_ok());
        assert_eq!(inner.stream.as_ref().unwrap().handle,"OLD");
    }
    #[test] fn stale_resolve_guard_does_not_mark_newer_request_failed() {
        let inner=Arc::new(Mutex::new(Inner{resolve_revision:4,resolve_status:ResolveStatus::Pending,..Default::default()}));
        drop(ResolveGuard{inner:inner.clone(),revision:3});assert!(inner.lock().unwrap().resolve_status==ResolveStatus::Pending);
        drop(ResolveGuard{inner:inner.clone(),revision:4});assert!(inner.lock().unwrap().resolve_status==ResolveStatus::Failed);
    }
    #[test] fn latest_failed_candidate_can_restore_previous_across_inflight_switch(){
        let stream=|name:&str,revision|Stream{handle:name.into(),url:"https://synthetic.invalid/".into(),mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(10),diagnostic_revision:0,resolve_revision:revision};
        let mut inner=Inner{generation:7,resolve_revision:3,resolve_status:ResolveStatus::Succeeded,stream:Some(stream("B",2)),previous:Some(stream("A",1)),candidate:Some(stream("C",3)),..Default::default()};
        assert!(restore_previous(&mut inner,"C","A").is_ok());assert_eq!(inner.stream.as_ref().unwrap().handle,"A");assert!(inner.candidate.is_none());
        assert!(accept_stream(&mut inner,"B",StreamSlot::Active).is_err());assert!(accept_stream(&mut inner,"C",StreamSlot::Candidate).is_err());
    }
    #[test] fn restricts_navigation() {
        assert_eq!(PROFILE_URL, "https://y.qq.com/n/ryqq_v2/profile");
        for u in [PROFILE_URL, "https://y.qq.com/n/ryqq/profile", "https://y.qq.com/portal/wx_redirect.html"] {
            assert!(allowed_navigation(&u.parse().unwrap()));
        }
        assert!(allowed_navigation(&"https://graph.qq.com/oauth2.0/show".parse().unwrap()));
        for u in ["http://y.qq.com/n/ryqq/profile", "https://y.qq.com.evil.invalid/n/ryqq/profile",
            "https://y.qq.com:444/n/ryqq/profile", "https://evil.qq.com/n/ryqq/profile",
            "file:///etc/passwd", "https://user@y.qq.com/n/ryqq/profile",
            "https://y.qq.com/n/ryqq_v2evil/profile"] {
            assert!(!allowed_navigation(&u.parse().unwrap()));
        }
    }
    #[test] fn selects_only_non_conflicting_necessary_synthetic_fields() {
        let pairs = vec![("uin".into(),"o000123".into()),("qm_keyst".into(),"fictional-key".into()),
            ("unrelated".into(),"never-used".into())];
        let (account, key) = select_session(pairs).unwrap();
        assert_eq!(account,"123"); assert_eq!(key,"fictional-key");
        assert!(select_session(vec![("uin".into(),"123".into())]).is_err());
        assert!(select_session(vec![("uin".into(),"123".into()),("qqmusic_uin".into(),"999".into()),
            ("qm_keyst".into(),"fake".into())]).is_err());
        assert!(select_session(vec![("uin".into(),"123".into()),("qm_keyst".into(),"".into())]).is_err());
        assert!(select_session(vec![("uin".into(),"123".into()),("qm_keyst".into(),"one".into()),("qqmusic_key".into(),"two".into())]).is_err());
    }
    #[test] fn vkey_filename_uses_file_mid_and_validates_both_ids() {
        assert_eq!(vkey_filename("SONG1",Some("FILE2")).unwrap(),"C400FILE2.m4a");
        assert_eq!(vkey_filename("SONG1",None).unwrap(),"C400SONG1.m4a");
        assert!(vkey_filename("SONG1",Some("../bad")).is_err());
        assert!(vkey_filename("",Some("FILE2")).is_err());
    }
    #[test] fn media_request_uses_unsigned_endpoint_and_legacy_module() {
        let client=reqwest::Client::new();
        let request=media_request(&client,"123","fixture-key","678","SONG1","C400FILE2.m4a").build().unwrap();
        assert_eq!(request.url().as_str(),API_URL);
        assert_eq!(request.headers()[reqwest::header::ORIGIN],"https://y.qq.com");
        let body:Value=serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert_eq!(body["comm"]["g_tk_new_20200303"],json!(hash33("fixture-key")));
        assert_eq!(body["comm"]["g_tk"],body["comm"]["g_tk_new_20200303"]);
        assert_eq!(body["req_0"]["module"],"vkey.GetVkeyServer");
        assert_eq!(body["req_0"]["method"],"CgiGetVkey");
        assert_eq!(body["req_0"]["param"]["songmid"],json!(["SONG1"]));
        assert_eq!(body["req_0"]["param"]["filename"],json!(["C400FILE2.m4a"]));
    }
    #[test] fn audio_url_and_range_are_restricted() {
        assert!(allowed_media_url("https://ws.stream.qqmusic.qq.com/", "M500SAMPLE.mp3?vkey=fixture").is_ok());
        let purl="C400SAMPLE.m4a?vkey=fixture";
        for base in ["ws.stream.qqmusic.qq.com/", "aqqmusic.tc.qq.com/amobile.music.tc.qq.com/", "edge.music.tc.qq.com/"] {
            let url=allowed_media_url(&format!("http://{base}"),purl).unwrap();
            assert_eq!(url.as_str(),format!("https://{base}{purl}"));
            assert_eq!(url.port_or_known_default(),Some(443));
        }
        for base in [
            "http://ws.stream.qqmusic.qq.com:8080/", "https://aqqmusic.tc.qq.com:444/",
            "https://evil.invalid/", "https://qqmusic.qq.com.evil.invalid/",
            "https://evil.tc.qq.com/", "https://edge.music.tc.qq.com.evil.invalid/",
            "http://user:secret@aqqmusic.tc.qq.com/", "https://user@ws.stream.qqmusic.qq.com/",
            "ftp://ws.stream.qqmusic.qq.com/",
        ] {assert!(allowed_media_url(base,purl).is_err());}
        for path in [
            "https://evil.invalid/a", "https://ws.stream.qqmusic.qq.com/C400SAMPLE.m4a",
            "//evil.invalid/a", "//ws.stream.qqmusic.qq.com/C400SAMPLE.m4a", " //ws.stream.qqmusic.qq.com/C400SAMPLE.m4a",
            "/private", "../secret", "nested/%2e%2E/secret", "%2e.%2fsecret", "file\\secret", "",
        ] {assert!(allowed_media_url("http://ws.stream.qqmusic.qq.com/",path).is_err());}
        assert_eq!(bounded_range(Some("bytes=10-")).unwrap(),(10,10+512*1024-1));
        assert_eq!(bounded_range(Some("bytes=0-99")).unwrap(),(0,99));
        for bad in ["bytes=-50","bytes=10-0","bytes=0-1,5-8","garbage"] {assert!(bounded_range(Some(bad)).is_err());}
        assert!(parse_media_response(&json!({"code":0,"req_0":{"code":0,"data":{"sip":["https://ws.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":""}]}}})).is_err());
        let empty=json!({"code":0,"req_0":{"code":0,"data":{"midurlinfo":[{"purl":"","result":42}]}}});
        let failure=parse_media_response(&empty).unwrap_err();
        assert_eq!(failure.kind,"upstream");assert!(failure.message.contains("拒绝"));
        let known=json!({"code":0,"req_0":{"code":0,"data":{"midurlinfo":[{"purl":"","result":104003}]}}});
        let failure=parse_media_response(&known).unwrap_err();
        assert_eq!(failure.kind,"upstream");
        assert_eq!(failure.message,"该曲目暂时无法在 Prism 播放，可能受 QQ 绿钻、版权或播放方式限制（104003）");
        let denied=json!({"code":0,"req_0":{"code":0,"data":{"sip":["https://ws.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":"M500FAKE.mp3","result":104003}]}}});
        assert!(parse_media_response(&denied).is_err());
        let allowed=json!({"code":0,"req_0":{"code":0,"data":{"sip":["https://ws.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":"M500FAKE.mp3","result":0}]}}});
        assert_eq!(parse_media_response(&allowed).unwrap().1,"audio/mpeg");
        let missing=json!({"code":0,"req_0":{"code":0,"data":{"sip":["https://ws.stream.qqmusic.qq.com/"],"midurlinfo":[{"purl":"M500FAKE.mp3"}]}}});
        assert!(parse_media_response(&missing).is_err());
    }
    #[test] fn media_response_requires_a_supported_path_on_an_allowed_host() {
        let response=|path:&str,base:&str|json!({"code":0,"req_0":{"code":0,"data":{
            "sip":[base],"midurlinfo":[{"purl":path,"result":0}]
        }}});
        let qq_base="https://ws.stream.qqmusic.qq.com/";
        let (url,mime)=parse_media_response(&response("C400FIXTURE.m4a?vkey=fixture",qq_base)).unwrap();
        assert_eq!(url,"https://ws.stream.qqmusic.qq.com/C400FIXTURE.m4a?vkey=fixture");
        assert_eq!(mime,"audio/mp4");
        let tc="http://aqqmusic.tc.qq.com/amobile.music.tc.qq.com/";
        assert_eq!(parse_media_response(&response("C400FIXTURE.m4a",tc)).unwrap(),
            ("https://aqqmusic.tc.qq.com/amobile.music.tc.qq.com/C400FIXTURE.m4a".into(),"audio/mp4"));
        assert!(parse_media_response(&response("C400FIXTURE.m4a","https://example.invalid/")).is_err());
        assert!(parse_media_response(&response("C400FIXTURE.bin?file=fixture.m4a",qq_base)).is_err());
        assert!(parse_media_response(&response(" ",qq_base)).is_err());
    }
    #[test] fn synthetic_local_stream_returns_only_bounded_bytes() {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let port=listener.local_addr().unwrap().port();
        let worker=std::thread::spawn(move||{let(mut socket,_)=listener.accept().unwrap();let mut request=[0u8;2048];let n=socket.read(&mut request).unwrap();assert!(String::from_utf8_lossy(&request[..n]).to_ascii_lowercase().contains("range: bytes=0-3"));socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/4\r\nConnection: close\r\n\r\ntest").unwrap();});
        let handle="A".repeat(40);let state=QqWebAuth{inner:Arc::new(Mutex::new(Inner{generation:7,stream:Some(Stream{handle:handle.clone(),url:format!("http://127.0.0.1:{port}/synthetic"),mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(10),diagnostic_revision:0,resolve_revision:0}),..Default::default()})),client:reqwest::Client::builder().no_proxy().build().unwrap(),cleanup_failed:Arc::new(AtomicBool::new(false))};
        let response=tauri::async_runtime::block_on(stream_chunk(&state,&handle,Some("bytes=0-3"))).unwrap();assert_eq!(response.status(),206);assert_eq!(response.headers()["content-type"],"audio/mpeg");assert_eq!(response.body(),b"test");assert!(!String::from_utf8_lossy(response.body()).contains("synthetic"));worker.join().unwrap();
        state.inner.lock().unwrap().generation+=1;assert!(tauri::async_runtime::block_on(stream_chunk(&state,&handle,None)).is_err());
    }
    #[test] fn failed_candidate_fetch_keeps_current_stream() {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let port=listener.local_addr().unwrap().port();
        let worker=std::thread::spawn(move||{for response in [b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/4\r\nConnection: close\r\n\r\ntest".as_slice()]{let(mut socket,_)=listener.accept().unwrap();let mut request=[0u8;2048];let _=socket.read(&mut request);socket.write_all(response).unwrap();}});
        let old="A".repeat(40);let new="B".repeat(40);
        let stream=|handle:String,url:String|Stream{handle,url,mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(10),diagnostic_revision:0,resolve_revision:2};
        let state=QqWebAuth{inner:Arc::new(Mutex::new(Inner{generation:7,stream:Some(stream(old.clone(),format!("http://127.0.0.1:{port}/old"))),candidate:Some(stream(new.clone(),format!("http://127.0.0.1:{port}/candidate"))),..Default::default()})),client:reqwest::Client::builder().no_proxy().build().unwrap(),cleanup_failed:Arc::new(AtomicBool::new(false))};
        assert!(tauri::async_runtime::block_on(stream_chunk(&state,&new,Some("bytes=0-3"))).is_err());
        assert_eq!(tauri::async_runtime::block_on(stream_chunk(&state,&old,Some("bytes=0-3"))).unwrap().body(),b"test");worker.join().unwrap();
        let inner=state.inner.lock().unwrap();assert_eq!(inner.stream.as_ref().unwrap().handle,old);assert_eq!(inner.candidate.as_ref().unwrap().handle,new);
    }
    #[test] fn successful_candidate_fetch_retains_previous_for_rollback() {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let port=listener.local_addr().unwrap().port();
        let worker=std::thread::spawn(move||{let(mut socket,_)=listener.accept().unwrap();let mut request=[0u8;2048];let _=socket.read(&mut request);socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/4\r\nConnection: close\r\n\r\ntest").unwrap();});
        let old="A".repeat(40);let new="B".repeat(40);
        let stream=|handle:String,url:String|Stream{handle,url,mime:"audio/mpeg",generation:7,expires:Instant::now()+Duration::from_secs(10),diagnostic_revision:0,resolve_revision:2};
        let candidate=Stream{mime:"audio/mp4",..stream(new.clone(),format!("http://127.0.0.1:{port}/candidate"))};
        let state=QqWebAuth{inner:Arc::new(Mutex::new(Inner{generation:7,stream:Some(stream(old.clone(),"http://127.0.0.1/old".into())),candidate:Some(candidate),..Default::default()})),client:reqwest::Client::builder().no_proxy().build().unwrap(),cleanup_failed:Arc::new(AtomicBool::new(false))};
        let response=tauri::async_runtime::block_on(stream_chunk(&state,&new,Some("bytes=0-3"))).unwrap();
        assert_eq!(response.headers()["content-type"],"audio/mp4");
        assert_eq!(response.headers()["content-range"],"bytes 0-3/4");
        assert_eq!(response.body(),b"test");worker.join().unwrap();
        let inner=state.inner.lock().unwrap();assert_eq!(inner.stream.as_ref().unwrap().handle,new);assert_eq!(inner.previous.as_ref().unwrap().handle,old);
        assert_eq!(inner.previous.as_ref().unwrap().mime,"audio/mpeg");
    }
    #[test] fn invalid_content_ranges_are_rejected() {
        assert_eq!(content_range_len("bytes 0-3/4",0,3).unwrap(),4);
        for value in ["bytes 1-3/4","bytes 0-4/4","bytes 0-8/9","bytes 0-3/*","bytes 3-0/4"] {assert!(content_range_len(value,0,3).is_err());}
    }
    #[test] fn requires_explicit_business_success_and_profile() {
        assert!(profile_data(json!({"code":0,"req_0":{"code":0,"data":{"info":{"nick":"合成用户"}}}}),"123").is_ok());
        assert!(profile_data(json!({"code":0,"req_0":{"code":1}}),"123").is_err());
        assert!(profile_data(json!({"code":0,"req_0":{"code":0,"data":{}}}),"123").is_err());
    }
}
