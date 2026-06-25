//! Screen capture (docs/computer-use-design.md §5) — `xcap` (ScreenCaptureKit on macOS, Windows
//! Graphics Capture on Windows). Returns the primary display as RGBA + its **physical** pixel dims,
//! which are exactly what the coordinate denormalization (`coords`) needs.
//!
//! macOS needs the **Screen Recording** TCC permission granted to the process running this binary.
//! Without it capture FAILS (surfaced as an error, never a silent blank) — fail-fast per §7.

use xcap::Monitor;

/// Capture the primary display. Returns `(rgba_bytes, width, height)` in physical pixels.
pub fn capture_primary() -> Result<(Vec<u8>, u32, u32), String> {
    let monitors = Monitor::all().map_err(|e| format!("Monitor::all: {e}"))?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }
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
