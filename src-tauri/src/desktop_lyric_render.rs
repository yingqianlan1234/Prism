use super::{
    button_left, logical, Button, Content, LyricAlign, LyricLayout, LyricStyle, LyricTheme,
    BUTTONS, BUTTON_WIDTH, TOOLBAR_HEIGHT,
};
use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    ptr::NonNull,
};
use windows::{
    core::{w, ComObject, Error, IUnknown, Interface, Ref, Result, BOOL, PCWSTR},
    Win32::{
        Foundation::{D2DERR_RECREATE_TARGET, DWRITE_E_NOCOLOR, E_FAIL, E_NOTIMPL, RECT, SIZE},
        Graphics::{
            Direct2D::{Common::*, *},
            DirectWrite::*,
            Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
            Gdi::*,
        },
    },
};
use windows_numerics::{Matrix3x2, Vector2};

const ICE: u32 = 0xf0f4fa;
const AMBER: u32 = 0xf2a65a;

struct Palette {
    primary: u32,
    accent: u32,
    secondary: u32,
    shadow: u32,
    outline: f32,
}

fn palette(content: &Content, theme: LyricTheme) -> Palette {
    let (active, paused, accent, secondary, shadow, outline) = match theme {
        LyricTheme::Night => (ICE, 0xa4b4c9, AMBER, 0x8fa2bc, 0x030711, 0.50),
        LyricTheme::Contrast => (0xffffff, 0xcbd5e1, 0xffb85c, 0xe2e8f0, 0x000000, 1.0),
        LyricTheme::Warm => (0xfff4e0, 0xc7b299, 0xf5b762, 0xc7b299, 0x160d08, 0.50),
        LyricTheme::Accent => (
            ICE,
            0xa4b4c9,
            content.accent_color.unwrap_or(AMBER),
            0x8fa2bc,
            0x030711,
            0.50,
        ),
    };
    Palette {
        primary: if content.playing { active } else { paused },
        accent,
        secondary,
        shadow,
        outline,
    }
}

pub(super) struct Effects {
    pub shell: f32,
    pub hover_button: Option<Button>,
    pub line: f32,
    pub progress: f32,
}

pub(super) struct Dib {
    pub dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: NonNull<u32>,
    size: SIZE,
}

