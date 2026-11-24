use crate::{desktop_shortcuts::{config_path, on_ui, read_config, write_config}, err, Result};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, path::PathBuf, ptr::NonNull, sync::OnceLock};
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::{core::{w, PCWSTR}, Win32::{
    Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
    Graphics::Gdi::*,
    System::LibraryLoader::GetModuleHandleW,
    UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
}};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Position { x: i32, y: i32 }

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Placement { version: u8, position: Position }

#[derive(Clone, Copy, Serialize)]
pub(crate) struct LyricStatus { enabled: bool, locked: bool, position: Option<Position> }

#[derive(Clone, Default, PartialEq, Eq)]
struct Content {
    text: String,
    translation: String,
    romaji: String,
    title: String,
    playing: bool,
}

fn line(value: String) -> Result<String> {
    if value.len() > 2048 || value.chars().count() > 512 {
        return Err(err("validation", "桌面歌词文字过长"));
    }
    Ok(value.chars().map(|c| if c.is_control() { ' ' } else { c }).collect())
}

struct Overlay {
    app: AppHandle,
    path: Option<PathBuf>,
    hwnd: Option<HWND>,
    locked: bool,
    position: Option<Position>,
    content: Content,
    class_registered: bool,
}

impl Overlay {
    fn status(&self) -> LyricStatus {
        LyricStatus { enabled: self.hwnd.is_some(), locked: self.locked, position: self.position }
    }
}

thread_local! { static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) }; }

fn state<T>(read: impl FnOnce(&Overlay) -> T) -> Result<T> {
    OVERLAY.with(|cell| cell.borrow().as_ref().map(read)).ok_or(err("unavailable", "桌面歌词不可用"))
}

fn update_state<T>(edit: impl FnOnce(&mut Overlay) -> T) -> Result<T> {
    OVERLAY.with(|cell| cell.borrow_mut().as_mut().map(edit)).ok_or(err("unavailable", "桌面歌词不可用"))
}

pub(crate) fn install(app: &AppHandle) {
    let path = config_path(app, "desktop-lyric-position.json").ok();
    let position = path.as_deref().and_then(read_config::<Placement>)
        .filter(|placement| placement.version == 1).map(|placement| placement.position);
    OVERLAY.with(|cell| cell.replace(Some(Overlay {
        app: app.clone(), path, hwnd: None, locked: false, position, content: Content::default(), class_registered: false,
    })));
}

pub(crate) fn shutdown() {
    if let Ok(Some(hwnd)) = state(|state| state.hwnd) {
        let _ = unsafe { DestroyWindow(hwnd) };
    }
    OVERLAY.with(|cell| cell.take());
}

fn publish() {
    if let Ok((app, status)) = state(|state| (state.app.clone(), state.status())) {
        let _ = app.emit_to("main", "prism:desktop-lyric-state", status);
    }
}

fn clamp_position(position: Option<Position>, area: RECT, width: i32, height: i32) -> Position {
    let max_x = (area.right - width).max(area.left);
    let max_y = (area.bottom - height).max(area.top);
    let preferred = position.unwrap_or(Position {
        x: area.left + (max_x - area.left) / 2,
        y: max_y - 48,
    });
    Position { x: preferred.x.clamp(area.left, max_x), y: preferred.y.clamp(area.top, max_y) }
}

fn initial_rect(main: HWND, saved: Option<Position>) -> RECT {
    let monitor = unsafe {
        match saved {
            Some(p) => MonitorFromPoint(POINT { x: p.x, y: p.y }, MONITOR_DEFAULTTONEAREST),
            None => MonitorFromWindow(main, MONITOR_DEFAULTTONEAREST),
        }
    };
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    let area = if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        info.rcWork
    } else {
        RECT { left: 0, top: 0, right: 800, bottom: 600 }
    };
    let width = scale(main, 680).min((area.right - area.left).max(1));
    let height = scale(main, 126).min((area.bottom - area.top).max(1));
    let p = clamp_position(saved, area, width, height);
    RECT { left: p.x, top: p.y, right: p.x + width, bottom: p.y + height }
}

