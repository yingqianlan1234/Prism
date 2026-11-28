use crate::{desktop_lyric, err, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeMap, fs, path::Path};
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL,
            MOD_NOREPEAT, MOD_SHIFT,
        },
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WM_HOTKEY, WM_NCDESTROY},
    },
};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum Action {
    TogglePlayback,
    PrevTrack,
    NextTrack,
    VolumeUp,
    VolumeDown,
    ToggleDesktopLyric,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Shortcuts {
    enabled: bool,
    bindings: BTreeMap<Action, String>,
}

impl Default for Shortcuts {
    fn default() -> Self {
        use Action::*;
        let bindings = [
            (TogglePlayback, "Ctrl+Alt+P"),
            (PrevTrack, "Ctrl+Alt+Left"),
            (NextTrack, "Ctrl+Alt+Right"),
            (VolumeUp, "Ctrl+Alt+Up"),
            (VolumeDown, "Ctrl+Alt+Down"),
            (ToggleDesktopLyric, "Ctrl+Alt+D"),
        ]
        .into_iter()
        .map(|(action, key)| (action, key.to_owned()))
        .collect();
        Self {
            enabled: false,
            bindings,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Preference {
    version: u8,
    shortcuts: Shortcuts,
}

#[derive(Clone, Copy, Debug)]
struct Hotkey {
    action: Action,
    modifiers: HOT_KEY_MODIFIERS,
    vk: u32,
}

fn hotkeys(settings: &Shortcuts) -> Result<BTreeMap<i32, Hotkey>> {
    if settings.enabled && settings.bindings.is_empty() {
        return Err(err("validation", "请至少设置一个快捷键"));
    }
    let mut keys = BTreeMap::new();
    for (&action, binding) in &settings.bindings {
        let (key, modifiers) = if let Some(key) = binding.strip_prefix("Ctrl+Alt+") {
            (key, MOD_CONTROL | MOD_ALT)
        } else if let Some(key) = binding.strip_prefix("Ctrl+Shift+") {
            (key, MOD_CONTROL | MOD_SHIFT)
        } else {
            return Err(err("validation", "快捷键须以 Ctrl+Alt 或 Ctrl+Shift 开头"));
        };
        let vk = match key.as_bytes() {
            b"Space" => 0x20,
            b"Left" => 0x25,
            b"Up" => 0x26,
            b"Right" => 0x27,
            b"Down" => 0x28,
            [letter @ b'A'..=b'Z'] => u32::from(*letter),
            [b'F', digit @ b'1'..=b'9'] => 0x6F + u32::from(*digit - b'0'),
            b"F10" => 0x79,
            b"F11" => 0x7A,
            _ => return Err(err("validation", "请使用方向键、Space、A–Z 或 F1–F11")),
        };
        let id = ((modifiers.0 << 8) | vk) as i32;
        if keys
            .insert(
                id,
                Hotkey {
                    action,
                    modifiers,
                    vk,
                },
            )
            .is_some()
        {
            return Err(err("conflict", "两个动作使用了同一个快捷键"));
        }
    }
    if !settings.enabled {
        keys.clear();
    }
    Ok(keys)
}

struct Desktop {
    app: AppHandle,
    settings: Shortcuts,
    keys: BTreeMap<i32, Hotkey>,
    error: Option<crate::Error>,
}

thread_local! { static DESKTOP: RefCell<Option<Desktop>> = const { RefCell::new(None) }; }

pub(crate) fn install(app: &mut App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(native) = window.hwnd() else { return };
    let hwnd = HWND(native.0);
    if !unsafe { SetWindowSubclass(hwnd, Some(window_proc), 1, 0) }.as_bool() {
        return;
    }
    let app = app.handle().clone();
    let settings = config_path(&app, "global-shortcuts.json")
        .ok()
        .and_then(|path| read_config::<Preference>(&path))
        .filter(|pref| pref.version == 1 && hotkeys(&pref.shortcuts).is_ok())
        .map(|pref| pref.shortcuts)
        .unwrap_or_default();
    desktop_lyric::install(&app);
    let mut desktop = Desktop {
        app,
        settings: settings.clone(),
        keys: BTreeMap::new(),
        error: None,
    };
    if let Err(error) = apply_shortcuts(&mut desktop, hwnd, settings, false) {
        desktop.settings.enabled = false;
        desktop.error = Some(error);
    }
    DESKTOP.with(|state| state.replace(Some(desktop)));
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    if message == WM_HOTKEY {
        let notification = DESKTOP.with(|state| {
            let state = state.borrow();
            let desktop = state.as_ref()?;
            let key = desktop.keys.get(&(wparam.0 as i32))?;
            Some((desktop.app.clone(), key.action))
        });
        if let Some((app, action)) = notification {
            let _ = app.emit_to(
                "main",
                "prism:global-shortcut",
                serde_json::json!({ "action": action }),
            );
            return LRESULT(0);
        }
    } else if message == WM_NCDESTROY {
        if let Some(desktop) = DESKTOP.with(|state| state.take()) {
            unregister(hwnd, desktop.keys.keys().copied());
        }
        desktop_lyric::shutdown();
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(window_proc), 1) };
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

fn unregister(hwnd: HWND, ids: impl IntoIterator<Item = i32>) {
    for id in ids {
        let _ = unsafe { UnregisterHotKey(Some(hwnd), id) };
    }
}

fn register_new(
    hwnd: HWND,
    current: &BTreeMap<i32, Hotkey>,
    next: &BTreeMap<i32, Hotkey>,
) -> Result<Vec<i32>> {
    let mut added = Vec::new();
    for (&id, key) in next {
        if current.contains_key(&id) {
            continue;
        }
        if unsafe { RegisterHotKey(Some(hwnd), id, key.modifiers | MOD_NOREPEAT, key.vk) }.is_err()
        {
            unregister(hwnd, added);
            return Err(err("conflict", "系统快捷键已被占用或无法注册"));
        }
        added.push(id);
    }
    Ok(added)
}

fn apply_shortcuts(
    desktop: &mut Desktop,
    hwnd: HWND,
    settings: Shortcuts,
    persist: bool,
) -> Result<()> {
    let next = hotkeys(&settings)?;
    let added = register_new(hwnd, &desktop.keys, &next)?;
    if persist {
        let saved = config_path(&desktop.app, "global-shortcuts.json").and_then(|path| {
            write_config(
                &path,
                &Preference {
                    version: 1,
                    shortcuts: settings.clone(),
                },
            )
        });
        if let Err(error) = saved {
            if settings.enabled {
                unregister(hwnd, added);
                return Err(error);
            }
            // Turning off always releases the OS shortcuts, even if saving fails.
            unregister(hwnd, desktop.keys.keys().copied());
            desktop.keys.clear();
            desktop.settings = settings;
            desktop.error = Some(err("storage", "快捷键已关闭，但无法保存设置"));
            return Err(err("storage", "快捷键已关闭，但无法保存设置"));
        }
    }
    unregister(
        hwnd,
        desktop
            .keys
            .keys()
            .copied()
            .filter(|id| !next.contains_key(id)),
    );
    desktop.keys = next;
    desktop.settings = settings;
    desktop.error = None;
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct ShortcutStatus {
    #[serde(flatten)]
    settings: Shortcuts,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<crate::Error>,
}

fn status(desktop: &Desktop) -> ShortcutStatus {
    ShortcutStatus {
        settings: desktop.settings.clone(),
        error: desktop.error.as_ref().map(|e| err(e.kind, e.message)),
    }
}

#[tauri::command]
pub(crate) async fn global_shortcuts_get(window: WebviewWindow) -> Result<ShortcutStatus> {
    on_ui(window, |_| {
        DESKTOP.with(|state| {
            state
                .borrow()
                .as_ref()
                .map(status)
                .ok_or(err("unavailable", "系统快捷键不可用"))
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn global_shortcuts_set(
    window: WebviewWindow,
    enabled: bool,
    bindings: Value,
) -> Result<ShortcutStatus> {
    let bindings =
        serde_json::from_value(bindings).map_err(|_| err("validation", "快捷键绑定无效"))?;
    on_ui(window, move |hwnd| {
        DESKTOP.with(|state| {
            let mut state = state.borrow_mut();
            let desktop = state
                .as_mut()
                .ok_or(err("unavailable", "系统快捷键不可用"))?;
            apply_shortcuts(desktop, hwnd, Shortcuts { enabled, bindings }, true)?;
            Ok(status(desktop))
        })
    })
    .await
}

pub(super) async fn on_ui<T: Send + 'static>(
    window: WebviewWindow,
    operation: impl FnOnce(HWND) -> Result<T> + Send + 'static,
) -> Result<T> {
    if window.label() != "main" {
        return Err(err("permission", "仅主窗口可以管理桌面功能"));
    }
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    let main_window = window.clone();
    window
        .run_on_main_thread(move || {
            let result = main_window
                .hwnd()
                .map_err(|_| err("unavailable", "主窗口不可用"))
                .and_then(|hwnd| operation(HWND(hwnd.0)));
            let _ = sender.try_send(result);
        })
        .map_err(|_| err("unavailable", "主窗口不可用"))?;
    receiver
        .recv()
        .await
        .ok_or(err("unavailable", "主窗口不可用"))?
}

pub(super) fn config_path(app: &AppHandle, file: &str) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(file))
        .map_err(|_| err("storage", "应用配置目录不可用"))
}

pub(super) fn read_config<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = crate::playback_storage::read_limited(fs::File::open(path).ok()?, 4096).ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

pub(super) fn write_config(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| err("storage", "无法编码桌面设置"))?;
    crate::playback_storage::write_if_changed(path, &bytes)
        .map_err(|_| err("storage", "无法保存桌面设置"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_supported_combinations_without_consuming_in_app_keys() {
        let mut settings = Shortcuts::default();
        assert!(hotkeys(&settings).unwrap().is_empty());
        settings.enabled = true;
        assert_eq!(hotkeys(&settings).unwrap().len(), 6);
        settings
            .bindings
            .insert(Action::TogglePlayback, "Ctrl+Alt+Left".into());
        assert_eq!(hotkeys(&settings).unwrap_err().kind, "conflict");
        for (suffix, vk) in [
            ("Left", 0x25),
            ("Up", 0x26),
            ("Right", 0x27),
            ("Down", 0x28),
            ("Space", 0x20),
            ("A", 0x41),
            ("Z", 0x5a),
            ("F1", 0x70),
            ("F11", 0x7a),
        ] {
            settings
                .bindings
                .insert(Action::TogglePlayback, format!("Ctrl+Shift+{suffix}"));
            assert!(hotkeys(&settings)
                .unwrap()
                .values()
                .any(|key| key.action == Action::TogglePlayback && key.vk == vk));
        }
        for invalid in [
            "Space",
            "Left",
            "Ctrl+L",
            "Ctrl+Alt+p",
            "Ctrl+Alt+F01",
            "Ctrl+Alt+F12",
            "Win+F5",
        ] {
            settings
                .bindings
                .insert(Action::TogglePlayback, invalid.into());
            assert_eq!(hotkeys(&settings).unwrap_err().kind, "validation");
        }
    }

    #[test]
    fn windows_conflict_releases_partially_registered_keys() {
        use windows::{
            core::w,
            Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
            },
        };
        struct Window(HWND);
        impl Drop for Window {
            fn drop(&mut self) {
                let _ = unsafe { DestroyWindow(self.0) };
            }
        }
        let window = || {
            Window(
                unsafe {
                    CreateWindowExW(
                        WINDOW_EX_STYLE(0),
                        w!("STATIC"),
                        w!(""),
                        WINDOW_STYLE(0),
                        0,
                        0,
                        0,
                        0,
                        Some(HWND_MESSAGE),
                        None,
                        None,
                        None,
                    )
                }
                .unwrap(),
            )
        };
        let existing = window();
        let candidate = window();
        let settings = Shortcuts {
            enabled: true,
            ..Shortcuts::default()
        };
        let mut free = hotkeys(&settings).unwrap().into_iter().filter(|(id, key)| {
            if unsafe { RegisterHotKey(Some(existing.0), *id, key.modifiers, key.vk) }.is_err() {
                return false;
            }
            unregister(existing.0, [*id]);
            true
        });
        let first = free.next().expect("one test shortcut must be available");
        let second = free.next().expect("two test shortcuts must be available");
        unsafe { RegisterHotKey(Some(existing.0), second.0, second.1.modifiers, second.1.vk) }
            .unwrap();
        let result = register_new(
            candidate.0,
            &BTreeMap::new(),
            &BTreeMap::from([first, second]),
        );
        assert_eq!(result.unwrap_err().kind, "conflict");
        unsafe { RegisterHotKey(Some(existing.0), first.0, first.1.modifiers, first.1.vk) }
            .expect("partial registration should have been released");
        unregister(existing.0, [first.0, second.0]);
    }
}
