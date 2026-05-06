use std::path::{Path, PathBuf};

const BUNDLED_CODEX_ENV: &str = "CODEX_MONITOR_BUNDLED_CODEX_BIN";
const BUNDLED_CODEX_DIR: &str = "codex-bundled";

const LOCAL_CODEX_DEBUG_BIN: &str =
    "/Users/xiaodeng/project/openai-codex/codex-rs/target/debug/codex";

fn codex_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "codex.exe"
    } else {
        "codex"
    }
}

fn existing_file(path: impl AsRef<Path>) -> Option<String> {
    let path = path.as_ref();
    if path.is_file() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

fn trimmed_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bundled_env_candidate() -> Option<String> {
    let path = trimmed_non_empty(std::env::var(BUNDLED_CODEX_ENV).ok())?;
    existing_file(path)
}

fn bundled_relative_path(base: impl Into<PathBuf>) -> PathBuf {
    base.into().join(BUNDLED_CODEX_DIR).join(codex_binary_name())
}

fn bundled_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(bundled_relative_path(exe_dir));
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(bundled_relative_path(contents_dir.join("Resources")));
            }
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(bundled_relative_path(current_dir.join("src-tauri/resources")));
        candidates.push(bundled_relative_path(current_dir.join("resources")));
    }

    candidates
}

fn bundled_binary_candidate() -> Option<String> {
    bundled_env_candidate().or_else(|| bundled_candidates().into_iter().find_map(existing_file))
}

pub(crate) fn resolve_codex_bin(codex_bin: Option<String>) -> Option<String> {
    trimmed_non_empty(codex_bin)
        .or_else(bundled_binary_candidate)
        .or_else(|| existing_file(LOCAL_CODEX_DEBUG_BIN))
}

#[cfg(test)]
mod tests {
    use super::resolve_codex_bin;
    use std::fs;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn unique_temp_codex_bin() -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default();
        std::env::temp_dir()
            .join(format!("codex-monitor-test-codex-{millis}"))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn codex_binary_trims_explicit_override() {
        assert_eq!(
            resolve_codex_bin(Some("  /tmp/custom-codex  ".to_string())),
            Some("/tmp/custom-codex".to_string())
        );
    }

    #[test]
    fn codex_binary_uses_bundled_env_binary() {
        let _guard = ENV_LOCK.lock().expect("env lock poisoned");
        let path = unique_temp_codex_bin();
        fs::write(&path, b"codex").expect("write test codex binary");
        std::env::set_var("CODEX_MONITOR_BUNDLED_CODEX_BIN", &path);

        let resolved = resolve_codex_bin(None);

        std::env::remove_var("CODEX_MONITOR_BUNDLED_CODEX_BIN");
        let _ = fs::remove_file(&path);

        assert_eq!(resolved, Some(path));
    }
}
