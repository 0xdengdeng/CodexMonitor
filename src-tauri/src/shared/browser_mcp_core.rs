//! Built-in browser capability core (docs/browser-capability-design.md §3-§4): writes/removes the
//! AgentDesk-managed `[mcp_servers.playwright]` block in the global codex-home config.toml.
//!
//! Single source of truth for the browser-MCP registration. AgentDesk owns this entry — it is a
//! managed block (mirrors `runtime_config_core`'s apply/remove discipline) and must never clobber a
//! user-authored `[mcp_servers.*]` entry. The command/path (npx vs bundled) is resolved by the
//! adapter; this module owns the product policy (persistent-profile launch, the v1 tool allow-list).

use std::path::{Path, PathBuf};

use toml_edit::{value, Array, Document, Item, Table};

use crate::shared::config_toml_core;
use crate::types::ManagedBrowserConfig;

/// Managed MCP server key for the built-in browser capability. AgentDesk owns this entry; it must be
/// filtered out of any user-facing MCP-server list so users never edit/remove it as a plain server.
pub(crate) const MANAGED_BROWSER_MCP_SERVER_NAME: &str = "playwright";

/// v1 tool allow-list (navigate + interaction), enforced via the server's `enabled_tools` so codex
/// only exposes these to the model. Excludes evaluate / run_code_unsafe / file_upload / network_*
/// (JS-exec + auth-header-leak surface) — see docs/browser-capability-design.md §4.3.
pub(crate) const BROWSER_V1_ENABLED_TOOLS: &[&str] = &[
    "browser_navigate",
    "browser_navigate_back",
    "browser_tabs",
    "browser_snapshot",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_select_option",
    "browser_hover",
    "browser_press_key",
    "browser_drag",
    "browser_drop",
    "browser_wait_for",
    "browser_resize",
    "browser_handle_dialog",
    "browser_close",
];

/// v1 launch args: drive the user's INSTALLED Chrome (`--browser chrome`) in a dedicated PERSISTENT
/// profile (no `--isolated`) — signed-in state survives across sessions (the user asked not to
/// re-login every session, 2026-06-25, superseding the 2026-06-23 `--isolated` decision).
///
/// The profile dir is set EXPLICITLY via `--user-data-dir` (appended in `apply_*` below), NOT left
/// to Playwright's default. Two reasons, both load-bearing: (1) some `@playwright/mcp` versions
/// default a missing `--user-data-dir` to a *temporary* dir → no persistence at all, defeating the
/// goal; (2) pinning an APP-OWNED dir makes the separation from the user's real Chrome profile
/// enforced by AgentDesk instead of borrowed from an upstream default (security review 2026-06-25).
/// Tradeoffs (see docs/browser-capability-design.md §2/§9): single concurrent session (Chrome
/// singleton-locks the on-disk profile), the agent's profile retains its own logins, and those
/// logins sit on disk at rest. No Chromium download (app stays ~light); if no Chrome is present,
/// Playwright MCP errors clearly (T5 adds a doctor check + download-on-demand fallback). Attaching to
/// the user's real Chrome profile (`--extension`) is a v2 opt-in.
const BROWSER_LAUNCH_ARGS: &[&str] = &["--browser", "chrome"];

/// App-owned persistent profile dir name. Lives as a sibling of `codex-home` (i.e. under the app's
/// data dir), so it is a different `user-data-dir` than the user's real Chrome AND is removed when
/// the app's data dir is cleared/uninstalled. A future "clear browser data" action deletes this dir.
const BROWSER_PROFILE_DIR_NAME: &str = "browser-chrome-profile";

/// Resolve the app-owned browser profile dir from the codex-home path (its sibling).
///
/// The separation guarantee (dedicated dir, never the user's real Chrome) holds regardless of where
/// codex-home is. The only thing the sibling derivation affects is the "removed on uninstall" claim:
/// for the managed codex-home (`<app-data>/codex-home`) the sibling lands under app-data as intended.
// TODO(2026-06-25 xiaodeng): if the user overrides CODEX_HOME (e.g. ~/.codex), the sibling lands
// outside app-data and uninstall no longer cleans it (docs §9 notes this). Prefer deriving the
// profile dir from the app data_dir directly once it's plumbed into the settings-sync path.
fn resolve_browser_profile_dir(codex_home: &Path) -> PathBuf {
    codex_home
        .parent()
        .unwrap_or(codex_home)
        .join(BROWSER_PROFILE_DIR_NAME)
}

