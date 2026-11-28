use crate::{err, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};

const DEFAULT_TOOLTIP: &str = "Vesper";
const DEFAULT_PLAYBACK_LABEL: &str = "播放 / 暂停";

struct TrayControls {
    icon: TrayIcon,
    playback: MenuItem<tauri::Wry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum CloseMode {
    Ask,
    Background,
    Exit,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preference {
    version: u8,
    mode: CloseMode,
}
pub(crate) struct BackgroundState {
    mode: Mutex<CloseMode>,
    tray: OnceLock<TrayControls>,
    allow_exit: AtomicBool,
    user_hidden: AtomicBool,
    quit_pending: AtomicBool,
    path: Option<PathBuf>,
}
fn read_mode(path: Option<&PathBuf>) -> CloseMode {
    path.and_then(|p| fs::File::open(p).ok())
        .and_then(|f| crate::playback_storage::read_limited(f, 1024).ok())
        .filter(|b| b.len() <= 1024)
        .and_then(|b| serde_json::from_slice::<Preference>(&b).ok())
        .filter(|p| p.version == 1)
        .map(|p| p.mode)
        .unwrap_or(CloseMode::Ask)
}
#[derive(Debug, PartialEq, Eq)]
enum CloseAction {
    Close,
    Hide,
    Ask,
}
fn close_action(mode: CloseMode, tray_ready: bool, force: bool) -> CloseAction {
    if force {
        return CloseAction::Close;
    }
    match mode {
        CloseMode::Exit => CloseAction::Close,
        CloseMode::Background if tray_ready => CloseAction::Hide,
        _ => CloseAction::Ask,
    }
}
pub(crate) fn restore(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackgroundState>() {
        state.user_hidden.store(false, Ordering::SeqCst);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        crate::window_dwm::apply_for(&window);
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn force_quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackgroundState>() {
        state.allow_exit.store(true, Ordering::SeqCst);
    }
    if let Some(window) = app.get_webview_window("main") {
        if window.close().is_err() {
            app.exit(0);
        }
    } else {
        app.exit(0);
    }
}
fn quit(app: &AppHandle) {
    let Some(state) = app.try_state::<BackgroundState>() else {
        force_quit(app);
        return;
    };
    if state.quit_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    let emitted = app
        .get_webview_window("main")
        .is_some_and(|w| w.emit("prism-tray-exit", ()).is_ok());
    if !emitted {
        state.quit_pending.store(false, Ordering::SeqCst);
        force_quit(app);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if let Some(s) = app.try_state::<BackgroundState>() {
            if s.quit_pending.swap(false, Ordering::SeqCst) {
                force_quit(&app);
            }
        }
    });
}
pub(crate) fn may_reveal(app: &AppHandle) -> bool {
    app.try_state::<BackgroundState>()
        .is_none_or(|s| !s.user_hidden.load(Ordering::SeqCst))
}

pub(crate) fn allow_exit_for_update(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackgroundState>() {
        state.allow_exit.store(true, Ordering::SeqCst);
    }
}

pub(crate) fn restore_close_behavior_after_update_error(app: &AppHandle) {
    if let Some(state) = app.try_state::<BackgroundState>() {
        state.allow_exit.store(false, Ordering::SeqCst);
    }
}

fn emit_playback_action(app: &AppHandle, action: &str) {
    let _ = app.emit_to(
        "main",
        "prism:global-shortcut",
        serde_json::json!({ "action": action }),
    );
}

pub(crate) fn install(app: &mut App) {
    let path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("close-behavior.json"));
    let mode = read_mode(path.as_ref());
    app.manage(BackgroundState {
        mode: Mutex::new(mode),
        tray: OnceLock::new(),
        allow_exit: AtomicBool::new(false),
        user_hidden: AtomicBool::new(false),
        quit_pending: AtomicBool::new(false),
        path,
    });
    let tray = (|| -> tauri::Result<_> {
        let playback = MenuItem::with_id(
            app,
            "prism_play_toggle",
            DEFAULT_PLAYBACK_LABEL,
            true,
            None::<&str>,
        )?;
        let previous = MenuItem::with_id(app, "prism_prev", "上一首", true, None::<&str>)?;
        let next = MenuItem::with_id(app, "prism_next", "下一首", true, None::<&str>)?;
        let playback_separator = PredefinedMenuItem::separator(app)?;
        let exit_separator = PredefinedMenuItem::separator(app)?;
        let open = MenuItem::with_id(app, "prism_open", "打开 Vesper", true, None::<&str>)?;
        let exit = MenuItem::with_id(app, "prism_exit", "退出 Vesper", true, None::<&str>)?;
        let lyric = MenuItem::with_id(
            app,
            "prism_lyric_toggle",
            "显示/隐藏桌面歌词",
            true,
            None::<&str>,
        )?;
        let lock = MenuItem::with_id(
            app,
            "prism_lyric_lock",
            "锁定/解锁桌面歌词",
            true,
            None::<&str>,
        )?;
        let menu = Menu::with_items(
            app,
            &[
                &playback,
                &previous,
                &next,
                &playback_separator,
                &open,
                &lyric,
                &lock,
                &exit_separator,
                &exit,
            ],
        )?;
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/window-icon.png"))?;
        let icon = TrayIconBuilder::with_id("prism_tray")
            .icon(icon)
            .tooltip(DEFAULT_TOOLTIP)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "prism_play_toggle" => emit_playback_action(app, "togglePlayback"),
                "prism_prev" => emit_playback_action(app, "prevTrack"),
                "prism_next" => emit_playback_action(app, "nextTrack"),
                "prism_open" => restore(app),
                "prism_exit" => quit(app),
                "prism_lyric_toggle" => crate::desktop_lyric::toggle_from_tray(app, false),
                "prism_lyric_lock" => crate::desktop_lyric::toggle_from_tray(app, true),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    restore(tray.app_handle())
                }
            })
            .build(app)?;
        Ok(TrayControls { icon, playback })
    })();
    if let Ok(tray) = tray {
        let _ = app.state::<BackgroundState>().tray.set(tray);
    }
    if let Some(window) = app.get_webview_window("main") {
        let w = window.clone();
        let app_handle = app.handle().clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                app_handle.exit(0);
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = w.state::<BackgroundState>();
                let force = state.allow_exit.swap(false, Ordering::SeqCst);
                let mode = state.mode.lock().map(|m| *m).unwrap_or(CloseMode::Ask);
                match close_action(mode, state.tray.get().is_some(), force) {
                    CloseAction::Close => {}
                    CloseAction::Hide => {
                        api.prevent_close();
                        state.user_hidden.store(true, Ordering::SeqCst);
                        if w.hide().is_err() {
                            state.user_hidden.store(false, Ordering::SeqCst);
                            let _ = w.emit("prism-close-error", "无法转入后台，请重试");
                        }
                    }
                    CloseAction::Ask => {
                        api.prevent_close();
                        let _ = w.emit("prism-close-choice", ());
                    }
                }
            }
        });
    }
}
fn clean_tray_text(text: Option<&str>) -> String {
    let text: String = text
        .unwrap_or_default()
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect();
    text.trim().to_owned()
}

