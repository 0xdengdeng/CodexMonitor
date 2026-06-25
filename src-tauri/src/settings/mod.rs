use serde_json::{json, Value};
use tauri::{AppHandle, State, Window};

use crate::managed_runtime;
use crate::remote_backend;
use crate::shared::runtime_models_core;
use crate::shared::runtime_secret_core;
use crate::shared::settings_core::{
    clear_managed_runtime_account_core, get_app_settings_core, get_codex_config_path_core,
    managed_runtime_config_changed, update_app_settings_core,
};
use crate::state::AppState;
use crate::types::{
    AppSettings, BackendMode, BrowserReadinessReport, BrowserReadinessStatus, RuntimeApiKeyStatus,
};
use crate::window;

const DEVELOPER_MODE_ENV_VARS: [&str; 2] =
    ["AGENTDESK_DEVELOPER_MODE", "CODEXMONITOR_DEVELOPER_MODE"];

// Built-in browser capability (docs/browser-capability-design.md): APP-ONLY. The headless daemon
// can't run a browser, so the managed `[mcp_servers.playwright]` block is written here in the app
// adapter — never in the shared config sync or the daemon RPC. v1 launches Playwright MCP via npx.
const BROWSER_MCP_DEV_COMMAND: &str = "npx";
const BROWSER_MCP_DEV_BASE_ARGS: [&str; 2] = ["-y", "@playwright/mcp@latest"];

#[tauri::command]
pub(crate) async fn get_app_settings(
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let settings = get_app_settings_core(&state.app_settings).await;
    let _ = window::apply_window_appearance(&window, settings.theme.as_str());
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn update_app_settings(
    mut settings: AppSettings,
    state: State<'_, AppState>,
    app: AppHandle,
    window: Window,
) -> Result<AppSettings, String> {
    let previous = state.app_settings.lock().await.clone();
    // No-Chrome gate (docs/browser-no-chrome-design.md §3.1): detect BEFORE persisting, so
    // `managed_browser.enabled=true` is never durably written without a launchable browser (which
    // would leave settings.json saying "on" with no MCP block). On NoBrowser we refuse the enable
    // here; the SPA observes `enabled` come back false despite requesting true, re-checks, and shows
    // the install prompt.
    if !previous.managed_browser.enabled
        && settings.managed_browser.enabled
        && !matches!(settings.backend_mode, BackendMode::Remote)
        && matches!(
            crate::shared::browser_detect::detect_browser_readiness(),
            crate::shared::browser_detect::BrowserReadiness::NoBrowser
        )
    {
        settings.managed_browser.enabled = false;
    }
    let updated =
        update_app_settings_core(settings, &state.app_settings, &state.settings_path).await?;
    if should_reset_remote_backend(&previous, &updated) {
        *state.remote_backend.lock().await = None;
    }
    if managed_runtime_config_changed(&previous, &updated) {
        managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    }
    // App-only built-in browser (docs/browser-capability-design.md): only the local desktop can run
    // a browser. Skip in remote mode (the toggle is greyed there); on a local toggle, write/remove
    // the managed Playwright MCP block and restart sessions so the sidecar re-reads config.toml.
    if !matches!(updated.backend_mode, BackendMode::Remote)
        && previous.managed_browser.enabled != updated.managed_browser.enabled
    {
        sync_browser_mcp_from_settings(&updated)?;
        managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    }
    ensure_remote_runtime_for_settings(&updated, state).await;
    let _ = window::apply_window_appearance(&window, updated.theme.as_str());
    Ok(updated)
}

#[tauri::command]
pub(crate) async fn runtime_api_key_status(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<RuntimeApiKeyStatus, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response =
            remote_backend::call_remote(&*state, app, "runtime_api_key_status", json!({})).await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    Ok(RuntimeApiKeyStatus {
        has_api_key: runtime_secret_core::runtime_api_key_exists()?,
    })
}

#[tauri::command]
pub(crate) async fn runtime_model_list(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(&*state, app, "runtime_model_list", json!({})).await;
    }

    let settings = state.app_settings.lock().await.clone();
    runtime_models_core::runtime_model_list_core(&settings.managed_runtime).await
}

#[tauri::command]
pub(crate) async fn runtime_image_model_list(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(&*state, app, "runtime_image_model_list", json!({}))
            .await;
    }

    let settings = state.app_settings.lock().await.clone();
    runtime_models_core::runtime_image_model_list_core(&settings.managed_runtime).await
}

