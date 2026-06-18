use std::path::Path;

use tauri::{AppHandle, Manager};

/// Read the tail of the app log file so the UI can offer "copy diagnostics" when
/// something breaks. A normal user can't find `~/Library/Logs/<id>/agentdesk.log`,
/// so on error we let them copy the recent log instead.
#[tauri::command]
pub(crate) fn read_app_log_tail(app: AppHandle, max_bytes: usize) -> Result<String, String> {
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|err| format!("resolve log dir: {err}"))?
        .join("agentdesk.log");
    read_file_tail(&log_path, max_bytes)
}

/// Read the tail of the headless daemon's log (`<app_data_dir>/logs/daemon.log`).
/// Errors (e.g. the daemon was never started) are surfaced to the caller, which
/// folds them into the diagnostics blob as a short note.
#[tauri::command]
pub(crate) fn read_daemon_log_tail(app: AppHandle, max_bytes: usize) -> Result<String, String> {
    let log_path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("resolve data dir: {err}"))?
        .join("logs")
        .join("daemon.log");
    read_file_tail(&log_path, max_bytes)
}

/// Write text to the OS clipboard from the Rust side. The webview's
/// `navigator.clipboard` only works inside a live user gesture, which is lost
/// after the async log reads that build the diagnostics blob — so the copy must
/// go through here instead.
#[tauri::command]
pub(crate) fn write_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|err| format!("clipboard: {err}"))?;
    clipboard
        .set_text(text)
        .map_err(|err| format!("clipboard set_text: {err}"))
}

/// Return at most `max_bytes` (hard-capped) from the end of `path`, trimmed to a
/// clean line boundary when the file is cut mid-stream.
fn read_file_tail(path: &Path, max_bytes: usize) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|err| format!("read {}: {err}", path.display()))?;

    let want = max_bytes.min(1_000_000);
    let start = bytes.len().saturating_sub(want);
    let text = String::from_utf8_lossy(&bytes[start..]);
    let trimmed = if start > 0 {
        text.split_once('\n').map(|(_, rest)| rest).unwrap_or(&text)
    } else {
        &text
    };
    Ok(trimmed.to_string())
}
