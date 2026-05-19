use std::fs;
use std::path::PathBuf;

use serde_json::Value;

#[test]
fn macos_private_api_feature_matches_config() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir.join("tauri.conf.json");
    let config_contents = fs::read_to_string(&config_path)
        .unwrap_or_else(|error| panic!("Failed to read {config_path:?}: {error}"));
    let config: Value = serde_json::from_str(&config_contents)
        .unwrap_or_else(|error| panic!("Failed to parse tauri.conf.json: {error}"));
    let macos_private_api = config
        .get("app")
        .and_then(|app| app.get("macOSPrivateApi"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    if macos_private_api {
        let cargo_path = manifest_dir.join("Cargo.toml");
        let cargo_contents = fs::read_to_string(&cargo_path)
            .unwrap_or_else(|error| panic!("Failed to read {cargo_path:?}: {error}"));
        let mut in_dependencies = false;
        let mut has_feature = false;

        for line in cargo_contents.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                in_dependencies = trimmed == "[dependencies]";
                continue;
            }
            if !in_dependencies {
                continue;
            }
            if trimmed.starts_with("tauri") && trimmed.contains("macos-private-api") {
                has_feature = true;
                break;
            }
        }

        assert!(
            has_feature,
            "Cargo.toml [dependencies] must enable macos-private-api when app.macOSPrivateApi is true"
        );
    }
}

#[test]
fn daemon_bins_include_current_and_legacy_bundle_names() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let cargo_path = manifest_dir.join("Cargo.toml");
    let cargo_contents = fs::read_to_string(&cargo_path)
        .unwrap_or_else(|error| panic!("Failed to read {cargo_path:?}: {error}"));
    let bin_names = cargo_bin_names(&cargo_contents);

    for required_bin in [
        "agentdesk-daemon",
        "agentdesk-daemonctl",
        "codex_monitor_daemon",
        "codex_monitor_daemonctl",
    ] {
        assert!(
            bin_names.iter().any(|name| name == required_bin),
            "Cargo.toml must declare a `{required_bin}` bin so Tauri can bundle daemon binaries"
        );
    }
}

#[test]
fn dev_config_uses_separate_app_identifier() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let base_config_path = manifest_dir.join("tauri.conf.json");
    let dev_config_path = manifest_dir.join("tauri.dev.conf.json");

    let base_config = read_json(&base_config_path);
    let dev_config = read_json(&dev_config_path);

    let base_identifier = string_field(&base_config, "identifier");
    let dev_identifier = string_field(&dev_config, "identifier");

    assert_eq!(
        base_identifier, "com.agentdesk.app",
        "production Tauri identifier should remain stable"
    );
    assert_eq!(
        dev_identifier, "com.agentdesk.app.dev",
        "dev builds must use a separate identifier so app_data_dir does not share production data"
    );
    assert_ne!(
        base_identifier, dev_identifier,
        "dev and production app data directories must be isolated"
    );
}

#[test]
fn dev_config_uses_distinct_product_name() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let base_config_path = manifest_dir.join("tauri.conf.json");
    let dev_config_path = manifest_dir.join("tauri.dev.conf.json");

    let base_config = read_json(&base_config_path);
    let dev_config = read_json(&dev_config_path);

    let base_product_name = string_field(&base_config, "productName");
    let dev_product_name = string_field(&dev_config, "productName");

    assert_eq!(
        base_product_name, "启航AI智慧平台",
        "production Tauri product name should remain stable"
    );
    assert!(
        dev_product_name.contains("Dev"),
        "dev builds must use an obviously distinct product name so users do not confuse them with the installed production app"
    );
    assert_ne!(
        base_product_name, dev_product_name,
        "dev and production app names must be visually distinct while both are running"
    );
}

#[test]
fn dev_config_uses_distinct_window_title() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let base_config_path = manifest_dir.join("tauri.conf.json");
    let dev_config_path = manifest_dir.join("tauri.dev.conf.json");

    let base_config = read_json(&base_config_path);
    let dev_config = read_json(&dev_config_path);

    let base_window_title = first_window_title(&base_config);
    let dev_window_title = first_window_title(&dev_config);

    assert_eq!(
        base_window_title, "启航AI智慧平台",
        "production Tauri window title should remain stable"
    );
    assert!(
        dev_window_title.contains("Dev"),
        "dev builds must use an obviously distinct window title while running beside production"
    );
    assert_ne!(
        base_window_title, dev_window_title,
        "dev and production window titles must be visually distinct"
    );
}

