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
