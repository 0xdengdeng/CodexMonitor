use std::env;
use std::ffi::OsString;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[cfg(target_os = "windows")]
const BUNDLED_GIT_FILE_NAME: &str = "git.exe";
#[cfg(not(target_os = "windows"))]
const BUNDLED_GIT_FILE_NAME: &str = "git";

#[cfg(target_os = "macos")]
const MIN_STANDALONE_GIT_BYTES: u64 = 512 * 1024;
const BUNDLED_GIT_WRAPPER_MARKER: &str = "AGENTDESK_BUNDLED_GIT_WRAPPER";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GitBinarySource {
    Bundled,
    Path,
    Fallback,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GitRuntimePreference {
    Auto,
    Bundled,
    System,
}

pub(crate) struct ResolvedGitBinary {
    path: PathBuf,
    source: GitBinarySource,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRuntimeInfo {
    pub(crate) available: bool,
    pub(crate) source: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) error: Option<String>,
}

fn git_runtime_preference_cell() -> &'static Mutex<GitRuntimePreference> {
    static GIT_RUNTIME_PREFERENCE: OnceLock<Mutex<GitRuntimePreference>> = OnceLock::new();
    GIT_RUNTIME_PREFERENCE.get_or_init(|| Mutex::new(GitRuntimePreference::Auto))
}

fn parse_git_runtime_preference(value: &str) -> GitRuntimePreference {
    match value.trim() {
        "bundled" => GitRuntimePreference::Bundled,
        "system" => GitRuntimePreference::System,
        _ => GitRuntimePreference::Auto,
    }
}

fn current_git_runtime_preference() -> GitRuntimePreference {
    git_runtime_preference_cell()
        .lock()
        .map(|preference| *preference)
        .unwrap_or(GitRuntimePreference::Auto)
}

pub(crate) fn set_git_runtime_preference(value: &str) {
    if let Ok(mut preference) = git_runtime_preference_cell().lock() {
        *preference = parse_git_runtime_preference(value);
    }
}

pub(crate) fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub(crate) fn normalize_windows_namespace_path(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }

    fn strip_prefix_ascii_case<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
        value
            .get(..prefix.len())
            .filter(|candidate| candidate.eq_ignore_ascii_case(prefix))
            .map(|_| &value[prefix.len()..])
    }

    fn starts_with_drive_path(value: &str) -> bool {
        let bytes = value.as_bytes();
        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
    }

    if let Some(rest) = strip_prefix_ascii_case(path, r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = strip_prefix_ascii_case(path, "//?/UNC/") {
        return format!("//{rest}");
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, r"\\?\").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, "//?/").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, r"\\.\").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }
    if let Some(rest) =
        strip_prefix_ascii_case(path, "//./").filter(|rest| starts_with_drive_path(rest))
    {
        return rest.to_string();
    }

    path.to_string()
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn bundled_git_binary_path(dir: &std::path::Path) -> PathBuf {
    dir.join(BUNDLED_GIT_FILE_NAME)
}

fn is_usable_bundled_git_candidate(path: &std::path::Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        // `/usr/bin/git` on macOS is an Apple developer-tools shim. Copying that shim
        // out of `/usr/bin` as a sidecar can hang when executed, so do not treat small
        // copied shims as a usable embedded Git.
        if path
            .metadata()
            .map(|metadata| metadata.len() < MIN_STANDALONE_GIT_BYTES)
            .unwrap_or(false)
        {
            return is_marked_bundled_git_wrapper(path);
        }
    }

    true
}

fn is_marked_bundled_git_wrapper(path: &std::path::Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut buffer = vec![0_u8; 4096];
    let Ok(read) = file.read(&mut buffer) else {
        return false;
    };
    String::from_utf8_lossy(&buffer[..read]).contains(BUNDLED_GIT_WRAPPER_MARKER)
}

fn executable_git_search_dirs(executable_dir: &std::path::Path) -> Vec<PathBuf> {
    let mut dirs = vec![executable_dir.to_path_buf()];

    #[cfg(target_os = "macos")]
    {
        if let Some(contents_dir) = executable_dir.parent() {
            dirs.push(contents_dir.join("Resources"));
        }
    }

    dirs
}

fn bundled_git_search_dirs() -> Vec<PathBuf> {
    let Ok(current_exe) = env::current_exe() else {
        return Vec::new();
    };
    let Some(executable_dir) = current_exe.parent() else {
        return Vec::new();
    };
    executable_git_search_dirs(executable_dir)
}

fn resolve_git_binary_from_sources<F>(
    bundled_dirs: &[PathBuf],
    path_git: Option<PathBuf>,
    fallback_candidates: &[PathBuf],
    is_file: F,
) -> Result<ResolvedGitBinary, String>
where
    F: Fn(&std::path::Path) -> bool,
{
    let preference = current_git_runtime_preference();

    if preference != GitRuntimePreference::System {
        for dir in bundled_dirs {
            let candidate = bundled_git_binary_path(dir);
            if is_file(&candidate) && is_usable_bundled_git_candidate(&candidate) {
                return Ok(ResolvedGitBinary {
                    path: candidate,
                    source: GitBinarySource::Bundled,
                });
            }
        }

        if preference == GitRuntimePreference::Bundled {
            let attempted = bundled_dirs
                .iter()
                .map(|dir| bundled_git_binary_path(dir).display().to_string())
                .collect::<Vec<_>>();
            let detail = if attempted.is_empty() {
                "no bundled Git search locations were available".to_string()
            } else {
                format!("Tried: {}", attempted.join(", "))
            };
            return Err(format!("Bundled Git not found or is not usable. {detail}"));
        }
    }

    if let Some(path) = path_git.filter(|path| is_file(path)) {
        return Ok(ResolvedGitBinary {
            path,
            source: GitBinarySource::Path,
        });
    }

    for candidate in fallback_candidates {
        if is_file(candidate) {
            return Ok(ResolvedGitBinary {
                path: candidate.clone(),
                source: GitBinarySource::Fallback,
            });
        }
    }

    let mut attempted = bundled_dirs
        .iter()
        .map(|dir| bundled_git_binary_path(dir).display().to_string())
        .collect::<Vec<_>>();
    attempted.extend(
        fallback_candidates
            .iter()
            .map(|path| path.display().to_string()),
    );

    Err(format!(
        "Git not found. Install Git or ensure it is on PATH. Tried: {}",
        attempted.join(", ")
    ))
}

fn git_binary_source_label(source: GitBinarySource) -> &'static str {
    match source {
        GitBinarySource::Bundled => "bundled",
        GitBinarySource::Path => "PATH",
        GitBinarySource::Fallback => "fallback",
    }
}