/// Load → apply → persist the managed browser block in the global config.toml.
pub(crate) fn sync_browser_mcp_config(
    codex_home: &Path,
    config: &ManagedBrowserConfig,
    command: &str,
    base_args: &[String],
) -> Result<(), String> {
    let (_, mut document) = config_toml_core::load_global_config_document(codex_home)?;
    let profile_dir = resolve_browser_profile_dir(codex_home);
    apply_browser_mcp_to_document(&mut document, config, command, base_args, &profile_dir)?;
    config_toml_core::persist_global_config_document(codex_home, &document)
}

/// Write the managed `[mcp_servers.playwright]` block when enabled, or remove it when disabled.
/// Never touches user-authored MCP servers.
pub(crate) fn apply_browser_mcp_to_document(
    document: &mut Document,
    config: &ManagedBrowserConfig,
    command: &str,
    base_args: &[String],
    profile_dir: &Path,
) -> Result<(), String> {
    if !config.enabled {
        remove_browser_mcp_from_document(document);
        return Ok(());
    }

    let command = command.trim();
    if command.is_empty() {
        return Err("browser MCP command must not be empty".to_string());
    }

    // Fail-fast: a non-UTF-8 profile path must surface, not be silently dropped (which would fall
    // back to Playwright's default dir and break the separation guarantee).
    let profile_dir = profile_dir
        .to_str()
        .ok_or_else(|| "browser profile dir path is not valid UTF-8".to_string())?;

    let mut args = Array::new();
    for arg in base_args {
        args.push(arg.as_str());
    }
    for arg in BROWSER_LAUNCH_ARGS {
        args.push(*arg);
    }
    args.push("--user-data-dir");
    args.push(profile_dir);

    let mut enabled_tools = Array::new();
    for tool in BROWSER_V1_ENABLED_TOOLS {
        enabled_tools.push(*tool);
    }

    let mut server = Table::new();
    server["command"] = value(command);
    server["args"] = value(args);
    server["enabled_tools"] = value(enabled_tools);

    let servers = config_toml_core::ensure_table(document, "mcp_servers")?;
    servers[MANAGED_BROWSER_MCP_SERVER_NAME] = Item::Table(server);
    Ok(())
}

