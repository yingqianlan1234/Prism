// Windows 11 的 DWM 圆角及边框配色。旧版 Windows 会忽略不支持的属性。
use std::sync::Mutex;
use tauri::{App, Manager, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};

// 依次记录背景、边框和文字的 RGB 色值。
static THEME: Mutex<[u32; 3]> = Mutex::new(OBSIDIAN);
const OBSIDIAN: [u32; 3] = [0x080A0F, 0x232A38, 0xF2F4F8];

fn theme_colors(theme: &str) -> [u32; 3] {
    match theme {
        "warm" => [0x100F0E, 0x2E2924, 0xF4F0E8],
        "night-radio" => [0x0E1624, 0x22324B, 0xF0F4FA],
        "crystal" => [0xEEF3FA, 0xCBD5E1, 0x0F172A],
        _ => OBSIDIAN,
    }
}

/// 将 RGB 十六进制色值（0x00RRGGBB）转为 DWM 的 COLORREF（0x00BBGGRR）。
const fn colorref(hex: u32) -> u32 {
    ((hex & 0x0000_00FF) << 16) | (hex & 0x0000_FF00) | ((hex & 0x00FF_0000) >> 16)
}

fn paint(hwnd: HWND, [background, border, text]: [u32; 3]) {
    for (attribute, value) in [
        (DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND.0 as u32),
        (DWMWA_CAPTION_COLOR, colorref(background)),
        (DWMWA_BORDER_COLOR, colorref(border)),
        (DWMWA_TEXT_COLOR, colorref(text)),
    ] {
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                &value as *const u32 as *const core::ffi::c_void,
                core::mem::size_of::<u32>() as u32,
            )
        };
    }
}

pub fn install(app: &App) {
    if let Some(window) = app.get_webview_window("main") {
        apply_for(&window);
    }
}

pub fn sync_theme(window: &WebviewWindow, theme: &str) {
    *THEME.lock().unwrap_or_else(|err| err.into_inner()) = theme_colors(theme);
    apply_for(window);
}

/// 隐藏窗口的 DWM 属性可能被忽略，显示后用当前主题重新应用。
pub fn apply_for(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        // 应用期间持锁，避免窗口恢复时用旧配色覆盖刚同步的主题。
        let colors = THEME.lock().unwrap_or_else(|err| err.into_inner());
        paint(hwnd, *colors);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_colors_match_palette_and_fall_back_to_obsidian() {
        assert_eq!(theme_colors("obsidian"), [0x080A0F, 0x232A38, 0xF2F4F8]);
        assert_eq!(theme_colors("warm"), [0x100F0E, 0x2E2924, 0xF4F0E8]);
        assert_eq!(theme_colors("night-radio"), [0x0E1624, 0x22324B, 0xF0F4FA]);
        assert_eq!(theme_colors("crystal"), [0xEEF3FA, 0xCBD5E1, 0x0F172A]);
        assert_eq!(theme_colors("unknown"), theme_colors("obsidian"));
    }

    #[test]
    fn colorref_matches_dwm_byte_order() {
        assert_eq!(colorref(0x0E1624), 0x0024_160E);
        assert_eq!(colorref(0xF0F4FA), 0x00FA_F4F0);
        assert_eq!(colorref(0x000000), 0);
        assert_eq!(colorref(0xFF0000), 0x0000_00FF);
        assert_eq!(colorref(0x00FF00), 0x0000_FF00);
        assert_eq!(colorref(0x0000FF), 0x00FF_0000);
    }
}
