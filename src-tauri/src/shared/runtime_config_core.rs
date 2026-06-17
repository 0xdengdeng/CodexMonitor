use std::path::Path;

use toml_edit::{value, Item, Table};

use crate::shared::config_toml_core;
use crate::shared::runtime_secret_core;
use crate::types::ManagedRuntimeConfig;

pub(crate) const MANAGED_RUNTIME_PROVIDER_ID: &str = "agentdesk_managed";
pub(crate) const MANAGED_RUNTIME_ENV_KEY: &str = runtime_secret_core::RUNTIME_API_KEY_ENV_KEY;
pub(crate) const DEFAULT_MANAGED_RUNTIME_MODEL: &str = "gpt-5.5";

const MANAGED_RUNTIME_PROVIDER_NAME: &str = "agentDesk Managed Runtime";
const MANAGED_RUNTIME_STREAM_IDLE_TIMEOUT_MS: i64 = 300_000;
// Codex feature keys that pick the image path. They are mutually exclusive: the
// native built-in `image_generation` tool vs the converged `generate_image`
// function tool (gateway-fulfilled via /v1/images). Driven by
// `native_image_generation` so the model is offered exactly one.
const FEATURE_IMAGE_GENERATION: &str = "image_generation";
const FEATURE_GENERATE_IMAGE_TOOL: &str = "generate_image_tool";
const MANAGED_RUNTIME_USER_AGENT: &str = concat!(
    "CodexMonitor/",
    env!("CARGO_PKG_VERSION"),
    " AgentDesk codex_cli_rs/",
    env!("CARGO_PKG_VERSION")
);

