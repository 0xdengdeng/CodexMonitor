//! Coordinate denormalization (docs/computer-use-design.md §3/§4).
//!
//! A CUA model grounds a screenshot and emits coordinates in its **model-specific convention**
//! (gateway-sourced; travels with the model). This module converts those to **physical screenshot
//! pixels** — pure, deterministic, fully testable. The screenshot IS the physical screen capture, so
//! the output is physical-screen pixels. The further **physical→logical** conversion (Windows
//! per-monitor DPI) happens at the OS inject layer using capture metadata, NOT here — keeping this
//! module OS-agnostic. The `normalized_1000` math was verified against the live probe (e.g. doubao
//! `(958, 38)` on 1280×800 → `(1226, 30)`).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoordConvention {
    /// Per-axis `0..1000` (doubao / UI-TARS family): `px = coord/1000 × dim`.
    Normalized1000,
    /// Absolute pixels in the **sent image's** space (Anthropic `computer_20*` / OpenAI CUA). We send
    /// the screenshot at native resolution, so these are already screenshot pixels.
    AbsolutePixels,
}

impl CoordConvention {
    /// Parse the wire token (matches CodexMonitor's `CoordConvention` serde + the `--coordinate-convention`
    /// CLI value written by `computer_mcp_core`). Fail-fast: unknown → `None` (caller must error, never guess).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "normalized_1000" => Some(Self::Normalized1000),
            "absolute_pixels" => Some(Self::AbsolutePixels),
            _ => None,
        }
    }
}

/// Physical pixel dimensions of the captured screenshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenshotDims {
    pub width: u32,
    pub height: u32,
}

/// Convert a model coordinate to physical screenshot pixels, clamped to the image bounds.
///
/// `mx,my` are in `conv`'s space. Returns `(px, py)` in `[0,width-1] × [0,height-1]`. Clamping is a
/// safety floor (a model could over/under-shoot the range); it is NOT a substitute for grounding
/// confidence (that is the caller's concern).
pub fn denormalize(mx: f64, my: f64, conv: CoordConvention, dims: ScreenshotDims) -> (u32, u32) {
    let w = dims.width as f64;
    let h = dims.height as f64;
    let (px, py) = match conv {
        CoordConvention::Normalized1000 => (mx / 1000.0 * w, my / 1000.0 * h),
        CoordConvention::AbsolutePixels => (mx, my),
    };
    let max_x = (w - 1.0).max(0.0);
    let max_y = (h - 1.0).max(0.0);
    (
        px.round().clamp(0.0, max_x) as u32,
        py.round().clamp(0.0, max_y) as u32,
    )
}

/// Convert physical screenshot pixels → **logical** pixels for the OS inject layer. `enigo` takes
/// logical coords on BOTH macOS and Windows, while capture (`xcap`) is physical — so this conversion
/// is needed on macOS too, not only Windows (the v1 design under-stated this). `scale` is the
/// display's backing-scale factor (macOS Retina ≈ 2.0; Windows per-monitor DPI/96). Evidenced on
/// real hardware 2026-06-25: a 3024×1964 physical capture vs an enigo cursor in ~1512×982 logical =
/// scale 2.0. A non-positive `scale` is treated as 1.0 (fail-soft to physical == logical).
pub fn physical_to_logical(px: u32, py: u32, scale: f64) -> (i32, i32) {
    let s = if scale > 0.0 { scale } else { 1.0 };
    ((px as f64 / s).round() as i32, (py as f64 / s).round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UI: ScreenshotDims = ScreenshotDims {
        width: 1280,
        height: 800,
    };

    #[test]
    fn physical_to_logical_applies_backing_scale() {
        assert_eq!(physical_to_logical(1500, 1000, 2.0), (750, 500)); // Retina 2x
        assert_eq!(physical_to_logical(1500, 1000, 1.0), (1500, 1000)); // 1x display
        assert_eq!(physical_to_logical(1500, 1000, 1.5), (1000, 667)); // Windows 150% DPI
        assert_eq!(physical_to_logical(10, 10, 0.0), (10, 10)); // non-positive → fail-soft to 1.0
    }

    #[test]
    fn parse_round_trips_known_conventions() {
        assert_eq!(
            CoordConvention::parse("normalized_1000"),
            Some(CoordConvention::Normalized1000)
        );
        assert_eq!(
            CoordConvention::parse("absolute_pixels"),
            Some(CoordConvention::AbsolutePixels)
        );
        assert_eq!(CoordConvention::parse("nope"), None);
        assert_eq!(CoordConvention::parse(""), None);
    }

    #[test]
    fn normalized_1000_matches_the_live_probe() {
        // Values lifted from the 2026-06-25 gateway probe (doubao grounding on the 1280×800 UI).
        let cases = [
            ((958.0, 38.0), (1226, 30)),   // settings gear (truth 1230,32)
            ((539.0, 158.0), (690, 126)),  // search field (truth 690,131)
            ((231.0, 375.0), (296, 300)),  // checkbox     (truth 300,300)
            ((875.0, 902.0), (1120, 722)), // save button  (truth 1120,720)
        ];
        for ((mx, my), want) in cases {
            assert_eq!(
                denormalize(mx, my, CoordConvention::Normalized1000, UI),
                want,
                "denorm({mx},{my})"
            );
        }
    }

    #[test]
    fn absolute_pixels_passes_through() {
        assert_eq!(
            denormalize(640.0, 400.0, CoordConvention::AbsolutePixels, UI),
            (640, 400)
        );
    }

    #[test]
    fn clamps_out_of_range_to_bounds() {
        // Normalized over/under-shoot
        assert_eq!(
            denormalize(1000.0, 1000.0, CoordConvention::Normalized1000, UI),
            (1279, 799)
        );
        assert_eq!(
            denormalize(-5.0, -5.0, CoordConvention::Normalized1000, UI),
            (0, 0)
        );
        // Absolute beyond the image
        assert_eq!(
            denormalize(9999.0, 9999.0, CoordConvention::AbsolutePixels, UI),
            (1279, 799)
        );
    }

    #[test]
    fn handles_1x1_image_without_panicking() {
        let one = ScreenshotDims {
            width: 1,
            height: 1,
        };
        assert_eq!(
            denormalize(500.0, 500.0, CoordConvention::Normalized1000, one),
            (0, 0)
        );
    }
}
