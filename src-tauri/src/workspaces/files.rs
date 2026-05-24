use std::fs::{File, Metadata};
use std::io::Read;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::files::io::write_text_file_within;
use crate::utils::normalize_git_path;

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "dist" | "target" | "release-artifacts"
    )
}

pub(crate) fn list_workspace_files_inner(root: &PathBuf, max_files: usize) -> Vec<String> {
    let mut results = Vec::new();
    let walker = WalkBuilder::new(root)
        // Allow hidden entries.
        .hidden(false)
        // Avoid crawling symlink targets.
        .follow_links(false)
        // Don't require git to be present to apply to apply git-related ignore rules.
        .require_git(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                let name = entry.file_name().to_string_lossy();
                return !should_skip_dir(&name);
            }
            true
        })
        .build();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        if let Ok(rel_path) = entry.path().strip_prefix(root) {
            let normalized = normalize_git_path(&rel_path.to_string_lossy());
            if !normalized.is_empty() {
                results.push(normalized);
            }
        }
        if results.len() >= max_files {
            break;
        }
    }

    results.sort();
    results
}

const MAX_WORKSPACE_FILE_BYTES: u64 = 400_000;

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceFileResponse {
    content: String,
    truncated: bool,
    revision: String,
}

fn workspace_file_revision(metadata: &Metadata, truncated: bool, content: &[u8]) -> String {
    let digest = Sha256::digest(content);
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        "sha256:{digest:x}:len:{}:mtime:{modified_nanos}:truncated:{truncated}",
        metadata.len()
    )
}

pub(crate) fn read_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
) -> Result<WorkspaceFileResponse, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve workspace root: {err}"))?;
    let candidate = canonical_root.join(relative_path);
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Invalid file path".to_string());
    }
    let metadata = std::fs::metadata(&canonical_path)
        .map_err(|err| format!("Failed to read file metadata: {err}"))?;
    if !metadata.is_file() {
        return Err("Path is not a file".to_string());
    }

    let file = File::open(&canonical_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut buffer = Vec::new();
    file.take(MAX_WORKSPACE_FILE_BYTES + 1)
        .read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read file: {err}"))?;

    let truncated = buffer.len() > MAX_WORKSPACE_FILE_BYTES as usize;
    if truncated {
        buffer.truncate(MAX_WORKSPACE_FILE_BYTES as usize);
    }

    let revision = workspace_file_revision(&metadata, truncated, &buffer);
    let content = String::from_utf8(buffer).map_err(|_| "File is not valid UTF-8".to_string())?;
    Ok(WorkspaceFileResponse {
        content,
        truncated,
        revision,
    })
}

pub(crate) fn write_workspace_file_inner(
    root: &PathBuf,
    relative_path: &str,
    content: &str,
    expected_revision: Option<&str>,
) -> Result<(), String> {
    let expected_revision = expected_revision
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Missing expected file revision.".to_string())?;
    let current = read_workspace_file_inner(root, relative_path)?;
    if current.truncated {
        return Err("File is too large to save from the preview editor.".to_string());
    }
    if current.revision != expected_revision {
        return Err("File changed on disk. Reload before saving.".to_string());
    }
    write_text_file_within(
        root,
        relative_path,
        content,
        false,
        "workspace root",
        "workspace file",
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::{read_workspace_file_inner, write_workspace_file_inner, MAX_WORKSPACE_FILE_BYTES};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "codex-monitor-{prefix}-{}-{nanos}",
            std::process::id()
        ))
    }

    #[test]
    fn write_workspace_file_rejects_stale_revision() {
        let root = temp_dir("workspace-file-stale");
        fs::create_dir_all(&root).expect("create temp root");
        let file_path = root.join("notes.md");
        fs::write(&file_path, "original").expect("write original file");

        let initial = read_workspace_file_inner(&root, "notes.md").expect("read initial file");
        fs::write(&file_path, "external update").expect("write external update");

        let err =
            write_workspace_file_inner(&root, "notes.md", "editor update", Some(&initial.revision))
                .expect_err("stale revision should fail");

        assert!(err.contains("changed on disk"));
        assert_eq!(
            fs::read_to_string(&file_path).expect("read preserved file"),
            "external update"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_workspace_file_rejects_append_past_preview_limit() {
        let root = temp_dir("workspace-file-append");
        fs::create_dir_all(&root).expect("create temp root");
        let file_path = root.join("large.txt");
        let original = "a".repeat(MAX_WORKSPACE_FILE_BYTES as usize);
        fs::write(&file_path, original).expect("write original file");

        let initial = read_workspace_file_inner(&root, "large.txt").expect("read initial file");
        assert!(!initial.truncated);
        fs::write(
            &file_path,
            format!("{}tail", "a".repeat(MAX_WORKSPACE_FILE_BYTES as usize)),
        )
        .expect("append beyond preview limit");

        let err = write_workspace_file_inner(
            &root,
            "large.txt",
            "editor update",
            Some(&initial.revision),
        )
        .expect_err("append past preview limit should fail");

        assert!(
            err.contains("too large") || err.contains("changed on disk"),
            "unexpected error: {err}"
        );
        assert_eq!(
            fs::metadata(&file_path).expect("read metadata").len(),
            MAX_WORKSPACE_FILE_BYTES + 4
        );

        let _ = fs::remove_dir_all(root);
    }
}
