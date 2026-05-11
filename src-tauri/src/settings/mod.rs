use serde_json::json;
use tauri::{AppHandle, State, Window};

use crate::remote_backend;
use crate::shared::runtime_secret_core;
use crate::shared::settings_core::{
    get_app_settings_core, get_codex_config_path_core, update_app_settings_core,
};
use crate::state::AppState;
use crate::types::{AppSettings, BackendMode, RuntimeApiKeyStatus};
use crate::window;

const DEVELOPER_MODE_ENV_VARS: [&str; 2] =
    ["AGENTDESK_DEVELOPER_MODE", "CODEXMONITOR_DEVELOPER_MODE"];

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
    settings: AppSettings,
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let previous = state.app_settings.lock().await.clone();
    let updated =
        update_app_settings_core(settings, &state.app_settings, &state.settings_path).await?;
    if should_reset_remote_backend(&previous, &updated) {
        *state.remote_backend.lock().await = None;
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
