use std::path::Path;

pub(crate) const APP_CLIENT_NAME: &str = "enterprise_ai_dev_workbench";
pub(crate) const APP_DISPLAY_NAME: &str = "企业 AI 开发工作台";
#[allow(dead_code)]
pub(crate) const APP_UPDATER_ENABLED: bool = false;

const LOCAL_CODEX_DEBUG_BIN: &str =
    "/Users/xiaodeng/project/openai-codex/codex-rs/target/debug/codex";

pub(crate) fn resolve_default_codex_bin(codex_bin: Option<String>) -> Option<String> {
    if let Some(value) = codex_bin.filter(|value| !value.trim().is_empty()) {
        return Some(value);
    }

    if Path::new(LOCAL_CODEX_DEBUG_BIN).is_file() {
        Some(LOCAL_CODEX_DEBUG_BIN.to_string())
    } else {
        None
    }
}
