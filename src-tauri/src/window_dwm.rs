// 仅 Windows：给 Prism 主窗口的**系统标题栏**精确着色。
// 边界（不得越界）：
// - 只作用于 main 窗口，不改窗口装饰模式，不设置 decorations:false，不启用 Mica / Acrylic / 透明窗口；
// - 不支持 DWMWA_CAPTION_COLOR 的 Windows 版本（Windows 10 及更早）会返回错误，这里按设计静默降级；
// - 任何失败都不得影响窗口创建、几何恢复或启动流程，因此本模块不向外返回 Result。
use tauri::{App, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
};

/// 把 web 十六进制颜色（0x00RRGGBB）转成 DWM 期望的 COLORREF（0x00BBGGRR）。
const fn colorref(hex: u32) -> u32 {
    ((hex & 0x0000_00FF) << 16) | (hex & 0x0000_FF00) | ((hex & 0x00FF_0000) >> 16)
}

/// 深靛夜色 #0E1624：标题栏背景与边框同色，让系统标题栏和深夜电台页面连成一片。
pub(crate) const CAPTION: u32 = colorref(0x0E1624);
/// #F0F4FA：标题栏文字沿用深夜电台主字色。
pub(crate) const TEXT: u32 = colorref(0xF0F4FA);

fn paint(hwnd: HWND) {
    for (attribute, value) in [
        (DWMWA_CAPTION_COLOR, CAPTION),
        (DWMWA_TEXT_COLOR, TEXT),
        (DWMWA_BORDER_COLOR, CAPTION),
    ] {
        // DWM 在 Windows 10 上对这些属性返回 E_INVALIDARG；丢弃错误就是既定的降级路径。
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

/// 在主窗口创建后调用；窗口不存在或拿不到 HWND 时直接返回。
pub fn install(app: &App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    apply_for(&window);
}

/// 对任意窗口应用标题栏配色。
/// 隐藏窗口不会被 DWM 合成，属性可能被忽略，所以窗口显示后必须再调用一次。
pub fn apply_for(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        paint(hwnd);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colorref_matches_dwm_byte_order() {
        // #0E1624 的 RGB 是 0x0E/0x16/0x24，COLORREF 是 0x00BBGGRR。
        assert_eq!(CAPTION, 0x0024_160E);
        assert_eq!(TEXT, 0x00FA_F4F0);
        assert_eq!(colorref(0x000000), 0);
        assert_eq!(colorref(0xFF0000), 0x0000_00FF);
        assert_eq!(colorref(0x00FF00), 0x0000_FF00);
        assert_eq!(colorref(0x0000FF), 0x00FF_0000);
    }
}
