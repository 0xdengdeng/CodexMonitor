use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::codex::home::resolve_default_codex_home;
use crate::types::WorkspaceEntry;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketItem {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) categories: Vec<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) publisher: String,
    pub(crate) verified: bool,
    pub(crate) source: SkillMarketSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketSource {
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) files: Vec<SkillMarketSourceFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketSourceFile {
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) executable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SkillInstallTarget {
    Global,
    Project,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SkillMarketInstallMode {
    Install,
    Update,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketInstallInput {
    pub(crate) item_id: String,
    pub(crate) target: SkillInstallTarget,
    #[serde(default)]
    pub(crate) locale: Option<String>,
    #[serde(default)]
    pub(crate) mode: Option<SkillMarketInstallMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillUninstallInput {
    pub(crate) path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillInstallResult {
    pub(crate) ok: bool,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) path: String,
    pub(crate) target: SkillInstallTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillUninstallResult {
    pub(crate) ok: bool,
    pub(crate) path: String,
}

const DEFAULT_REGISTRY_BASE_URL: &str =
    "https://gitee.com/qihang-ai/agentdesk-capabilities/raw/main";
const REGISTRY_BASE_URL_ENV: &str = "AGENTDESK_CAPABILITY_REGISTRY_BASE_URL";
const REGISTRY_DIR_ENV: &str = "AGENTDESK_CAPABILITY_REGISTRY_DIR";
const INSTALL_METADATA_FILE: &str = ".agentdesk-install.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillInstallMetadata {
    pub(crate) schema_version: u32,
    pub(crate) id: String,
    pub(crate) version: String,
    pub(crate) target: SkillInstallTarget,
    pub(crate) source: SkillMarketSource,
    pub(crate) installed_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryCatalog {
    items: Vec<RegistryCatalogItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryCatalogItem {
    id: String,
    #[serde(rename = "type")]
    capability_type: String,
    version: String,
    title: String,
    description: String,
    categories: Vec<String>,
    tags: Vec<String>,
    publisher: String,
    source: RegistrySource,
    safety: Option<RegistrySafety>,
}

#[derive(Debug, Deserialize)]
struct RegistrySource {
    kind: String,
    path: String,
    #[serde(default)]
    files: Vec<SkillMarketSourceFile>,
}

#[derive(Debug, Deserialize)]
struct RegistrySafety {
    verified: Option<bool>,
}

fn registry_base_url() -> String {
    env::var(REGISTRY_BASE_URL_ENV)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_REGISTRY_BASE_URL.to_string())
}

fn registry_locale(locale: Option<&str>) -> &'static str {
    match locale {
        Some("en") | Some("en-US") => "en-US",
        Some("zh-CN") | None => "zh-CN",
        Some(_) => "zh-CN",
    }
}

fn validate_registry_relative_path(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Registry path must not be empty.".to_string());
    }
    if trimmed.contains('\\') {
        return Err("Registry path must use `/` separators.".to_string());
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err("Registry path must be relative.".to_string());
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let part = value
                    .to_str()
                    .ok_or_else(|| "Registry path must be valid UTF-8.".to_string())?;
                if part.is_empty() {
                    return Err("Registry path must not contain empty components.".to_string());
                }
                parts.push(part.to_string());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Registry path cannot leave the registry root.".to_string());
            }
        }
    }
    if parts.is_empty() {
        return Err("Registry path must not be empty.".to_string());
    }
    Ok(parts.join("/"))
}

fn registry_url(base_url: &str, source_path: &str, file_name: &str) -> Result<String, String> {
    let source_path = validate_registry_relative_path(source_path)?;
    let file_name = validate_registry_relative_path(file_name)?;
    Ok(format!(
        "{}/{}/{}",
        base_url.trim().trim_end_matches('/'),
        source_path,
        file_name
    ))
}

fn registry_local_path(root: &Path, source_path: &str, file_name: &str) -> Result<PathBuf, String> {
    let source_path = validate_registry_relative_path(source_path)?;
    let file_name = validate_registry_relative_path(file_name)?;
    Ok(root.join(source_path).join(file_name))
}