#[test]
fn dev_scripts_merge_dev_tauri_config() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let package_path = manifest_dir
        .parent()
        .expect("src-tauri should have a workspace parent")
        .join("package.json");
    let package = read_json(&package_path);
    let scripts = package
        .get("scripts")
        .and_then(|value| value.as_object())
        .expect("package.json must define scripts");

    for script_name in ["tauri:dev", "tauri:dev:win"] {
        let command = scripts
            .get(script_name)
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| panic!("package.json scripts must define {script_name}"));
        assert!(
            command.contains("--config src-tauri/tauri.dev.conf.json"),
            "{script_name} must merge tauri.dev.conf.json so local dev uses isolated app data"
        );
    }
}

#[test]
fn tauri_config_bundles_git_sidecar() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config_path = manifest_dir.join("tauri.conf.json");
    let config = read_json(&config_path);
    let external_bins = config
        .get("bundle")
        .and_then(|bundle| bundle.get("externalBin"))
        .and_then(|value| value.as_array())
        .expect("tauri.conf.json bundle.externalBin must be an array");

    assert!(
        external_bins
            .iter()
            .any(|value| value.as_str() == Some("binaries/git")),
        "Tauri must bundle the Git sidecar so users do not need to install Git separately"
    );

    let resources = config
        .get("bundle")
        .and_then(|bundle| bundle.get("resources"))
        .and_then(|value| value.as_array())
        .expect("tauri.conf.json bundle.resources must be an array");

    assert!(
        resources
            .iter()
            .any(|value| value.as_str() == Some("resources/git/")),
        "Tauri must bundle the embedded Git distribution resources, not only a launcher"
    );
}

#[test]
fn tauri_scripts_sync_git_sidecar_before_dev_and_build() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let package_path = manifest_dir
        .parent()
        .expect("src-tauri should have a workspace parent")
        .join("package.json");
    let package = read_json(&package_path);
    let scripts = package
        .get("scripts")
        .and_then(|value| value.as_object())
        .expect("package.json must define scripts");

    assert!(
        scripts.contains_key("sync:git-sidecar"),
        "package.json must expose sync:git-sidecar for generating the bundled Git binary"
    );

    let sync_script_path = manifest_dir
        .parent()
        .expect("src-tauri should have a workspace parent")
        .join("scripts/sync-git-sidecar.mjs");
    let sync_script =
        std::fs::read_to_string(sync_script_path).expect("sync-git-sidecar.mjs must be readable");
    assert!(
        sync_script.contains("AGENTDESK_BUNDLED_GIT_WRAPPER"),
        "sync:git-sidecar must generate a bundled Git launcher, not copy the system Git shim"
    );
    assert!(
        sync_script.contains("resources/git"),
        "sync:git-sidecar must prepare a bundled Git distribution resource directory"
    );

    for script_name in [
        "pretauri:dev",
        "pretauri:build",
        "pretauri:dev:win",
        "pretauri:build:win",
    ] {
        let command = scripts
            .get(script_name)
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| panic!("package.json scripts must define {script_name}"));
        assert!(
            command.contains("sync:git-sidecar"),
            "{script_name} must sync the bundled Git sidecar before Tauri starts"
        );
    }
}

#[test]
fn desktop_capability_allows_setting_window_title() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let capability_path = manifest_dir.join("capabilities/default.json");
    let capabilities = read_json(&capability_path);
    let permissions = capabilities
        .get("capabilities")
        .and_then(|value| value.as_array())
        .and_then(|items| {
            items.iter().find(|item| {
                item.get("identifier").and_then(|value| value.as_str()) == Some("desktop-default")
            })
        })
        .and_then(|capability| capability.get("permissions"))
        .and_then(|value| value.as_array())
        .expect("desktop-default capability must define permissions");

    assert!(
        permissions
            .iter()
            .any(|value| value.as_str() == Some("core:window:allow-set-title")),
        "desktop windows must allow setTitle so dev builds can distinguish themselves from production"
    );
}

fn cargo_bin_names(cargo_contents: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut in_bin = false;

    for line in cargo_contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[[") {
            in_bin = trimmed == "[[bin]]";
            continue;
        }
        if trimmed.starts_with('[') {
            in_bin = false;
            continue;
        }
        if !in_bin || !trimmed.starts_with("name") {
            continue;
        }

        let Some((_, value)) = trimmed.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
            names.push(value[1..value.len() - 1].to_string());
        }
    }

    names
}

fn read_json(path: &std::path::Path) -> Value {
    let contents =
        fs::read_to_string(path).unwrap_or_else(|error| panic!("Failed to read {path:?}: {error}"));
    serde_json::from_str(&contents)
        .unwrap_or_else(|error| panic!("Failed to parse {path:?}: {error}"))
}

fn string_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| panic!("config must define string field {key}"))
}

fn first_window_title(value: &Value) -> &str {
    value
        .get("app")
        .and_then(|app| app.get("windows"))
        .and_then(|windows| windows.as_array())
        .and_then(|windows| windows.first())
        .and_then(|window| window.get("title"))
        .and_then(|title| title.as_str())
        .expect("config must define app.windows[0].title")
}