fn create(main: HWND, locked: bool) -> Result<()> {
    let module = unsafe { GetModuleHandleW(None) }.map_err(|_|err("unavailable", "无法初始化桌面歌词"))?;
    let instance = HINSTANCE(module.0);
    let class = w!("Prism.DesktopLyric");
    let (registered, position) = state(|state| (state.class_registered, state.position))?;
    if !registered {
        let wc = WNDCLASSW {
            lpfnWndProc: Some(window_proc), hInstance: instance, lpszClassName: class,
            hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap_or_default(), ..Default::default()
        };
        if unsafe { RegisterClassW(&wc) } == 0 { return Err(err("unavailable", "无法初始化桌面歌词")); }
        update_state(|state| state.class_registered = true)?;
    }
    let rect = initial_rect(main, position);
    let hwnd = create_native_window(instance, class, rect, locked)?;
    let content = state(|state| state.content.clone())?;
    if let Err(error) = present(hwnd, &content, locked) {
        let _ = unsafe { DestroyWindow(hwnd) };
        return Err(error);
    }
    update_state(|state| {
        state.hwnd = Some(hwnd);
        state.locked = locked;
        state.position = Some(Position { x: rect.left, y: rect.top });
    })?;
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
    Ok(())
}

fn create_native_window(instance: HINSTANCE, class: PCWSTR, rect: RECT, locked: bool) -> Result<HWND> {
    let styles = WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
    let styles = if locked { styles | WS_EX_TRANSPARENT } else { styles };
    unsafe {
        CreateWindowExW(styles, class, w!("Prism 桌面歌词"), WS_POPUP,
            rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top,
            None, None, Some(instance), None)
    }.map_err(|_|err("unavailable", "无法打开桌面歌词"))
}

fn set_locked(hwnd: HWND, locked: bool) -> Result<()> {
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let mask = WS_EX_TRANSPARENT.0 as isize;
    let next = if locked { style | mask } else { style & !mask };
    if style != next {
        unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next) };
        if unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & mask != next & mask {
            return Err(err("unavailable", "无法切换桌面歌词锁定状态"));
        }
        let _ = unsafe { SetWindowPos(hwnd, None, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER) };
    }
    update_state(|state| state.locked = locked)?;
    redraw(hwnd);
    Ok(())
}

fn remember_position(hwnd: HWND) {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() { return; }
    let position = Position { x: rect.left, y: rect.top };
    let path = update_state(|state| {
        state.position = Some(position);
        state.path.clone()
    });
    if let Ok(Some(path)) = path {
        let _ = write_config(&path, &Placement { version: 1, position });
    }
}

#[tauri::command]
pub(crate) async fn desktop_lyric_get(window: WebviewWindow) -> Result<LyricStatus> {
    on_ui(window, |_| state(Overlay::status)).await
}

#[tauri::command]
pub(crate) async fn desktop_lyric_set(window: WebviewWindow, enabled: bool, locked: Option<bool>) -> Result<LyricStatus> {
    on_ui(window, move |main| {
        let (hwnd, was_locked) = state(|state| (state.hwnd, state.locked))?;
        let locked = locked.unwrap_or(was_locked);
        match (enabled, hwnd) {
            (true, None) => create(main, locked)?,
            (true, Some(hwnd)) if locked != was_locked => set_locked(hwnd, locked)?,
            (false, Some(hwnd)) => {
                unsafe { DestroyWindow(hwnd) }.map_err(|_|err("unavailable", "无法关闭桌面歌词"))?;
                if locked != was_locked {
                    update_state(|state| state.locked = locked)?;
                    publish();
                }
                return state(Overlay::status);
            }
            (false, None) => update_state(|state| state.locked = locked)?,
            _ => {}
        }
        publish();
        state(Overlay::status)
    }).await
}

#[tauri::command]
pub(crate) async fn desktop_lyric_update(
    window: WebviewWindow, text: String, translation: Option<String>,
    romaji: Option<String>, title: Option<String>, playing: Option<bool>,
) -> Result<()> {
    let content = Content {
        text: line(text)?, translation: line(translation.unwrap_or_default())?,
        romaji: line(romaji.unwrap_or_default())?, title: line(title.unwrap_or_default())?,
        playing: playing.unwrap_or(false),
    };
    on_ui(window, move |_| {
        let changed = update_state(|state| {
            let hwnd = state.hwnd?;
            if state.content == content { return None; }
            state.content = content;
            Some(hwnd)
        })?;
        if let Some(hwnd) = changed { redraw(hwnd); }
        Ok(())
    }).await
}

const PANEL: u32 = 0x0e1624;
const ICE: u32 = 0xf0f4fa;
const PAUSED: u32 = 0xa4b4c9;
const AMBER: u32 = 0xf2a65a;
const ROMAJI: u32 = 0x8fa2bc;
const SHADOW: u32 = 0x030711;

