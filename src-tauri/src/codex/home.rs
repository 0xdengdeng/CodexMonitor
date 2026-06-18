use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::types::WorkspaceEntry;

const MANAGED_CODEX_HOME_DIR: &str = "codex-home";
#[cfg(not(test))]
const LEGACY_CODEX_HOME_DIR: &str = ".codex";
const LEGACY_IMPORT_MARKER: &str = ".agentdesk_legacy_codex_home_imported";
const LEGACY_IMPORT_DIRS: &[&str] = &["sessions", "archived_sessions", "generated_images"];

pub(crate) fn managed_codex_home_for_data_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(MANAGED_CODEX_HOME_DIR)
}

pub(crate) fn configure_managed_codex_home(data_dir: &Path) -> Result<PathBuf, String> {
    let codex_home = managed_codex_home_for_data_dir(data_dir);
    fs::create_dir_all(&codex_home).map_err(|err| {
        format!(
            "Failed to create AgentDesk Codex home at {}: {err}",
            codex_home.display()
        )
    })?;
    env::set_var("CODEX_HOME", &codex_home);
    #[cfg(not(test))]
    if let Err(err) = import_legacy_codex_home_once(&codex_home) {
        eprintln!("failed to import legacy Codex history: {err}");
    }
    Ok(codex_home)
}

#[cfg(not(test))]
fn import_legacy_codex_home_once(managed_codex_home: &Path) -> Result<(), String> {
    let legacy_codex_home = match resolve_legacy_codex_home() {
        Some(path) => path,
        None => return Ok(()),
    };
    import_legacy_codex_home_from(&legacy_codex_home, managed_codex_home)
}

fn import_legacy_codex_home_from(
    legacy_codex_home: &Path,
    managed_codex_home: &Path,
) -> Result<(), String> {
    if paths_equivalent(legacy_codex_home, managed_codex_home) {
        return Ok(());
    }
    if !legacy_codex_home.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(managed_codex_home).map_err(|err| {
        format!(
            "Failed to create managed Codex home at {}: {err}",
            managed_codex_home.display()
        )
    })?;

    let marker = managed_codex_home.join(LEGACY_IMPORT_MARKER);
    if marker.exists() {
        return Ok(());
    }

    for dirname in LEGACY_IMPORT_DIRS {
        copy_missing_tree(
            &legacy_codex_home.join(dirname),
            &managed_codex_home.join(dirname),
        )?;
    }

    fs::write(&marker, "legacy Codex history imported by AgentDesk\n").map_err(|err| {
        format!(
            "Failed to write legacy import marker at {}: {err}",
            marker.display()
        )
    })?;
    Ok(())
}

#[cfg(not(test))]
fn resolve_legacy_codex_home() -> Option<PathBuf> {
    Some(resolve_home_dir()?.join(LEGACY_CODEX_HOME_DIR))
}

fn copy_missing_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    if !source.is_dir() {
        return Ok(());
    }
    copy_missing_tree_inner(source, destination, source)
}

fn copy_missing_tree_inner(source: &Path, destination: &Path, root: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|err| {
        format!(
            "Failed to create legacy import destination {}: {err}",
            destination.display()
        )
    })?;

    let entries = fs::read_dir(source).map_err(|err| {
        format!(
            "Failed to read legacy Codex history directory {}: {err}",
            source.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| {
            format!(
                "Failed to read legacy Codex history entry under {}: {err}",
                source.display()
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|err| {
            format!(
                "Failed to inspect legacy Codex history entry {}: {err}",
                path.display()
            )
        })?;

        let relative = path.strip_prefix(root).map_err(|err| {
            format!(
                "Failed to resolve legacy Codex history path {} relative to {}: {err}",
                path.display(),
                root.display()
            )
        })?;
        let target = destination.join(relative);

        if file_type.is_dir() {
            copy_missing_tree_inner(&path, destination, root)?;
        } else if file_type.is_file() && !target.exists() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    format!(
                        "Failed to create legacy import destination {}: {err}",
                        parent.display()
                    )
                })?;
            }
            fs::copy(&path, &target).map_err(|err| {
                format!(
                    "Failed to copy legacy Codex history {} to {}: {err}",
                    path.display(),
                    target.display()
                )
            })?;
        }
    }
    Ok(())
}

