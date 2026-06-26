//! Built-in computer-use capability core (docs/computer-use-design.md §10 + §14 observe-only MVP):
//! writes/removes the AgentDesk-managed `[mcp_servers.computer]` block in the global codex-home
//! config.toml.
//!
//! Managed-**key** block (mirrors `browser_mcp_core`'s config-writer discipline) — owns the entry by
//! the key `computer`, removes by key, never clobbers a user-authored `[mcp_servers.*]`. The command
//! is the bundled `computer-mcp` sidecar (resolved by the adapter).
//!
//! Two observe modes (§14):
//! - **image** (default): the sidecar returns the screenshot; codex forwards it to a vision-capable
//!   conversation model. No gateway call, no dispatch key — `args = ["--mode", "image"]` only.
//! - **text** (fallback): the sidecar delegates to a configured vision model through the gateway and
//!   returns text. Gateway base + model are non-secret → argv; the dispatch key is forwarded BY NAME
//!   via `env_vars = ["AGENTDESK_RUNTIME_API_KEY"]` (codex `env_clear()`s the child then forwards the
//!   value from its own env) so the secret never lands in config.toml.

use std::path::Path;

use toml_edit::{value, Array, Document, Item, Table};

use crate::shared::config_toml_core;
use crate::shared::runtime_secret_core;
use crate::types::ManagedComputerConfig;

/// Managed MCP server key. AgentDesk owns this entry; filter it out of any user-facing MCP list.
pub(crate) const MANAGED_COMPUTER_MCP_SERVER_NAME: &str = "computer";

/// Phase-3a observe-only allow-list (§14): only the read-only observe tool ships first;
/// `computer_act` / `computer_wait` (§4) are the next cut. codex enforces `enabled_tools`.
pub(crate) const COMPUTER_OBSERVE_ENABLED_TOOLS: &[&str] = &["computer_observe"];

/// How the observe sidecar returns the screen (§14). The default is image; text is the fallback for a
/// conversation model that can't take image input.
pub(crate) enum ComputerObserveMode<'a> {
    Image,
    Text {
        gateway_base_url: &'a str,
        vision_model_id: &'a str,
    },
}

/// Load → apply → persist the managed computer-use block in the global config.toml.
pub(crate) fn sync_computer_mcp_config(
    codex_home: &Path,
    config: &ManagedComputerConfig,
    command: &str,
    mode: &ComputerObserveMode,
) -> Result<(), String> {
    let (_, mut document) = config_toml_core::load_global_config_document(codex_home)?;
    apply_computer_mcp_to_document(&mut document, config, command, mode)?;
    config_toml_core::persist_global_config_document(codex_home, &document)
}

/// Write the managed `[mcp_servers.computer]` block when enabled, or remove it when disabled.
/// Never touches user-authored MCP servers.
pub(crate) fn apply_computer_mcp_to_document(
    document: &mut Document,
    config: &ManagedComputerConfig,
    command: &str,
    mode: &ComputerObserveMode,
) -> Result<(), String> {
    if !config.enabled {
        remove_computer_mcp_from_document(document);
        return Ok(());
    }

    let command = command.trim();
    if command.is_empty() {
        return Err("computer MCP command must not be empty".to_string());
    }

    let mut args = Array::new();
    args.push("--mode");
    let mut env_vars = Array::new();
    match mode {
        ComputerObserveMode::Image => {
            args.push("image");
            // image mode needs no gateway/model/key — the conversation model sees the screenshot.
        }
        ComputerObserveMode::Text {
            gateway_base_url,
            vision_model_id,
        } => {
            // Fail-fast: text mode's gateway endpoint + vision model are load-bearing.
            let gateway_base_url = gateway_base_url.trim();
            if gateway_base_url.is_empty() {
                return Err("computer MCP gateway base URL must not be empty (text mode)".to_string());
            }
            let vision_model_id = vision_model_id.trim();
            if vision_model_id.is_empty() {
                return Err("computer MCP vision model id must not be empty (text mode)".to_string());
            }
            args.push("text");
            args.push("--gateway-base-url");
            args.push(gateway_base_url);
            args.push("--model");
            args.push(vision_model_id);
            // Forward the dispatch key BY NAME — codex passes its value from its own env; the secret
            // value is never written into config.toml (§14 auth seam).
            env_vars.push(runtime_secret_core::RUNTIME_API_KEY_ENV_KEY);
        }
    }

    let mut enabled_tools = Array::new();
    for tool in COMPUTER_OBSERVE_ENABLED_TOOLS {
        enabled_tools.push(*tool);
    }

    let mut server = Table::new();
    server["command"] = value(command);
    server["args"] = value(args);
    if !env_vars.is_empty() {
        server["env_vars"] = value(env_vars);
    }
    server["enabled_tools"] = value(enabled_tools);

    let servers = config_toml_core::ensure_table(document, "mcp_servers")?;
    servers[MANAGED_COMPUTER_MCP_SERVER_NAME] = Item::Table(server);
    Ok(())
}