fn scale(hwnd: HWND, pixels: i32) -> i32 {
    scaled(unsafe { GetDpiForWindow(hwnd) }, pixels)
}

fn scaled(dpi: u32, pixels: i32) -> i32 {
    (pixels * dpi.max(96) as i32 + 48) / 96
}

fn redraw(hwnd: HWND) {
    if let Ok(Some((content, locked))) = state(|state| {
        (state.hwnd == Some(hwnd)).then(|| (state.content.clone(), state.locked))
    }) {
        let _ = present(hwnd, &content, locked);
    }
}

struct Dib {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: NonNull<u32>,
    len: usize,
}

impl Dib {
    fn new(width: i32, height: i32) -> Result<Self> {
        let error = || err("unavailable", "无法建立桌面歌词绘制表面");
        let len = usize::try_from(width).ok()
            .zip(usize::try_from(height).ok())
            .and_then(|(w, h)| w.checked_mul(h))
            .filter(|n| (1..=4_000_000).contains(n))
            .ok_or_else(error)?;
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) }
            .map_err(|_| error())?;
        let dc = unsafe { CreateCompatibleDC(None) };
        let previous = if dc.0.is_null() { HGDIOBJ::default() }
            else { unsafe { SelectObject(dc, HGDIOBJ(bitmap.0)) } };
        if let Some(bits) = NonNull::new(bits.cast()) {
            if !previous.0.is_null() {
                return Ok(Self { dc, bitmap, previous, bits, len });
            }
        }
        unsafe {
            if !dc.0.is_null() { let _ = DeleteDC(dc); }
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
        }
        Err(error())
    }

    fn pixels(&mut self) -> &mut [u32] {
        // Synchronize GDI drawing before directly reading or replacing the DIB.
        unsafe {
            let _ = GdiFlush();
            std::slice::from_raw_parts_mut(self.bits.as_ptr(), self.len)
        }
    }
}

impl Drop for Dib {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
            let _ = DeleteDC(self.dc);
        }
    }
}

fn font(face: PCWSTR, size: i32, weight: i32) -> HFONT {
    unsafe {
        CreateFontW(-size, 0, 0, 0, weight, 0, 0, 0, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY, 0, face)
    }
}

fn font_family(dc: HDC) -> PCWSTR {
    const FAMILIES: [PCWSTR; 3] = [w!("MiSans"), w!("Noto Sans SC"), w!("Microsoft YaHei UI")];
    static CHOSEN: OnceLock<usize> = OnceLock::new();
    FAMILIES[*CHOSEN.get_or_init(|| {
        for (index, face) in FAMILIES[..2].iter().copied().enumerate() {
            let candidate = font(face, 20, 400);
            if candidate.0.is_null() { continue; }
            let previous = unsafe { SelectObject(dc, HGDIOBJ(candidate.0)) };
            let mut actual = [0u16; 64];
            let selected = if !previous.0.is_null() {
                let count = unsafe { GetTextFaceW(dc, Some(&mut actual)) };
                unsafe { SelectObject(dc, previous); }
                count > 0 && actual.split(|&ch| ch == 0).next() == Some(unsafe { face.as_wide() })
            } else { false };
            unsafe { let _ = DeleteObject(HGDIOBJ(candidate.0)); }
            if selected { return index; }
        }
        2
    })]
}

struct TextLine<'a> {
    text: &'a str,
    rect: RECT,
    size: i32,
    weight: i32,
    color: u32,
    align: DRAW_TEXT_FORMAT,
}

