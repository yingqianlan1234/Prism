use crate::{
    desktop_shortcuts::{config_path, on_ui, read_config, write_config},
    err, Result,
};
use serde::{Deserialize, Serialize};
use std::{
    cell::RefCell,
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM},
        Graphics::Gdi::*,
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI},
            Input::KeyboardAndMouse::*,
            WindowsAndMessaging::*,
        },
    },
};

#[path = "desktop_lyric_render.rs"]
mod render;
use render::{Renderer, UnlockVisual};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Position {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum LyricTheme {
    #[default]
    Night,
    Contrast,
    Warm,
    Accent,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum LyricLayout {
    #[default]
    Dual,
    Single,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum LyricAlign {
    #[default]
    Center,
    Left,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
struct LyricStyle {
    font_size: i32,
    theme: LyricTheme,
    layout: LyricLayout,
    align: LyricAlign,
    panel_opacity: u8,
    karaoke: bool,
    show_translation: bool,
    show_romaji: bool,
    width: i32,
}

impl Default for LyricStyle {
    fn default() -> Self {
        Self {
            font_size: 28,
            theme: LyricTheme::Night,
            layout: LyricLayout::Dual,
            align: LyricAlign::Center,
            panel_opacity: 82,
            karaoke: true,
            show_translation: true,
            show_romaji: false,
            width: 720,
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LyricStylePatch {
    font_size: Option<i64>,
    theme: Option<LyricTheme>,
    layout: Option<LyricLayout>,
    align: Option<LyricAlign>,
    panel_opacity: Option<i64>,
    karaoke: Option<bool>,
    show_translation: Option<bool>,
    show_romaji: Option<bool>,
    width: Option<i64>,
}

impl LyricStyle {
    fn validate_numbers(font_size: i64, panel_opacity: i64, width: i64) -> Result<()> {
        for (valid, message) in [
            (
                (18..=48).contains(&font_size),
                "桌面歌词字号必须在 18–48 之间",
            ),
            (
                (40..=100).contains(&panel_opacity),
                "桌面歌词底板不透明度必须在 40–100 之间",
            ),
            (
                (460..=1200).contains(&width),
                "桌面歌词宽度必须在 460–1200 之间",
            ),
        ] {
            if !valid {
                return Err(err("validation", message));
            }
        }
        Ok(())
    }

    fn validate(self) -> Result<Self> {
        Self::validate_numbers(
            self.font_size.into(),
            self.panel_opacity.into(),
            self.width.into(),
        )?;
        Ok(self)
    }

    fn merge(self, patch: LyricStylePatch) -> Result<Self> {
        let font_size = patch.font_size.unwrap_or(self.font_size.into());
        let panel_opacity = patch.panel_opacity.unwrap_or(self.panel_opacity.into());
        let width = patch.width.unwrap_or(self.width.into());
        Self::validate_numbers(font_size, panel_opacity, width)?;
        Ok(Self {
            font_size: font_size as i32,
            theme: patch.theme.unwrap_or(self.theme),
            layout: patch.layout.unwrap_or(self.layout),
            align: patch.align.unwrap_or(self.align),
            panel_opacity: panel_opacity as u8,
            karaoke: patch.karaoke.unwrap_or(self.karaoke),
            show_translation: patch.show_translation.unwrap_or(self.show_translation),
            show_romaji: patch.show_romaji.unwrap_or(self.show_romaji),
            width: width as i32,
        })
    }

    fn secondary<'a>(&self, content: &'a Content) -> Option<(&'a str, bool)> {
        if self.show_translation && !content.translation.is_empty() {
            Some((&content.translation, true))
        } else if self.layout == LyricLayout::Dual && !content.next_text.is_empty() {
            Some((&content.next_text, false))
        } else {
            None
        }
    }

    fn romaji(&self, content: &Content) -> bool {
        self.show_romaji && !content.romaji.is_empty()
    }
    fn primary_height(&self) -> i32 {
        self.font_size + 14
    }
    fn secondary_height(&self) -> i32 {
        (self.font_size * 2 / 3).clamp(14, 26) + 6
    }
    fn height(&self, content: &Content) -> i32 {
        TOOLBAR_HEIGHT
            + self.primary_height()
            + 10
            + if self.secondary(content).is_some() {
                self.secondary_height()
            } else {
                0
            }
            + if self.romaji(content) { 21 } else { 0 }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Placement {
    version: u8,
    position: Option<Position>,
    #[serde(default)]
    style: LyricStyle,
}

impl Placement {
    fn migrate(self) -> Option<Self> {
        let style = match self.version {
            1 => LyricStyle::default(),
            2 => self.style.validate().ok()?,
            _ => return None,
        };
        Some(Self {
            version: 2,
            style,
            ..self
        })
    }
}

#[derive(Clone, Copy, Serialize)]
pub(crate) struct LyricStatus {
    enabled: bool,
    locked: bool,
    position: Option<Position>,
    style: LyricStyle,
}

#[derive(Default, PartialEq)]
struct Content {
    text: String,
    translation: String,
    romaji: String,
    next_text: String,
    title: String,
    playing: bool,
    elapsed_ms: u32,
    duration_ms: u32,
    rate: f32,
    accent_color: Option<u32>,
}

impl Content {
    fn progress(&self, since_update_ms: f32) -> f32 {
        if self.duration_ms == 0 {
            return 0.0;
        }
        ((self.elapsed_ms as f32 + since_update_ms * self.rate) / self.duration_ms as f32)
            .clamp(0.0, 1.0)
    }
}

fn accent(value: &str) -> Option<u32> {
    let value = value.strip_prefix('#')?;
    (value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(value, 16).ok())
        .flatten()
}

fn line(value: String) -> Result<String> {
    if value.len() > 2048 || value.chars().count() > 512 {
        return Err(err("validation", "桌面歌词文字过长"));
    }
    Ok(value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect())
}

const ANIMATION_MS: f32 = 140.0;
const TIMER: usize = 1;
const LOCK_PROBE_TIMER: usize = 2;
const UNLOCK_HIDE_DELAY: Duration = Duration::from_millis(260);
const UNLOCK_CLASS: PCWSTR = w!("Prism.DesktopLyric.Unlock");
const MOUSE_LEFT_DOWN: usize = 0x0001;
const WM_MOUSELEAVE: u32 = 0x02a3;
const TOOLBAR_HEIGHT: i32 = 32;
const BUTTON_WIDTH: i32 = 32;
const EDGE: i32 = 10;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Button {
    Previous,
    Playback,
    Next,
    Translation,
    Layout,
    Smaller,
    Larger,
    Lock,
    Close,
}

const BUTTONS: [Button; 9] = [
    Button::Previous,
    Button::Playback,
    Button::Next,
    Button::Translation,
    Button::Layout,
    Button::Smaller,
    Button::Larger,
    Button::Lock,
    Button::Close,
];

fn button_left(width: f32) -> f32 {
    width - (EDGE + BUTTON_WIDTH * BUTTONS.len() as i32) as f32
}

fn button_at(width: f32, mouse_x: f32, mouse_y: f32) -> Option<Button> {
    let offset = mouse_x - button_left(width);
    if offset < 0.0 || !(0.0..TOOLBAR_HEIGHT as f32).contains(&mouse_y) {
        return None;
    }
    BUTTONS
        .get((offset / BUTTON_WIDTH as f32) as usize)
        .copied()
}

#[derive(Default)]
struct Hover {
    from: f32,
    on: bool,
    since: Option<Instant>,
}

impl Hover {
    fn amount(&self, now: Instant) -> f32 {
        let fraction = time_fraction(now, self.since);
        self.from + (if self.on { 1.0 } else { 0.0 } - self.from) * fraction * (2.0 - fraction)
    }

    fn set(&mut self, on: bool, now: Instant) {
        if self.on != on {
            *self = Self {
                from: self.amount(now),
                on,
                since: Some(now),
            };
        }
    }
}

fn time_fraction(now: Instant, since: Option<Instant>) -> f32 {
    since.map_or(1.0, |time| {
        (now.duration_since(time).as_secs_f32() * 1000.0 / ANIMATION_MS).min(1.0)
    })
}

struct Overlay {
    app: AppHandle,
    path: Option<PathBuf>,
    hwnd: Option<HWND>,
    locked: bool,
    unlock: Option<UnlockProbe>,
    unlock_hover_until: Option<Instant>,
    position: Option<Position>,
    style: LyricStyle,
    content: Content,
    class_registered: bool,
    hover: Hover,
    hover_button: Option<Button>,
    pressed: Option<Button>,
    tracking: Option<bool>,
    dragging: bool,
    timer: bool,
    line_changed: Option<Instant>,
    content_updated: Instant,
}

impl Overlay {
    fn status(&self) -> LyricStatus {
        LyricStatus {
            enabled: self.hwnd.is_some(),
            locked: self.locked,
            position: self.position,
            style: self.style,
        }
    }
}

thread_local! {
    static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
    static RENDERER: RefCell<Option<Renderer>> = const { RefCell::new(None) };
}

fn state<T>(read: impl FnOnce(&Overlay) -> T) -> Result<T> {
    OVERLAY
        .with(|cell| cell.borrow().as_ref().map(read))
        .ok_or_else(|| err("unavailable", "桌面歌词不可用"))
}

fn update_state<T>(edit: impl FnOnce(&mut Overlay) -> T) -> Result<T> {
    OVERLAY
        .with(|cell| cell.borrow_mut().as_mut().map(edit))
        .ok_or_else(|| err("unavailable", "桌面歌词不可用"))
}

pub(crate) fn install(app: &AppHandle) {
    let path = config_path(app, "desktop-lyric-position.json").ok();
    let saved = path
        .as_deref()
        .and_then(read_config::<Placement>)
        .and_then(Placement::migrate);
    OVERLAY.with(|cell| {
        cell.replace(Some(Overlay {
            app: app.clone(),
            path,
            hwnd: None,
            locked: false,
            unlock: None,
            unlock_hover_until: None,
            position: saved.as_ref().and_then(|placement| placement.position),
            style: saved.map_or_else(LyricStyle::default, |placement| placement.style),
            content: Content::default(),
            class_registered: false,
            hover: Hover::default(),
            hover_button: None,
            pressed: None,
            tracking: None,
            dragging: false,
            timer: false,
            line_changed: None,
            content_updated: Instant::now(),
        }))
    });
}

pub(crate) fn shutdown() {
    if let Ok(Some(hwnd)) = state(|overlay| overlay.hwnd) {
        stop_unlock_probe(hwnd);
        let _ = unsafe { DestroyWindow(hwnd) };
    }
    OVERLAY.with(|cell| cell.take());
}

fn publish() {
    if let Ok((app, status)) = state(|overlay| (overlay.app.clone(), overlay.status())) {
        let _ = app.emit_to("main", "prism:desktop-lyric-state", status);
    }
}

fn persist() -> Result<()> {
    let (path, placement) = state(|overlay| {
        (
            overlay.path.clone(),
            Placement {
                version: 2,
                position: overlay.position,
                style: overlay.style,
            },
        )
    })?;
    write_config(
        &path.ok_or_else(|| err("storage", "应用配置目录不可用"))?,
        &placement,
    )
}

fn clamp_position(position: Option<Position>, area: RECT, width: i32, height: i32) -> Position {
    let max_x = (area.right - width).max(area.left);
    let max_y = (area.bottom - height).max(area.top);
    let preferred = position.unwrap_or(Position {
        x: area.left + (max_x - area.left) / 2,
        y: max_y - 48,
    });
    Position {
        x: preferred.x.clamp(area.left, max_x),
        y: preferred.y.clamp(area.top, max_y),
    }
}

fn work_area(monitor: HMONITOR) -> RECT {
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        info.rcWork
    } else {
        RECT {
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
        }
    }
}

fn dpi(hwnd: HWND) -> u32 {
    unsafe { GetDpiForWindow(hwnd) }.max(96)
}
fn scaled(dpi: u32, dip: i32) -> i32 {
    (dip * dpi as i32 + 48) / 96
}
fn logical(dpi: u32, pixels: i32) -> f32 {
    pixels as f32 * 96.0 / dpi as f32
}

fn create(main: HWND, locked: bool) -> Result<()> {
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|_| err("unavailable", "无法初始化桌面歌词"))?
            .0,
    );
    let class = w!("Prism.DesktopLyric");
    let (registered, saved, style, height) = state(|overlay| {
        (
            overlay.class_registered,
            overlay.position,
            overlay.style,
            overlay.style.height(&overlay.content),
        )
    })?;
    if !registered {
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class,
            hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap_or_default(),
            ..Default::default()
        };
        if unsafe { RegisterClassW(&window_class) } == 0 {
            return Err(err("unavailable", "无法初始化桌面歌词"));
        }
        update_state(|overlay| overlay.class_registered = true)?;
    }
    let monitor = unsafe {
        saved.map_or_else(
            || MonitorFromWindow(main, MONITOR_DEFAULTTONEAREST),
            |position| {
                MonitorFromPoint(
                    POINT {
                        x: position.x,
                        y: position.y,
                    },
                    MONITOR_DEFAULTTONEAREST,
                )
            },
        )
    };
    let (mut monitor_dpi, mut vertical_dpi) = (dpi(main), 96);
    let _ = unsafe {
        GetDpiForMonitor(
            monitor,
            MDT_EFFECTIVE_DPI,
            &mut monitor_dpi,
            &mut vertical_dpi,
        )
    };
    let area = work_area(monitor);
    let width = scaled(monitor_dpi, style.width).min((area.right - area.left).max(1));
    let height = scaled(monitor_dpi, height);
    let position = clamp_position(saved, area, width, height);
    let hwnd = create_native_window(instance, class, position, width, height, locked)?;
    update_state(|overlay| {
        overlay.hwnd = Some(hwnd);
        overlay.locked = locked;
        overlay.position = Some(position);
    })?;
    let result = (|| {
        if locked {
            start_unlock_probe(hwnd)?;
        }
        redraw(hwnd)
    })();
    if let Err(error) = result {
        let _ = unsafe { DestroyWindow(hwnd) };
        return Err(error);
    }
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

fn create_native_window(
    instance: HINSTANCE,
    class: PCWSTR,
    position: Position,
    width: i32,
    height: i32,
    locked: bool,
) -> Result<HWND> {
    let mut styles = WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
    if locked {
        styles |= WS_EX_TRANSPARENT;
    }
    unsafe {
        CreateWindowExW(
            styles,
            class,
            w!("Vesper 桌面歌词"),
            WS_POPUP | WS_THICKFRAME,
            position.x,
            position.y,
            width,
            height,
            None,
            None,
            Some(instance),
            None,
        )
    }
    .map_err(|_| err("unavailable", "无法打开桌面歌词"))
}

fn apply_lock_style(hwnd: HWND, locked: bool) -> Result<()> {
    let current = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let mask = WS_EX_TRANSPARENT.0 as isize;
    let next = if locked {
        current | mask
    } else {
        current & !mask
    };
    if current != next {
        unsafe {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
        if unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & mask != next & mask {
            return Err(err("unavailable", "无法切换桌面歌词锁定状态"));
        }
    }
    Ok(())
}

fn set_locked(hwnd: HWND, locked: bool) -> Result<()> {
    apply_lock_style(hwnd, locked)?;
    update_state(|overlay| {
        overlay.locked = locked;
        overlay.unlock_hover_until = None;
        overlay.hover = Hover::default();
        overlay.hover_button = None;
        overlay.pressed = None;
        overlay.tracking = None;
    })?;
    if locked {
        if let Err(error) = start_unlock_probe(hwnd) {
            apply_lock_style(hwnd, false)?;
            update_state(|overlay| overlay.locked = false)?;
            return Err(error);
        }
    } else {
        stop_unlock_probe(hwnd);
    }
    if unsafe { GetCapture() } == hwnd {
        let _ = unsafe { ReleaseCapture() };
    }
    Ok(())
}

fn window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.ok().map(|_| rect)
}

fn unlock_rect(lyric: RECT, area: RECT, dpi: u32) -> RECT {
    let diameter = scaled(dpi, 26);
    let gap = scaled(dpi, 5);
    let above = lyric.top - gap - diameter;
    let position = clamp_position(
        Some(Position {
            x: lyric.left + (lyric.right - lyric.left - diameter) / 2,
            y: if above >= area.top {
                above
            } else {
                lyric.bottom + gap
            },
        }),
        area,
        diameter,
        diameter,
    );
    RECT {
        left: position.x,
        top: position.y,
        right: position.x + diameter,
        bottom: position.y + diameter,
    }
}

fn contains(rect: RECT, point: POINT) -> bool {
    point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom
}

fn unlock_hot_zone(lyric: RECT, capsule: RECT, cursor: POINT) -> bool {
    let bridge = RECT {
        left: lyric.left.max(capsule.left),
        right: lyric.right.min(capsule.right),
        top: lyric.bottom.min(capsule.bottom),
        bottom: lyric.top.max(capsule.top),
    };
    contains(lyric, cursor) || contains(capsule, cursor) || contains(bridge, cursor)
}

#[derive(Default)]
struct UnlockProbe {
    hwnd: Option<HWND>,
    frame: Option<(RECT, u32, UnlockVisual)>,
    outside_since: Option<Instant>,
    hover: bool,
    pressed: bool,
}

impl UnlockProbe {
    fn start(hwnd: HWND) -> Result<Self> {
        if unsafe { SetTimer(Some(hwnd), LOCK_PROBE_TIMER, 120, None) } == 0 {
            return Err(err("unavailable", "无法启动桌面歌词解锁探测"));
        }
        Ok(Self::default())
    }

    fn stop(self, hwnd: HWND) {
        let _ = unsafe { KillTimer(Some(hwnd), LOCK_PROBE_TIMER) };
        if let Some(capsule) = self.hwnd {
            let _ = unsafe { DestroyWindow(capsule) };
        }
    }

    fn hide(&mut self) {
        if self.frame.take().is_some() {
            if let Some(hwnd) = self.hwnd {
                let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
            }
        }
        self.hover = false;
        self.pressed = false;
        self.outside_since = None;
    }

    fn probe(
        &mut self,
        lyric: RECT,
        capsule: RECT,
        dpi: u32,
        cursor: POINT,
        now: Instant,
    ) -> Result<()> {
        if unlock_hot_zone(lyric, capsule, cursor) {
            self.outside_since = None;
            self.show(capsule, dpi)?;
        } else if self.frame.is_some() {
            let since = *self.outside_since.get_or_insert(now);
            if !self.pressed && now.duration_since(since) >= UNLOCK_HIDE_DELAY {
                self.hide();
            }
        }
        Ok(())
    }

    fn show(&mut self, rect: RECT, dpi: u32) -> Result<()> {
        let visual = if self.hover && self.pressed {
            UnlockVisual::Pressed
        } else if self.hover {
            UnlockVisual::Hover
        } else {
            UnlockVisual::Idle
        };
        if self.frame == Some((rect, dpi, visual)) {
            return Ok(());
        }
        let hwnd = match self.hwnd {
            Some(hwnd) => hwnd,
            None => {
                let hwnd = create_unlock_window(rect)?;
                self.hwnd = Some(hwnd);
                hwnd
            }
        };
        let size = SIZE {
            cx: rect.right - rect.left,
            cy: rect.bottom - rect.top,
        };
        RENDERER.with(|cell| {
            let mut slot = cell
                .try_borrow_mut()
                .map_err(|_| err("unavailable", "桌面歌词渲染器正忙"))?;
            if slot.is_none() {
                *slot = Some(
                    Renderer::new().map_err(|_| err("unavailable", "无法初始化解锁按钮渲染器"))?,
                );
            }
            let surface = slot
                .as_mut()
                .unwrap()
                .render_unlock(size, dpi, visual)
                .map_err(|_| err("unavailable", "无法绘制桌面歌词解锁按钮"))?;
            submit_frame(
                hwnd,
                size,
                surface.dc,
                Some(&POINT {
                    x: rect.left,
                    y: rect.top,
                }),
            )
        })?;
        if self.frame.is_none() {
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
        self.frame = Some((rect, dpi, visual));
        Ok(())
    }
}

fn create_unlock_window(rect: RECT) -> Result<HWND> {
    let unavailable = || err("unavailable", "无法打开桌面歌词解锁按钮");
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|_| unavailable())?
            .0,
    );
    let class = WNDCLASSW {
        lpfnWndProc: Some(unlock_window_proc),
        hInstance: instance,
        lpszClassName: UNLOCK_CLASS,
        hCursor: unsafe { LoadCursorW(None, IDC_HAND) }.unwrap_or_default(),
        ..Default::default()
    };
    let mut registered = WNDCLASSW::default();
    if unsafe { GetClassInfoW(Some(instance), UNLOCK_CLASS, &mut registered) }.is_err()
        && unsafe { RegisterClassW(&class) } == 0
        && unsafe { GetClassInfoW(Some(instance), UNLOCK_CLASS, &mut registered) }.is_err()
    {
        return Err(unavailable());
    }
    unsafe {
        CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            UNLOCK_CLASS,
            w!("解锁"),
            WS_POPUP,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            None,
            None,
            Some(instance),
            None,
        )
    }
    .map_err(|_| unavailable())
}

fn start_unlock_probe(hwnd: HWND) -> Result<()> {
    if state(|overlay| overlay.hwnd == Some(hwnd) && overlay.locked && overlay.unlock.is_none())? {
        let probe = UnlockProbe::start(hwnd)?;
        update_state(|overlay| overlay.unlock = Some(probe))?;
    }
    Ok(())
}

fn stop_unlock_probe(hwnd: HWND) {
    if let Ok(Some(probe)) = update_state(|overlay| overlay.unlock.take()) {
        probe.stop(hwnd);
    }
}

fn refresh_unlock(hwnd: HWND, poll: bool) -> Result<()> {
    let Some(lyric) = window_rect(hwnd) else {
        return Ok(());
    };
    let Some(mut probe) = update_state(|overlay| {
        if overlay.hwnd == Some(hwnd) && overlay.locked {
            overlay.unlock.take()
        } else {
            None
        }
    })?
    else {
        return Ok(());
    };
    let monitor_dpi = dpi(hwnd);
    let area = work_area(unsafe { MonitorFromRect(&lyric, MONITOR_DEFAULTTONEAREST) });
    let capsule = unlock_rect(lyric, area, monitor_dpi);
    let mut cursor = POINT::default();
    let result = if poll && unsafe { GetCursorPos(&mut cursor) }.is_ok() {
        if probe.pressed {
            let primary = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } == 0 {
                VK_LBUTTON
            } else {
                VK_RBUTTON
            };
            if !contains(capsule, cursor) && unsafe { GetAsyncKeyState(i32::from(primary.0)) } >= 0
            {
                probe.pressed = false;
            }
        }
        probe.probe(lyric, capsule, monitor_dpi, cursor, Instant::now())
    } else if probe.frame.is_some() {
        probe.show(capsule, monitor_dpi)
    } else {
        Ok(())
    };
    update_state(|overlay| overlay.unlock = Some(probe))?;
    result
}

unsafe extern "system" fn unlock_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_DPICHANGED => return LRESULT(0),
        WM_MOUSEMOVE | WM_MOUSELEAVE | WM_LBUTTONDOWN | WM_LBUTTONUP => {
            let mut client = RECT::default();
            let inside = message != WM_MOUSELEAVE
                && unsafe { GetClientRect(hwnd, &mut client) }.is_ok()
                && contains(client, point(lparam));
            if let Ok(Some((lyric, track, clicked))) = update_state(|overlay| {
                let lyric = overlay.hwnd?;
                let probe = overlay.unlock.as_mut()?;
                if !overlay.locked || probe.hwnd != Some(hwnd) || probe.frame.is_none() {
                    return None;
                }
                let track = inside && !probe.hover;
                let clicked = match message {
                    WM_LBUTTONDOWN => {
                        probe.pressed = inside;
                        false
                    }
                    WM_LBUTTONUP => std::mem::take(&mut probe.pressed) && inside,
                    WM_MOUSEMOVE if wparam.0 & MOUSE_LEFT_DOWN == 0 => {
                        probe.pressed = false;
                        false
                    }
                    _ => false,
                };
                probe.hover = inside;
                Some((lyric, track, clicked))
            }) {
                if clicked {
                    stop_unlock_probe(lyric);
                    let _ = set_locked(lyric, false);
                    let now = Instant::now();
                    if update_state(|overlay| {
                        if overlay.locked {
                            return false;
                        }
                        overlay.hover = Hover {
                            from: 1.0,
                            on: true,
                            since: None,
                        };
                        overlay.unlock_hover_until = Some(now + Duration::from_secs(1));
                        true
                    })
                    .unwrap_or(false)
                    {
                        let _ = redraw(lyric);
                    } else {
                        let _ = start_unlock_probe(lyric);
                    }
                    publish();
                } else {
                    if track {
                        let mut request = TRACKMOUSEEVENT {
                            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                            dwFlags: TME_LEAVE,
                            hwndTrack: hwnd,
                            dwHoverTime: 0,
                        };
                        let _ = unsafe { TrackMouseEvent(&mut request) };
                    }
                    let _ = refresh_unlock(lyric, false);
                }
            }
            return LRESULT(0);
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn resize(hwnd: HWND, suggested: Option<RECT>) -> Result<()> {
    let Some(current) = window_rect(hwnd) else {
        return Ok(());
    };
    let anchor = suggested.unwrap_or(current);
    let (style, height) = state(|overlay| (overlay.style, overlay.style.height(&overlay.content)))?;
    let area = work_area(unsafe { MonitorFromRect(&anchor, MONITOR_DEFAULTTONEAREST) });
    let monitor_dpi = dpi(hwnd);
    let width = scaled(monitor_dpi, style.width).min((area.right - area.left).max(1));
    let height = scaled(monitor_dpi, height);
    let preferred = Position {
        x: anchor.left + (anchor.right - anchor.left - width) / 2,
        y: anchor.bottom - height,
    };
    let pos = clamp_position(Some(preferred), area, width, height);
    if (pos.x, pos.y, width, height)
        != (
            current.left,
            current.top,
            current.right - current.left,
            current.bottom - current.top,
        )
    {
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                pos.x,
                pos.y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
        }
        .map_err(|_| err("unavailable", "无法调整桌面歌词尺寸"))?;
    }
    update_state(|overlay| overlay.position = Some(pos))?;
    let _ = refresh_unlock(hwnd, false);
    Ok(())
}

fn change_style(style: LyricStyle) -> Result<()> {
    let (hwnd, previous) =
        update_state(|overlay| (overlay.hwnd, std::mem::replace(&mut overlay.style, style)))?;
    let previous_rect = hwnd.and_then(window_rect);
    let saved = hwnd
        .map_or(Ok(()), |hwnd| resize(hwnd, None))
        .and_then(|()| persist());
    if let Err(error) = saved {
        update_state(|overlay| overlay.style = previous)?;
        if let Some(hwnd) = hwnd {
            let _ = resize(hwnd, previous_rect);
            let _ = redraw(hwnd);
        }
        return Err(error);
    }
    let redrawn = hwnd.map_or(Ok(()), redraw);
    publish();
    redrawn
}

fn set_enabled(main: HWND, enabled: bool, locked: Option<bool>) -> Result<LyricStatus> {
    let (hwnd, old_lock) = state(|overlay| (overlay.hwnd, overlay.locked))?;
    let locked = locked.unwrap_or(old_lock);
    match (enabled, hwnd) {
        (true, None) => create(main, locked)?,
        (true, Some(hwnd)) if locked != old_lock => {
            set_locked(hwnd, locked)?;
            redraw(hwnd)?;
        }
        (false, Some(hwnd)) => {
            unsafe { DestroyWindow(hwnd) }.map_err(|_| err("unavailable", "无法关闭桌面歌词"))?;
            if locked == old_lock {
                return state(Overlay::status);
            }
            update_state(|overlay| overlay.locked = locked)?;
        }
        (false, None) => update_state(|overlay| overlay.locked = locked)?,
        _ => {}
    }
    publish();
    state(Overlay::status)
}

pub(crate) fn toggle_from_tray(app: &AppHandle, toggle_lock: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let main = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let (Ok(hwnd), Ok(status)) = (main.hwnd(), state(Overlay::status)) {
            let (enabled, locked) = if toggle_lock {
                (status.enabled, Some(!status.locked))
            } else {
                (!status.enabled, None)
            };
            let _ = set_enabled(HWND(hwnd.0), enabled, locked);
        }
    });
}

