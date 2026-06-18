use tauri::{AppHandle, Manager};

/// Read the tail of the app log file so the UI can offer "copy diagnostics" when
/// something breaks. A normal user can't find `~/Library/Logs/<id>/agentdesk.log`,
/// so on error we let them copy the recent log instead. Returns at most
/// `max_bytes` (hard-capped) from the end, trimmed to a clean line boundary.
#[tauri::command]
pub(crate) fn read_app_log_tail(app: AppHandle, max_bytes: usize) -> Result<String, String> {
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|err| format!("resolve log dir: {err}"))?
        .join("agentdesk.log");
    let bytes = std::fs::read(&log_path)
        .map_err(|err| format!("read {}: {err}", log_path.display()))?;

    let want = max_bytes.min(1_000_000);
    let start = bytes.len().saturating_sub(want);
    let text = String::from_utf8_lossy(&bytes[start..]);
    // Drop a partial leading line when we cut mid-file so the tail starts clean.
    let trimmed = if start > 0 {
        text.split_once('\n').map(|(_, rest)| rest).unwrap_or(&text)
    } else {
        &text
    };
    Ok(trimmed.to_string())
}