fn text_layout<'a>(content: &'a Content, locked: bool, size: SIZE, dpi: u32) -> Vec<TextLine<'a>> {
    let px = |value| scaled(dpi, value);
    let mut lines = Vec::with_capacity(6);
    let mut add = |text: &'a str, rect: RECT, size, weight, color, align| {
        if !text.is_empty() && rect.left < rect.right && rect.top < rect.bottom {
            lines.push(TextLine { text, rect, size: px(size), weight, color, align });
        }
    };
    if !locked {
        let top = |left, right| RECT { left, right, top: px(4), bottom: px(29) };
        let title = if content.title.is_empty() { "桌面歌词" } else { content.title.as_str() };
        add(title, top(px(18), size.cx - px(94)), 13, 500, AMBER, DT_LEFT);
        add("锁定", top(size.cx - px(86), size.cx - px(40)), 13, 500, ICE, DT_CENTER);
        add("×", top(size.cx - px(40), size.cx - px(8)), 19, 500, ICE, DT_CENTER);
    }
    let rows = [
        (content.text.as_str(), 39, 29, 700, if content.playing { ICE } else { PAUSED }),
        (content.translation.as_str(), 24, 18, 500, AMBER),
        (content.romaji.as_str(), 22, 16, 500, ROMAJI),
    ];
    let top = px(if locked { 4 } else { 29 });
    let bottom = size.cy - px(5);
    let height: i32 = rows.iter().filter(|(text, ..)| !text.is_empty())
        .map(|(_, height, ..)| px(*height)).sum();
    let mut y = top + ((bottom - top - height) / 2).max(0);
    for (text, height, font_size, weight, color) in rows {
        if text.is_empty() { continue; }
        let rect = RECT { left: px(20), right: size.cx - px(20), top: y, bottom: (y + px(height)).min(bottom) };
        add(text, rect, font_size, weight, color, DT_CENTER);
        y += px(height);
    }
    lines
}

fn draw_mask(dc: HDC, line: &TextLine<'_>, face: PCWSTR) {
    let mut text: Vec<u16> = line.text.encode_utf16().collect();
    let mut rect = line.rect;
    unsafe {
        let font = font(face, line.size, line.weight);
        if font.0.is_null() { return; }
        let previous = SelectObject(dc, HGDIOBJ(font.0));
        if !previous.0.is_null() {
            DrawTextW(dc, &mut text, &mut rect, line.align | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_NOPREFIX);
            SelectObject(dc, previous);
        }
        let _ = DeleteObject(HGDIOBJ(font.0));
    }
}

fn mul255(a: u8, b: u8) -> u8 {
    ((u16::from(a) * u16::from(b) + 127) / 255) as u8
}

fn over(pixel: &mut u32, color: u32, alpha: u8) {
    if alpha == 0 { return; }
    let [b, g, r, a] = pixel.to_le_bytes();
    let [blue, green, red, _] = color.to_le_bytes();
    let keep = 255 - alpha;
    *pixel = u32::from_le_bytes([
        mul255(blue, alpha) + mul255(b, keep),
        mul255(green, alpha) + mul255(g, keep),
        mul255(red, alpha) + mul255(r, keep),
        alpha + mul255(a, keep),
    ]);
}

fn panel(pixels: &mut [u32], width: usize, height: usize, dpi: u32) {
    let inset = f64::from(scaled(dpi, 3));
    let half_x = width as f64 / 2.0;
    let half_y = height as f64 / 2.0;
    let radius = f64::from(scaled(dpi, 18)).min(half_x - inset).min(half_y - inset);
    if radius <= 0.0 { return; }
    let border = f64::from(dpi.max(96)) / 96.0;
    for (y, row) in pixels.chunks_exact_mut(width).enumerate() {
        let dy = (y as f64 + 0.5 - half_y).abs() - (half_y - inset - radius);
        for (x, pixel) in row.iter_mut().enumerate() {
            let dx = (x as f64 + 0.5 - half_x).abs() - (half_x - inset - radius);
            let distance = if dx > 0.0 && dy > 0.0 { dx.hypot(dy) } else { dx.max(dy) } - radius;
            let outer = (0.5 - distance).clamp(0.0, 1.0);
            let inner = (0.5 - distance - border).clamp(0.0, 1.0);
            over(pixel, PANEL, (199.0 * outer).round() as u8);
            over(pixel, ICE, (36.0 * (outer - inner)).round() as u8);
        }
    }
}

fn blur_axis(input: &[u8], size: usize, stride: usize, radius: usize) -> Vec<u8> {
    let mut output = vec![0; input.len()];
    let count = (2 * radius + 1) as u32;
    let lines = input.len() / size;
    for line in 0..lines {
        let base = if stride == 1 { line * size } else { line };
        let at = |i| u32::from(input[base + i * stride]);
        let mut sum: u32 = (0..=radius.min(size - 1)).map(at).sum();
        for i in 0..size {
            output[base + i * stride] = (sum / count) as u8;
            if i >= radius { sum -= at(i - radius); }
            if i + radius + 1 < size { sum += at(i + radius + 1); }
        }
    }
    output
}