fn normalize_registry_files(
    files: Vec<SkillMarketSourceFile>,
) -> Result<Vec<SkillMarketSourceFile>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for file in files {
        let path = validate_registry_relative_path(&file.path)?;
        if !seen.insert(path.clone()) {
            return Err(format!("Duplicate registry file path: {path}"));
        }
        normalized.push(SkillMarketSourceFile {
            path,
            executable: file.executable,
        });
    }
    if !normalized.is_empty() && !seen.contains("SKILL.md") {
        return Err("Registry skill file list must include SKILL.md.".to_string());
    }
    Ok(normalized)
}

fn parse_skill_market_catalog(contents: &str) -> Result<Vec<SkillMarketItem>, String> {
    let catalog: RegistryCatalog = serde_json::from_str(contents)
        .map_err(|err| format!("Unable to parse skill market catalog: {err}"))?;
    catalog
        .items
        .into_iter()
        .filter(|item| item.capability_type == "skill")
        .map(|item| {
            let source_path = validate_registry_relative_path(&item.source.path)?;
            let source_files = normalize_registry_files(item.source.files)?;
            Ok(SkillMarketItem {
                name: item.id.clone(),
                id: item.id,
                version: item.version,
                title: item.title,
                description: item.description,
                categories: item.categories,
                tags: item.tags,
                publisher: item.publisher,
                verified: item
                    .safety
                    .and_then(|safety| safety.verified)
                    .unwrap_or(false),
                source: SkillMarketSource {
                    kind: item.source.kind,
                    path: source_path,
                    files: source_files,
                },
            })
        })
        .collect()
}

async fn read_registry_bytes(source_path: &str, file_name: &str) -> Result<Vec<u8>, String> {
    if let Ok(root) = env::var(REGISTRY_DIR_ENV) {
        let root = PathBuf::from(root);
        let path = registry_local_path(&root, source_path, file_name)?;
        return tokio::fs::read(&path)
            .await
            .map_err(|err| format!("Unable to read {}: {err}", path.display()));
    }

    let url = registry_url(&registry_base_url(), source_path, file_name)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| format!("Unable to create registry client: {err}"))?;
    let response = client
        .get(&url)
        .header(USER_AGENT, "AgentDesk")
        .send()
        .await
        .map_err(|err| format!("Unable to fetch skill market registry: {err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Skill market registry returned HTTP {status}"));
    }
    Ok(response
        .bytes()
        .await
        .map_err(|err| format!("Unable to read skill market registry response: {err}"))
        .map(|bytes| bytes.to_vec())?)
}

async fn read_registry_text(source_path: &str, file_name: &str) -> Result<String, String> {
    let bytes = read_registry_bytes(source_path, file_name).await?;
    String::from_utf8(bytes)
        .map_err(|err| format!("Skill market registry response is not valid UTF-8: {err}"))
}

pub(crate) async fn skill_market_catalog(
    locale: Option<String>,
) -> Result<Vec<SkillMarketItem>, String> {
    let locale = registry_locale(locale.as_deref());
    let file_name = format!("catalog.{locale}.json");
    let contents = read_registry_text("catalog", &file_name).await?;
    parse_skill_market_catalog(&contents)
}

fn validate_skill_slug(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Skill name must not be empty.".to_string());
    }
    if trimmed == ".system" || trimmed.starts_with('.') {
        return Err("Skill name cannot start with `.`.".to_string());
    }
    if trimmed.len() > 64 {
        return Err("Skill name must be 64 characters or fewer.".to_string());
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err("Skill name must not be empty.".to_string());
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return Err("Skill name must start with a lowercase letter or digit.".to_string());
    }
    if !chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-') {
        return Err("Skill name can only contain lowercase letters, numbers, and `-`.".to_string());
    }
    Ok(())
}

async fn workspace_path(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(PathBuf::from(&entry.path))
}

struct RegistryFileContents {
    path: String,
    contents: Vec<u8>,
    executable: bool,
}

fn install_metadata_for_item(
    item: &SkillMarketItem,
    target: SkillInstallTarget,
) -> SkillInstallMetadata {
    SkillInstallMetadata {
        schema_version: 1,
        id: item.id.clone(),
        version: item.version.clone(),
        target,
        source: item.source.clone(),
        installed_at: chrono::Utc::now().to_rfc3339(),
    }
}