impl Dib {
    fn new(size: SIZE) -> Result<Self> {
        let area = i64::from(size.cx) * i64::from(size.cy);
        if size.cx <= 0 || size.cy <= 0 || area > 4_000_000 {
            return Err(Error::from_hresult(E_FAIL));
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size.cx,
                biHeight: -size.cy,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        unsafe {
            let mut bits = std::ptr::null_mut();
            let bitmap = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
            let dc = CreateCompatibleDC(None);
            if !dc.0.is_null() {
                let previous = SelectObject(dc, HGDIOBJ(bitmap.0));
                if let Some(bits) = NonNull::new(bits.cast()).filter(|_| !previous.0.is_null()) {
                    return Ok(Self {
                        dc,
                        bitmap,
                        previous,
                        bits,
                        size,
                    });
                }
                let _ = DeleteDC(dc);
            }
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            Err(Error::from_hresult(E_FAIL))
        }
    }

    pub fn pixels(&mut self) -> &mut [u32] {
        unsafe {
            let _ = GdiFlush();
            std::slice::from_raw_parts_mut(
                self.bits.as_ptr(),
                self.size.cx as usize * self.size.cy as usize,
            )
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

pub(super) struct Renderer {
    target: ID2D1DCRenderTarget,
    factory: ID2D1Factory,
    text: IDWriteFactory,
    color_text: Option<IDWriteFactory4>,
    lyric_stroke: ID2D1StrokeStyle,
    family: PCWSTR,
    hardware: bool,
    surface: Option<Dib>,
    unlock_surface: Option<Dib>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum UnlockVisual {
    #[default]
    Idle,
    Hover,
    Pressed,
}

fn target(factory: &ID2D1Factory, kind: D2D1_RENDER_TARGET_TYPE) -> Result<ID2D1DCRenderTarget> {
    unsafe {
        factory.CreateDCRenderTarget(&D2D1_RENDER_TARGET_PROPERTIES {
            r#type: kind,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 96.0,
            dpiY: 96.0,
            ..Default::default()
        })
    }
}

fn font_family(factory: &IDWriteFactory) -> PCWSTR {
    let mut collection = None;
    unsafe {
        let _ = factory.GetSystemFontCollection(&mut collection, false);
    }
    if let Some(collection) = collection {
        for family in [w!("MiSans"), w!("Noto Sans SC")] {
            let mut exists = BOOL(0);
            let mut index = 0;
            if unsafe { collection.FindFamilyName(family, &mut index, &mut exists) }.is_ok()
                && exists.as_bool()
            {
                return family;
            }
        }
    }
    w!("Microsoft YaHei UI")
}

impl Renderer {
    pub fn new() -> Result<Self> {
        unsafe {
            let factory: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
            let text: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let family = font_family(&text);
            let color_text = text.cast().ok();
            let lyric_stroke = factory.CreateStrokeStyle(
                &D2D1_STROKE_STYLE_PROPERTIES {
                    startCap: D2D1_CAP_STYLE_ROUND,
                    endCap: D2D1_CAP_STYLE_ROUND,
                    dashCap: D2D1_CAP_STYLE_ROUND,
                    lineJoin: D2D1_LINE_JOIN_ROUND,
                    miterLimit: 1.0,
                    ..Default::default()
                },
                None,
            )?;
            let preferred = target(&factory, D2D1_RENDER_TARGET_TYPE_HARDWARE);
            let hardware = preferred.is_ok();
            let target =
                preferred.or_else(|_| target(&factory, D2D1_RENDER_TARGET_TYPE_SOFTWARE))?;
            Ok(Self {
                target,
                factory,
                text,
                color_text,
                lyric_stroke,
                family,
                hardware,
                surface: None,
                unlock_surface: None,
            })
        }
    }

    pub fn render(
        &mut self,
        content: &Content,
        style: LyricStyle,
        size: SIZE,
        dpi: u32,
        effects: Effects,
    ) -> Result<&mut Dib> {
        self.frame(size, dpi, false, |canvas, width, height| {
            canvas.scene(content, style, width, height, &effects)
        })
    }

    pub fn render_unlock(
        &mut self,
        size: SIZE,
        dpi: u32,
        visual: UnlockVisual,
    ) -> Result<&mut Dib> {
        self.frame(size, dpi, true, |canvas, width, height| {
            canvas.unlock(width, height, visual)
        })
    }

    fn frame(
        &mut self,
        size: SIZE,
        dpi: u32,
        unlock: bool,
        paint: impl Fn(&Canvas<'_>, f32, f32) -> Result<()>,
    ) -> Result<&mut Dib> {
        let slot = if unlock {
            &mut self.unlock_surface
        } else {
            &mut self.surface
        };
        let surface = match slot.take() {
            Some(surface) if surface.size == size => surface,
            _ => Dib::new(size)?,
        };
        let result = self.draw(&surface, dpi, &paint);
        if let Err(error) = result {
            if !self.hardware && error.code() != D2DERR_RECREATE_TARGET {
                return Err(error);
            }
            self.hardware = false;
            self.target = target(&self.factory, D2D1_RENDER_TARGET_TYPE_SOFTWARE)?;
            self.draw(&surface, dpi, &paint)?;
        }
        let slot = if unlock {
            &mut self.unlock_surface
        } else {
            &mut self.surface
        };
        let surface = slot.insert(surface);
        for pixel in surface.pixels() {
            let [blue, green, red, alpha] = pixel.to_le_bytes();
            if blue > alpha || green > alpha || red > alpha {
                *pixel =
                    u32::from_le_bytes([blue.min(alpha), green.min(alpha), red.min(alpha), alpha]);
            }
        }
        Ok(surface)
    }

    fn draw(
        &self,
        surface: &Dib,
        dpi: u32,
        paint: impl FnOnce(&Canvas<'_>, f32, f32) -> Result<()>,
    ) -> Result<()> {
        unsafe {
            let target = &self.target;
            let size = surface.size;
            target.BindDC(
                surface.dc,
                &RECT {
                    left: 0,
                    top: 0,
                    right: size.cx,
                    bottom: size.cy,
                },
            )?;
            target.SetDpi(dpi as f32, dpi as f32);
            target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
            let brush = target.CreateSolidColorBrush(&color(ICE, 1.0), None)?;
            let canvas = Canvas {
                renderer: self,
                brush,
                pixel_width: 96.0 / dpi as f32,
            };
            target.BeginDraw();
            target.Clear(None);
            let result = paint(&canvas, logical(dpi, size.cx), logical(dpi, size.cy));
            let finished = target.EndDraw(None, None);
            finished.and(result)
        }
    }
}

fn color(rgb: u32, alpha: f32) -> D2D1_COLOR_F {
    let [blue, green, red, _] = rgb.to_le_bytes();
    D2D1_COLOR_F {
        r: f32::from(red) / 255.0,
        g: f32::from(green) / 255.0,
        b: f32::from(blue) / 255.0,
        a: alpha,
    }
}

fn rect(left: f32, top: f32, right: f32, bottom: f32) -> D2D_RECT_F {
    D2D_RECT_F {
        left,
        top,
        right,
        bottom,
    }
}
fn rounded(rect: D2D_RECT_F, radius: f32) -> D2D1_ROUNDED_RECT {
    D2D1_ROUNDED_RECT {
        rect,
        radiusX: radius,
        radiusY: radius,
    }
}

#[windows::core::implement(IDWriteTextRenderer, Agile = false)]
struct GlyphOutlines {
    factory: ID2D1Factory,
    color_text: IDWriteFactory4,
    runs: RefCell<Vec<Option<ID2D1Geometry>>>,
    needs_native_text: Cell<bool>,
}

impl IDWritePixelSnapping_Impl for GlyphOutlines_Impl {
    fn IsPixelSnappingDisabled(&self, _: *const c_void) -> Result<BOOL> {
        Ok(true.into())
    }

    fn GetCurrentTransform(&self, _: *const c_void, _: *mut DWRITE_MATRIX) -> Result<()> {
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn GetPixelsPerDip(&self, _: *const c_void) -> Result<f32> {
        Err(Error::from_hresult(E_NOTIMPL))
    }
}

impl IDWriteTextRenderer_Impl for GlyphOutlines_Impl {
    fn DrawGlyphRun(
        &self,
        _: *const c_void,
        x: f32,
        y: f32,
        measuring_mode: DWRITE_MEASURING_MODE,
        run: *const DWRITE_GLYPH_RUN,
        description: *const DWRITE_GLYPH_RUN_DESCRIPTION,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        (|| -> Result<()> {
            unsafe {
                let run = run.as_ref().ok_or_else(|| Error::from_hresult(E_FAIL))?;
                if run.glyphCount == 0 {
                    return Ok(());
                }
                let face = run
                    .fontFace
                    .as_ref()
                    .ok_or_else(|| Error::from_hresult(E_FAIL))?;
                if run.glyphIndices.is_null() {
                    return Err(Error::from_hresult(E_FAIL));
                }
                // A successful translation signals color layers or bitmap/SVG glyphs.
                let color_formats = DWRITE_GLYPH_IMAGE_FORMATS_COLR
                    | DWRITE_GLYPH_IMAGE_FORMATS_SVG
                    | DWRITE_GLYPH_IMAGE_FORMATS_PNG
                    | DWRITE_GLYPH_IMAGE_FORMATS_JPEG
                    | DWRITE_GLYPH_IMAGE_FORMATS_TIFF
                    | DWRITE_GLYPH_IMAGE_FORMATS_PREMULTIPLIED_B8G8R8A8;
                match self.color_text.TranslateColorGlyphRun(
                    Vector2::new(x, y),
                    run,
                    (!description.is_null()).then_some(description),
                    color_formats,
                    measuring_mode,
                    None,
                    0,
                ) {
                    Err(error) if error.code() == DWRITE_E_NOCOLOR => {}
                    Err(error) => return Err(error),
                    Ok(_) => return Err(Error::from_hresult(E_NOTIMPL)),
                }
                let path = self.factory.CreatePathGeometry()?;
                let sink = path.Open()?;
                face.GetGlyphRunOutline(
                    run.fontEmSize,
                    run.glyphIndices,
                    (!run.glyphAdvances.is_null()).then_some(run.glyphAdvances),
                    (!run.glyphOffsets.is_null()).then_some(run.glyphOffsets),
                    run.glyphCount,
                    run.isSideways.as_bool(),
                    run.bidiLevel % 2 != 0,
                    &sink,
                )?;
                sink.Close()?;
                let positioned = self
                    .factory
                    .CreateTransformedGeometry(&path, &Matrix3x2::translation(x, y))?;
                self.runs.borrow_mut().push(Some(positioned.into()));
                Ok(())
            }
        })()
        .inspect_err(|_| self.needs_native_text.set(true))
    }

    fn DrawUnderline(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: *const DWRITE_UNDERLINE,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        self.needs_native_text.set(true);
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn DrawStrikethrough(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: *const DWRITE_STRIKETHROUGH,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        self.needs_native_text.set(true);
        Err(Error::from_hresult(E_NOTIMPL))
    }

    fn DrawInlineObject(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: Ref<'_, IDWriteInlineObject>,
        _: BOOL,
        _: BOOL,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        self.needs_native_text.set(true);
        Err(Error::from_hresult(E_NOTIMPL))
    }
}

struct Canvas<'a> {
    renderer: &'a Renderer,
    brush: ID2D1SolidColorBrush,
    pixel_width: f32,
}

impl Canvas<'_> {
    fn unlock(&self, width: f32, height: f32, visual: UnlockVisual) -> Result<()> {
        let (base, alpha, edge, rim, ink) = match visual {
            UnlockVisual::Idle => (0x0e1624, 0.94, ICE, 0.55, ICE),
            UnlockVisual::Hover => (0x35251f, 0.98, AMBER, 0.90, AMBER),
            UnlockVisual::Pressed => (0x221913, 0.98, AMBER, 0.72, AMBER),
        };
        let target = &self.renderer.target;
        let center_x = width / 2.0;
        let center_y = height / 2.0;
        let center = Vector2::new(center_x, center_y);
        let radius = width.min(height) / 2.0 - 1.0;
        let shell = D2D1_ELLIPSE {
            point: center,
            radiusX: radius,
            radiusY: radius,
        };
        let shackle = unsafe { self.renderer.factory.CreatePathGeometry()? };
        let sink = unsafe { shackle.Open()? };
        unsafe {
            sink.BeginFigure(
                Vector2::new(center_x - 3.0, center_y + 0.5),
                D2D1_FIGURE_BEGIN_HOLLOW,
            );
            sink.AddLine(Vector2::new(center_x - 3.0, center_y - 3.0));
            sink.AddBezier(&D2D1_BEZIER_SEGMENT {
                point1: Vector2::new(center_x - 3.0, center_y - 7.0),
                point2: Vector2::new(center_x + 3.0, center_y - 7.0),
                point3: Vector2::new(center_x + 3.0, center_y - 3.0),
            });
            sink.AddLine(Vector2::new(center_x + 3.0, center_y - 2.0));
            sink.EndFigure(D2D1_FIGURE_END_OPEN);
            sink.Close()?;
            self.brush.SetColor(&color(base, alpha));
            target.FillEllipse(&shell, &self.brush);
            self.brush.SetColor(&color(edge, rim));
            target.DrawEllipse(&shell, &self.brush, 1.0, None::<&ID2D1StrokeStyle>);
            self.brush.SetColor(&color(ink, 1.0));
            target.DrawGeometry(&shackle, &self.brush, 1.5, None::<&ID2D1StrokeStyle>);
            target.DrawRoundedRectangle(
                &rounded(
                    rect(
                        center_x - 4.5,
                        center_y + 0.5,
                        center_x + 4.5,
                        center_y + 5.5,
                    ),
                    1.4,
                ),
                &self.brush,
                1.5,
                None::<&ID2D1StrokeStyle>,
            );
        }
        Ok(())
    }

    fn layout(
        &self,
        text: &str,
        area: D2D_RECT_F,
        size: f32,
        align: LyricAlign,
        weight: DWRITE_FONT_WEIGHT,
    ) -> Result<IDWriteTextLayout> {
        unsafe {
            let factory = &self.renderer.text;
            let format = factory.CreateTextFormat(
                self.renderer.family,
                None::<&IDWriteFontCollection>,
                weight,
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                size,
                w!("zh-CN"),
            )?;
            format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
            format.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER)?;
            format.SetTextAlignment(if align == LyricAlign::Center {
                DWRITE_TEXT_ALIGNMENT_CENTER
            } else {
                DWRITE_TEXT_ALIGNMENT_LEADING
            })?;
            let ellipsis = factory.CreateEllipsisTrimmingSign(&format)?;
            format.SetTrimming(
                &DWRITE_TRIMMING {
                    granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER,
                    ..Default::default()
                },
                &ellipsis,
            )?;
            factory.CreateTextLayout(
                &text.encode_utf16().collect::<Vec<_>>(),
                &format,
                area.right - area.left,
                area.bottom - area.top,
            )
        }
    }

    fn ink(&self, layout: &IDWriteTextLayout, position: Vector2, rgb: u32, alpha: f32) {
        unsafe {
            self.brush.SetColor(&color(rgb, alpha));
            self.renderer.target.DrawTextLayout(
                position,
                layout,
                &self.brush,
                D2D1_DRAW_TEXT_OPTIONS_CLIP,
            );
        }
    }

    fn lyric_path(
        &self,
        layout: &IDWriteTextLayout,
        origin: Vector2,
    ) -> Result<ID2D1GeometryGroup> {
        let factory = &self.renderer.factory;
        let renderer = ComObject::new(GlyphOutlines {
            factory: factory.clone(),
            color_text: self
                .renderer
                .color_text
                .clone()
                .ok_or_else(|| Error::from_hresult(E_NOTIMPL))?,
            runs: RefCell::new(Vec::new()),
            needs_native_text: Cell::new(false),
        });
        unsafe {
            layout.Draw(
                None,
                &*renderer.as_interface::<IDWriteTextRenderer>(),
                origin.X,
                origin.Y,
            )?;
            // DirectWrite can continue layout drawing after a renderer callback fails.
            if renderer.get().needs_native_text.get() {
                return Err(Error::from_hresult(E_NOTIMPL));
            }
            let runs = renderer.get().runs.borrow();
            factory.CreateGeometryGroup(D2D1_FILL_MODE_WINDING, &runs)
        }
    }

    fn karaoke_brush(
        &self,
        split: f32,
        accent: u32,
        base: u32,
        alpha: f32,
    ) -> Result<ID2D1LinearGradientBrush> {
        let target = &self.renderer.target;
        let half_pixel = self.pixel_width / 2.0;
        unsafe {
            let stops = target.CreateGradientStopCollection(
                &[
                    D2D1_GRADIENT_STOP {
                        position: 0.0,
                        color: color(accent, alpha),
                    },
                    D2D1_GRADIENT_STOP {
                        position: 1.0,
                        color: color(base, alpha),
                    },
                ],
                D2D1_GAMMA_2_2,
                D2D1_EXTEND_MODE_CLAMP,
            )?;
            target.CreateLinearGradientBrush(
                &D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
                    startPoint: Vector2::new(split - half_pixel, 0.0),
                    endPoint: Vector2::new(split + half_pixel, 0.0),
                },
                None,
                &stops,
            )
        }
    }

    fn lyric(
        &self,
        layout: &IDWriteTextLayout,
        area: D2D_RECT_F,
        palette: &Palette,
        rgb: u32,
        alpha: f32,
        progress: f32,
        stroke_width: f32,
    ) -> Result<()> {
        if alpha <= 0.0 {
            return Ok(());
        }
        let origin = Vector2::new(area.left, area.top);
        let shadow_offset = 1.6;
        let (fill, split) = if progress <= 0.0 {
            (rgb, None)
        } else if progress >= 1.0 {
            (palette.accent, None)
        } else {
            let mut metrics = DWRITE_TEXT_METRICS::default();
            unsafe { layout.GetMetrics(&mut metrics)? };
            let split =
                (area.left + metrics.left + metrics.width * progress).clamp(area.left, area.right);
            (rgb, Some(split))
        };
        let target = &self.renderer.target;
        let paths = self.lyric_path(layout, origin).and_then(|path| {
            let shadow = unsafe {
                self.renderer
                    .factory
                    .CreateTransformedGeometry(&path, &Matrix3x2::translation(0.0, shadow_offset))?
            };
            let gradient = split
                .map(|x| self.karaoke_brush(x, palette.accent, fill, alpha))
                .transpose()?;
            Ok((path, shadow, gradient))
        });
        if let Ok((path, shadow, gradient)) = paths {
            unsafe {
                target.PushAxisAlignedClip(&area, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
                self.brush.SetColor(&color(palette.shadow, alpha * 0.30));
                target.FillGeometry(&shadow, &self.brush, None::<&ID2D1Brush>);
                self.brush
                    .SetColor(&color(palette.shadow, alpha * palette.outline));
                target.DrawGeometry(
                    &path,
                    &self.brush,
                    stroke_width,
                    &self.renderer.lyric_stroke,
                );
                self.brush.SetColor(&color(fill, alpha));
                let brush: &ID2D1Brush = match &gradient {
                    Some(gradient) => gradient,
                    None => &self.brush,
                };
                target.FillGeometry(&path, brush, None::<&ID2D1Brush>);
                target.PopAxisAlignedClip();
            }
            return Ok(());
        }

        // Fall back for the whole layout so partial outlines never obscure native glyphs.
        self.ink(
            layout,
            Vector2::new(origin.X, origin.Y + shadow_offset),
            palette.shadow,
            alpha * 0.30,
        );
        let draw_native = |rgb| unsafe {
            self.brush.SetColor(&color(rgb, alpha));
            target.DrawTextLayout(
                origin,
                layout,
                &self.brush,
                D2D1_DRAW_TEXT_OPTIONS_CLIP | D2D1_DRAW_TEXT_OPTIONS_ENABLE_COLOR_FONT,
            );
        };
        if let Some(split) = split {
            for (left, right, rgb) in [
                (area.left, split, palette.accent),
                (split, area.right, fill),
            ] {
                if left < right {
                    unsafe {
                        target.PushAxisAlignedClip(
                            &rect(left, area.top, right, area.bottom),
                            D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
                        );
                        draw_native(rgb);
                        target.PopAxisAlignedClip();
                    }
                }
            }
        } else {
            draw_native(fill);
        }
        Ok(())
    }

    fn scene(
        &self,
        content: &Content,
        style: LyricStyle,
        width: f32,
        height: f32,
        effects: &Effects,
    ) -> Result<()> {
        let palette = palette(content, style.theme);
        if effects.shell > 0.0 {
            let shell = rounded(rect(1.5, 1.5, width - 1.5, height - 1.5), 18.0);
            unsafe {
                self.brush.SetColor(&color(
                    0x0e1624,
                    f32::from(style.panel_opacity) / 100.0 * effects.shell,
                ));
                self.renderer
                    .target
                    .FillRoundedRectangle(&shell, &self.brush);
                self.brush.SetColor(&color(ICE, 0.26 * effects.shell));
                self.renderer.target.DrawRoundedRectangle(
                    &shell,
                    &self.brush,
                    1.0,
                    None::<&ID2D1StrokeStyle>,
                );
            }
            self.toolbar(content, style, width, &palette, effects)?;
        }
        let mut top = TOOLBAR_HEIGHT as f32;
        if !content.text.is_empty() {
            let ease = effects.line * (2.0 - effects.line);
            let offset = 6.0 * (1.0 - ease);
            let area = rect(
                16.0,
                top + offset,
                width - 16.0,
                top + offset + style.primary_height() as f32,
            );
            let layout = self.layout(
                &content.text,
                area,
                style.font_size as f32,
                style.align,
                DWRITE_FONT_WEIGHT_SEMI_BOLD,
            )?;
            self.lyric(
                &layout,
                area,
                &palette,
                palette.primary,
                ease,
                effects.progress,
                (style.font_size as f32 * 0.10).clamp(2.4, 3.2),
            )?;
        }
        top += style.primary_height() as f32;
        if let Some((text, translation)) = style.secondary(content) {
            let area = rect(
                16.0,
                top,
                width - 16.0,
                top + style.secondary_height() as f32,
            );
            let layout = self.layout(
                text,
                area,
                (style.secondary_height() - 6) as f32,
                style.align,
                DWRITE_FONT_WEIGHT_MEDIUM,
            )?;
            self.lyric(
                &layout,
                area,
                &palette,
                if translation {
                    palette.accent
                } else {
                    palette.secondary
                },
                1.0,
                0.0,
                ((style.secondary_height() - 6) as f32 * 0.10).clamp(1.8, 2.2),
            )?;
            top = area.bottom;
        }
        if style.romaji(content) {
            let area = rect(16.0, top, width - 16.0, top + 21.0);
            let layout = self.layout(
                &content.romaji,
                area,
                14.0,
                style.align,
                DWRITE_FONT_WEIGHT_MEDIUM,
            )?;
            self.lyric(&layout, area, &palette, palette.secondary, 1.0, 0.0, 1.8)?;
        }
        Ok(())
    }

    fn toolbar(
        &self,
        content: &Content,
        style: LyricStyle,
        width: f32,
        palette: &Palette,
        effects: &Effects,
    ) -> Result<()> {
        let start = button_left(width);
        let title = if content.title.is_empty() {
            "桌面歌词"
        } else {
            &content.title
        };
        if start > 26.0 {
            let area = rect(16.0, 0.0, start - 8.0, TOOLBAR_HEIGHT as f32);
            let layout = self.layout(
                title,
                area,
                13.0,
                LyricAlign::Left,
                DWRITE_FONT_WEIGHT_SEMI_BOLD,
            )?;
            self.ink(
                &layout,
                Vector2::new(area.left, area.top),
                AMBER,
                effects.shell,
            );
        }
        for (index, button) in BUTTONS.into_iter().enumerate() {
            let left = start + index as f32 * BUTTON_WIDTH as f32;
            let hovered = effects.hover_button == Some(button);
            let active = (button == Button::Translation && style.show_translation)
                || (button == Button::Layout && style.layout == LyricLayout::Dual);
            if hovered {
                unsafe {
                    self.brush.SetColor(&color(
                        if button == Button::Close {
                            0xfe8a88
                        } else {
                            ICE
                        },
                        0.18 * effects.shell,
                    ));
                    self.renderer.target.FillRoundedRectangle(
                        &rounded(rect(left + 2.0, 4.0, left + 30.0, 28.0), 8.0),
                        &self.brush,
                    );
                }
            }
            let label = match button {
                Button::Translation => Some("译"),
                Button::Layout => Some(if active { "双" } else { "单" }),
                Button::Smaller => Some("A-"),
                Button::Larger => Some("A+"),
                _ => None,
            };
            if let Some(label) = label {
                let area = rect(left, 0.0, left + BUTTON_WIDTH as f32, TOOLBAR_HEIGHT as f32);
                let layout = self.layout(
                    label,
                    area,
                    13.0,
                    LyricAlign::Center,
                    DWRITE_FONT_WEIGHT_SEMI_BOLD,
                )?;
                self.ink(
                    &layout,
                    Vector2::new(left, 0.0),
                    if active { palette.accent } else { ICE },
                    effects.shell,
                );
            } else {
                unsafe {
                    self.brush.SetColor(&color(ICE, effects.shell));
                }
                self.icon(
                    button,
                    left + BUTTON_WIDTH as f32 / 2.0,
                    16.0,
                    content.playing,
                )?;
            }
        }
        Ok(())
    }

    fn triangle(&self, x: f32, y: f32, direction: f32, radius: f32) -> Result<()> {
        unsafe {
            let path = self.renderer.factory.CreatePathGeometry()?;
            let sink = path.Open()?;
            sink.BeginFigure(
                Vector2::new(x - radius * direction, y - 5.0),
                D2D1_FIGURE_BEGIN_FILLED,
            );
            sink.AddLine(Vector2::new(x + radius * direction, y));
            sink.AddLine(Vector2::new(x - radius * direction, y + 5.0));
            sink.EndFigure(D2D1_FIGURE_END_CLOSED);
            sink.Close()?;
            self.renderer
                .target
                .FillGeometry(&path, &self.brush, None::<&ID2D1Brush>);
        }
        Ok(())
    }

    fn icon(&self, button: Button, x: f32, y: f32, playing: bool) -> Result<()> {
        let target = &self.renderer.target;
        let stroke = |x0, y0, x1, y1| unsafe {
            target.DrawLine(
                Vector2::new(x + x0, y + y0),
                Vector2::new(x + x1, y + y1),
                &self.brush,
                1.5,
                None::<&ID2D1StrokeStyle>,
            );
        };
        match button {
            Button::Previous | Button::Next => {
                let direction = if button == Button::Next { 1.0 } else { -1.0 };
                self.triangle(x - 4.0 * direction, y, direction, 3.0)?;
                self.triangle(x + 2.0 * direction, y, direction, 3.0)?;
                stroke(7.0 * direction, -5.0, 7.0 * direction, 5.0);
            }
            Button::Playback if playing => unsafe {
                target.FillRectangle(&rect(x - 4.5, y - 5.0, x - 1.5, y + 5.0), &self.brush);
                target.FillRectangle(&rect(x + 1.5, y - 5.0, x + 4.5, y + 5.0), &self.brush);
            },
            Button::Playback => self.triangle(x, y, 1.0, 4.5)?,
            Button::Lock => unsafe {
                target.DrawRoundedRectangle(
                    &rounded(rect(x - 3.0, y - 6.0, x + 3.0, y + 2.0), 3.0),
                    &self.brush,
                    1.5,
                    None::<&ID2D1StrokeStyle>,
                );
                target.FillRoundedRectangle(
                    &rounded(rect(x - 5.0, y - 1.0, x + 5.0, y + 6.0), 1.5),
                    &self.brush,
                );
            },
            Button::Close => {
                stroke(-4.5, -4.5, 4.5, 4.5);
                stroke(4.5, -4.5, -4.5, 4.5);
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_lyrics_have_vector_outlines_and_trimmed_lyrics_still_render() {
        let mut renderer = Renderer::new().unwrap();
        let surface = renderer
            .frame(SIZE { cx: 210, cy: 50 }, 96, false, |canvas, _, _| {
                let area = rect(10.0, 0.0, 200.0, 50.0);
                let origin = Vector2::new(area.left, area.top);
                let layout = canvas.layout(
                    "夜行 Night",
                    area,
                    28.0,
                    LyricAlign::Left,
                    DWRITE_FONT_WEIGHT_SEMI_BOLD,
                )?;
                let path = canvas.lyric_path(&layout, origin)?;
                let bounds = unsafe { path.GetBounds(None)? };
                assert!(bounds.left >= area.left - 2.0 && bounds.right > bounds.left);
                assert!(bounds.top >= area.top && bounds.bottom > bounds.top);

                let area = rect(10.0, 0.0, 110.0, 50.0);
                let layout = canvas.layout(
                    &"Night ride ".repeat(20),
                    area,
                    28.0,
                    LyricAlign::Left,
                    DWRITE_FONT_WEIGHT_SEMI_BOLD,
                )?;
                assert!(canvas.lyric_path(&layout, origin).is_err());
                let palette = palette(&Content::default(), LyricTheme::Contrast);
                canvas.lyric(&layout, area, &palette, ICE, 1.0, 0.5, 2.8)
            })
            .unwrap();
        let pixels = surface.pixels();
        assert!(pixels.contains(&0xfff0f4fa));
        assert!(pixels.contains(&0xffffb85c));
    }
}