fn render(content: &Content, locked: bool, size: SIZE, dpi: u32) -> Result<Dib> {
    let mut surface = Dib::new(size.cx, size.cy)?;
    let (width, height) = (size.cx as usize, size.cy as usize);
    let lines = text_layout(content, locked, size, dpi);
    surface.pixels().fill(0);
    let dc = surface.dc;
    let face = font_family(dc);
    unsafe {
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, COLORREF(0xffffff));
    }
    for line in &lines { draw_mask(dc, line, face); }

    // GDI supplies glyph coverage; all colors and alpha are composed separately.
    let pixels = surface.pixels();
    let glyphs: Vec<u8> = pixels.iter().map(|pixel| {
        let [b, g, r, _] = pixel.to_le_bytes();
        ((u16::from(b) + u16::from(g) + u16::from(r)) / 3) as u8
    }).collect();
    pixels.fill(0);
    if !locked { panel(pixels, width, height, dpi); }

    if !lines.is_empty() {
        let radius = scaled(dpi, 3) as usize;
        let offset = scaled(dpi, 2) as usize;
        let soft = blur_axis(&blur_axis(&glyphs, width, 1, radius), height, width, radius);
        let edge = scaled(dpi, 1) as usize;
        let (outline_alpha, shadow_alpha) = if locked { (229, 206) } else { (138, 158) };
        for (y, row) in pixels.chunks_exact_mut(width).enumerate() {
            for (x, pixel) in row.iter_mut().enumerate() {
                let at = |x: usize, y: usize| glyphs[y * width + x];
                let outline = at(x.saturating_sub(edge), y).max(at((x + edge).min(width - 1), y))
                    .max(at(x, y.saturating_sub(edge))).max(at(x, (y + edge).min(height - 1)));
                let halo = if y >= offset { soft[(y - offset) * width + x] } else { 0 };
                over(pixel, SHADOW, mul255(outline, outline_alpha).max(mul255(halo, shadow_alpha)));
            }
        }
        for line in lines {
            let rect = line.rect;
            for y in rect.top.max(0)..rect.bottom.min(size.cy) {
                for x in rect.left.max(0)..rect.right.min(size.cx) {
                    let index = y as usize * width + x as usize;
                    over(&mut pixels[index], line.color, glyphs[index]);
                }
            }
        }
    }
    Ok(surface)
}

fn present(hwnd: HWND, content: &Content, locked: bool) -> Result<()> {
    let unavailable = || err("unavailable", "无法更新桌面歌词透明度");
    let mut view = RECT::default();
    unsafe { GetClientRect(hwnd, &mut view) }.map_err(|_| unavailable())?;
    let size = SIZE { cx: view.right, cy: view.bottom };
    let surface = render(content, locked, size, unsafe { GetDpiForWindow(hwnd) })?;
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8,
    };
    unsafe {
        UpdateLayeredWindow(hwnd, None, None, Some(&size), Some(surface.dc),
            Some(&POINT::default()), COLORREF(0), Some(&blend), ULW_ALPHA)
    }.map_err(|_| unavailable())
}