pub(crate) fn read_skill_install_metadata(skill_path: &Path) -> Option<SkillInstallMetadata> {
    let skill_dir = skill_dir_from_path(skill_path).ok()?;
    let contents = fs::read_to_string(skill_dir.join(INSTALL_METADATA_FILE)).ok()?;
    serde_json::from_str(&contents).ok()
}

fn unique_sibling_dir(target_dir: &Path, purpose: &str) -> Result<PathBuf, String> {
    let parent = target_dir
        .parent()
        .ok_or_else(|| format!("Invalid skill target path: {}", target_dir.display()))?;
    let name = target_dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Invalid skill target path: {}", target_dir.display()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for attempt in 0..16 {
        let candidate = parent.join(format!(
            ".{name}.{purpose}-{}-{timestamp}-{attempt}",
            std::process::id()
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "Unable to allocate temporary skill path next to {}",
        target_dir.display()
    ))
}

fn validate_existing_skill_dir(
    target_dir: &Path,
    expected_metadata: &SkillInstallMetadata,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(target_dir)
        .map_err(|err| format!("Failed to read {}: {err}", target_dir.display()))?;
    if metadata.file_type().is_symlink() {
        return Err("Refusing to update a symlinked Skill.".to_string());
    }
    if !metadata.is_dir() {
        return Err("Existing skill path is not a directory.".to_string());
    }
    if !target_dir.join("SKILL.md").is_file() {
        return Err("Existing skill path does not contain SKILL.md.".to_string());
    }
    let install_metadata = read_skill_install_metadata(target_dir).ok_or_else(|| {
        "Existing skill was not installed from the market; refusing to update.".to_string()
    })?;
    if install_metadata.id != expected_metadata.id
        || install_metadata.target != expected_metadata.target
        || install_metadata.source.path != expected_metadata.source.path
    {
        return Err("Existing skill install metadata does not match this market item.".to_string());
    }
    Ok(())
}

fn promote_written_skill_dir(
    temp_dir: &Path,
    target_dir: &Path,
    replace_existing: bool,
) -> Result<(), String> {
    if !replace_existing {
        fs::rename(temp_dir, target_dir)
            .map_err(|err| format!("Failed to move skill into {}: {err}", target_dir.display()))?;
        return Ok(());
    }

    let backup_dir = unique_sibling_dir(target_dir, "backup")?;
    fs::rename(target_dir, &backup_dir)
        .map_err(|err| format!("Failed to prepare existing skill for update: {err}"))?;

    match fs::rename(temp_dir, target_dir) {
        Ok(()) => {
            let _ = fs::remove_dir_all(&backup_dir);
            Ok(())
        }
        Err(err) => {
            let _ = fs::rename(&backup_dir, target_dir);
            Err(format!(
                "Failed to replace skill at {}: {err}",
                target_dir.display()
            ))
        }
    }
}