#[tauri::command]
pub(crate) async fn runtime_api_key_set(
    api_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<RuntimeApiKeyStatus, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            app,
            "runtime_api_key_set",
            json!({ "apiKey": api_key }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    runtime_secret_core::set_runtime_api_key(&api_key)?;
    managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    Ok(RuntimeApiKeyStatus { has_api_key: true })
}

#[tauri::command]
pub(crate) async fn runtime_api_key_clear(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<RuntimeApiKeyStatus, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response =
            remote_backend::call_remote(&*state, app, "runtime_api_key_clear", json!({})).await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    runtime_secret_core::clear_runtime_api_key()?;
    clear_managed_runtime_account_core(&state.app_settings, &state.settings_path).await?;
    managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    Ok(RuntimeApiKeyStatus { has_api_key: false })
}

#[tauri::command]
pub(crate) async fn get_codex_config_path() -> Result<String, String> {
    get_codex_config_path_core()
}

#[tauri::command]
pub(crate) fn is_developer_mode_enabled() -> bool {
    is_developer_mode_enabled_from_env()
}

fn is_developer_mode_enabled_from_env() -> bool {
    DEVELOPER_MODE_ENV_VARS
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .any(|value| is_truthy_developer_mode_value(&value))
}

fn is_truthy_developer_mode_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn should_reset_remote_backend(previous: &AppSettings, updated: &AppSettings) -> bool {
    let backend_mode_changed = !matches!(
        (&previous.backend_mode, &updated.backend_mode),
        (
            crate::types::BackendMode::Local,
            crate::types::BackendMode::Local
        ) | (
            crate::types::BackendMode::Remote,
            crate::types::BackendMode::Remote
        )
    );
    backend_mode_changed
        || previous.remote_backend_provider != updated.remote_backend_provider
        || previous.remote_backend_host != updated.remote_backend_host
        || previous.remote_backend_token != updated.remote_backend_token
}

/// App-only: write/remove the managed `[mcp_servers.playwright]` block in the local codex-home.
/// `browser_mcp_core` owns the block shape + v1 allow-list + `--extension`; the adapter owns the
/// command (npx for v1; bundled path in T5).
fn sync_browser_mcp_from_settings(settings: &AppSettings) -> Result<(), String> {
    let Some(codex_home) = crate::codex::home::resolve_default_codex_home() else {
        return Ok(());
    };
    let base_args: Vec<String> = BROWSER_MCP_DEV_BASE_ARGS
        .iter()
        .map(|arg| (*arg).to_string())
        .collect();
    // Channel only matters when enabling (the block is removed on disable; channel is ignored there).
    let launch_channel = if settings.managed_browser.enabled {
        match crate::shared::browser_detect::detect_browser_readiness() {
            crate::shared::browser_detect::BrowserReadiness::SystemChannel(channel) => channel,
            // TODO(no-Chrome phase B, docs/browser-no-chrome-design.md §3.1/§6): gate the toggle on
            // readiness + guide the user to install Chrome. Until then fall back to "chrome" (current
            // behavior: Playwright errors clearly at first use if absent) — no regression.
            crate::shared::browser_detect::BrowserReadiness::NoBrowser => "chrome",
        }
    } else {
        "chrome" // ignored on the remove path
    };
    // TODO(2026-06-23 xiaodeng): T5 — replace npx with a bundled absolute node + @playwright/mcp
    // path (mirror codex/runtime.rs resolve) so it works offline without nvm/npx on PATH.
    crate::shared::browser_mcp_core::sync_browser_mcp_config(
        &codex_home,
        &settings.managed_browser,
        BROWSER_MCP_DEV_COMMAND,
        &base_args,
        launch_channel,
    )
}

/// App-only: report whether a launchable Chromium-family browser (chrome/msedge) is installed, so
/// the SPA can gate the Browser toggle and guide the user to install Chrome when none is found.
/// Pure path probe (docs/browser-no-chrome-design.md §4) — no side effects.
#[tauri::command]
pub(crate) fn check_browser_readiness() -> Result<BrowserReadinessReport, String> {
    Ok(
        match crate::shared::browser_detect::detect_browser_readiness() {
            crate::shared::browser_detect::BrowserReadiness::SystemChannel(channel) => {
                BrowserReadinessReport {
                    status: BrowserReadinessStatus::System,
                    channel: Some(channel.to_string()),
                }
            }
            crate::shared::browser_detect::BrowserReadiness::NoBrowser => BrowserReadinessReport {
                status: BrowserReadinessStatus::NoBrowser,
                channel: None,
            },
        },
    )
}

async fn ensure_remote_runtime_for_settings(settings: &AppSettings, state: State<'_, AppState>) {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return;
    }
    if !matches!(settings.backend_mode, BackendMode::Remote) {
        return;
    }

    let _ = crate::tailscale::tailscale_daemon_start(state).await;
}

#[cfg(test)]
mod tests {
    use super::{is_truthy_developer_mode_value, should_reset_remote_backend};
    use crate::types::{AppSettings, BackendMode};

    #[test]
    fn should_reset_remote_backend_when_provider_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.remote_backend_provider = crate::types::RemoteBackendProvider::Tcp;
        updated.remote_backend_host = "remote.example:4732".to_string();
        assert!(should_reset_remote_backend(&previous, &updated));
    }

    #[test]
    fn should_reset_remote_backend_when_transport_token_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.remote_backend_token = Some("token-1".to_string());
        assert!(should_reset_remote_backend(&previous, &updated));
    }

    #[test]
    fn should_not_reset_remote_backend_for_non_transport_setting_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.theme = "dark".to_string();
        updated.backend_mode = BackendMode::Local;
        assert!(!should_reset_remote_backend(&previous, &updated));
    }

    #[test]
    fn developer_mode_accepts_explicit_truthy_env_values() {
        for value in ["1", "true", "TRUE", "yes", "on", " On "] {
            assert!(is_truthy_developer_mode_value(value));
        }
        for value in ["", "0", "false", "off", "no", "developer"] {
            assert!(!is_truthy_developer_mode_value(value));
        }
    }
}