#[tauri::command]
pub(crate) async fn desktop_lyric_get(window: WebviewWindow) -> Result<LyricStatus> {
    on_ui(window, |_| state(Overlay::status)).await
}

#[tauri::command]
pub(crate) async fn desktop_lyric_set(
    window: WebviewWindow,
    enabled: bool,
    locked: Option<bool>,
    style: Option<LyricStylePatch>,
) -> Result<LyricStatus> {
    on_ui(window, move |main| {
        if let Some(patch) = style {
            change_style(state(|overlay| overlay.style)?.merge(patch)?)?;
        }
        set_enabled(main, enabled, locked)
    })
    .await
}

#[tauri::command]
pub(crate) async fn desktop_lyric_update(
    window: WebviewWindow,
    text: String,
    translation: Option<String>,
    romaji: Option<String>,
    title: Option<String>,
    playing: Option<bool>,
    next_text: Option<String>,
    elapsed_ms: Option<u32>,
    duration_ms: Option<u32>,
    rate: Option<f32>,
    accent_color: Option<String>,
) -> Result<()> {
    let content = Content {
        text: line(text)?,
        translation: line(translation.unwrap_or_default())?,
        romaji: line(romaji.unwrap_or_default())?,
        title: line(title.unwrap_or_default())?,
        playing: playing.unwrap_or(false),
        next_text: line(next_text.unwrap_or_default())?,
        elapsed_ms: elapsed_ms.unwrap_or_default().min(600_000),
        duration_ms: duration_ms.unwrap_or_default().min(600_000),
        rate: rate
            .filter(|rate| rate.is_finite())
            .unwrap_or(1.0)
            .clamp(0.25, 4.0),
        accent_color: accent_color.as_deref().and_then(accent),
    };
    on_ui(window, move |_| {
        let update = update_state(|overlay| {
            let hwnd = overlay.hwnd?;
            let timed = content.playing && overlay.style.karaoke && content.duration_ms > 0;
            if overlay.content == content && !timed {
                return None;
            }
            let now = Instant::now();
            if overlay.content.text != content.text {
                overlay.line_changed = Some(now);
            }
            overlay.content_updated = now;
            let resized = overlay.style.height(&overlay.content) != overlay.style.height(&content);
            overlay.content = content;
            Some((hwnd, resized && !overlay.dragging))
        })?;
        if let Some((hwnd, resized)) = update {
            if resized {
                resize(hwnd, None)?;
            }
            redraw(hwnd)?;
        }
        Ok(())
    })
    .await
}