fn git_binary_log_line(resolved: &ResolvedGitBinary) -> String {
    format!(
        "git: using {} Git at {}",
        git_binary_source_label(resolved.source),
        resolved.path.display()
    )
}

fn log_resolved_git_binary(resolved: &ResolvedGitBinary) {
    static LAST_LOGGED_GIT_BINARY: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    let last_logged = LAST_LOGGED_GIT_BINARY.get_or_init(|| Mutex::new(None));
    let Ok(mut last_logged) = last_logged.lock() else {
        eprintln!("{}", git_binary_log_line(resolved));
        return;
    };

    if last_logged.as_ref() == Some(&resolved.path) {
        return;
    }

    eprintln!("{}", git_binary_log_line(resolved));
    *last_logged = Some(resolved.path.clone());
}

pub(crate) fn resolve_git_binary() -> Result<PathBuf, String> {
    let candidates: &[&str] = if cfg!(windows) {
        &[
            "C:\\Program Files\\Git\\bin\\git.exe",
            "C:\\Program Files (x86)\\Git\\bin\\git.exe",
        ]
    } else {
        &[
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
            "/opt/local/bin/git",
            "/run/current-system/sw/bin/git",
        ]
    };

    let path_git = find_in_path("git").or_else(|| {
        if cfg!(windows) {
            find_in_path("git.exe")
        } else {
            None
        }
    });
    let fallback_candidates = candidates.iter().map(PathBuf::from).collect::<Vec<_>>();

    let resolved = resolve_git_binary_from_sources(
        &bundled_git_search_dirs(),
        path_git,
        &fallback_candidates,
        |path| path.is_file(),
    )?;
    log_resolved_git_binary(&resolved);
    Ok(resolved.path)
}

pub(crate) fn git_runtime_info() -> GitRuntimeInfo {
    let candidates: &[&str] = if cfg!(windows) {
        &[
            "C:\\Program Files\\Git\\bin\\git.exe",
            "C:\\Program Files (x86)\\Git\\bin\\git.exe",
        ]
    } else {
        &[
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/usr/bin/git",
            "/opt/local/bin/git",
            "/run/current-system/sw/bin/git",
        ]
    };
    let path_git = find_in_path("git").or_else(|| {
        if cfg!(windows) {
            find_in_path("git.exe")
        } else {
            None
        }
    });
    let fallback_candidates = candidates.iter().map(PathBuf::from).collect::<Vec<_>>();

    let resolved = match resolve_git_binary_from_sources(
        &bundled_git_search_dirs(),
        path_git,
        &fallback_candidates,
        |path| path.is_file(),
    ) {
        Ok(resolved) => resolved,
        Err(error) => {
            return GitRuntimeInfo {
                available: false,
                source: None,
                path: None,
                version: None,
                error: Some(error),
            };
        }
    };

    log_resolved_git_binary(&resolved);
    GitRuntimeInfo {
        available: true,
        source: Some(git_binary_source_label(resolved.source).to_string()),
        path: Some(resolved.path.to_string_lossy().to_string()),
        version: None,
        error: None,
    }
}

