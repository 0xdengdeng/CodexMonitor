//! Screen capture (docs/computer-use-design.md §5) — `xcap` (ScreenCaptureKit on macOS, Windows
//! Graphics Capture on Windows). Returns the primary display as RGBA + its **physical** pixel dims,
//! which are exactly what the coordinate denormalization (`coords`) needs.
//!
//! macOS needs the **Screen Recording** TCC permission granted to the process running this binary.
//! Without it capture FAILS (surfaced as an error, never a silent blank) — fail-fast per §7.

use std::io::Cursor;

use xcap::Monitor;

/// Capture the primary display and encode it as PNG bytes — what the text-mode vision client sends to
/// the gateway. Convenience over `capture_primary` + manual encode; observe needs no pixel dims.
pub fn capture_primary_png() -> Result<Vec<u8>, String> {
    let (rgba, w, h) = capture_primary()?;
    let img: image::RgbaImage =
        image::ImageBuffer::from_raw(w, h, rgba).ok_or("ImageBuffer::from_raw failed")?;
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode: {e}"))?;
    Ok(png)
}

/// Capture the primary display, downscale so the longest side is ≤ `max_long_side`, and PNG-encode.
/// Image mode returns this straight into the conversation, so we cap the size — a full-res Retina
/// frame is needlessly large for vision input (cost + payload) with no accuracy gain.
pub fn capture_primary_png_scaled(max_long_side: u32) -> Result<Vec<u8>, String> {
    let (rgba, w, h) = capture_primary()?;
    let img: image::RgbaImage =
        image::ImageBuffer::from_raw(w, h, rgba).ok_or("ImageBuffer::from_raw failed")?;
    let mut dyn_img = image::DynamicImage::ImageRgba8(img);
    if w.max(h) > max_long_side {
        // resize fits within the box preserving aspect → longest side becomes max_long_side.
        dyn_img = dyn_img.resize(max_long_side, max_long_side, image::imageops::FilterType::Triangle);
    }
    let mut png = Vec::new();
    dyn_img
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode: {e}"))?;
    Ok(png)
}

/// Capture the primary display. Returns `(rgba_bytes, width, height)` in physical pixels.
pub fn capture_primary() -> Result<(Vec<u8>, u32, u32), String> {
    let monitors = Monitor::all().map_err(|e| format!("Monitor::all: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }
    // Best-effort primary detection: prefer the monitor flagged primary; if none is flagged (or the
    // flag can't be read) fall back to the first monitor. Intentional fallback (fail-fast.md
    // document-at-site carve-out) — it only selects WHICH of the user's own displays to capture,
    // never whether/where the image leaves the machine.
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .unwrap_or(&monitors[0]);
    let img = monitor
        .capture_image()
        .map_err(|e| format!("capture_image: {e}"))?;
    let (w, h) = (img.width(), img.height());
    Ok((img.into_raw(), w, h))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real capture against THIS machine's screen. `#[ignore]` so the normal suite (and CI without a
    /// display / Screen-Recording grant) stays green; run explicitly:
    ///   cargo test -- --ignored --nocapture real_capture_primary
    #[test]
    #[ignore]
    fn real_capture_primary() {
        match capture_primary() {
            Ok((rgba, w, h)) => {
                assert!(w > 0 && h > 0, "zero dims");
                assert_eq!(rgba.len() as u32, w * h * 4, "RGBA byte count mismatch");
                // Not a uniform/blank frame → confirms real content (TCC grant is working).
                let first = &rgba[0..4];
                let varied = rgba.chunks_exact(4).any(|px| px != first);
                println!("capture OK: {w}x{h}, {} bytes, varied_pixels={varied}", rgba.len());
                assert!(varied, "frame is a single solid color — likely a TCC-denied blank capture");
            }
            Err(e) => panic!("capture failed (grant Screen Recording to the terminal?): {e}"),
        }
    }
}
