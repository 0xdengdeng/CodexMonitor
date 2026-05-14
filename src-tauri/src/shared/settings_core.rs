use std::path::PathBuf;

use tokio::sync::Mutex;

use crate::codex::config as codex_config;
use crate::codex::home::resolve_default_codex_home;
use crate::shared::config_toml_core;
use crate::shared::runtime_config_core;
use crate::storage::write_settings;
use crate::types::{AppSettings, EnterpriseAiConfig};
use crate::utils::normalize_windows_namespace_path;

fn normalize_personality(value: &str) -> Option<&'static str> {
    match value.trim() {
        "friendly" => Some("friendly"),
        "pragmatic" => Some("pragmatic"),
        _ => None,
    }
}

pub(crate) async fn get_app_settings_core(app_settings: &Mutex<AppSettings>) -> AppSettings {
    let mut settings = app_settings.lock().await.clone();
    if let Ok(Some(collaboration_modes_enabled)) = codex_config::read_collaboration_modes_enabled()
    {
        settings.collaboration_modes_enabled = collaboration_modes_enabled;
    }
    if let Ok(Some(steer_enabled)) = codex_config::read_steer_enabled() {
        settings.steer_enabled = steer_enabled;
    }
    if let Ok(Some(unified_exec_enabled)) = codex_config::read_unified_exec_enabled() {
        settings.unified_exec_enabled = unified_exec_enabled;
    }
    if let Ok(Some(apps_enabled)) = codex_config::read_apps_enabled() {
        settings.experimental_apps_enabled = apps_enabled;
    }
    if let Ok(personality) = codex_config::read_personality() {
        settings.personality = personality
            .as_deref()
            .and_then(normalize_personality)
            .unwrap_or("friendly")
            .to_string();
    }
    settings
}