fn submit_frame(hwnd: HWND, size: SIZE, dc: HDC, position: Option<&POINT>) -> Result<()> {
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };
    unsafe {
        UpdateLayeredWindow(
            hwnd,
            None,
            position.map(|point| point as *const POINT),
            Some(&size),
            Some(dc),
            Some(&POINT::default()),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        )
    }
    .map_err(|_| err("unavailable", "无法提交桌面歌词透明帧"))
}

fn redraw(hwnd: HWND) -> Result<()> {
    if state(|overlay| overlay.hwnd).ok().flatten() != Some(hwnd) {
        return Ok(());
    }
    let mut rect = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() || rect.right <= 0 || rect.bottom <= 0 {
        return Ok(());
    }
    let size = SIZE {
        cx: rect.right,
        cy: rect.bottom,
    };
    let now = Instant::now();
    let monitor_dpi = dpi(hwnd);
    let animate = update_state(|overlay| {
        if overlay.unlock_hover_until.is_some_and(|until| now >= until) {
            overlay.unlock_hover_until = None;
            overlay.hover.set(false, now);
        }
        let fraction = time_fraction(now, overlay.line_changed);
        let karaoke = overlay.content.playing
            && overlay.style.karaoke
            && overlay.content.duration_ms > 0
            && !overlay.content.text.is_empty();
        let progress = if karaoke {
            overlay
                .content
                .progress(now.duration_since(overlay.content_updated).as_secs_f32() * 1000.0)
        } else {
            0.0
        };
        (
            fraction,
            progress,
            overlay.unlock_hover_until.is_some()
                || (!overlay.locked && time_fraction(now, overlay.hover.since) < 1.0)
                || fraction < 1.0
                || (karaoke && progress < 1.0),
        )
    })?;
    let result = RENDERER.with(|cell| {
        let Ok(mut slot) = cell.try_borrow_mut() else {
            return Ok(());
        };
        if slot.is_none() {
            *slot =
                Some(Renderer::new().map_err(|_| err("unavailable", "无法初始化桌面歌词渲染器"))?);
        }
        let renderer = slot.as_mut().unwrap();
        let surface = state(|overlay| {
            renderer.render(
                &overlay.content,
                overlay.style,
                size,
                monitor_dpi,
                render::Effects {
                    shell: if overlay.locked {
                        0.0
                    } else {
                        overlay.hover.amount(now)
                    },
                    hover_button: overlay.hover_button,
                    line: animate.0,
                    progress: animate.1,
                },
            )
        })?
        .map_err(|_| err("unavailable", "无法绘制桌面歌词"))?;
        if !state(|overlay| overlay.locked)? {
            for pixel in surface.pixels() {
                if *pixel == 0 {
                    *pixel = 0x01000000;
                }
            }
        }
        submit_frame(hwnd, size, surface.dc, None)
    });
    let running = state(|overlay| overlay.timer)?;
    let needed = animate.2 && result.is_ok();
    if running != needed {
        let running = if needed {
            (unsafe { SetTimer(Some(hwnd), TIMER, 33, None) }) != 0
        } else {
            let _ = unsafe { KillTimer(Some(hwnd), TIMER) };
            false
        };
        update_state(|overlay| overlay.timer = running)?;
    }
    result
}