/// Remove only the managed browser entry. If that leaves `mcp_servers` empty (we were the sole
/// entry) drop the table too, but never remove it while user entries remain.
pub(crate) fn remove_browser_mcp_from_document(document: &mut Document) {
    let became_empty = match document.get_mut("mcp_servers").and_then(Item::as_table_mut) {
        Some(servers) => {
            servers.remove(MANAGED_BROWSER_MCP_SERVER_NAME);
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

    fn enabled() -> ManagedBrowserConfig {
        ManagedBrowserConfig { enabled: true }
    }
    fn disabled() -> ManagedBrowserConfig {
        ManagedBrowserConfig { enabled: false }
    }
    fn base() -> Vec<String> {
        vec!["-y".to_string(), "@playwright/mcp@latest".to_string()]
    }
    fn profile() -> PathBuf {
        PathBuf::from("/tmp/agentdesk-test-appdata/browser-chrome-profile")
    }

    #[test]
    fn resolve_profile_dir_is_app_owned_sibling_of_codex_home() {
        let dir = resolve_browser_profile_dir(Path::new("/home/u/.app-data/codex-home"));
        assert_eq!(dir, PathBuf::from("/home/u/.app-data/browser-chrome-profile"));
        // must NOT be the user's real Chrome profile location
        assert!(!dir.to_string_lossy().contains("Google/Chrome"));
    }

    #[test]
    fn writes_managed_block_with_persistent_pinned_profile_and_v1_allowlist() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_browser_mcp_to_document(&mut doc, &enabled(), "npx", &base(), &profile())
            .expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("[mcp_servers.playwright]"));
        assert!(rendered.contains("command = \"npx\""));
        assert!(rendered.contains("--browser"));
        assert!(rendered.contains("chrome"));
        assert!(rendered.contains("@playwright/mcp@latest"));
        assert!(rendered.contains("browser_navigate"));
        // persistent profile: --isolated must NOT be present (it would wipe logins each session)
        assert!(!rendered.contains("--isolated"));
        // separation is ENFORCED by us: profile dir pinned explicitly, and it is app-owned (not the
        // user's real Chrome profile)
        assert!(rendered.contains("--user-data-dir"));
        assert!(rendered.contains("browser-chrome-profile"));
        assert!(!rendered.contains("Google/Chrome"));
        // excluded tools must not leak into the allow-list
        assert!(!rendered.contains("browser_evaluate"));
        assert!(!rendered.contains("browser_run_code_unsafe"));

        let parsed = config_toml_core::parse_document(&rendered).expect("reparse");
        let tools = parsed["mcp_servers"]["playwright"]["enabled_tools"]
            .as_array()
            .expect("enabled_tools array");
        assert_eq!(tools.len(), 18);
        let args = parsed["mcp_servers"]["playwright"]["args"]
            .as_array()
            .expect("args array");
        // base (-y, @playwright/mcp@latest) + --browser chrome + --user-data-dir <path>
        assert_eq!(args.len(), 6);
    }

    #[test]
    fn disabled_removes_ours_and_preserves_user_servers() {
        let mut doc = config_toml_core::parse_document(
            "[mcp_servers.github]\ncommand = \"gh-mcp\"\nargs = [\"serve\"]\n",
        )
        .expect("parse");
        apply_browser_mcp_to_document(&mut doc, &disabled(), "npx", &base(), &profile()).expect("apply");
        let rendered = doc.to_string();
        assert!(rendered.contains("[mcp_servers.github]"));
        assert!(rendered.contains("command = \"gh-mcp\""));
        assert!(!rendered.contains("playwright"));
    }

    #[test]
    fn enable_then_disable_keeps_user_server_intact() {
        let mut doc =
            config_toml_core::parse_document("[mcp_servers.github]\ncommand = \"gh-mcp\"\n")
                .expect("parse");
        apply_browser_mcp_to_document(&mut doc, &enabled(), "npx", &base(), &profile()).expect("enable");
        assert!(doc.to_string().contains("[mcp_servers.playwright]"));
        assert!(doc.to_string().contains("[mcp_servers.github]"));

        apply_browser_mcp_to_document(&mut doc, &disabled(), "npx", &base(), &profile()).expect("disable");
        let rendered = doc.to_string();
        assert!(!rendered.contains("playwright"));
        assert!(rendered.contains("[mcp_servers.github]"));
        assert!(rendered.contains("command = \"gh-mcp\""));
    }

    #[test]
    fn disable_drops_empty_mcp_servers_table_when_we_were_sole_entry() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_browser_mcp_to_document(&mut doc, &enabled(), "npx", &base(), &profile()).expect("enable");
        assert!(doc.to_string().contains("mcp_servers"));
        apply_browser_mcp_to_document(&mut doc, &disabled(), "npx", &base(), &profile()).expect("disable");
        assert!(!doc.to_string().contains("mcp_servers"));
    }

    #[test]
    fn apply_is_idempotent() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        apply_browser_mcp_to_document(&mut doc, &enabled(), "npx", &base(), &profile()).expect("apply 1");
        apply_browser_mcp_to_document(&mut doc, &enabled(), "npx", &base(), &profile()).expect("apply 2");
        assert_eq!(doc.to_string().matches("[mcp_servers.playwright]").count(), 1);
    }

    #[test]
    fn enabled_with_empty_command_errors() {
        let mut doc = config_toml_core::parse_document("").expect("parse");
        let err = apply_browser_mcp_to_document(&mut doc, &enabled(), "   ", &base(), &profile())
            .expect_err("must reject empty command");
        assert!(err.contains("command"));
    }
}
