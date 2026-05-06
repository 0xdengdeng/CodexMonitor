pub(crate) const APP_CLIENT_NAME: &str = "enterprise_ai_dev_workbench";
pub(crate) const APP_DISPLAY_NAME: &str = "企业 AI 开发工作台";
#[allow(dead_code)]
pub(crate) const APP_UPDATER_ENABLED: bool = false;

pub(crate) fn resolve_default_codex_bin(codex_bin: Option<String>) -> Option<String> {
    crate::shared::codex_binary::resolve_codex_bin(codex_bin)
}