fn normalized_optional(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn normalize_managed_runtime_config(
    config: &ManagedRuntimeConfig,
) -> ManagedRuntimeConfig {
    ManagedRuntimeConfig {
        enabled: config.enabled,
        base_url: normalized_optional(config.base_url.as_deref()),
        model: normalized_optional(config.model.as_deref()),
        image_model: normalized_optional(config.image_model.as_deref()),
        native_image_generation: config.native_image_generation,
    }
}

pub(crate) fn managed_runtime_config_is_complete(config: &ManagedRuntimeConfig) -> bool {
    let config = normalize_managed_runtime_config(config);
    config.enabled && config.base_url.is_some()
}

pub(crate) fn effective_managed_runtime_model(config: &ManagedRuntimeConfig) -> Option<String> {
    if !managed_runtime_config_is_complete(config) {
        return None;
    }
    normalize_managed_runtime_config(config)
        .model
        .or_else(|| Some(DEFAULT_MANAGED_RUNTIME_MODEL.to_string()))
}

pub(crate) fn build_managed_runtime_env(
    config: &ManagedRuntimeConfig,
    api_key: Option<String>,
) -> Vec<(String, String)> {
    if !managed_runtime_config_is_complete(config) {
        return Vec::new();
    }
    let Some(api_key) = normalized_optional(api_key.as_deref()) else {
        return Vec::new();
    };
    vec![(MANAGED_RUNTIME_ENV_KEY.to_string(), api_key)]
}

pub(crate) fn build_managed_runtime_env_from_store(
    config: &ManagedRuntimeConfig,
) -> Result<Vec<(String, String)>, String> {
    if !managed_runtime_config_is_complete(config) {
        return Ok(Vec::new());
    }
    let api_key = runtime_secret_core::get_runtime_api_key()?;
    if api_key.is_none() {
        return Err(
            "agentDesk Runtime API key is missing. Add it in Settings before starting Codex Runtime."
                .to_string(),
        );
    }
    Ok(build_managed_runtime_env(config, api_key))
}

pub(crate) fn sync_managed_runtime_config(
    codex_home: &Path,
    config: &ManagedRuntimeConfig,
) -> Result<(), String> {
    let (_, mut document) = config_toml_core::load_global_config_document(codex_home)?;
    apply_managed_runtime_config_to_document(&mut document, config)?;
    config_toml_core::persist_global_config_document(codex_home, &document)
}

pub(crate) fn apply_managed_runtime_config_to_document(
    document: &mut toml_edit::Document,
    config: &ManagedRuntimeConfig,
) -> Result<(), String> {
    let config = normalize_managed_runtime_config(config);

    if !managed_runtime_config_is_complete(&config) {
        remove_managed_runtime_provider(document)?;
        return Ok(());
    }

    config_toml_core::set_top_level_string(
        document,
        "model_provider",
        Some(MANAGED_RUNTIME_PROVIDER_ID),
    );
    config_toml_core::set_top_level_string(
        document,
        "model",
        effective_managed_runtime_model(&config).as_deref(),
    );

    let providers = config_toml_core::ensure_table(document, "model_providers")?;
    let mut provider = Table::new();
    provider["name"] = value(MANAGED_RUNTIME_PROVIDER_NAME);
    provider["base_url"] = value(config.base_url.as_deref().unwrap_or_default());
    provider["wire_api"] = value("responses");
    provider["env_key"] = value(MANAGED_RUNTIME_ENV_KEY);
    provider["requires_openai_auth"] = value(false);
    provider["supports_websockets"] = value(false);
    provider["stream_idle_timeout_ms"] = value(MANAGED_RUNTIME_STREAM_IDLE_TIMEOUT_MS);
    let mut http_headers = Table::new();
    http_headers["User-Agent"] = value(MANAGED_RUNTIME_USER_AGENT);
    if let Some(image_model) = config.image_model.as_deref() {
        http_headers["X-ADG-Image-Model"] = value(image_model);
    }
    provider["http_headers"] = Item::Table(http_headers);
    providers[MANAGED_RUNTIME_PROVIDER_ID] = Item::Table(provider);

    let features = config_toml_core::ensure_table(document, "features")?;
    features[FEATURE_IMAGE_GENERATION] = value(config.native_image_generation);
    features[FEATURE_GENERATE_IMAGE_TOOL] = value(!config.native_image_generation);

    Ok(())
}

fn remove_managed_runtime_provider(document: &mut toml_edit::Document) -> Result<(), String> {
    if config_toml_core::read_top_level_string(document, "model_provider").as_deref()
        == Some(MANAGED_RUNTIME_PROVIDER_ID)
    {
        let _ = document.remove("model_provider");
    }
    if let Some(providers) = document
        .get_mut("model_providers")
        .and_then(Item::as_table_mut)
    {
        providers.remove(MANAGED_RUNTIME_PROVIDER_ID);
    }
    // Drop the image-path feature keys we manage so codex falls back to its own
    // defaults when the managed runtime is off; never clobber unrelated features.
    if let Some(features) = document.get_mut("features").and_then(Item::as_table_mut) {
        features.remove(FEATURE_IMAGE_GENERATION);
        features.remove(FEATURE_GENERATE_IMAGE_TOOL);
        if features.is_empty() {
            document.remove("features");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use crate::types::ManagedRuntimeConfig;

    use super::{
        build_managed_runtime_env, sync_managed_runtime_config, DEFAULT_MANAGED_RUNTIME_MODEL,
        MANAGED_RUNTIME_ENV_KEY, MANAGED_RUNTIME_PROVIDER_ID,
    };

    #[test]
    fn sync_managed_runtime_config_writes_provider_without_secret() {
        let codex_home =
            std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&codex_home).expect("create temp codex home");

        let settings = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: Some("gpt-5.4".to_string()),
            image_model: Some("adg-image".to_string()),
            native_image_generation: true,
        };

        sync_managed_runtime_config(&codex_home, &settings).expect("sync runtime config");

        let contents =
            fs::read_to_string(codex_home.join("config.toml")).expect("read config.toml");
        assert!(contents.contains("model = \"gpt-5.4\""));
        assert!(contents.contains(&format!(
            "model_provider = \"{MANAGED_RUNTIME_PROVIDER_ID}\""
        )));
        assert!(contents.contains("[model_providers.agentdesk_managed]"));
        assert!(contents.contains("base_url = \"https://runtime.example.com/v1\""));
        assert!(contents.contains("wire_api = \"responses\""));
        assert!(contents.contains(&format!("env_key = \"{MANAGED_RUNTIME_ENV_KEY}\"")));
        assert!(contents.contains("requires_openai_auth = false"));
        assert!(contents.contains("supports_websockets = false"));
        assert!(contents.contains("stream_idle_timeout_ms = 300000"));
        assert!(!contents.contains("sk-secret"));
    }

    #[test]
    fn sync_managed_runtime_config_writes_image_path_features() {
        let codex_home =
            std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&codex_home).expect("create temp codex home");
        let config_path = codex_home.join("config.toml");

        // native (built-in image_generation) on -> converged tool off.
        let native = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: Some("gpt-5.5".to_string()),
            image_model: None,
            native_image_generation: true,
        };
        sync_managed_runtime_config(&codex_home, &native).expect("sync native");
        let contents = fs::read_to_string(&config_path).expect("read config.toml");
        assert!(contents.contains("[features]"));
        assert!(contents.contains("image_generation = true"));
        assert!(contents.contains("generate_image_tool = false"));

        // native off -> converged generate_image on, built-in off.
        let converged = ManagedRuntimeConfig {
            native_image_generation: false,
            ..native.clone()
        };
        sync_managed_runtime_config(&codex_home, &converged).expect("sync converged");
        let contents = fs::read_to_string(&config_path).expect("read config.toml");
        assert!(contents.contains("image_generation = false"));
        assert!(contents.contains("generate_image_tool = true"));

        // managed runtime off -> our feature keys are dropped (codex defaults).
        let disabled = ManagedRuntimeConfig {
            enabled: false,
            ..native
        };
        sync_managed_runtime_config(&codex_home, &disabled).expect("sync disabled");
        let contents = fs::read_to_string(&config_path).expect("read config.toml");
        assert!(!contents.contains("generate_image_tool"));
        assert!(!contents.contains("image_generation"));
    }

    #[test]
    fn sync_managed_runtime_config_writes_image_model_header() {
        let codex_home =
            std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&codex_home).expect("create temp codex home");

        let settings = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: Some("qihang-ultra-5.5".to_string()),
            image_model: Some("adg-image-pro".to_string()),
            native_image_generation: true,
        };

        sync_managed_runtime_config(&codex_home, &settings).expect("sync runtime config");

        let contents =
            fs::read_to_string(codex_home.join("config.toml")).expect("read config.toml");
        assert!(contents.contains("[model_providers.agentdesk_managed.http_headers]"));
        assert!(contents.contains("X-ADG-Image-Model = \"adg-image-pro\""));
    }

    #[test]
    fn sync_managed_runtime_config_writes_adg_user_agent_header() {
        let codex_home =
            std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&codex_home).expect("create temp codex home");

        let settings = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: Some("qihang-ultra-5.5".to_string()),
            image_model: None,
            native_image_generation: true,
        };

        sync_managed_runtime_config(&codex_home, &settings).expect("sync runtime config");

        let contents =
            fs::read_to_string(codex_home.join("config.toml")).expect("read config.toml");
        assert!(contents.contains("[model_providers.agentdesk_managed.http_headers]"));
        assert!(contents.contains(&format!(
            "User-Agent = \"CodexMonitor/{} AgentDesk codex_cli_rs/{}\"",
            env!("CARGO_PKG_VERSION"),
            env!("CARGO_PKG_VERSION")
        )));
    }

    #[test]
    fn sync_managed_runtime_config_keeps_user_agent_header_when_image_model_unset() {
        let codex_home =
            std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&codex_home).expect("create temp codex home");

        let settings = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: Some("qihang-ultra-5.5".to_string()),
            image_model: None,
            native_image_generation: true,
        };

        sync_managed_runtime_config(&codex_home, &settings).expect("sync runtime config");

        let contents =
            fs::read_to_string(codex_home.join("config.toml")).expect("read config.toml");
        assert!(contents.contains("[model_providers.agentdesk_managed.http_headers]"));
        assert!(contents.contains(&format!(
            "User-Agent = \"CodexMonitor/{} AgentDesk codex_cli_rs/{}\"",
            env!("CARGO_PKG_VERSION"),
            env!("CARGO_PKG_VERSION")
        )));
        assert!(!contents.contains("X-ADG-Image-Model"));
    }

    #[test]
    fn sync_managed_runtime_config_writes_default_model_when_omitted() {
        let codex_home =
            std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&codex_home).expect("create temp codex home");

        let settings = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: None,
            image_model: Some("adg-image".to_string()),
            native_image_generation: true,
        };

        sync_managed_runtime_config(&codex_home, &settings).expect("sync runtime config");

        let contents =
            fs::read_to_string(codex_home.join("config.toml")).expect("read config.toml");
        assert!(contents.contains(&format!(
            "model_provider = \"{MANAGED_RUNTIME_PROVIDER_ID}\""
        )));
        assert!(contents.contains(&format!("model = \"{DEFAULT_MANAGED_RUNTIME_MODEL}\"")));
        assert!(contents.contains("[model_providers.agentdesk_managed]"));
        assert!(contents.contains("base_url = \"https://runtime.example.com/v1\""));
    }

    #[test]
    fn build_managed_runtime_env_injects_secret_only_when_config_is_complete() {
        let enabled = ManagedRuntimeConfig {
            enabled: true,
            base_url: Some("https://runtime.example.com/v1".to_string()),
            model: Some("gpt-5.4".to_string()),
            image_model: Some("adg-image".to_string()),
            native_image_generation: true,
        };
        assert_eq!(
            build_managed_runtime_env(&enabled, Some("sk-secret".to_string())),
            vec![(MANAGED_RUNTIME_ENV_KEY.to_string(), "sk-secret".to_string())]
        );

        let disabled = ManagedRuntimeConfig {
            enabled: false,
            ..enabled.clone()
        };
        assert!(build_managed_runtime_env(&disabled, Some("sk-secret".to_string())).is_empty());

        let missing_model = ManagedRuntimeConfig {
            model: None,
            ..enabled.clone()
        };
        assert_eq!(
            build_managed_runtime_env(&missing_model, Some("sk-secret".to_string())),
            vec![(MANAGED_RUNTIME_ENV_KEY.to_string(), "sk-secret".to_string())]
        );

        let missing_url = ManagedRuntimeConfig {
            base_url: None,
            ..enabled.clone()
        };
        assert!(build_managed_runtime_env(&missing_url, Some("sk-secret".to_string())).is_empty());

        assert!(build_managed_runtime_env(&enabled, None).is_empty());
    }
}
