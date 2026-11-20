use std::{
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicU8, Ordering}, mpsc, Arc},
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
use windows::core::Interface;
use windows::core::BOOL;

#[tauri::command]
fn synthetic_privileged() -> &'static str { "synthetic privileged result" }

fn secure_profile_dir(root: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(root)?;
    let root = root.canonicalize()?;
    let name = format!("probe_{}_{}", std::process::id(), std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
    let path = root.join(name);
    std::fs::create_dir(&path)?;
    Ok(path)
}

fn cleanup_profile(root: &Path, target: &Path) -> bool {
    let Ok(root) = root.canonicalize() else { return false };
    let Ok(target) = target.canonicalize() else { return false };
    if target.parent() != Some(root.as_path())
        || !target.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("probe_"))
    { return false; }
    std::fs::remove_dir_all(&target).is_ok()
}

fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("loopback fixture");
    listener.set_nonblocking(true).expect("loopback nonblocking");
    let port = listener.local_addr().unwrap().port();
    let page_url = format!("http://127.0.0.1:{port}/fixture");
    let signal = Arc::new(AtomicU8::new(0));
    let server_signal = signal.clone();
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline && server_signal.load(Ordering::Relaxed) == 0 {
            let Ok((mut stream, _)) = listener.accept() else {
                thread::sleep(Duration::from_millis(25)); continue
            };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let mut req = [0_u8; 2048];
            let n = stream.read(&mut req).unwrap_or(0);
            let first = String::from_utf8_lossy(&req[..n]);
            let path = first.lines().next().unwrap_or("");
            if path.starts_with("GET /result?status=denied ") {
                server_signal.store(1, Ordering::Relaxed);
            } else if path.starts_with("GET /result?status=unavailable ") {
                server_signal.store(2, Ordering::Relaxed);
            } else if path.starts_with("GET /result?status=reached ") {
                server_signal.store(3, Ordering::Relaxed);
            }
            let body = r#"<!doctype html><meta charset="utf-8"><title>隔离授权测试</title><p>仅使用本机虚构数据。</p><script>
            (async()=>{let status='unavailable';try{if(window.__TAURI_INTERNALS__?.invoke){await window.__TAURI_INTERNALS__.invoke('synthetic_privileged');status='reached'}}catch(_){status='denied'}try{await fetch('/result?status='+status)}catch(_){}})();
            </script>"#;
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nSet-Cookie: xianyu_fixture=fake_only; Path=/; SameSite=Strict\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(body.as_bytes());
        }
    });

    let root = std::env::temp_dir().join("xianyu_qq_auth_isolation_fixture");
    let profile_dir = secure_profile_dir(&root).expect("isolated fixture directory");
    let cleanup_root = root.clone();
    let cleanup_target = profile_dir.clone();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![synthetic_privileged])
        .setup(move |app| {
            let main = app.get_webview_window("main").expect("fixture main window");
            let remote = WebviewWindowBuilder::new(
                app, "synthetic-auth", WebviewUrl::External("about:blank".parse().unwrap()),
            )
                .title("轻屿：临时授权隔离测试（合成数据）")
                .inner_size(560.0, 240.0)
                .data_directory(profile_dir.clone())
                .incognito(true)
                .general_autofill_enabled(false)
                .on_navigation(move |url| {
                    (url.scheme() == "about" && url.path() == "blank")
                        || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
                            && url.port() == Some(port) && url.path() == "/fixture")
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            let (tx, rx) = mpsc::sync_channel(1);
            remote.with_webview(move |wv| {
                let checked = (|| -> windows::core::Result<bool> {
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
                let _ = tx.send(checked);
            })?;
            let app = app.handle().clone();
            let url: tauri::Url = page_url.parse().unwrap();
            thread::spawn(move || {
                let settings_disabled = rx.recv_timeout(Duration::from_secs(10)).unwrap_or(false);
                let mut cookie_isolated = false;
                let mut remote_cookie_present = false;
                let mut ipc = 0_u8;
                let mut cleared = false;
                if settings_disabled && remote.navigate(url.clone()).is_ok() {
                    let deadline = Instant::now() + Duration::from_secs(12);
                    while Instant::now() < deadline {
                        ipc = signal.load(Ordering::Relaxed);
                        if ipc != 0 { break; }
                        thread::sleep(Duration::from_millis(50));
                    }
                    let remote_has = remote.cookies_for_url(url.clone()).ok().is_some_and(|cs| {
                        cs.iter().any(|c| c.name() == "xianyu_fixture" && c.value() == "fake_only")
                    });
                    let main_has = main.cookies_for_url(url.clone()).ok().is_some_and(|cs| {
                        cs.iter().any(|c| c.name() == "xianyu_fixture")
                    });
                    remote_cookie_present = remote_has;
                    cookie_isolated = remote_has && !main_has;
                    cleared = remote.clear_all_browsing_data().is_ok();
                }
                let _ = remote.close();
                thread::sleep(Duration::from_secs(2));
                let removed = cleanup_profile(&cleanup_root, &cleanup_target);
                println!("QQ_AUTH_ISOLATION_RESULT {}", serde_json::json!({
                    "password_and_autofill_disabled": settings_disabled,
                    "remote_fixture_cookie_present": remote_cookie_present,
                    "cookie_isolated": cookie_isolated,
                    "remote_custom_ipc": match ipc {1 => "denied", 2 => "unavailable", 3 => "reachable", _ => "unobserved"},
                    "isolated_profile_cleared": cleared,
                    "isolated_directory_removed": removed,
                    "ok": settings_disabled && cookie_isolated && (ipc == 1 || ipc == 2) && cleared && removed
                }));
                app.exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("fixture app");
}