fn paths_equivalent(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

pub(crate) fn resolve_workspace_codex_home(
    _entry: &WorkspaceEntry,
    _parent_entry: Option<&WorkspaceEntry>,
) -> Option<PathBuf> {
    resolve_default_codex_home()
}

pub(crate) fn resolve_default_codex_home() -> Option<PathBuf> {
    if let Ok(value) = env::var("CODEX_HOME") {
        if let Some(path) = normalize_codex_home(&value) {
            return Some(path);
        }
    }
    None
}

fn normalize_codex_home(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(path) = expand_tilde(trimmed) {
        return Some(path);
    }
    if let Some(path) = expand_dollar_env(trimmed) {
        return Some(path);
    }
    if let Some(path) = expand_percent_env(trimmed) {
        return Some(path);
    }
    Some(PathBuf::from(trimmed))
}

fn expand_tilde(value: &str) -> Option<PathBuf> {
    if !value.starts_with('~') {
        return None;
    }
    let home_dir = resolve_home_dir()?;
    if value == "~" {
        return Some(home_dir);
    }
    let rest = value.strip_prefix("~/")?;
    Some(home_dir.join(rest))
}

fn expand_dollar_env(value: &str) -> Option<PathBuf> {
    let rest = value.strip_prefix('$')?;
    if rest.is_empty() {
        return None;
    }

    let (var, remainder) = if let Some(inner) = rest.strip_prefix('{') {
        let end = inner.find('}')?;
        let name = &inner[..end];
        let remaining = &inner[end + 1..];
        (name, remaining)
    } else {
        let end = rest
            .find(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
            .unwrap_or(rest.len());
        let name = &rest[..end];
        let remaining = &rest[end..];
        (name, remaining)
    };

    if var.is_empty() {
        return None;
    }

    let value = resolve_env_var(var)?;
    Some(join_env_path(&value, remainder))
}

fn expand_percent_env(value: &str) -> Option<PathBuf> {
    let rest = value.strip_prefix('%')?;
    let end = rest.find('%')?;
    let var = &rest[..end];
    if var.is_empty() {
        return None;
    }
    let remainder = &rest[end + 1..];
    let value = resolve_env_var(var)?;
    Some(join_env_path(&value, remainder))
}

fn resolve_env_var(name: &str) -> Option<String> {
    if name.eq_ignore_ascii_case("HOME") {
        if let Some(home) = resolve_home_dir() {
            return Some(home.to_string_lossy().to_string());
        }
    }
    if let Some(value) = lookup_env_value(name) {
        return Some(value);
    }
    None
}

fn lookup_env_value(name: &str) -> Option<String> {
    if let Ok(value) = env::var(name) {
        if !value.trim().is_empty() {
            return Some(value);
        }
    }
    let upper = name.to_ascii_uppercase();
    if upper != name {
        if let Ok(value) = env::var(&upper) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    let lower = name.to_ascii_lowercase();
    if lower != name && lower != upper {
        if let Ok(value) = env::var(&lower) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn join_env_path(prefix: &str, remainder: &str) -> PathBuf {
    let mut base = PathBuf::from(prefix.trim());
    let trimmed_remainder = remainder.trim_start_matches(['/', '\\']);
    if trimmed_remainder.is_empty() {
        base
    } else {
        base.push(trimmed_remainder);
        base
    }
}

pub(crate) fn resolve_home_dir() -> Option<PathBuf> {
    if let Ok(value) = env::var("HOME") {
        if !value.trim().is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    if let Ok(value) = env::var("USERPROFILE") {
        if !value.trim().is_empty() {
            return Some(PathBuf::from(value));
        }
    }
    #[cfg(unix)]
    {
        // Fallback for daemon environments that do not expose HOME.
        unsafe {
            let uid = libc::geteuid();
            let pwd = libc::getpwuid(uid);
            if !pwd.is_null() {
                let dir_ptr = (*pwd).pw_dir;
                if !dir_ptr.is_null() {
                    if let Ok(dir) = std::ffi::CStr::from_ptr(dir_ptr).to_str() {
                        if !dir.trim().is_empty() {
                            return Some(PathBuf::from(dir));
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{WorkspaceKind, WorkspaceSettings, WorktreeInfo};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn workspace_entry(kind: WorkspaceKind, path: &str) -> WorkspaceEntry {
        let worktree = if kind.is_worktree() {
            Some(WorktreeInfo {
                branch: "feature/test".to_string(),
            })
        } else {
            None
        };
        WorkspaceEntry {
            id: "workspace-id".to_string(),
            name: "workspace".to_string(),
            path: path.to_string(),
            kind,
            parent_id: None,
            worktree,
            settings: WorkspaceSettings::default(),
        }
    }

    #[test]
    fn workspace_codex_home_uses_default_resolution() {
        let entry = workspace_entry(WorkspaceKind::Main, "/repo");
        let _guard = ENV_LOCK.lock().expect("lock env");

        let prev_codex_home = std::env::var("CODEX_HOME").ok();
        std::env::set_var("CODEX_HOME", "/tmp/codex-global");

        let resolved = resolve_workspace_codex_home(&entry, None);
        assert_eq!(resolved, Some(PathBuf::from("/tmp/codex-global")));

        match prev_codex_home {
            Some(value) => std::env::set_var("CODEX_HOME", value),
            None => std::env::remove_var("CODEX_HOME"),
        }
    }

    #[test]
    fn managed_codex_home_overrides_external_environment() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let data_dir =
            std::env::temp_dir().join(format!("agentdesk-data-dir-{}", uuid::Uuid::new_v4()));
        let expected = data_dir.join("codex-home");
        let prev_codex_home = std::env::var("CODEX_HOME").ok();
        std::env::set_var("CODEX_HOME", "/tmp/external-codex-home");

        let configured = configure_managed_codex_home(&data_dir).expect("configure managed home");

        assert_eq!(configured, expected);
        assert_eq!(
            std::env::var("CODEX_HOME").ok(),
            Some(expected.to_string_lossy().to_string())
        );
        assert_eq!(resolve_default_codex_home(), Some(expected));
        let _ = std::fs::remove_dir_all(&data_dir);
        match prev_codex_home {
            Some(value) => std::env::set_var("CODEX_HOME", value),
            None => std::env::remove_var("CODEX_HOME"),
        }
    }

    #[test]
    fn default_codex_home_does_not_fall_back_to_system_home() {
        let _guard = ENV_LOCK.lock().expect("lock env");

        let prev_codex_home = std::env::var("CODEX_HOME").ok();
        std::env::remove_var("CODEX_HOME");

        assert_eq!(resolve_default_codex_home(), None);

        match prev_codex_home {
            Some(value) => std::env::set_var("CODEX_HOME", value),
            None => std::env::remove_var("CODEX_HOME"),
        }
    }

    #[test]
    fn codex_home_expands_tilde_and_env_vars() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let home_dir = std::env::temp_dir().join("codex-home-test");
        let home_str = home_dir.to_string_lossy().to_string();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home_str);

        let prev_appdata = std::env::var("APPDATA").ok();
        std::env::set_var("APPDATA", "/tmp/appdata-root");

        let tilde = normalize_codex_home("~/.codex-api");
        assert_eq!(tilde, Some(home_dir.join(".codex-api")));

        let dollar = normalize_codex_home("$HOME/.codex-api");
        assert_eq!(dollar, Some(home_dir.join(".codex-api")));

        let braces = normalize_codex_home("${HOME}/.codex-api");
        assert_eq!(braces, Some(home_dir.join(".codex-api")));

        let appdata = normalize_codex_home("%APPDATA%/Codex");
        assert_eq!(appdata, Some(PathBuf::from("/tmp/appdata-root/Codex")));

        let appdata_lower = normalize_codex_home("$appdata/Codex");
        assert_eq!(
            appdata_lower,
            Some(PathBuf::from("/tmp/appdata-root/Codex"))
        );

        match prev_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        match prev_appdata {
            Some(value) => std::env::set_var("APPDATA", value),
            None => std::env::remove_var("APPDATA"),
        }
    }

    #[test]
    fn legacy_codex_home_import_copies_history_assets_without_overwriting() {
        let root =
            std::env::temp_dir().join(format!("agentdesk-legacy-import-{}", uuid::Uuid::new_v4()));
        let legacy = root.join("legacy");
        let managed = root.join("managed");

        let legacy_session = legacy
            .join("sessions")
            .join("2026")
            .join("06")
            .join("18")
            .join("rollout-legacy.jsonl");
        let managed_session = managed
            .join("sessions")
            .join("2026")
            .join("06")
            .join("18")
            .join("rollout-legacy.jsonl");
        let legacy_archive = legacy
            .join("archived_sessions")
            .join("rollout-archived.jsonl");
        let legacy_image = legacy
            .join("generated_images")
            .join("thread-1")
            .join("image.png");

        fs::create_dir_all(legacy_session.parent().expect("legacy session parent"))
            .expect("create legacy sessions");
        fs::create_dir_all(managed_session.parent().expect("managed session parent"))
            .expect("create managed sessions");
        fs::create_dir_all(legacy_archive.parent().expect("legacy archive parent"))
            .expect("create legacy archives");
        fs::create_dir_all(legacy_image.parent().expect("legacy image parent"))
            .expect("create legacy images");

        fs::write(&legacy_session, "legacy-session").expect("write legacy session");
        fs::write(&managed_session, "existing-session").expect("write managed session");
        fs::write(&legacy_archive, "legacy-archive").expect("write legacy archive");
        fs::write(&legacy_image, "legacy-image").expect("write legacy image");

        import_legacy_codex_home_from(&legacy, &managed).expect("import legacy home");

        assert_eq!(
            fs::read_to_string(&managed_session).expect("read managed session"),
            "existing-session"
        );
        assert_eq!(
            fs::read_to_string(
                managed
                    .join("archived_sessions")
                    .join("rollout-archived.jsonl")
            )
            .expect("read managed archive"),
            "legacy-archive"
        );
        assert_eq!(
            fs::read_to_string(
                managed
                    .join("generated_images")
                    .join("thread-1")
                    .join("image.png")
            )
            .expect("read managed image"),
            "legacy-image"
        );
        assert!(managed.join(LEGACY_IMPORT_MARKER).exists());

        fs::write(&legacy_archive, "changed-after-marker").expect("rewrite legacy archive");
        import_legacy_codex_home_from(&legacy, &managed).expect("second import");
        assert_eq!(
            fs::read_to_string(
                managed
                    .join("archived_sessions")
                    .join("rollout-archived.jsonl")
            )
            .expect("read managed archive again"),
            "legacy-archive"
        );

        let _ = fs::remove_dir_all(root);
    }
}