pub(crate) async fn update_app_settings_core(
    settings: AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<AppSettings, String> {
    update_app_settings_core_inner(settings, app_settings, settings_path, true).await
}

#[allow(dead_code)]
pub(crate) async fn update_app_settings_core_allow_managed_runtime_clear(
    settings: AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<AppSettings, String> {
    update_app_settings_core_inner(settings, app_settings, settings_path, false).await
}

pub(crate) async fn clear_managed_runtime_account_core(
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<AppSettings, String> {
    let mut next = app_settings.lock().await.clone();
    next.enterprise_ai = EnterpriseAiConfig::default();
    next.managed_runtime.enabled = false;
    next.managed_runtime.base_url = None;
    update_app_settings_core_allow_managed_runtime_clear(next, app_settings, settings_path).await
}

pub(crate) fn managed_runtime_config_changed(
    previous: &AppSettings,
    updated: &AppSettings,
) -> bool {
    let previous = runtime_config_core::normalize_managed_runtime_config(&previous.managed_runtime);
    let updated = runtime_config_core::normalize_managed_runtime_config(&updated.managed_runtime);
    previous.enabled != updated.enabled
        || previous.base_url != updated.base_url
        || previous.model != updated.model
}

async fn update_app_settings_core_inner(
    mut settings: AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
    preserve_managed_runtime: bool,
) -> Result<AppSettings, String> {
    let mut current = app_settings.lock().await;
    let previous = current.clone();
    settings.global_worktrees_folder = settings
        .global_worktrees_folder
        .map(|path| normalize_windows_namespace_path(&path));
    settings.managed_runtime =
        runtime_config_core::normalize_managed_runtime_config(&settings.managed_runtime);
    if preserve_managed_runtime
        && !runtime_config_core::managed_runtime_config_is_complete(&settings.managed_runtime)
        && runtime_config_core::managed_runtime_config_is_complete(&previous.managed_runtime)
    {
        settings.managed_runtime =
            runtime_config_core::normalize_managed_runtime_config(&previous.managed_runtime);
        settings.enterprise_ai = previous.enterprise_ai;
    }
    sync_codex_config_from_settings(&settings)?;
    write_settings(settings_path, &settings)?;
    *current = settings.clone();
    Ok(settings)
}

fn sync_codex_config_from_settings(settings: &AppSettings) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    let (_, mut document) = config_toml_core::load_global_config_document(&root)?;
    sync_codex_config_document_from_settings(&mut document, settings)?;
    config_toml_core::persist_global_config_document(&root, &document)
}

fn sync_codex_config_document_from_settings(
    document: &mut toml_edit::Document,
    settings: &AppSettings,
) -> Result<(), String> {
    config_toml_core::set_feature_flag(
        document,
        "collaboration_modes",
        settings.collaboration_modes_enabled,
    )?;
    config_toml_core::set_feature_flag(document, "steer", settings.steer_enabled)?;
    config_toml_core::set_feature_flag(document, "unified_exec", settings.unified_exec_enabled)?;
    config_toml_core::set_feature_flag(document, "apps", settings.experimental_apps_enabled)?;
    config_toml_core::set_top_level_string(
        document,
        "personality",
        normalize_personality(settings.personality.as_str()),
    );
    runtime_config_core::apply_managed_runtime_config_to_document(
        document,
        &settings.managed_runtime,
    )
}

pub(crate) fn sync_managed_runtime_config_from_settings(
    settings: &AppSettings,
) -> Result<(), String> {
    let Some(root) = resolve_default_codex_home() else {
        return Ok(());
    };
    runtime_config_core::sync_managed_runtime_config(&root, &settings.managed_runtime)
}

pub(crate) fn get_codex_config_path_core() -> Result<String, String> {
    codex_config::config_toml_path()
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        .and_then(|path| {
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::{sync_codex_config_document_from_settings, update_app_settings_core};
    use crate::shared::runtime_config_core::MANAGED_RUNTIME_PROVIDER_ID;
    use crate::types::{AppSettings, EnterpriseAiConfig, EnterpriseAiStatus, ManagedRuntimeConfig};
    use tokio::sync::Mutex;
    use uuid::Uuid;

    #[test]
    fn sync_codex_config_document_updates_theme_adjacent_settings_in_one_document() {
        let mut settings = AppSettings::default();
        settings.collaboration_modes_enabled = true;
        settings.steer_enabled = true;
        settings.unified_exec_enabled = true;
        settings.experimental_apps_enabled = false;
        settings.personality = "friendly".to_string();
        settings.managed_runtime = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: None,
        };
        let mut document = toml_edit::Document::new();

        sync_codex_config_document_from_settings(&mut document, &settings)
            .expect("sync config document");

        let rendered = document.to_string();
        assert!(rendered.contains("personality = \"friendly\""));
        assert!(rendered.contains(&format!(
            "model_provider = \"{MANAGED_RUNTIME_PROVIDER_ID}\""
        )));
        assert!(rendered.contains("[features]"));
        assert!(rendered.contains("collaboration_modes = true"));
        assert!(rendered.contains("[model_providers.agentdesk_managed]"));
        assert!(rendered.contains("base_url = \"https://runtime.example.com/v1\""));
    }

    #[test]
    fn update_settings_preserves_runtime_account_when_stale_payload_clears_it() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut current = AppSettings::default();
            current.theme = "light".to_string();
            current.managed_runtime = ManagedRuntimeConfig {
                enabled: true,
                base_url: Some("https://runtime.example.com/v1".to_string()),
                model: None,
            };
            current.enterprise_ai = EnterpriseAiConfig {
                tenant_domain: Some("company1".to_string()),
                status: EnterpriseAiStatus::Connected,
                account_name: Some("user@example.com".to_string()),
                key_last4: Some("1234".to_string()),
                last_validated_at_ms: Some(1000),
                last_error: None,
            };
            let mut incoming = current.clone();
            incoming.theme = "dark".to_string();
            incoming.managed_runtime = ManagedRuntimeConfig::default();
            incoming.enterprise_ai = EnterpriseAiConfig::default();
            let app_settings = Mutex::new(current);
            let settings_path =
                std::env::temp_dir().join(format!("agentdesk-settings-{}.json", Uuid::new_v4()));

            let updated = update_app_settings_core(incoming, &app_settings, &settings_path)
                .await
                .expect("update settings");

            assert_eq!(updated.theme, "dark");
            assert!(updated.managed_runtime.enabled);
            assert_eq!(
                updated.managed_runtime.base_url.as_deref(),
                Some("https://runtime.example.com/v1")
            );
            assert_eq!(
                updated.enterprise_ai.tenant_domain.as_deref(),
                Some("company1")
            );

            let _ = std::fs::remove_file(settings_path);
        });
    }
}
