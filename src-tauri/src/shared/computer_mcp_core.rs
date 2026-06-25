//! Built-in computer-use capability core (docs/computer-use-design.md §10): writes/removes the
//! AgentDesk-managed `[mcp_servers.computer]` block in the global codex-home config.toml.
//!
//! Managed-**key** block (mirrors `browser_mcp_core`'s config-writer discipline) — owns the entry by
//! the key `computer`, removes by key, never clobbers a user-authored `[mcp_servers.*]`. The command
//! is the BUNDLED `computer-mcp` sidecar (resolved by the adapter, like `codex-runtime` — NOT the npx
//! browser MCP). The gateway endpoint + key travel via the spawn env (`[mcp_servers.computer.env]`),
//! never in args (secrets). This module owns the product policy: the v1 intent-level tool allow-list
//! and the grounding-model args (which vision model + its coordinate convention, gateway-sourced).

use std::path::Path;

use toml_edit::{value, Array, Document, Item, Table};

use crate::shared::config_toml_core;
use crate::types::{CuaModel, ManagedComputerConfig};

/// Managed MCP server key. AgentDesk owns this entry; filter it out of any user-facing MCP list.
pub(crate) const MANAGED_COMPUTER_MCP_SERVER_NAME: &str = "computer";

/// v1 tool allow-list — **intent-level only** (the coding model never grounds or sees pixels, §1/§4).
/// The computer-mcp converts intent→coords→pixels internally; low-level coordinate tools are NOT
/// exposed, and no tool returns a raw image to the coding model.
pub(crate) const COMPUTER_V1_ENABLED_TOOLS: &[&str] =
    &["computer_act", "computer_observe", "computer_wait"];

/// Load → apply → persist the managed computer-use block in the global config.toml.
pub(crate) fn sync_computer_mcp_config(
    codex_home: &Path,
    config: &ManagedComputerConfig,
    command: &str,
    base_args: &[String],
    model: &CuaModel,
) -> Result<(), String> {
    let (_, mut document) = config_toml_core::load_global_config_document(codex_home)?;
    apply_computer_mcp_to_document(&mut document, config, command, base_args, model)?;
    config_toml_core::persist_global_config_document(codex_home, &document)
}

/// Write the managed `[mcp_servers.computer]` block when enabled, or remove it when disabled.
/// Never touches user-authored MCP servers.
pub(crate) fn apply_computer_mcp_to_document(
    document: &mut Document,
    config: &ManagedComputerConfig,
    command: &str,
    base_args: &[String],
    model: &CuaModel,
) -> Result<(), String> {
    if !config.enabled {
        remove_computer_mcp_from_document(document);
        return Ok(());
    }

    let command = command.trim();
    if command.is_empty() {
        return Err("computer MCP command must not be empty".to_string());
    }
    // Fail-fast: the grounding model is load-bearing (the server denormalizes per its convention).
    let model_id = model.model_id.trim();
    if model_id.is_empty() {
        return Err("computer MCP grounding model id must not be empty".to_string());
    }

    let mut args = Array::new();
    for arg in base_args {
        args.push(arg.as_str());
    }
    // Grounding config (gateway-sourced): which vision model + its coordinate convention. The gateway
    // endpoint + key are NOT here — they go via [mcp_servers.computer.env] (secrets, set by adapter).
    args.push("--model");
    args.push(model_id);
    args.push("--coordinate-convention");
    args.push(model.coordinate_convention.as_str());

    let mut enabled_tools = Array::new();
    for tool in COMPUTER_V1_ENABLED_TOOLS {
        enabled_tools.push(*tool);
    }

    let mut server = Table::new();
    server["command"] = value(command);
    server["args"] = value(args);
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
    use crate::types::CoordConvention;

    fn enabled() -> ManagedComputerConfig {
        ManagedComputerConfig { enabled: true }
    }
    fn disabled() -> ManagedComputerConfig {
        ManagedComputerConfig { enabled: false }
    }
    fn base() -> Vec<String> {
        vec!["--stdio".to_string()]
    }
    fn model() -> CuaModel {
        CuaModel {
            model_id: "doubao-seed-1-6-vision-250815".to_string(),
            coordinate_convention: CoordConvention::Normalized1000,
        }
    }

    #[test]
    fn writes_managed_block_with_intent_tools_and_grounding_model() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &base(), &model())
            .expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("[mcp_servers.computer]"));
        assert!(rendered.contains("command = \"computer-mcp\""));
        assert!(rendered.contains("--model"));
        assert!(rendered.contains("doubao-seed-1-6-vision-250815"));
        assert!(rendered.contains("--coordinate-convention"));
        assert!(rendered.contains("normalized_1000"));
        assert!(rendered.contains("computer_act"));
        // intent-level only: no low-level coord tool, no raw-image tool leaks into the allow-list
        assert!(!rendered.contains("computer_click"));
        assert!(!rendered.contains("computer_screenshot"));

        let parsed = config_toml_core::parse_document(&rendered).expect("reparse");
        let tools = parsed["mcp_servers"]["computer"]["enabled_tools"]
            .as_array()
            .expect("enabled_tools array");
        assert_eq!(tools.len(), 3);
    }

    #[test]
    fn absolute_pixels_convention_is_written_verbatim() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let m = CuaModel {
            model_id: "some-cua-model".to_string(),
            coordinate_convention: CoordConvention::AbsolutePixels,
        };
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &base(), &m)
            .expect("apply");
        assert!(doc.to_string().contains("absolute_pixels"));
    }

    #[test]
    fn disabled_removes_ours_and_preserves_user_servers() {
        let mut doc = config_toml_core::parse_document(
            "[mcp_servers.github]\ncommand = \"gh-mcp\"\nargs = [\"serve\"]\n",
        )
        .expect("parse");
        apply_computer_mcp_to_document(&mut doc, &disabled(), "computer-mcp", &base(), &model())
            .expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("[mcp_servers.github]"));
        assert!(!rendered.contains("[mcp_servers.computer]"));
    }

    #[test]
    fn apply_is_idempotent() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &base(), &model())
            .expect("apply 1");
        apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &base(), &model())
            .expect("apply 2");
        assert_eq!(
            doc.to_string().matches("[mcp_servers.computer]").count(),
            1
        );
    }

    #[test]
    fn enabled_with_empty_command_errors() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let err = apply_computer_mcp_to_document(&mut doc, &enabled(), "   ", &base(), &model())
            .expect_err("must reject empty command");
        assert!(err.contains("command"));
    }

    #[test]
    fn enabled_with_empty_model_id_errors() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let m = CuaModel {
            model_id: "  ".to_string(),
            coordinate_convention: CoordConvention::Normalized1000,
        };
        let err = apply_computer_mcp_to_document(&mut doc, &enabled(), "computer-mcp", &base(), &m)
            .expect_err("must reject empty model id");
        assert!(err.contains("model"));
    }
}