fn write_skill_dir(
    target_dir: &Path,
    files: Vec<RegistryFileContents>,
    mode: SkillMarketInstallMode,
    metadata: &SkillInstallMetadata,
) -> Result<PathBuf, String> {
    let target_exists = target_dir.exists();
    let replace_existing = mode == SkillMarketInstallMode::Update && target_exists;
    if target_exists {
        if !replace_existing {
            return Err("Skill is already installed.".to_string());
        }
        validate_existing_skill_dir(target_dir, metadata)?;
    }

    let parent = target_dir
        .parent()
        .ok_or_else(|| format!("Invalid skill target path: {}", target_dir.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    let temp_dir = unique_sibling_dir(target_dir, "installing")?;
    fs::create_dir_all(&temp_dir)
        .map_err(|err| format!("Failed to create {}: {err}", temp_dir.display()))?;
    let write_result = (|| {
        for file in files {
            let relative_path = validate_registry_relative_path(&file.path)?;
            let output_path = temp_dir.join(relative_path);
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
            }
            fs::write(&output_path, file.contents)
                .map_err(|err| format!("Failed to write {}: {err}", output_path.display()))?;
            if file.executable {
                set_executable(&output_path)?;
            }
        }
        let metadata_path = temp_dir.join(INSTALL_METADATA_FILE);
        let metadata = serde_json::to_vec_pretty(metadata)
            .map_err(|err| format!("Failed to encode skill install metadata: {err}"))?;
        fs::write(&metadata_path, metadata)
            .map_err(|err| format!("Failed to write {}: {err}", metadata_path.display()))?;
        Ok::<(), String>(())
    })();
    if let Err(err) = write_result {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(err);
    }
    let temp_skill_path = temp_dir.join("SKILL.md");
    if !temp_skill_path.is_file() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("Installed skill package did not contain SKILL.md.".to_string());
    }
    if let Err(err) = promote_written_skill_dir(&temp_dir, target_dir, replace_existing) {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(err);
    }
    let skill_path = target_dir.join("SKILL.md");
    Ok(skill_path)
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata =
        fs::metadata(path).map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(path, permissions)
        .map_err(|err| format!("Failed to set executable bit on {}: {err}", path.display()))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) async fn skill_market_install_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: Option<String>,
    input: SkillMarketInstallInput,
) -> Result<SkillInstallResult, String> {
    let item = skill_market_catalog(input.locale.clone())
        .await?
        .into_iter()
        .find(|item| item.id == input.item_id)
        .ok_or_else(|| format!("Skill market item not found: {}", input.item_id))?;
    if item.source.kind != "repo" {
        return Err(format!(
            "Unsupported skill market source type: {}",
            item.source.kind
        ));
    }
    validate_skill_slug(&item.name)?;
    let source_files = if item.source.files.is_empty() {
        vec![SkillMarketSourceFile {
            path: "SKILL.md".to_string(),
            executable: false,
        }]
    } else {
        item.source.files.clone()
    };
    let mut package_files = Vec::with_capacity(source_files.len());
    for file in source_files {
        let contents = read_registry_bytes(&item.source.path, &file.path).await?;
        package_files.push(RegistryFileContents {
            path: file.path,
            contents,
            executable: file.executable,
        });
    }

    let skills_root = match input.target {
        SkillInstallTarget::Global => resolve_default_codex_home()
            .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())?
            .join("skills"),
        SkillInstallTarget::Project => {
            let workspace_id = workspace_id
                .ok_or_else(|| "workspaceId is required for project install".to_string())?;
            workspace_path(workspaces, workspace_id.as_str())
                .await?
                .join(".agents")
                .join("skills")
        }
    };

    let target_dir = skills_root.join(&item.name);
    let mode = input.mode.unwrap_or(SkillMarketInstallMode::Install);
    let metadata = install_metadata_for_item(&item, input.target);
    let skill_path = write_skill_dir(&target_dir, package_files, mode, &metadata)?;

    Ok(SkillInstallResult {
        ok: true,
        name: item.name,
        version: item.version,
        path: skill_path.to_string_lossy().to_string(),
        target: input.target,
    })
}

fn skill_dir_from_path(path: &Path) -> Result<PathBuf, String> {
    let trimmed = path.as_os_str();
    if trimmed.is_empty() {
        return Err("Skill path must not be empty.".to_string());
    }
    if path.file_name().and_then(|value| value.to_str()) == Some("SKILL.md") {
        return path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("Invalid Skill path: {}", path.display()));
    }
    Ok(path.to_path_buf())
}

fn relative_first_component(path: &Path) -> Option<String> {
    path.components().find_map(|component| match component {
        Component::Normal(value) => value.to_str().map(str::to_string),
        _ => None,
    })
}

fn validate_uninstall_target(skill_dir: &Path, allowed_roots: &[PathBuf]) -> Result<(), String> {
    let metadata = fs::symlink_metadata(skill_dir)
        .map_err(|err| format!("Failed to read {}: {err}", skill_dir.display()))?;
    if metadata.file_type().is_symlink() {
        return Err("Refusing to uninstall a symlinked Skill.".to_string());
    }
    if !metadata.is_dir() {
        return Err("Skill uninstall target must be a directory.".to_string());
    }
    if !skill_dir.join("SKILL.md").is_file() {
        return Err("Skill uninstall target must contain SKILL.md.".to_string());
    }

    let canonical_skill_dir = fs::canonicalize(skill_dir)
        .map_err(|err| format!("Failed to resolve {}: {err}", skill_dir.display()))?;

    for root in allowed_roots {
        if !root.exists() {
            continue;
        }
        let canonical_root = fs::canonicalize(root)
            .map_err(|err| format!("Failed to resolve {}: {err}", root.display()))?;
        if !canonical_skill_dir.starts_with(&canonical_root) {
            continue;
        }
        let relative = canonical_skill_dir
            .strip_prefix(&canonical_root)
            .map_err(|err| err.to_string())?;
        if relative_first_component(relative).as_deref() == Some(".system") {
            return Err("Built-in Skills cannot be uninstalled.".to_string());
        }
        return Ok(());
    }

    Err("Skill uninstall is limited to installed global or project Skills.".to_string())
}

