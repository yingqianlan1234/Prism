use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Mutex}};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use crate::{err, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="lowercase")]
enum CloseMode { Ask, Background, Exit }
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preference { version: u8, mode: CloseMode }
pub(crate) struct BackgroundState { mode: Mutex<CloseMode>, tray_ready: AtomicBool, allow_exit: AtomicBool, user_hidden: AtomicBool, quit_pending: AtomicBool, path: Option<PathBuf> }
fn read_mode(path: Option<&PathBuf>) -> CloseMode {
    path.and_then(|p|fs::File::open(p).ok()).and_then(|f|crate::playback_storage::read_limited(f,1024).ok()).filter(|b|b.len()<=1024)
        .and_then(|b|serde_json::from_slice::<Preference>(&b).ok())
        .filter(|p|p.version==1).map(|p|p.mode).unwrap_or(CloseMode::Ask)
}
#[derive(Debug, PartialEq, Eq)]
enum CloseAction { Close, Hide, Ask }
fn close_action(mode:CloseMode,tray_ready:bool,force:bool)->CloseAction {
    if force{return CloseAction::Close}
    match mode {CloseMode::Exit=>CloseAction::Close,CloseMode::Background if tray_ready=>CloseAction::Hide,_=>CloseAction::Ask}
}
fn restore(app:&AppHandle) {
    if let Some(state)=app.try_state::<BackgroundState>() { state.user_hidden.store(false,Ordering::SeqCst); }
    if let Some(window)=app.get_webview_window("main") { let _=window.show(); crate::window_dwm::apply_for(&window); let _=window.unminimize(); let _=window.set_focus(); }
}
fn force_quit(app:&AppHandle) {
    if let Some(state)=app.try_state::<BackgroundState>() { state.allow_exit.store(true,Ordering::SeqCst); }
    if let Some(window)=app.get_webview_window("main") { if window.close().is_err() { app.exit(0); } } else { app.exit(0); }
}
fn quit(app:&AppHandle) {
    let Some(state)=app.try_state::<BackgroundState>() else {force_quit(app);return};
    if state.quit_pending.swap(true,Ordering::SeqCst){return}
    let emitted=app.get_webview_window("main").is_some_and(|w|w.emit("prism-tray-exit",()).is_ok());
    if !emitted {state.quit_pending.store(false,Ordering::SeqCst);force_quit(app);return}
    let app=app.clone();std::thread::spawn(move||{std::thread::sleep(std::time::Duration::from_secs(3));if let Some(s)=app.try_state::<BackgroundState>(){if s.quit_pending.swap(false,Ordering::SeqCst){force_quit(&app);}}});
}
pub(crate) fn may_reveal(app:&AppHandle)->bool { app.try_state::<BackgroundState>().is_none_or(|s|!s.user_hidden.load(Ordering::SeqCst)) }

