use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
const BUNDLED_CODEX_RUNTIME_FILE_NAME: &str = "codex-runtime.exe";
#[cfg(not(target_os = "windows"))]
const BUNDLED_CODEX_RUNTIME_FILE_NAME: &str = "codex-runtime";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexRuntimeSource {
    Bundled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedCodexRuntime {
    pub(crate) bin: String,
    pub(crate) source: CodexRuntimeSource,
}

fn bundled_codex_runtime_file_name() -> &'static str {
    BUNDLED_CODEX_RUNTIME_FILE_NAME
}

fn bundled_codex_runtime_path(dir: &Path) -> PathBuf {
    dir.join(bundled_codex_runtime_file_name())
}

#[allow(dead_code)]
fn executable_runtime_search_dirs(executable_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![executable_dir.to_path_buf()];

    #[cfg(target_os = "macos")]
    {
        if let Some(contents_dir) = executable_dir.parent() {
            dirs.push(contents_dir.join("Resources"));
        }
    }

    dirs
}

fn resolve_codex_runtime_from_search_dirs(
    search_dirs: Vec<PathBuf>,
) -> Result<ResolvedCodexRuntime, String> {
    let mut attempted = Vec::new();
    for dir in search_dirs {
        let bundled = bundled_codex_runtime_path(&dir);
        if bundled.is_file() {
            return Ok(ResolvedCodexRuntime {
                bin: bundled.to_string_lossy().to_string(),
                source: CodexRuntimeSource::Bundled,
            });
        }
        attempted.push(bundled);
    }

    let attempted = attempted
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "Bundled Codex runtime not found. Run `npm run sync:codex-runtime` before starting CodexMonitor. Tried: {attempted}"
    ))
}

#[allow(dead_code)]
pub(crate) fn resolve_codex_runtime_from_resource_dir(
    _configured_codex_bin: Option<String>,
    resource_dir: Option<&Path>,
) -> Result<ResolvedCodexRuntime, String> {
    let resource_dir = resource_dir.ok_or_else(|| {
        "Bundled Codex runtime not found because the app resource directory could not be resolved."
            .to_string()
    })?;
    resolve_codex_runtime_from_search_dirs(vec![resource_dir.to_path_buf()])
}

#[allow(dead_code)]
pub(crate) fn resolve_codex_runtime_from_executable_dir(
    executable_dir: &Path,
) -> Result<ResolvedCodexRuntime, String> {
    resolve_codex_runtime_from_search_dirs(executable_runtime_search_dirs(executable_dir))
}

#[allow(dead_code)]
pub(crate) fn resolve_codex_runtime_from_current_exe() -> Result<ResolvedCodexRuntime, String> {
    let current_exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let executable_dir = current_exe
        .parent()
        .ok_or_else(|| "Unable to resolve executable directory".to_string())?;
    resolve_codex_runtime_from_executable_dir(executable_dir)
}

#[allow(dead_code)]
pub(crate) fn resolve_codex_runtime(
    app_handle: &AppHandle,
    configured_codex_bin: Option<String>,
) -> Result<ResolvedCodexRuntime, String> {
    let resource_dir = app_handle.path().resource_dir().ok();
    resolve_codex_runtime_from_resource_dir(configured_codex_bin, resource_dir.as_deref())
}

#[allow(dead_code)]
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

    fn bundled_runtime_path(dir: &std::path::Path) -> std::path::PathBuf {
        dir.join(super::bundled_codex_runtime_file_name())
    }

    #[test]
    fn bundled_runtime_overrides_legacy_custom_codex_bin() {
        let temp_dir = std::env::temp_dir().join(format!(
            "codex-monitor-runtime-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let bundled = bundled_runtime_path(&temp_dir);
        fs::write(&bundled, "runtime").expect("write bundled runtime");

        let resolved = resolve_codex_runtime_from_resource_dir(
            Some("/custom/codex".to_string()),
            Some(&temp_dir),
        )
        .expect("resolve bundled runtime")
        .bin;

        assert_eq!(resolved, bundled.to_string_lossy());
        let runtime = resolve_codex_runtime_from_resource_dir(
            Some("/custom/codex".to_string()),
            Some(&temp_dir),
        )
        .expect("resolve bundled runtime with source");
        assert_eq!(runtime.source, CodexRuntimeSource::Bundled);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn bundled_runtime_resolves_from_executable_directory_for_daemon() {
        let temp_dir = std::env::temp_dir().join(format!(
            "codex-monitor-runtime-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let bundled = bundled_runtime_path(&temp_dir);
        fs::write(&bundled, "runtime").expect("write bundled runtime");

        let resolved = super::resolve_codex_runtime_from_executable_dir(&temp_dir)
            .expect("resolve bundled runtime from executable dir");

        assert_eq!(resolved.bin, bundled.to_string_lossy());
        assert_eq!(resolved.source, CodexRuntimeSource::Bundled);
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn bundled_runtime_is_default_when_no_custom_path_is_set() {
        let temp_dir = std::env::temp_dir().join(format!(
            "codex-monitor-runtime-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");
        let bundled = bundled_runtime_path(&temp_dir);
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