fn format_tray_tooltip(title: Option<&str>, artist: Option<&str>, playing: bool) -> String {
    let title = clean_tray_text(title);
    if title.is_empty() {
        return DEFAULT_TOOLTIP.to_owned();
    }
    let status = if playing { "正在播放" } else { "已暂停" };
    let mut tooltip = format!("Vesper · {status}：{title}");
    let artist = clean_tray_text(artist);
    if !artist.is_empty() {
        tooltip.push_str(" - ");
        tooltip.push_str(&artist);
    }
    // Windows allocates the tooltip buffer in UTF-16 code units.
    let mut units = 0;
    let cutoff = tooltip.char_indices().find(|&(_, ch)| {
        units += ch.len_utf16();
        units > 120
    });
    if let Some((end, _)) = cutoff {
        tooltip.truncate(end);
    }
    tooltip
}

#[cfg(windows)]
#[tauri::command]
pub(crate) fn tray_status_sync(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, BackgroundState>,
    title: Option<String>,
    artist: Option<String>,
    playing: bool,
) -> Result<()> {
    if window.label() != "main" {
        return Err(err("permission", "仅主窗口可以同步托盘状态"));
    }
    if let Some(tray) = state.tray.get() {
        let tooltip = format_tray_tooltip(title.as_deref(), artist.as_deref(), playing);
        let label = if tooltip == DEFAULT_TOOLTIP {
            DEFAULT_PLAYBACK_LABEL
        } else if playing {
            "暂停播放"
        } else {
            "继续播放"
        };
        let icon = tray.icon.clone();
        let playback = tray.playback.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = icon.set_tooltip(Some(&tooltip));
            let _ = playback.set_text(label);
        });
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn close_behavior_finish_exit(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, BackgroundState>,
) -> Result<()> {
    if window.label() != "main" {
        return Err(err("permission", "无权退出应用"));
    }
    if state.quit_pending.swap(false, Ordering::SeqCst) {
        force_quit(&app);
    }
    Ok(())
}
#[tauri::command]
pub(crate) fn close_behavior_get(
    window: WebviewWindow,
    state: State<'_, BackgroundState>,
) -> Result<serde_json::Value> {
    if window.label() != "main" {
        return Err(err("permission", "无权访问关闭设置"));
    }
    let mode = state
        .mode
        .lock()
        .map_err(|_| err("storage", "无法读取关闭设置"))?;
    Ok(serde_json::json!({"mode":*mode,"trayAvailable":state.tray.get().is_some()}))
}
#[tauri::command]
pub(crate) fn close_behavior_set(
    window: WebviewWindow,
    state: State<'_, BackgroundState>,
    mode: String,
    close_now: bool,
) -> Result<()> {
    if window.label() != "main" {
        return Err(err("permission", "无权修改关闭设置"));
    }
    let choice = match mode.as_str() {
        "background" => CloseMode::Background,
        "exit" => CloseMode::Exit,
        _ => return Err(err("validation", "关闭方式无效")),
    };
    if choice == CloseMode::Background && state.tray.get().is_none() {
        return Err(err("unsupported", "系统托盘不可用，无法转入后台"));
    }
    let path = state
        .path
        .as_ref()
        .ok_or(err("storage", "无法保存关闭设置"))?;
    let data = serde_json::to_vec(&Preference {
        version: 1,
        mode: choice,
    })
    .map_err(|_| err("storage", "无法保存关闭设置"))?;
    crate::playback_storage::write_if_changed(path, &data)
        .map_err(|_| err("storage", "无法保存关闭设置"))?;
    *state
        .mode
        .lock()
        .map_err(|_| err("storage", "无法保存关闭设置"))? = choice;
    if close_now {
        match choice {
            CloseMode::Background => {
                state.user_hidden.store(true, Ordering::SeqCst);
                if window.hide().is_err() {
                    state.user_hidden.store(false, Ordering::SeqCst);
                    return Err(err("window", "无法转入后台"));
                }
            }
            CloseMode::Exit => {
                state.allow_exit.store(true, Ordering::SeqCst);
                if window.close().is_err() {
                    state.allow_exit.store(false, Ordering::SeqCst);
                    return Err(err("window", "无法关闭窗口"));
                }
            }
            CloseMode::Ask => {}
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_tooltip_formats_playback_and_omits_missing_metadata() {
        assert_eq!(
            format_tray_tooltip(Some("夜车"), Some("曾轶可"), true),
            "Vesper · 正在播放：夜车 - 曾轶可"
        );
        assert_eq!(
            format_tray_tooltip(Some("夜车"), Some("\n\t\0"), false),
            "Vesper · 已暂停：夜车"
        );
        for title in [None, Some(""), Some(" \r\n\t\0 ")] {
            assert_eq!(format_tray_tooltip(title, Some("歌手"), true), "Vesper");
        }
    }

    #[test]
    fn tray_tooltip_replaces_control_characters_and_truncates_on_character_boundaries() {
        let tooltip = format_tray_tooltip(Some("\r 夜\n车\0"), Some("A\tB\u{85}C"), true);
        assert_eq!(tooltip, "Vesper · 正在播放：夜 车 - A B C");
        assert!(!tooltip.chars().any(char::is_control));

        let title = "夜A".repeat(100);
        let full = format!("Vesper · 正在播放：{title} - 艺人");
        let tooltip = format_tray_tooltip(Some(&title), Some("艺人"), true);
        assert_eq!(tooltip, full.chars().take(120).collect::<String>());

        let prefix = format!("Vesper · 正在播放：{}夜", "夜A".repeat(52));
        assert_eq!(prefix.encode_utf16().count(), 119);
        let title = format!("{}夜😀再见", "夜A".repeat(52));
        assert_eq!(format_tray_tooltip(Some(&title), None, true), prefix);
    }
    #[test]
    fn close_choice_never_hides_without_a_tray() {
        assert_eq!(close_action(CloseMode::Ask, true, false), CloseAction::Ask);
        assert_eq!(
            close_action(CloseMode::Background, true, false),
            CloseAction::Hide
        );
        assert_eq!(
            close_action(CloseMode::Background, false, false),
            CloseAction::Ask
        );
        assert_eq!(
            close_action(CloseMode::Exit, true, false),
            CloseAction::Close
        );
        assert_eq!(
            close_action(CloseMode::Background, true, true),
            CloseAction::Close
        );
    }
    #[test]
    fn persisted_choice_survives_reload_and_bad_data_defaults_to_ask() {
        let dir =
            std::env::temp_dir().join(format!("prism-close-test-{:016x}", rand::random::<u64>()));
        let path = dir.join("choice.json");
        let raw = serde_json::to_vec(&Preference {
            version: 1,
            mode: CloseMode::Background,
        })
        .unwrap();
        crate::playback_storage::write_if_changed(&path, &raw).unwrap();
        assert_eq!(read_mode(Some(&path)), CloseMode::Background);
        fs::write(&path, b"invalid").unwrap();
        assert_eq!(read_mode(Some(&path)), CloseMode::Ask);
        fs::remove_file(path).unwrap();
        fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn preference_defaults_and_validation() {
        assert_eq!(read_mode(None), CloseMode::Ask);
        assert!(serde_json::from_str::<Preference>(r#"{"version":1,"mode":"background"}"#).is_ok());
        assert!(serde_json::from_str::<Preference>(r#"{"version":1,"mode":"invalid"}"#).is_err());
        assert!(
            serde_json::from_str::<Preference>(r#"{"version":1,"mode":"exit","extra":1}"#).is_err()
        );
    }
}