pub(crate) fn install(app:&mut App) {
    let path=app.path().app_data_dir().ok().map(|p|p.join("close-behavior.json"));
    let mode=read_mode(path.as_ref());
    app.manage(BackgroundState { mode:Mutex::new(mode), tray_ready:AtomicBool::new(false), allow_exit:AtomicBool::new(false), user_hidden:AtomicBool::new(false), quit_pending:AtomicBool::new(false), path });
    let tray=(|| -> tauri::Result<_> {
        let open=MenuItem::with_id(app,"prism_open","打开 Vesper",true,None::<&str>)?;
        let exit=MenuItem::with_id(app,"prism_exit","退出 Vesper",true,None::<&str>)?;
        let lyric=MenuItem::with_id(app,"prism_lyric_toggle","显示/隐藏桌面歌词",true,None::<&str>)?;
        let lock=MenuItem::with_id(app,"prism_lyric_lock","锁定/解锁桌面歌词",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&lyric,&lock,&exit])?;
        let icon=tauri::image::Image::from_bytes(include_bytes!("../icons/window-icon.png"))?;
        TrayIconBuilder::with_id("prism_tray").icon(icon).tooltip("Vesper").menu(&menu).show_menu_on_left_click(false)
            .on_menu_event(|app,event|match event.id().as_ref(){
                "prism_open"=>restore(app),"prism_exit"=>quit(app),
                "prism_lyric_toggle"=>crate::desktop_lyric::toggle_from_tray(app,false),
                "prism_lyric_lock"=>crate::desktop_lyric::toggle_from_tray(app,true),_=>{}
            })
            .on_tray_icon_event(|tray,event|if let TrayIconEvent::Click{button:MouseButton::Left,button_state:MouseButtonState::Up,..}=event{restore(tray.app_handle())})
            .build(app)
    })();
    app.state::<BackgroundState>().tray_ready.store(tray.is_ok(),Ordering::SeqCst);
    if let Some(window)=app.get_webview_window("main") {
        let w=window.clone();let app_handle=app.handle().clone();window.on_window_event(move |event|{if matches!(event,WindowEvent::Destroyed){app_handle.exit(0);return}if let WindowEvent::CloseRequested{api,..}=event{
            let state=w.state::<BackgroundState>();
            let force=state.allow_exit.swap(false,Ordering::SeqCst);
            let mode=state.mode.lock().map(|m|*m).unwrap_or(CloseMode::Ask);
            match close_action(mode,state.tray_ready.load(Ordering::SeqCst),force) {
                CloseAction::Close=>{},
                CloseAction::Hide=>{api.prevent_close();state.user_hidden.store(true,Ordering::SeqCst);if w.hide().is_err(){state.user_hidden.store(false,Ordering::SeqCst);let _=w.emit("prism-close-error","无法转入后台，请重试");}},
                CloseAction::Ask=>{api.prevent_close();let _=w.emit("prism-close-choice",());}
            }
        }});
    }
}
#[tauri::command]
pub(crate) fn close_behavior_finish_exit(window:WebviewWindow,app:AppHandle,state:State<'_,BackgroundState>)->Result<()> {
    if window.label()!="main"{return Err(err("permission","无权退出应用"))}
    if state.quit_pending.swap(false,Ordering::SeqCst){force_quit(&app);}
    Ok(())
}
#[tauri::command]
pub(crate) fn close_behavior_get(window:WebviewWindow,state:State<'_,BackgroundState>)->Result<serde_json::Value>{
    if window.label()!="main"{return Err(err("permission","无权访问关闭设置"))}
    let mode=state.mode.lock().map_err(|_|err("storage","无法读取关闭设置"))?;
    Ok(serde_json::json!({"mode":*mode,"trayAvailable":state.tray_ready.load(Ordering::SeqCst)}))
}
#[tauri::command]
pub(crate) fn close_behavior_set(window:WebviewWindow,state:State<'_,BackgroundState>,mode:String,close_now:bool)->Result<()> {
    if window.label()!="main"{return Err(err("permission","无权修改关闭设置"))}
    let choice=match mode.as_str(){"background"=>CloseMode::Background,"exit"=>CloseMode::Exit,_=>return Err(err("validation","关闭方式无效"))};
    if choice==CloseMode::Background&&!state.tray_ready.load(Ordering::SeqCst){return Err(err("unsupported","系统托盘不可用，无法转入后台"))}
    let path=state.path.as_ref().ok_or(err("storage","无法保存关闭设置"))?;
    let data=serde_json::to_vec(&Preference{version:1,mode:choice}).map_err(|_|err("storage","无法保存关闭设置"))?;
    crate::playback_storage::write_if_changed(path,&data).map_err(|_|err("storage","无法保存关闭设置"))?;
    *state.mode.lock().map_err(|_|err("storage","无法保存关闭设置"))?=choice;
    if close_now {match choice {CloseMode::Background=>{state.user_hidden.store(true,Ordering::SeqCst);if window.hide().is_err(){state.user_hidden.store(false,Ordering::SeqCst);return Err(err("window","无法转入后台"))}},CloseMode::Exit=>{state.allow_exit.store(true,Ordering::SeqCst);if window.close().is_err(){state.allow_exit.store(false,Ordering::SeqCst);return Err(err("window","无法关闭窗口"))}},CloseMode::Ask=>{}}}
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn close_choice_never_hides_without_a_tray(){assert_eq!(close_action(CloseMode::Ask,true,false),CloseAction::Ask);assert_eq!(close_action(CloseMode::Background,true,false),CloseAction::Hide);assert_eq!(close_action(CloseMode::Background,false,false),CloseAction::Ask);assert_eq!(close_action(CloseMode::Exit,true,false),CloseAction::Close);assert_eq!(close_action(CloseMode::Background,true,true),CloseAction::Close);}
    #[test] fn persisted_choice_survives_reload_and_bad_data_defaults_to_ask(){let dir=std::env::temp_dir().join(format!("prism-close-test-{:016x}",rand::random::<u64>()));let path=dir.join("choice.json");let raw=serde_json::to_vec(&Preference{version:1,mode:CloseMode::Background}).unwrap();crate::playback_storage::write_if_changed(&path,&raw).unwrap();assert_eq!(read_mode(Some(&path)),CloseMode::Background);fs::write(&path,b"invalid").unwrap();assert_eq!(read_mode(Some(&path)),CloseMode::Ask);fs::remove_file(path).unwrap();fs::remove_dir(dir).unwrap();}
    #[test] fn preference_defaults_and_validation(){assert_eq!(read_mode(None),CloseMode::Ask);assert!(serde_json::from_str::<Preference>(r#"{"version":1,"mode":"background"}"#).is_ok());assert!(serde_json::from_str::<Preference>(r#"{"version":1,"mode":"invalid"}"#).is_err());assert!(serde_json::from_str::<Preference>(r#"{"version":1,"mode":"exit","extra":1}"#).is_err());}
}