pub(crate) fn is_skill_uninstall_target_allowed(path: &str, allowed_roots: &[PathBuf]) -> bool {
    let Ok(skill_dir) = skill_dir_from_path(Path::new(path.trim())) else {
        return false;
    };
    validate_uninstall_target(&skill_dir, allowed_roots).is_ok()
}

pub(crate) async fn skill_uninstall_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: Option<String>,
    input: SkillUninstallInput,
) -> Result<SkillUninstallResult, String> {
    let skill_dir = skill_dir_from_path(Path::new(input.path.trim()))?;
    let mut allowed_roots = Vec::new();
    if let Some(codex_home) = resolve_default_codex_home() {
        allowed_roots.push(codex_home.join("skills"));
    }
    if let Some(workspace_id) = workspace_id {
        allowed_roots.push(
            workspace_path(workspaces, workspace_id.as_str())
                .await?
                .join(".agents")
                .join("skills"),
        );
    }
    validate_uninstall_target(&skill_dir, &allowed_roots)?;

    fs::remove_dir_all(&skill_dir)
        .map_err(|err| format!("Failed to remove {}: {err}", skill_dir.display()))?;

    Ok(SkillUninstallResult {
        ok: true,
        path: skill_dir.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Mutex as StdMutex, MutexGuard};

    static ENV_LOCK: StdMutex<()> = StdMutex::new(());

    struct CodexHomeEnvGuard {
        previous: Option<String>,
        previous_registry_dir: Option<String>,
        previous_registry_base_url: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl CodexHomeEnvGuard {
        fn set(path: &Path) -> Self {
            Self::set_inner(path, None)
        }

        fn set_with_registry(path: &Path, registry_dir: &Path) -> Self {
            Self::set_inner(path, Some(registry_dir))
        }

        fn set_inner(path: &Path, registry_dir: Option<&Path>) -> Self {
            let lock = ENV_LOCK.lock().expect("lock CODEX_HOME env");
            let previous = std::env::var("CODEX_HOME").ok();
            let previous_registry_dir = std::env::var(REGISTRY_DIR_ENV).ok();
            let previous_registry_base_url = std::env::var(REGISTRY_BASE_URL_ENV).ok();
            std::env::set_var("CODEX_HOME", path);
            std::env::remove_var(REGISTRY_BASE_URL_ENV);
            match registry_dir {
                Some(path) => std::env::set_var(REGISTRY_DIR_ENV, path),
                None => std::env::remove_var(REGISTRY_DIR_ENV),
            }
            Self {
                previous,
                previous_registry_dir,
                previous_registry_base_url,
                _lock: lock,
            }
        }
    }

    impl Drop for CodexHomeEnvGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var("CODEX_HOME", value),
                None => std::env::remove_var("CODEX_HOME"),
            }
            match &self.previous_registry_dir {
                Some(value) => std::env::set_var(REGISTRY_DIR_ENV, value),
                None => std::env::remove_var(REGISTRY_DIR_ENV),
            }
            match &self.previous_registry_base_url {
                Some(value) => std::env::set_var(REGISTRY_BASE_URL_ENV, value),
                None => std::env::remove_var(REGISTRY_BASE_URL_ENV),
            }
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "agentdesk-skill-market-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn registry_fixture() -> PathBuf {
        let root = temp_dir("registry");
        let catalog_dir = root.join("catalog");
        let skill_dir = root.join("skills").join("docs-writer");
        fs::create_dir_all(&catalog_dir).expect("create catalog dir");
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let catalog = r#"{
          "schemaVersion": 1,
          "locale": "zh-CN",
          "updatedAt": "2026-05-20",
          "items": [
            {
              "id": "docs-writer",
              "type": "skill",
              "version": "0.1.0",
              "title": "文档写手",
              "description": "帮助撰写 README、帮助文档、发布说明和使用指南。",
              "publisher": "AgentDesk",
              "categories": ["writing", "productivity"],
              "tags": ["docs", "readme", "writing"],
              "installTargets": ["global", "project"],
              "source": { "kind": "repo", "path": "skills/docs-writer" },
              "safety": { "verified": true, "risk": "low" }
            }
          ]
        }"#;
        fs::write(catalog_dir.join("catalog.zh-CN.json"), catalog).expect("write zh catalog");
        fs::write(catalog_dir.join("catalog.en-US.json"), catalog).expect("write en catalog");
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: docs-writer\ndescription: Draft docs.\n---\n\nWrite docs.\n",
        )
        .expect("write skill");
        root
    }

    fn registry_fixture_with_supporting_files() -> PathBuf {
        let root = temp_dir("registry-files");
        let catalog_dir = root.join("catalog");
        let skill_dir = root.join("skills").join("deep-skill");
        fs::create_dir_all(&catalog_dir).expect("create catalog dir");
        fs::create_dir_all(skill_dir.join("references")).expect("create references dir");
        fs::create_dir_all(skill_dir.join("assets")).expect("create assets dir");
        let catalog = r#"{
          "schemaVersion": 1,
          "locale": "zh-CN",
          "updatedAt": "2026-05-20",
          "items": [
            {
              "id": "deep-skill",
              "type": "skill",
              "version": "0.1.0",
              "title": "Deep Skill",
              "description": "Installs support files.",
              "publisher": "AgentDesk",
              "categories": ["engineering"],
              "tags": ["docs"],
              "installTargets": ["global", "project"],
              "source": {
                "kind": "repo",
                "path": "skills/deep-skill",
                "files": [
                  { "path": "SKILL.md" },
                  { "path": "references/guide.md" },
                  { "path": "assets/logo.bin" }
                ]
              },
              "safety": { "verified": true, "risk": "low" }
            }
          ]
        }"#;
        fs::write(catalog_dir.join("catalog.zh-CN.json"), catalog).expect("write zh catalog");
        fs::write(catalog_dir.join("catalog.en-US.json"), catalog).expect("write en catalog");
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deep-skill\ndescription: Deep skill.\n---\n",
        )
        .expect("write skill");
        fs::write(
            skill_dir.join("references").join("guide.md"),
            "Read the guide.",
        )
        .expect("write reference");
        fs::write(skill_dir.join("assets").join("logo.bin"), [0, 1, 2, 3]).expect("write asset");
        root
    }

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime")
            .block_on(future)
    }

    fn workspace_entry(id: &str, path: PathBuf) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: "Test Workspace".to_string(),
            path: path.to_string_lossy().to_string(),
            kind: crate::types::WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: crate::types::WorkspaceSettings::default(),
        }
    }

    #[test]
    fn catalog_contains_beginner_friendly_skills() {
        let codex_home = temp_dir("catalog-home");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);

        let catalog =
            block_on(skill_market_catalog(Some("zh-CN".to_string()))).expect("load catalog");

        assert!(catalog.iter().any(|item| item.id == "docs-writer"));
        assert!(catalog.iter().all(|item| item.verified));
        assert!(catalog.iter().all(|item| !item.title.trim().is_empty()));
    }

    #[test]
    fn registry_catalog_parses_skill_items_and_skips_other_capability_types() {
        let catalog = r#"{
          "schemaVersion": 1,
          "locale": "zh-CN",
          "updatedAt": "2026-05-20",
          "items": [
            {
              "id": "docs-writer",
              "type": "skill",
              "version": "0.1.0",
              "title": "文档写手",
              "description": "帮助撰写 README。",
              "publisher": "AgentDesk",
              "categories": ["writing"],
              "tags": ["docs"],
              "installTargets": ["global", "project"],
              "source": { "kind": "repo", "path": "skills/docs-writer" },
              "safety": { "verified": true, "risk": "low" }
            },
            {
              "id": "github",
              "type": "mcp",
              "version": "0.1.0",
              "title": "GitHub MCP",
              "description": "连接 GitHub。",
              "publisher": "AgentDesk",
              "categories": ["engineering"],
              "tags": ["github"],
              "installTargets": ["global"],
              "source": { "kind": "repo", "path": "mcp/github" },
              "safety": { "verified": true, "risk": "medium" }
            }
          ]
        }"#;

        let items = parse_skill_market_catalog(catalog).expect("parse registry catalog");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "docs-writer");
        assert_eq!(items[0].version, "0.1.0");
        assert_eq!(items[0].title, "文档写手");
        assert_eq!(items[0].source.kind, "repo");
        assert_eq!(items[0].source.path, "skills/docs-writer");
    }

    #[test]
    fn registry_source_paths_reject_absolute_and_parent_components() {
        assert!(registry_url(
            "https://example.test/root",
            "skills/docs-writer",
            "SKILL.md"
        )
        .is_ok());
        assert!(registry_url("https://example.test/root", "../secrets", "SKILL.md").is_err());
        assert!(registry_url("https://example.test/root", "/tmp/skill", "SKILL.md").is_err());
        assert!(
            registry_url("https://example.test/root", "skills/../secrets", "SKILL.md").is_err()
        );
    }

    #[test]
    fn validate_skill_slug_rejects_path_traversal() {
        assert!(validate_skill_slug("../bad").is_err());
        assert!(validate_skill_slug("bad/name").is_err());
        assert!(validate_skill_slug(".system").is_err());
        assert!(validate_skill_slug("docs-writer").is_ok());
    }

    #[test]
    fn install_global_skill_writes_under_managed_codex_home() {
        let codex_home = temp_dir("global");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let workspaces = Mutex::new(HashMap::new());

        let result = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: None,
            },
        ))
        .expect("install global skill");

        let skill_path = codex_home
            .join("skills")
            .join("docs-writer")
            .join("SKILL.md");
        assert_eq!(result.path, skill_path.to_string_lossy());
        assert!(skill_path.exists());
        assert!(fs::read_to_string(skill_path)
            .expect("read skill")
            .contains("name: docs-writer"));
        let metadata_path = codex_home
            .join("skills")
            .join("docs-writer")
            .join(".agentdesk-install.json");
        let metadata: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(metadata_path).expect("read install metadata"),
        )
        .expect("parse install metadata");
        assert_eq!(metadata["id"], "docs-writer");
        assert_eq!(metadata["version"], "0.1.0");
        assert_eq!(metadata["target"], "global");
        assert_eq!(metadata["source"]["path"], "skills/docs-writer");
    }

    #[test]
    fn install_global_skill_writes_declared_supporting_files() {
        let codex_home = temp_dir("global-files");
        let registry = registry_fixture_with_supporting_files();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let workspaces = Mutex::new(HashMap::new());

        let result = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "deep-skill".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: None,
            },
        ))
        .expect("install global skill with supporting files");

        let skill_dir = codex_home.join("skills").join("deep-skill");
        assert_eq!(
            result.path,
            skill_dir.join("SKILL.md").to_string_lossy().to_string()
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("references").join("guide.md"))
                .expect("read installed reference"),
            "Read the guide."
        );
        assert_eq!(
            fs::read(skill_dir.join("assets").join("logo.bin")).expect("read installed asset"),
            vec![0, 1, 2, 3]
        );
    }

    #[test]
    fn install_project_skill_writes_under_workspace_agents_skills() {
        let workspace_root = temp_dir("project");
        let codex_home = temp_dir("project-codex-home");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let mut entries = HashMap::new();
        entries.insert(
            "workspace-1".to_string(),
            workspace_entry("workspace-1", workspace_root.clone()),
        );
        let workspaces = Mutex::new(entries);

        let result = block_on(skill_market_install_core(
            &workspaces,
            Some("workspace-1".to_string()),
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Project,
                locale: None,
                mode: None,
            },
        ))
        .expect("install project skill");

        let skill_path = workspace_root
            .join(".agents")
            .join("skills")
            .join("docs-writer")
            .join("SKILL.md");
        assert_eq!(result.path, skill_path.to_string_lossy());
        assert!(skill_path.exists());
    }

    #[test]
    fn install_refuses_to_overwrite_existing_skill() {
        let codex_home = temp_dir("overwrite");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let existing = codex_home.join("skills").join("docs-writer");
        fs::create_dir_all(&existing).expect("create existing skill");
        fs::write(existing.join("SKILL.md"), "existing").expect("write existing skill");
        let workspaces = Mutex::new(HashMap::new());

        let err = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: None,
            },
        ))
        .expect_err("reject overwrite");

        assert!(err.contains("already installed"));
    }

    #[test]
    fn update_existing_skill_replaces_existing_skill_dir() {
        let codex_home = temp_dir("update");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let existing = codex_home.join("skills").join("docs-writer");
        let workspaces = Mutex::new(HashMap::new());
        block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: None,
            },
        ))
        .expect("install managed skill");
        fs::write(existing.join("stale.txt"), "stale").expect("write stale file");

        let result = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: Some(SkillMarketInstallMode::Update),
            },
        ))
        .expect("update existing skill");

        let skill_path = existing.join("SKILL.md");
        assert_eq!(result.path, skill_path.to_string_lossy());
        assert!(fs::read_to_string(skill_path)
            .expect("read updated skill")
            .contains("name: docs-writer"));
        assert!(!existing.join("stale.txt").exists());
    }

    #[test]
    fn update_refuses_unmanaged_existing_skill() {
        let codex_home = temp_dir("update-unmanaged");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let existing = codex_home.join("skills").join("docs-writer");
        fs::create_dir_all(&existing).expect("create existing skill");
        fs::write(existing.join("SKILL.md"), "existing").expect("write existing skill");
        let workspaces = Mutex::new(HashMap::new());

        let err = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: Some(SkillMarketInstallMode::Update),
            },
        ))
        .expect_err("unmanaged skill update should fail");

        assert!(err.contains("not installed from the market"));
        assert_eq!(
            fs::read_to_string(existing.join("SKILL.md")).expect("read existing skill"),
            "existing"
        );
    }

    #[test]
    fn update_mode_installs_when_target_skill_is_missing() {
        let codex_home = temp_dir("update-missing");
        let registry = registry_fixture();
        let _env = CodexHomeEnvGuard::set_with_registry(&codex_home, &registry);
        let workspaces = Mutex::new(HashMap::new());

        let result = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
                locale: None,
                mode: Some(SkillMarketInstallMode::Update),
            },
        ))
        .expect("install missing skill through update mode");

        let skill_path = codex_home
            .join("skills")
            .join("docs-writer")
            .join("SKILL.md");
        assert_eq!(result.path, skill_path.to_string_lossy());
        assert!(skill_path.exists());
    }

    #[test]
    fn uninstall_rejects_builtin_system_skill() {
        let codex_home = temp_dir("system");
        let _env = CodexHomeEnvGuard::set(&codex_home);
        let system_skill = codex_home
            .join("skills")
            .join(".system")
            .join("imagegen")
            .join("SKILL.md");
        fs::create_dir_all(system_skill.parent().expect("system skill parent"))
            .expect("create system skill");
        fs::write(&system_skill, "system").expect("write system skill");
        let workspaces = Mutex::new(HashMap::new());

        let err = block_on(skill_uninstall_core(
            &workspaces,
            None,
            SkillUninstallInput {
                path: system_skill.to_string_lossy().to_string(),
            },
        ))
        .expect_err("reject system uninstall");

        assert!(err.to_ascii_lowercase().contains("built-in"));
        assert!(system_skill.exists());
    }

    #[test]
    fn uninstall_rejects_directory_without_skill_file() {
        let codex_home = temp_dir("non-skill");
        let _env = CodexHomeEnvGuard::set(&codex_home);
        let directory = codex_home.join("skills").join("notes");
        fs::create_dir_all(&directory).expect("create non-skill directory");
        let workspaces = Mutex::new(HashMap::new());

        let err = block_on(skill_uninstall_core(
            &workspaces,
            None,
            SkillUninstallInput {
                path: directory.to_string_lossy().to_string(),
            },
        ))
        .expect_err("reject non-skill directory");

        assert!(err.contains("SKILL.md"));
        assert!(directory.exists());
    }
}
