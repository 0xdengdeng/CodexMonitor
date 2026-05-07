use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
const BUNDLED_CODEX_RUNTIME_FILE_NAME: &str = "codex-runtime.exe";
#[cfg(not(target_os = "windows"))]
const BUNDLED_CODEX_RUNTIME_FILE_NAME: &str = "codex-runtime";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexRuntimeSource {
    Custom,
    Bundled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedCodexRuntime {
    pub(crate) bin: String,
    pub(crate) source: CodexRuntimeSource,
}

fn bundled_codex_runtime_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join(BUNDLED_CODEX_RUNTIME_FILE_NAME)
}

pub(crate) fn resolve_codex_runtime_from_resource_dir(
    configured_codex_bin: Option<String>,
    resource_dir: Option<&Path>,
) -> Result<ResolvedCodexRuntime, String> {
    if let Some(value) = configured_codex_bin.filter(|value| !value.trim().is_empty()) {
        return Ok(ResolvedCodexRuntime {
            bin: value,
            source: CodexRuntimeSource::Custom,
        });
    }

    let resource_dir = resource_dir.ok_or_else(|| {
        "Bundled Codex runtime not found because the app resource directory could not be resolved."
            .to_string()
    })?;
    let bundled = bundled_codex_runtime_path(resource_dir);
    if bundled.is_file() {
        return Ok(ResolvedCodexRuntime {
            bin: bundled.to_string_lossy().to_string(),
            source: CodexRuntimeSource::Bundled,
        });
    }

    Err(format!(
        "Bundled Codex runtime not found at {}. Run `npm run sync:codex-runtime` before starting CodexMonitor.",
        bundled.display()
    ))
}

pub(crate) fn resolve_codex_runtime(
    app_handle: &AppHandle,
    configured_codex_bin: Option<String>,
) -> Result<ResolvedCodexRuntime, String> {
    let resource_dir = app_handle.path().resource_dir().ok();
    resolve_codex_runtime_from_resource_dir(configured_codex_bin, resource_dir.as_deref())
}

pub(crate) fn resolve_effective_codex_bin(
    app_handle: &AppHandle,
    configured_codex_bin: Option<String>,
) -> Result<String, String> {
    resolve_codex_runtime(app_handle, configured_codex_bin).map(|runtime| runtime.bin)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{resolve_codex_runtime_from_resource_dir, CodexRuntimeSource};

    #[test]
    fn custom_codex_bin_overrides_bundled_runtime() {
        let temp_dir = std::env::temp_dir().join(format!(
            "codex-monitor-runtime-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let bundled = temp_dir.join("codex-runtime");
        fs::write(&bundled, "runtime").expect("write bundled runtime");

        let resolved = resolve_codex_runtime_from_resource_dir(
            Some("/custom/codex".to_string()),
            Some(&temp_dir),
        )
        .expect("resolve custom runtime")
        .bin;

        assert_eq!(resolved, "/custom/codex");
        let runtime = resolve_codex_runtime_from_resource_dir(
            Some("/custom/codex".to_string()),
            Some(&temp_dir),
        )
        .expect("resolve custom runtime with source");
        assert_eq!(runtime.source, CodexRuntimeSource::Custom);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn bundled_runtime_is_default_when_no_custom_path_is_set() {
        let temp_dir = std::env::temp_dir().join(format!(
            "codex-monitor-runtime-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let bundled = temp_dir.join("codex-runtime");
        fs::write(&bundled, "runtime").expect("write bundled runtime");

        let resolved = resolve_codex_runtime_from_resource_dir(None, Some(&temp_dir))
            .expect("resolve bundled runtime")
            .bin;

        assert_eq!(resolved, bundled.to_string_lossy());
        let runtime = resolve_codex_runtime_from_resource_dir(None, Some(&temp_dir))
            .expect("resolve bundled runtime with source");
        assert_eq!(runtime.source, CodexRuntimeSource::Bundled);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn missing_bundled_runtime_fails_instead_of_using_path_codex() {
        let temp_dir = std::env::temp_dir().join(format!(
            "codex-monitor-runtime-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let err = resolve_codex_runtime_from_resource_dir(None, Some(&temp_dir))
            .expect_err("missing bundled runtime should fail");

        assert!(err.contains("Bundled Codex runtime not found"));
        let _ = fs::remove_dir_all(temp_dir);
    }
}