/// Remove only the managed computer entry. If that leaves `mcp_servers` empty drop the table too,
/// but never remove it while user entries remain.
pub(crate) fn remove_computer_mcp_from_document(document: &mut Document) {
    let became_empty = match document.get_mut("mcp_servers").and_then(Item::as_table_mut) {
        Some(servers) => {
            servers.remove(MANAGED_COMPUTER_MCP_SERVER_NAME);
            servers.is_empty()
        }
        None => false,
    };
    if became_empty {
        document.remove("mcp_servers");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled() -> ManagedComputerConfig {
        ManagedComputerConfig { enabled: true }
    }
    fn disabled() -> ManagedComputerConfig {
        ManagedComputerConfig { enabled: false }
    }
    const GW: &str = "https://adg-uat.example.com/v1";
    const VISION: &str = "doubao-seed-1-6-flash-250828";

    #[test]
    fn image_mode_writes_minimal_block_no_gateway_no_env() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &ComputerObserveMode::Image)
            .expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("[mcp_servers.computer]"));
        assert!(rendered.contains("command = \"computer-mcp\""));
        assert!(rendered.contains("--mode"));
        assert!(rendered.contains("image"));
        assert!(rendered.contains("computer_observe"));
        // image mode is self-contained: no gateway, no model, no forwarded key, no act/wait.
        assert!(!rendered.contains("--gateway-base-url"));
        assert!(!rendered.contains("--model"));
        assert!(!rendered.contains("env_vars"));
        assert!(!rendered.contains("AGENTDESK_RUNTIME_API_KEY"));
        assert!(!rendered.contains("computer_act"));

        let parsed = config_toml_core::parse_document(&rendered).expect("reparse");
        let tools = parsed["mcp_servers"]["computer"]["enabled_tools"]
            .as_array()
            .expect("enabled_tools array");
        assert_eq!(tools.len(), 1);
    }

    #[test]
    fn text_mode_writes_gateway_args_and_env_forward() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let mode = ComputerObserveMode::Text {
            gateway_base_url: GW,
            vision_model_id: VISION,
        };
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &mode).expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("--mode"));
        assert!(rendered.contains("text"));
        assert!(rendered.contains("--gateway-base-url"));
        assert!(rendered.contains(GW));
        assert!(rendered.contains("--model"));
        assert!(rendered.contains(VISION));
        // dispatch key forwarded BY NAME; the secret value is never written into config.toml.
        assert!(rendered.contains("AGENTDESK_RUNTIME_API_KEY"));

        let parsed = config_toml_core::parse_document(&rendered).expect("reparse");
        let env_vars = parsed["mcp_servers"]["computer"]["env_vars"]
            .as_array()
            .expect("env_vars array");
        assert_eq!(
            env_vars.get(0).and_then(|v| v.as_str()),
            Some("AGENTDESK_RUNTIME_API_KEY")
        );
    }

    #[test]
    fn disabled_removes_ours_and_preserves_user_servers() {
        let mut doc = config_toml_core::parse_document(
            "[mcp_servers.github]\ncommand = \"gh-mcp\"\nargs = [\"serve\"]\n",
        )
        .expect("parse");
        apply_computer_mcp_to_document(&mut doc, &disabled(), "computer-mcp", &ComputerObserveMode::Image)
            .expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("[mcp_servers.github]"));
        assert!(!rendered.contains("[mcp_servers.computer]"));
    }

    #[test]
    fn apply_is_idempotent() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &ComputerObserveMode::Image)
            .expect("apply 1");
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &ComputerObserveMode::Image)
            .expect("apply 2");
        assert_eq!(
            doc.to_string().matches("[mcp_servers.computer]").count(),
            1
        );
    }

    #[test]
    fn enabled_with_empty_command_errors() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let err =
            apply_computer_mcp_to_document(&mut doc, &enabled(), "   ", &ComputerObserveMode::Image)
                .expect_err("must reject empty command");
        assert!(err.contains("command"));
    }

    #[test]
    fn text_mode_with_empty_gateway_or_model_errors() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let bad_gw = ComputerObserveMode::Text {
            gateway_base_url: "  ",
            vision_model_id: VISION,
        };
        assert!(
            apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &bad_gw)
                .expect_err("reject empty gateway")
                .contains("gateway")
        );
        let bad_model = ComputerObserveMode::Text {
            gateway_base_url: GW,
            vision_model_id: "  ",
        };
        assert!(
            apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &bad_model)
                .expect_err("reject empty model")
                .contains("model")
        );
    }
}
