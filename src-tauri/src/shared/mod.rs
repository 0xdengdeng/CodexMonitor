pub(crate) mod account;
pub(crate) mod agents_config_core;
// Used by the app (src/settings adapter) but not the headless daemon binary (browser is app-only;
// the daemon can't run a browser) — allow keeps the daemon build warning-free. See
// docs/browser-capability-design.md.
#[allow(dead_code)]
pub(crate) mod browser_mcp_core;
pub(crate) mod codex_aux_core;
pub(crate) mod codex_core;
pub(crate) mod config_toml_core;
// Used by the app (src/deploy) but not the headless daemon binary (deploy is app-only today;
// daemon parity is v2) — allow keeps the daemon build warning-free.
#[allow(dead_code)]
pub(crate) mod deploy_core;
pub(crate) mod files_core;
pub(crate) mod git_core;
pub(crate) mod git_rpc;
pub(crate) mod git_ui_core;
#[allow(dead_code)]
pub(crate) mod image_generation_core;
pub(crate) mod local_usage_core;
pub(crate) mod process_core;
pub(crate) mod prompts_core;
pub(crate) mod runtime_config_core;
pub(crate) mod runtime_models_core;
pub(crate) mod runtime_secret_core;
pub(crate) mod settings_core;
pub(crate) mod skills_market_core;
pub(crate) mod workspace_rpc;
pub(crate) mod workspaces_core;
pub(crate) mod worktree_core;