fn point(param: LPARAM) -> POINT {
    POINT {
        x: param.0 as i16 as i32,
        y: (param.0 >> 16) as i16 as i32,
    }
}

fn cursor_button(hwnd: HWND, client: POINT) -> Option<Button> {
    let mut rect = RECT::default();
    unsafe { GetClientRect(hwnd, &mut rect) }.ok()?;
    let monitor_dpi = dpi(hwnd);
    button_at(
        logical(monitor_dpi, rect.right),
        logical(monitor_dpi, client.x),
        logical(monitor_dpi, client.y),
    )
}

fn mouse_moved(hwnd: HWND, nonclient: bool, cursor: POINT) {
    let button = if nonclient {
        None
    } else {
        cursor_button(hwnd, cursor)
    };
    if let Ok(Some((track, changed))) = update_state(|overlay| {
        if overlay.locked || overlay.hwnd != Some(hwnd) {
            return None;
        }
        let track = overlay.tracking != Some(nonclient);
        let changed = !overlay.hover.on || overlay.hover_button != button;
        overlay.unlock_hover_until = None;
        overlay.hover.set(true, Instant::now());
        overlay.hover_button = button;
        overlay.tracking = Some(nonclient);
        Some((track, changed))
    }) {
        if track {
            let mut request = TRACKMOUSEEVENT {
                cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: if nonclient {
                    TME_LEAVE | TME_NONCLIENT
                } else {
                    TME_LEAVE
                },
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            if unsafe { TrackMouseEvent(&mut request) }.is_err() {
                let _ = update_state(|overlay| overlay.tracking = None);
            }
        }
        if changed {
            let _ = redraw(hwnd);
        }
    }
}

fn leave(hwnd: HWND, nonclient: bool) {
    let mut cursor = POINT::default();
    let inside = unsafe { GetCursorPos(&mut cursor).is_ok() && WindowFromPoint(cursor) == hwnd };
    if update_state(|overlay| {
        if overlay.tracking == Some(nonclient) {
            overlay.tracking = None;
        }
        if inside || overlay.dragging || !overlay.hover.on {
            return false;
        }
        overlay.hover.set(false, Instant::now());
        overlay.hover_button = None;
        true
    })
    .unwrap_or(false)
    {
        let _ = redraw(hwnd);
    }
}

fn activate(hwnd: HWND, button: Button) -> Result<()> {
    let action = match button {
        Button::Previous => Some("prevTrack"),
        Button::Playback => Some("togglePlayback"),
        Button::Next => Some("nextTrack"),
        _ => None,
    };
    if let Some(action) = action {
        let app = state(|overlay| overlay.app.clone())?;
        let _ = app.emit_to(
            "main",
            "prism:global-shortcut",
            serde_json::json!({ "action": action }),
        );
        return Ok(());
    }
    let mut style = state(|overlay| overlay.style)?;
    match button {
        Button::Translation => style.show_translation = !style.show_translation,
        Button::Layout => {
            style.layout = if style.layout == LyricLayout::Dual {
                LyricLayout::Single
            } else {
                LyricLayout::Dual
            }
        }
        Button::Smaller => style.font_size = (style.font_size - 2).clamp(18, 48),
        Button::Larger => style.font_size = (style.font_size + 2).clamp(18, 48),
        Button::Lock => {
            set_locked(hwnd, true)?;
            redraw(hwnd)?;
            publish();
            return Ok(());
        }
        Button::Close => {
            return unsafe { DestroyWindow(hwnd) }
                .map_err(|_| err("unavailable", "无法关闭桌面歌词"))
        }
        _ => return Ok(()),
    }
    change_style(style)
}

fn hit_test(hwnd: HWND, screen: POINT) -> i32 {
    if unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_TRANSPARENT.0 as isize != 0 {
        return HTTRANSPARENT;
    }
    let Some(rect) = window_rect(hwnd) else {
        return HTNOWHERE as i32;
    };
    let monitor_dpi = dpi(hwnd);
    let mouse_x = screen.x - rect.left;
    let width = rect.right - rect.left;
    let edge = scaled(monitor_dpi, EDGE);
    if mouse_x < edge {
        HTLEFT as i32
    } else if mouse_x >= width - edge {
        HTRIGHT as i32
    } else if cursor_button(
        hwnd,
        POINT {
            x: mouse_x,
            y: screen.y - rect.top,
        },
    )
    .is_some()
    {
        HTCLIENT as i32
    } else {
        HTCAPTION as i32
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_NCCALCSIZE | WM_NCLBUTTONDBLCLK => return LRESULT(0),
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_ERASEBKGND => return LRESULT(1),
        WM_NCHITTEST => return LRESULT(hit_test(hwnd, point(lparam)) as isize),
        WM_MOUSEMOVE | WM_NCMOUSEMOVE => {
            mouse_moved(hwnd, message == WM_NCMOUSEMOVE, point(lparam))
        }
        WM_MOUSELEAVE | WM_NCMOUSELEAVE => leave(hwnd, message == WM_NCMOUSELEAVE),
        WM_LBUTTONDOWN => {
            if let Some(button) = cursor_button(hwnd, point(lparam)) {
                if update_state(|overlay| {
                    if overlay.locked {
                        return false;
                    }
                    overlay.pressed = Some(button);
                    true
                })
                .unwrap_or(false)
                {
                    unsafe {
                        SetCapture(hwnd);
                    }
                }
            }
            return LRESULT(0);
        }
        WM_LBUTTONUP => {
            let pressed = update_state(|overlay| overlay.pressed.take())
                .ok()
                .flatten();
            if unsafe { GetCapture() } == hwnd {
                let _ = unsafe { ReleaseCapture() };
            }
            if let Some(button) =
                pressed.filter(|&button| Some(button) == cursor_button(hwnd, point(lparam)))
            {
                let _ = activate(hwnd, button);
            }
            leave(hwnd, false);
            return LRESULT(0);
        }
        WM_CAPTURECHANGED => {
            let _ = update_state(|overlay| overlay.pressed = None);
        }
        WM_ENTERSIZEMOVE => {
            let _ = update_state(|overlay| {
                overlay.dragging = true;
                overlay.hover.set(!overlay.locked, Instant::now());
            });
            let _ = redraw(hwnd);
        }
        WM_EXITSIZEMOVE => {
            if let Some(rect) = window_rect(hwnd) {
                let _ = update_state(|overlay| {
                    overlay.dragging = false;
                    overlay.style.width = (logical(dpi(hwnd), rect.right - rect.left).round()
                        as i32)
                        .clamp(460, 1200);
                });
                let _ = resize(hwnd, None);
                let _ = persist();
                publish();
                leave(hwnd, true);
                let _ = redraw(hwnd);
            }
        }
        WM_GETMINMAXINFO if lparam.0 != 0 => {
            if let Ok(height) = state(|overlay| overlay.style.height(&overlay.content)) {
                let monitor_dpi = dpi(hwnd);
                let height = scaled(monitor_dpi, height);
                let limits = unsafe { &mut *(lparam.0 as *mut MINMAXINFO) };
                limits.ptMinTrackSize = POINT {
                    x: scaled(monitor_dpi, 460),
                    y: height,
                };
                limits.ptMaxTrackSize = POINT {
                    x: scaled(monitor_dpi, 1200),
                    y: height,
                };
                return LRESULT(0);
            }
        }
        WM_SIZE => {
            let _ = redraw(hwnd);
        }
        WM_TIMER if wparam.0 == TIMER => {
            let _ = redraw(hwnd);
            return LRESULT(0);
        }
        WM_TIMER if wparam.0 == LOCK_PROBE_TIMER => {
            let _ = refresh_unlock(hwnd, true);
            return LRESULT(0);
        }
        WM_DPICHANGED
            if lparam.0 != 0 && state(|overlay| overlay.hwnd).ok().flatten() == Some(hwnd) =>
        {
            let rect = unsafe { *(lparam.0 as *const RECT) };
            if state(|overlay| overlay.dragging).unwrap_or(false) {
                let _ = unsafe {
                    SetWindowPos(
                        hwnd,
                        None,
                        rect.left,
                        rect.top,
                        rect.right - rect.left,
                        rect.bottom - rect.top,
                        SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                };
                let _ = refresh_unlock(hwnd, false);
            } else {
                let _ = resize(hwnd, Some(rect));
            }
            let _ = redraw(hwnd);
            return LRESULT(0);
        }
        WM_CLOSE => {
            let _ = unsafe { DestroyWindow(hwnd) };
            return LRESULT(0);
        }
        WM_DESTROY if state(|overlay| overlay.hwnd).ok().flatten() == Some(hwnd) => {
            let _ = unsafe { KillTimer(Some(hwnd), TIMER) };
            stop_unlock_probe(hwnd);
            let position = window_rect(hwnd).map(|rect| Position {
                x: rect.left,
                y: rect.top,
            });
            let _ = update_state(|overlay| {
                overlay.position = position.or(overlay.position);
                overlay.hwnd = None;
                overlay.unlock_hover_until = None;
                overlay.hover = Hover::default();
                overlay.hover_button = None;
                overlay.pressed = None;
                overlay.tracking = None;
                overlay.dragging = false;
                overlay.timer = false;
                overlay.line_changed = None;
                overlay.content = Content::default();
            });
            RENDERER.with(|cell| {
                if let Ok(mut renderer) = cell.try_borrow_mut() {
                    renderer.take();
                }
            });
            let _ = persist();
            publish();
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn unlock_position_centers_flips_and_clamps_on_negative_monitors() {
        let work = bounds(0, 30, 1920, 1040);
        assert_eq!(
            unlock_rect(bounds(100, 80, 500, 180), work, 96),
            bounds(287, 49, 313, 75)
        );
        assert_eq!(
            unlock_rect(bounds(100, 30, 500, 130), work, 96),
            bounds(287, 135, 313, 161)
        );
        let secondary = bounds(-1920, -500, -600, 580);
        assert_eq!(
            unlock_rect(bounds(-2010, -500, -1800, -400), secondary, 144),
            bounds(-1920, -392, -1881, -353),
        );
        assert_eq!(
            unlock_rect(bounds(-740, -500, -450, 570), secondary, 120),
            bounds(-633, 547, -600, 580),
        );
    }

    #[test]
    fn unlock_hot_zone_includes_only_the_narrow_gap_between_windows() {
        let lyric = bounds(-500, 100, -100, 200);
        for (capsule, bridge_y) in [
            (bounds(-313, 69, -287, 95), 97),
            (bounds(-313, 205, -287, 231), 203),
        ] {
            for cursor in [
                POINT { x: -499, y: 100 },
                POINT {
                    x: -300,
                    y: capsule.top,
                },
                POINT {
                    x: -300,
                    y: bridge_y,
                },
            ] {
                assert!(unlock_hot_zone(lyric, capsule, cursor));
            }
            assert!(!unlock_hot_zone(
                lyric,
                capsule,
                POINT {
                    x: capsule.left - 1,
                    y: bridge_y
                }
            ));
            assert!(!unlock_hot_zone(lyric, capsule, POINT { x: -100, y: 100 }));
        }
    }

    #[test]
    fn unlock_button_renders_a_premultiplied_circle_and_centered_icon_at_each_dpi() {
        let mut renderer = Renderer::new().unwrap();
        for dpi in [96, 120, 144] {
            let size = SIZE {
                cx: scaled(dpi, 26),
                cy: scaled(dpi, 26),
            };
            let pixels = [
                UnlockVisual::Idle,
                UnlockVisual::Hover,
                UnlockVisual::Pressed,
            ]
            .map(|visual| {
                renderer
                    .render_unlock(size, dpi, visual)
                    .unwrap()
                    .pixels()
                    .to_vec()
            });
            for frame in &pixels {
                assert!(frame.iter().all(|pixel| {
                    let [blue, green, red, alpha] = pixel.to_le_bytes();
                    blue <= alpha && green <= alpha && red <= alpha
                }));
                let pixel =
                    |left, top| frame[(scaled(dpi, top) * size.cx + scaled(dpi, left)) as usize];
                let red = |left, top| (pixel(left, top) >> 16) & 255;
                assert_eq!(pixel(0, 0), 0);
                assert_eq!(pixel(25, 25), 0);
                assert!((200..255).contains(&(pixel(6, 13) >> 24)));
                assert!((0..3).any(|top| red(13, top) > red(6, 13) + 25));
                assert!(frame.iter().any(|pixel| (1..190).contains(&(pixel >> 24))));
                assert!((6..10).any(|top| red(13, top) > 100), "shackle at {dpi} DPI");
                assert!((18..21).any(|top| red(13, top) > 100), "lock body at {dpi} DPI");
                assert!(
                    (10..17).all(|top| [5, 6, 19, 20]
                        .into_iter()
                        .all(|left| red(left, top) == red(6, 13))),
                    "no side label at {dpi} DPI"
                );
            }
            let background = (scaled(dpi, 13) * size.cx + scaled(dpi, 6)) as usize;
            let red = |frame: &[u32]| (frame[background] >> 16) & 255;
            assert!(red(&pixels[1]) > red(&pixels[2]) && red(&pixels[2]) > red(&pixels[0]));
        }
    }

    #[test]
    fn locked_probe_lazily_shows_without_activation_hides_and_stops_on_unlock() {
        let instance = HINSTANCE(unsafe { GetModuleHandleW(None) }.unwrap().0);
        let hwnd = create_native_window(
            instance,
            w!("STATIC"),
            Position { x: 140, y: 180 },
            480,
            100,
            true,
        )
        .unwrap();
        let mut probe = UnlockProbe::start(hwnd).unwrap();
        assert!(probe.hwnd.is_none());
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut message = MSG::default();
        while !unsafe { PeekMessageW(&mut message, Some(hwnd), WM_TIMER, WM_TIMER, PM_REMOVE) }
            .as_bool()
        {
            assert!(Instant::now() < deadline, "lock probe timer did not fire");
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(message.wParam.0, LOCK_PROBE_TIMER);
        let now = Instant::now();
        let lyric = bounds(140, 180, 620, 280);
        let capsule = bounds(367, 149, 393, 175);
        let outside = POINT { x: 10, y: 10 };
        let bridge = POINT { x: 380, y: 177 };
        probe.probe(lyric, capsule, 96, outside, now).unwrap();
        assert!(probe.hwnd.is_none());
        let active = unsafe { GetActiveWindow() };
        probe.probe(lyric, capsule, 96, bridge, now).unwrap();
        let button = probe.hwnd.unwrap();
        let expected_style = WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        let styles = unsafe { GetWindowLongPtrW(button, GWL_EXSTYLE) } as u32;
        assert_eq!(
            styles & (expected_style | WS_EX_TRANSPARENT).0,
            expected_style.0
        );
        assert_eq!(unsafe { GetActiveWindow() }, active);
        assert!(unsafe { IsWindowVisible(button) }.as_bool());
        assert_eq!(window_rect(button), Some(capsule));

        let moved = bounds(364, 141, 397, 174);
        probe.show(moved, 120).unwrap();
        assert_eq!(window_rect(button), Some(moved));
        probe.probe(lyric, moved, 120, outside, now).unwrap();
        probe.pressed = true;
        probe
            .probe(lyric, moved, 120, outside, now + UNLOCK_HIDE_DELAY)
            .unwrap();
        assert!(unsafe { IsWindowVisible(button) }.as_bool());
        probe.pressed = false;
        probe
            .probe(lyric, moved, 120, outside, now + UNLOCK_HIDE_DELAY)
            .unwrap();
        assert!(!unsafe { IsWindowVisible(button) }.as_bool());
        probe
            .probe(lyric, moved, 120, bridge, now + UNLOCK_HIDE_DELAY)
            .unwrap();
        assert_eq!(probe.hwnd, Some(button));
        assert!(unsafe { IsWindowVisible(button) }.as_bool());

        apply_lock_style(hwnd, false).unwrap();
        probe.stop(hwnd);
        assert!(!unsafe { IsWindow(Some(button)) }.as_bool());
        assert!(unsafe { KillTimer(Some(hwnd), LOCK_PROBE_TIMER) }.is_err());
        unsafe { DestroyWindow(hwnd) }.unwrap();
    }

    #[test]
    fn sanitizes_lyric_text_and_clamps_to_work_area() {
        assert_eq!(
            line("<b>歌词</b>\n第二行\0".into()).unwrap(),
            "<b>歌词</b> 第二行 "
        );
        assert_eq!(line("词".repeat(513)).unwrap_err().kind, "validation");
        assert!(line("😀".repeat(512)).is_ok());
        let area = RECT {
            left: -1000,
            top: 0,
            right: 0,
            bottom: 720,
        };
        assert_eq!(
            clamp_position(None, area, 600, 120),
            Position { x: -800, y: 552 }
        );
        assert_eq!(
            clamp_position(Some(Position { x: 200, y: -999 }), area, 600, 120),
            Position { x: -600, y: 0 }
        );
        assert_eq!(
            clamp_position(None, area, 1200, 800),
            Position { x: -1000, y: 0 }
        );
    }

    #[test]
    fn validates_style_and_migrates_v1_placements() {
        let defaults = LyricStyle::default();
        let previous: Placement =
            serde_json::from_str(r#"{"version":1,"position":{"x":-560,"y":95}}"#).unwrap();
        let upgraded = previous.migrate().unwrap();
        assert_eq!(upgraded.style, defaults);
        assert_eq!(
            serde_json::to_value(upgraded).unwrap(),
            serde_json::json!({
                "version": 2, "position": {"x": -560, "y": 95}, "style": {
                    "fontSize": 28, "theme": "night", "layout": "dual", "align": "center", "panelOpacity": 82,
                    "karaoke": true, "showTranslation": true, "showRomaji": false, "width": 720
                }
            })
        );
        for raw in [
            r#"{"fontSize":17}"#,
            r#"{"fontSize":49}"#,
            r#"{"panelOpacity":39}"#,
            r#"{"panelOpacity":101}"#,
            r#"{"panelOpacity":-1}"#,
            r#"{"panelOpacity":256}"#,
            r#"{"width":459}"#,
            r#"{"width":1201}"#,
        ] {
            let patch = serde_json::from_str(raw).unwrap();
            assert_eq!(defaults.merge(patch).unwrap_err().kind, "validation");
        }
        assert!(serde_json::from_str::<LyricStylePatch>(r#"{"unknown":1}"#).is_err());
        let style = defaults
            .merge(
                serde_json::from_str(
                    r#"{"theme":"contrast","align":"left","width":1200,"showRomaji":true}"#,
                )
                .unwrap(),
            )
            .unwrap();
        let serialized = serde_json::to_string(&Placement {
            version: 2,
            position: None,
            style,
        })
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Placement>(&serialized)
                .unwrap()
                .migrate()
                .unwrap()
                .style,
            style
        );
        assert!(serde_json::from_str::<Placement>(
            r#"{"version":2,"position":null,"style":{"width":10}}"#
        )
        .unwrap()
        .migrate()
        .is_none());
        assert_eq!(accent("#a1B203"), Some(0xa1b203));
        for value in ["", "aabbcc", "#aabbccdd", "#abz033", "#彩abc"] {
            assert_eq!(accent(value), None);
        }
    }

    #[test]
    fn motion_converges_and_layout_prioritizes_translation() {
        use std::time::Duration;
        let now = Instant::now();
        let mut hover = Hover::default();
        hover.set(true, now);
        let midpoint = now + Duration::from_millis(70);
        assert_eq!(hover.amount(now), 0.0);
        assert!((hover.amount(midpoint) - 0.75).abs() < 0.001);
        hover.set(false, midpoint);
        assert!((hover.amount(midpoint) - 0.75).abs() < 0.001);
        assert_eq!(hover.amount(midpoint + Duration::from_millis(140)), 0.0);
        let mut content = Content {
            next_text: "下一句".into(),
            translation: "译文".into(),
            duration_ms: 800,
            elapsed_ms: 100,
            rate: 2.0,
            ..Default::default()
        };
        assert_eq!(content.progress(150.0), 0.5);
        assert_eq!(content.progress(400.0), 1.0);
        let mut style = LyricStyle::default();
        assert_eq!(style.secondary(&content), Some(("译文", true)));
        content.translation.clear();
        assert_eq!(style.secondary(&content), Some(("下一句", false)));
        let height = style.height(&content);
        style.layout = LyricLayout::Single;
        assert_eq!(style.secondary(&content), None);
        assert!(style.height(&content) < height);
    }

    #[test]
    fn draws_shell_controls_and_partial_karaoke_in_premultiplied_bgra() {
        let mut renderer = Renderer::new().unwrap();
        let content = Content {
            title: "夜间广播 · Night Radio".into(),
            text: "PRISM DESKTOP LYRICS".into(),
            next_text: "NEXT LINE".into(),
            playing: true,
            ..Default::default()
        };
        let style = LyricStyle::default();
        for dpi in [96, 120, 144] {
            let size = SIZE {
                cx: scaled(dpi, style.width),
                cy: scaled(dpi, style.height(&content)),
            };
            let width = size.cx as usize;
            let at = |x, y| scaled(dpi, y) as usize * width + scaled(dpi, x) as usize;
            let primary_bottom = TOOLBAR_HEIGHT + style.primary_height();
            for shell in [0.0, 0.5, 1.0] {
                let frame = renderer
                    .render(
                        &content,
                        style,
                        size,
                        dpi,
                        render::Effects {
                            shell,
                            hover_button: Some(Button::Close),
                            line: 1.0,
                            progress: 0.5,
                        },
                    )
                    .unwrap();
                let pixels = frame.pixels();
                assert_eq!(pixels[0], 0);
                let alpha = pixels[at(8, 48)] >> 24;
                assert!(
                    (alpha as i32 - (255.0 * 0.82 * shell).round() as i32).abs() <= 1,
                    "dpi={dpi} shell={shell} alpha={alpha}"
                );
                let controls = &pixels[..at(0, TOOLBAR_HEIGHT)];
                if shell == 0.0 {
                    assert!(controls.iter().all(|pixel| *pixel == 0));
                } else {
                    assert!(pixels[at(694, 16)] >> 24 > alpha);
                }
                assert!(pixels.iter().all(|pixel| {
                    let [blue, green, red, alpha] = pixel.to_le_bytes();
                    blue <= alpha && green <= alpha && red <= alpha
                }));
                if shell == 0.0 {
                    let primary = &pixels[at(0, TOOLBAR_HEIGHT)..at(0, primary_bottom)];
                    let count_color = |color, left| {
                        primary
                            .iter()
                            .enumerate()
                            .filter(|(index, pixel)| {
                                **pixel == color && ((index % width) < width / 2) == left
                            })
                            .count()
                    };
                    assert!(count_color(0xfff2a65a, true) > 0);
                    assert_eq!(count_color(0xfff2a65a, false), 0);
                    assert!(count_color(0xfff0f4fa, false) > 0);
                    assert!(pixels[at(0, primary_bottom)..].contains(&0xff8fa2bc));
                }
            }
        }
        let paused = Content {
            playing: false,
            ..content
        };
        let frame = renderer
            .render(
                &paused,
                style,
                SIZE {
                    cx: style.width,
                    cy: style.height(&paused),
                },
                96,
                render::Effects {
                    shell: 0.0,
                    hover_button: None,
                    line: 1.0,
                    progress: 0.0,
                },
            )
            .unwrap();
        assert!(frame.pixels().contains(&0xffa4b4c9));
    }

    #[test]
    fn native_window_is_nonactivating_and_switches_hit_testing() {
        let instance = HINSTANCE(unsafe { GetModuleHandleW(None) }.unwrap().0);
        let class = w!("Prism.DesktopLyric.Test");
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class,
            ..Default::default()
        };
        assert_ne!(unsafe { RegisterClassW(&window_class) }, 0);
        let hwnd =
            create_native_window(instance, class, Position { x: 0, y: 0 }, 720, 120, true).unwrap();
        let size = SIZE { cx: 720, cy: 120 };
        let mut renderer = Renderer::new().unwrap();
        let frame = renderer
            .render(
                &Content {
                    text: "夜间电台 · Prism".into(),
                    ..Default::default()
                },
                LyricStyle::default(),
                size,
                96,
                render::Effects {
                    shell: 0.0,
                    hover_button: None,
                    line: 1.0,
                    progress: 0.0,
                },
            )
            .unwrap();
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
            ..Default::default()
        };
        unsafe {
            UpdateLayeredWindow(
                hwnd,
                None,
                None,
                Some(&size),
                Some(frame.dc),
                Some(&POINT::default()),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            )
        }
        .unwrap();
        let flags = (WS_EX_LAYERED
            | WS_EX_TRANSPARENT
            | WS_EX_TOPMOST
            | WS_EX_TOOLWINDOW
            | WS_EX_NOACTIVATE)
            .0;
        assert_eq!(
            unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32 & flags,
            flags
        );
        assert_eq!(hit_test(hwnd, POINT { x: 1, y: 40 }), HTTRANSPARENT);
        apply_lock_style(hwnd, false).unwrap();
        assert_eq!(hit_test(hwnd, POINT { x: 1, y: 40 }), HTLEFT as i32);
        assert_eq!(hit_test(hwnd, POINT { x: 719, y: 40 }), HTRIGHT as i32);
        assert_eq!(hit_test(hwnd, POINT { x: 650, y: 15 }), HTCLIENT as i32);
        assert_eq!(hit_test(hwnd, POINT { x: 360, y: 50 }), HTCAPTION as i32);
        apply_lock_style(hwnd, true).unwrap();
        assert_eq!(hit_test(hwnd, POINT { x: 650, y: 15 }), HTTRANSPARENT);
        unsafe { DestroyWindow(hwnd) }.unwrap();
        assert!(!unsafe { IsWindow(Some(hwnd)) }.as_bool());
        unsafe { UnregisterClassW(class, Some(instance)) }.unwrap();
    }
}