fn paint(hwnd: HWND) {
    let mut paint = PAINTSTRUCT::default();
    unsafe {
        BeginPaint(hwnd, &mut paint);
        let _ = EndPaint(hwnd, &paint);
    }
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_PAINT => { paint(hwnd); return LRESULT(0); }
        WM_ERASEBKGND => return LRESULT(1),
        WM_NCHITTEST => {
            if state(|state| state.locked).unwrap_or(false) { return LRESULT(HTTRANSPARENT as isize); }
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let x = (lparam.0 as i16) as i32;
                let y = ((lparam.0 >> 16) as i16) as i32;
                let controls = x >= rect.right - scale(hwnd, 88) && y < rect.top + scale(hwnd, 29);
                return LRESULT(if controls { HTCLIENT } else { HTCAPTION } as isize);
            }
        }
        WM_LBUTTONUP => {
            let mut rect = RECT::default();
            let x = (lparam.0 as i16) as i32;
            let y = ((lparam.0 >> 16) as i16) as i32;
            if unsafe { GetClientRect(hwnd, &mut rect) }.is_ok() && y < scale(hwnd, 29) {
                if x >= rect.right - scale(hwnd, 40) {
                    let _ = unsafe { DestroyWindow(hwnd) };
                } else if x >= rect.right - scale(hwnd, 88) && set_locked(hwnd, true).is_ok() {
                    publish();
                }
                return LRESULT(0);
            }
        }
        WM_EXITSIZEMOVE => { remember_position(hwnd); publish(); }
        WM_DPICHANGED => {
            if lparam.0 != 0 {
                // WM_DPICHANGED provides a valid RECT for the duration of this callback.
                let rect = unsafe { &*(lparam.0 as *const RECT) };
                let _ = unsafe { SetWindowPos(hwnd, None, rect.left, rect.top, rect.right - rect.left,
                    rect.bottom - rect.top, SWP_NOACTIVATE | SWP_NOZORDER) };
            }
            redraw(hwnd);
            return LRESULT(0);
        }
        WM_CLOSE => { let _ = unsafe { DestroyWindow(hwnd) }; return LRESULT(0); }
        WM_DESTROY if state(|state| state.hwnd == Some(hwnd)).unwrap_or(false) => {
            remember_position(hwnd);
            let _ = update_state(|state| { state.hwnd = None; state.content = Content::default(); });
            publish();
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_text_and_clamps_saved_position_to_a_monitor() {
        assert_eq!(line("<b>歌词</b>\n第二行\0".into()).unwrap(), "<b>歌词</b> 第二行 ");
        assert_eq!(line("词".repeat(513)).unwrap_err().kind, "validation");
        let negative = RECT { left: -1000, top: -50, right: 0, bottom: 720 };
        assert_eq!(clamp_position(Some(Position { x: 30, y: -300 }), negative, 600, 120),
            Position { x: -600, y: -50 });
        assert_eq!(clamp_position(None, negative, 600, 120), Position { x: -800, y: 552 });
    }

    #[test]
    fn draws_premultiplied_round_panel_and_text_only_locked_state() {
        let content = Content {
            title: "夜间广播 · Night Radio".into(),
            text: "晚风把灯火吹成一条河".into(),
            translation: "Evening winds turn the lights into a river".into(),
            romaji: "Wan feng ba deng huo chui cheng yi tiao he".into(),
            playing: true,
        };
        for dpi in [96, 120, 144] {
            let size = SIZE { cx: scaled(dpi, 680), cy: scaled(dpi, 126) };
            for locked in [false, true] {
                let mut frame = render(&content, locked, size, dpi).unwrap();
                let pixels = frame.pixels();
                let width = size.cx as usize;
                let at = |x: usize, y: usize| pixels[y * width + x];
                assert_eq!(at(0, 0), 0);
                assert_eq!(at(scaled(dpi, 7) as usize, scaled(dpi, 50) as usize) >> 24, if locked { 0 } else { 199 });
                assert!(pixels.iter().all(|pixel| {
                    let [b, g, r, a] = pixel.to_le_bytes();
                    b <= a && g <= a && r <= a
                }));
                assert!(pixels.iter().any(|&pixel| pixel == 0xff000000 | ICE));
                let title = &pixels[..width * scaled(dpi, 24) as usize];
                if locked {
                    let controls = width - scaled(dpi, 88) as usize;
                    assert!(title.chunks_exact(width).all(|row| row[controls..].iter().all(|&pixel| pixel == 0)));
                } else {
                    assert!(title.iter().any(|&pixel| (1..199).contains(&(pixel >> 24))));
                }
            }
        }
        let paused = Content { playing: false, ..content };
        let mut frame = render(&paused, true, SIZE { cx: 680, cy: 126 }, 96).unwrap();
        assert!(frame.pixels().iter().any(|&pixel| pixel == 0xff000000 | PAUSED));
    }

    #[test]
    fn windows_creates_transparent_nonactivating_overlay_and_destroys_it() {
        let instance = HINSTANCE(unsafe { GetModuleHandleW(None) }.unwrap().0);
        let class = w!("Prism.DesktopLyric.Test");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(window_proc), hInstance: instance, lpszClassName: class, ..Default::default()
        };
        assert_ne!(unsafe { RegisterClassW(&wc) }, 0);
        let hwnd = create_native_window(instance, class, RECT { left: 0, top: 0, right: 600, bottom: 120 }, true).unwrap();
        let sample = Content { text: "夜间电台 · Prism".into(), playing: true, ..Content::default() };
        present(hwnd, &sample, false).unwrap();
        present(hwnd, &sample, true).unwrap();
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
        let flags = (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE).0;
        let destroyed = unsafe { DestroyWindow(hwnd) }.is_ok();
        assert_eq!(style & flags, flags);
        assert!(destroyed && !unsafe { IsWindow(Some(hwnd)) }.as_bool());
        unsafe { UnregisterClassW(class, Some(instance)) }.unwrap();
    }
}
