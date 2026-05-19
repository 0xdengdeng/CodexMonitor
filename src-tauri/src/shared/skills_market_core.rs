use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::codex::home::resolve_default_codex_home;
use crate::types::WorkspaceEntry;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketItem {
    pub(crate) id: String,
    pub(crate) name: String,
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
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SkillInstallTarget {
    Global,
    Project,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillMarketInstallInput {
    pub(crate) item_id: String,
    pub(crate) target: SkillInstallTarget,
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
    pub(crate) path: String,
    pub(crate) target: SkillInstallTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillUninstallResult {
    pub(crate) ok: bool,
    pub(crate) path: String,
}

struct BundledSkill {
    item: SkillMarketItem,
    skill_md: &'static str,
}

fn bundled_skills() -> Vec<BundledSkill> {
    vec![
        BundledSkill {
            item: SkillMarketItem {
                id: "docs-writer".to_string(),
                name: "docs-writer".to_string(),
                title: "Docs Writer".to_string(),
                description: "Draft READMEs, help docs, release notes, and usage guides.".to_string(),
                categories: vec!["writing".to_string(), "productivity".to_string()],
                tags: vec!["docs".to_string(), "readme".to_string(), "writing".to_string()],
                publisher: "AgentDesk".to_string(),
                verified: true,
                source: SkillMarketSource {
                    kind: "bundled".to_string(),
                },
            },
            skill_md: r#"---
name: docs-writer
description: Draft READMEs, help docs, release notes, and usage guides from rough notes or code context.
---

Use this skill when the user asks for product documentation, README updates, setup guides, release notes, changelogs, or clearer usage instructions.

Prefer concise structure, concrete examples, and copy that a new user can follow without knowing the implementation details.
"#,
        },
        BundledSkill {
            item: SkillMarketItem {
                id: "code-review-assistant".to_string(),
                name: "code-review-assistant".to_string(),
                title: "Code Review Assistant".to_string(),
                description: "Review code changes for bugs, regressions, and missing tests.".to_string(),
                categories: vec!["engineering".to_string()],
                tags: vec!["review".to_string(), "tests".to_string(), "quality".to_string()],
                publisher: "AgentDesk".to_string(),
                verified: true,
                source: SkillMarketSource {
                    kind: "bundled".to_string(),
                },
            },
            skill_md: r#"---
name: code-review-assistant
description: Review code changes for correctness, regressions, maintainability, and missing tests.
---

Use this skill when the user asks for a code review or wants risks checked before shipping. Lead with findings, include file and line references when available, and keep summaries secondary.
"#,
        },
        BundledSkill {
            item: SkillMarketItem {
                id: "image-brief".to_string(),
                name: "image-brief".to_string(),
                title: "Image Brief".to_string(),
                description: "Turn rough visual ideas into clear image generation briefs.".to_string(),
                categories: vec!["design".to_string(), "images".to_string()],
                tags: vec!["image".to_string(), "prompt".to_string(), "design".to_string()],
                publisher: "AgentDesk".to_string(),
                verified: true,
                source: SkillMarketSource {
                    kind: "bundled".to_string(),
                },
            },
            skill_md: r#"---
name: image-brief
description: Turn rough visual ideas into clear image generation briefs with subject, style, composition, and constraints.
---

Use this skill when the user wants an image prompt, visual direction, product mockup brief, poster concept, or creative art direction before generating or editing an image.
"#,
        },
        BundledSkill {
            item: SkillMarketItem {
                id: "content-ideas".to_string(),
                name: "content-ideas".to_string(),
                title: "Content Ideas".to_string(),
                description: "Generate practical content topics, outlines, hooks, and titles.".to_string(),
                categories: vec!["writing".to_string()],
                tags: vec!["content".to_string(), "topics".to_string(), "outline".to_string()],
                publisher: "AgentDesk".to_string(),
                verified: true,
                source: SkillMarketSource {
                    kind: "bundled".to_string(),
                },
            },
            skill_md: r#"---
name: content-ideas
description: Generate practical content topics, outlines, hooks, and titles for creator workflows.
---

Use this skill when the user wants content ideas, topic selection, article outlines, hooks, or title options. Keep suggestions specific, actionable, and matched to the user's platform.
"#,
        },
    ]
}

pub(crate) fn skill_market_catalog() -> Vec<SkillMarketItem> {
    bundled_skills()
        .into_iter()
        .map(|entry| entry.item)
        .collect()
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
        return Err(
            "Skill name can only contain lowercase letters, numbers, and `-`.".to_string(),
        );
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

fn find_bundled_skill(item_id: &str) -> Result<BundledSkill, String> {
    bundled_skills()
        .into_iter()
        .find(|entry| entry.item.id == item_id)
        .ok_or_else(|| format!("Skill market item not found: {item_id}"))
}

fn write_skill_dir(target_dir: &Path, skill_md: &str) -> Result<PathBuf, String> {
    if target_dir.exists() {
        return Err("Skill is already installed.".to_string());
    }
    fs::create_dir_all(target_dir)
        .map_err(|err| format!("Failed to create {}: {err}", target_dir.display()))?;
    let skill_path = target_dir.join("SKILL.md");
    fs::write(&skill_path, skill_md)
        .map_err(|err| format!("Failed to write {}: {err}", skill_path.display()))?;
    Ok(skill_path)
}

pub(crate) async fn skill_market_install_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: Option<String>,
    input: SkillMarketInstallInput,
) -> Result<SkillInstallResult, String> {
    let bundled = find_bundled_skill(input.item_id.as_str())?;
    validate_skill_slug(&bundled.item.name)?;

    let skills_root = match input.target {
        SkillInstallTarget::Global => resolve_default_codex_home()
            .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())?
            .join("skills"),
        SkillInstallTarget::Project => {
            let workspace_id =
                workspace_id.ok_or_else(|| "workspaceId is required for project install".to_string())?;
            workspace_path(workspaces, workspace_id.as_str())
                .await?
                .join(".agents")
                .join("skills")
        }
    };

    let target_dir = skills_root.join(&bundled.item.name);
    let skill_path = write_skill_dir(&target_dir, bundled.skill_md)?;

    Ok(SkillInstallResult {
        ok: true,
        name: bundled.item.name,
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
        _lock: MutexGuard<'static, ()>,
    }

    impl CodexHomeEnvGuard {
        fn set(path: &Path) -> Self {
            let lock = ENV_LOCK.lock().expect("lock CODEX_HOME env");
            let previous = std::env::var("CODEX_HOME").ok();
            std::env::set_var("CODEX_HOME", path);
            Self {
                previous,
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
        let catalog = skill_market_catalog();

        assert!(catalog.iter().any(|item| item.id == "docs-writer"));
        assert!(catalog.iter().all(|item| item.verified));
        assert!(catalog.iter().all(|item| !item.title.trim().is_empty()));
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
        let _env = CodexHomeEnvGuard::set(&codex_home);
        let workspaces = Mutex::new(HashMap::new());

        let result = block_on(skill_market_install_core(
            &workspaces,
            None,
            SkillMarketInstallInput {
                item_id: "docs-writer".to_string(),
                target: SkillInstallTarget::Global,
            },
        ))
        .expect("install global skill");

        let skill_path = codex_home.join("skills").join("docs-writer").join("SKILL.md");
        assert_eq!(result.path, skill_path.to_string_lossy());
        assert!(skill_path.exists());
        assert!(fs::read_to_string(skill_path)
            .expect("read skill")
            .contains("name: docs-writer"));
    }

    #[test]
    fn install_project_skill_writes_under_workspace_agents_skills() {
        let workspace_root = temp_dir("project");
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
        let _env = CodexHomeEnvGuard::set(&codex_home);
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
            },
        ))
        .expect_err("reject overwrite");

        assert!(err.contains("already installed"));
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