pub(crate) fn git_env_path() -> String {
    let paths: Vec<PathBuf> = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();

    let defaults: &[&str] = if cfg!(windows) {
        &["C:\\Windows\\System32"]
    } else {
        &[
            "/usr/bin",
            "/bin",
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/opt/local/bin",
            "/run/current-system/sw/bin",
        ]
    };

    let paths = git_env_paths_from_sources(paths, &bundled_git_search_dirs(), defaults);
    let joined = env::join_paths(paths).unwrap_or_else(|_| OsString::new());
    joined.to_string_lossy().to_string()
}

fn git_env_paths_from_sources(
    mut paths: Vec<PathBuf>,
    bundled_dirs: &[PathBuf],
    defaults: &[&str],
) -> Vec<PathBuf> {
    for dir in bundled_dirs {
        if is_usable_bundled_git_candidate(&bundled_git_binary_path(dir)) && !paths.contains(dir) {
            paths.push(dir.clone());
        }
    }

    for candidate in defaults {
        let path = PathBuf::from(candidate);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }

    paths
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{normalize_git_path, normalize_windows_namespace_path};

    #[test]
    fn normalize_git_path_replaces_backslashes() {
        assert_eq!(normalize_git_path("foo\\bar\\baz"), "foo/bar/baz");
    }

    #[test]
    fn normalize_windows_namespace_path_strips_drive_prefix() {
        assert_eq!(
            normalize_windows_namespace_path(r"\\?\I:\gpt-projects\json-composer"),
            r"I:\gpt-projects\json-composer"
        );
        assert_eq!(
            normalize_windows_namespace_path("//?/I:/gpt-projects/json-composer"),
            "I:/gpt-projects/json-composer"
        );
    }

    #[test]
    fn normalize_windows_namespace_path_strips_unc_prefix() {
        assert_eq!(
            normalize_windows_namespace_path(r"\\?\UNC\SERVER\Share\Repo"),
            r"\\SERVER\Share\Repo"
        );
        assert_eq!(
            normalize_windows_namespace_path("//?/UNC/SERVER/Share/Repo"),
            "//SERVER/Share/Repo"
        );
        assert_eq!(
            normalize_windows_namespace_path(r"\\?\unc\SERVER\Share\Repo"),
            r"\\SERVER\Share\Repo"
        );
        assert_eq!(
            normalize_windows_namespace_path("//?/unc/SERVER/Share/Repo"),
            "//SERVER/Share/Repo"
        );
    }

    #[test]
    fn normalize_windows_namespace_path_preserves_whitespace_for_plain_paths() {
        assert_eq!(
            normalize_windows_namespace_path("  /tmp/workspace  "),
            "  /tmp/workspace  "
        );
    }

    #[test]
    fn normalize_windows_namespace_path_preserves_other_namespace_forms() {
        assert_eq!(
            normalize_windows_namespace_path(
                r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\repo"
            ),
            r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\repo"
        );
        assert_eq!(
            normalize_windows_namespace_path(r"\\.\pipe\codex-monitor"),
            r"\\.\pipe\codex-monitor"
        );
    }

    #[test]
    fn bundled_git_binary_is_preferred_over_system_git() {
        let bundled_dir = unique_test_dir("bundled-git-preferred");
        let bundled = super::bundled_git_binary_path(&bundled_dir);
        std::fs::create_dir_all(&bundled_dir).expect("create test bundled dir");
        write_usable_git_candidate(&bundled);
        let system_git = PathBuf::from("/usr/bin/git");

        let resolved = super::resolve_git_binary_from_sources(
            &[bundled_dir.clone()],
            Some(system_git.clone()),
            &[system_git],
            |path| path == bundled,
        )
        .expect("resolve bundled git");

        assert_eq!(resolved.path, bundled);
        assert_eq!(resolved.source, super::GitBinarySource::Bundled);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn copied_macos_git_shim_sidecar_is_not_preferred() {
        let bundled_dir = unique_test_dir("bundled-git-small-shim");
        let bundled = super::bundled_git_binary_path(&bundled_dir);
        let system_git = bundled_dir.join("system-git");
        std::fs::create_dir_all(&bundled_dir).expect("create test bundled dir");
        std::fs::write(&bundled, b"small copied shim").expect("write copied shim");
        write_usable_git_candidate(&system_git);

        let resolved = super::resolve_git_binary_from_sources(
            &[bundled_dir],
            Some(system_git.clone()),
            &[],
            |path| path == bundled || path == system_git,
        )
        .expect("resolve system git");

        assert_eq!(resolved.path, system_git);
        assert_eq!(resolved.source, super::GitBinarySource::Path);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn marked_bundled_git_wrapper_is_usable_even_when_small() {
        let bundled_dir = unique_test_dir("bundled-git-wrapper");
        let bundled = super::bundled_git_binary_path(&bundled_dir);
        std::fs::create_dir_all(&bundled_dir).expect("create test bundled dir");
        std::fs::write(
            &bundled,
            b"#!/bin/sh\n# AGENTDESK_BUNDLED_GIT_WRAPPER\nexec /bin/false\n",
        )
        .expect("write bundled wrapper");

        assert!(super::is_usable_bundled_git_candidate(&bundled));
    }

    #[test]
    fn git_binary_log_line_includes_source_and_path() {
        let resolved = super::ResolvedGitBinary {
            path: PathBuf::from("/app/Contents/MacOS/git"),
            source: super::GitBinarySource::Bundled,
        };

        assert_eq!(
            super::git_binary_log_line(&resolved),
            "git: using bundled Git at /app/Contents/MacOS/git"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn git_env_path_ignores_unusable_copied_macos_git_shim_dirs() {
        let shim_dir = unique_test_dir("env-small-shim");
        let usable_dir = unique_test_dir("env-usable-bundled");
        let shim = super::bundled_git_binary_path(&shim_dir);
        let usable = super::bundled_git_binary_path(&usable_dir);
        std::fs::create_dir_all(&shim_dir).expect("create shim dir");
        std::fs::create_dir_all(&usable_dir).expect("create usable dir");
        std::fs::write(&shim, b"small copied shim").expect("write copied shim");
        write_usable_git_candidate(&usable);

        let paths = super::git_env_paths_from_sources(
            vec![PathBuf::from("/existing")],
            &[shim_dir.clone(), usable_dir.clone()],
            &["/usr/bin"],
        );

        assert!(!paths.contains(&shim_dir));
        assert!(paths.contains(&usable_dir));
        assert!(paths.contains(&PathBuf::from("/usr/bin")));
    }

    #[test]
    fn git_runtime_info_reports_unavailable_error() {
        let info = super::resolve_git_binary_from_sources(&[], None, &[], |_| false)
            .map(|resolved| super::GitRuntimeInfo {
                available: true,
                source: Some(super::git_binary_source_label(resolved.source).to_string()),
                path: Some(resolved.path.to_string_lossy().to_string()),
                version: None,
                error: None,
            })
            .unwrap_or_else(|error| super::GitRuntimeInfo {
                available: false,
                source: None,
                path: None,
                version: None,
                error: Some(error),
            });

        assert!(!info.available);
        assert!(info.error.unwrap_or_default().contains("Git not found"));
    }

    #[test]
    fn system_git_preference_skips_bundled_git() {
        let bundled_dir = unique_test_dir("bundled-skipped-for-system");
        let bundled = super::bundled_git_binary_path(&bundled_dir);
        let system_git = bundled_dir.join("system-git");
        std::fs::create_dir_all(&bundled_dir).expect("create test bundled dir");
        write_usable_git_candidate(&bundled);
        write_usable_git_candidate(&system_git);

        super::set_git_runtime_preference("system");
        let resolved = super::resolve_git_binary_from_sources(
            &[bundled_dir],
            Some(system_git.clone()),
            &[],
            |path| path == bundled || path == system_git,
        )
        .expect("resolve system git");
        super::set_git_runtime_preference("auto");

        assert_eq!(resolved.path, system_git);
        assert_eq!(resolved.source, super::GitBinarySource::Path);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn bundled_git_preference_requires_usable_bundled_git() {
        let bundled_dir = unique_test_dir("bundled-unusable-strict");
        let bundled = super::bundled_git_binary_path(&bundled_dir);
        let system_git = bundled_dir.join("system-git");
        std::fs::create_dir_all(&bundled_dir).expect("create test bundled dir");
        std::fs::write(&bundled, b"small copied shim").expect("write copied shim");
        write_usable_git_candidate(&system_git);

        super::set_git_runtime_preference("bundled");
        let result = super::resolve_git_binary_from_sources(
            &[bundled_dir],
            Some(system_git.clone()),
            &[],
            |path| path == bundled || path == system_git,
        );
        super::set_git_runtime_preference("auto");

        let Err(err) = result else {
            panic!("bundled preference should not silently use system git");
        };
        assert!(err.contains("Bundled Git not found or is not usable"));
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "codex-monitor-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        dir
    }

    fn write_usable_git_candidate(path: &std::path::Path) {
        let size = {
            #[cfg(target_os = "macos")]
            {
                super::MIN_STANDALONE_GIT_BYTES + 1
            }
            #[cfg(not(target_os = "macos"))]
            {
                1
            }
        };
        std::fs::write(path, vec![0_u8; size as usize]).expect("write usable git candidate");
    }
}
