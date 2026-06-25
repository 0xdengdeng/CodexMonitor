//! Input injection (docs/computer-use-design.md §5) — `enigo` (CGEvent on macOS, SendInput on
//! Windows). macOS needs the **Accessibility** TCC grant; Windows needs none. On Windows the
//! physical→logical DPI conversion is applied HERE before injecting (xcap gives physical px,
//! SetCursorPos takes logical) — pinned in the §5 contract.
//!
//! enigo MUST run on its process's main thread on macOS (tauri#6421); as a standalone sidecar that
//! is automatic. Actual move/click/type wrappers land with the orchestration commit; this module
//! currently validates the dependency + the Accessibility permission non-destructively.

use enigo::{Enigo, Mouse, Settings};

/// Read the current cursor location (non-destructive — does NOT move anything). Doubles as an
/// Accessibility-permission probe: on macOS this path exercises the same CGEvent access injection needs.
pub fn cursor_location() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default()).map_err(|e| format!("Enigo::new: {e}"))?;
    enigo.location().map_err(|e| format!("location: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Non-destructive: constructs enigo (validates Accessibility) + reads the cursor. Does NOT move
    /// the mouse. `cargo test -- --ignored --nocapture real_enigo_init`
    #[test]
    #[ignore]
    fn real_enigo_init() {
        match cursor_location() {
            Ok((x, y)) => println!("enigo OK (Accessibility granted): cursor at ({x},{y}) — no input injected"),
            Err(e) => panic!("enigo init/read failed (grant Accessibility to the terminal?): {e}"),
        }
    }
}
