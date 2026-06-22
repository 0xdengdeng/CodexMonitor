use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::oneshot::error::TryRecvError;
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;
use tokio::time::Instant;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::config as codex_config;
use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::rules;
use crate::shared::account::{build_account_response, read_auth_account};
use crate::shared::config_toml_core;
use crate::shared::runtime_config_core::{
    effective_managed_runtime_model, managed_runtime_config_is_complete,
    DEFAULT_MANAGED_RUNTIME_MODEL, MANAGED_RUNTIME_PROVIDER_ID,
};
use crate::shared::skills_market_core;
use crate::types::{AppSettings, ManagedRuntimeConfig, WorkspaceEntry};

const LOGIN_START_TIMEOUT: Duration = Duration::from_secs(30);
#[allow(dead_code)]
const MAX_INLINE_IMAGE_BYTES: u64 = 50 * 1024 * 1024;
const THREAD_LIST_SOURCE_KINDS: &[&str] = &[
    "cli",
    "vscode",
    "appServer",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "unknown",
];

fn build_thread_list_params(
    cursor: Option<String>,
    limit: Option<u32>,
    sort_key: Option<String>,
) -> Value {
    json!({
        "cursor": cursor,
        "limit": limit,
        "sortKey": sort_key,
        // Keep historical conversations visible when the active account/runtime
        // changes. Upstream treats an empty provider list as "all providers".
        "modelProviders": [],
        // Keep interactive and sub-agent sessions visible across CLI versions so
        // thread/list refreshes do not drop valid historical conversations.
        // Intentionally exclude generic "subAgent" so parentless internal jobs
        // (for example memory consolidation) do not leak back into app state.
        "sourceKinds": THREAD_LIST_SOURCE_KINDS
    })
}

fn build_skills_list_params(workspace_path: String, extra_user_roots: Vec<String>) -> Value {
    let mut params = Map::new();
    params.insert("cwds".to_string(), json!([workspace_path.clone()]));
    params.insert("forceReload".to_string(), json!(true));

    if !extra_user_roots.is_empty() {
        params.insert(
            "perCwdExtraUserRoots".to_string(),
            json!([{
                "cwd": workspace_path,
                "extraUserRoots": extra_user_roots,
            }]),
        );
    }

    Value::Object(params)
}

#[allow(dead_code)]
fn image_extension_for_path(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

#[allow(dead_code)]
fn image_mime_type_for_path(path: &str) -> Option<&'static str> {
    let extension = image_extension_for_path(path)?;
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "tiff" | "tif" => Some("image/tiff"),
        _ => None,
    }
}

#[allow(dead_code)]
fn should_inline_image_path_for_codex(path: &str) -> bool {
    matches!(
        image_extension_for_path(path).as_deref(),
        Some("heic") | Some("heif")
    )
}

#[cfg(target_os = "macos")]
fn temp_converted_image_path(path: &str, extension: &str) -> PathBuf {
    let stem = Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let safe_stem = stem
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("codex-monitor-image-{safe_stem}-{ts}.{extension}"))
}

#[cfg(target_os = "macos")]
fn convert_heif_image_to_jpeg_bytes(path: &str) -> Result<Vec<u8>, String> {
    let output_path = temp_converted_image_path(path, "jpg");
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg"])
        .arg(path)
        .arg("--out")
        .arg(&output_path)
        .status()
        .map_err(|err| format!("Failed to launch HEIC/HEIF conversion for {path}: {err}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&output_path);
        return Err(format!(
            "Failed to convert HEIC/HEIF image into a Codex-compatible JPEG: {path}"
        ));
    }
    let bytes = std::fs::read(&output_path).map_err(|err| {
        format!(
            "Failed to read converted JPEG for {path} at {}: {err}",
            output_path.display()
        )
    })?;
    let _ = std::fs::remove_file(&output_path);
    if bytes.is_empty() {
        return Err(format!(
            "Converted JPEG is empty after HEIC/HEIF conversion: {path}"
        ));
    }
    Ok(bytes)
}

#[allow(dead_code)]
pub(crate) fn normalize_file_path(raw: &str) -> String {
    let path = raw.trim();
    let file_uri_path = path
        .strip_prefix("file://localhost")
        .or_else(|| path.strip_prefix("file://"));
    let Some(path) = file_uri_path else {
        return path.to_string();
    };

    let mut decoded = Vec::with_capacity(path.len());
    let bytes = path.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hi = bytes[index + 1];
            let lo = bytes[index + 2];
            let hi_value = match hi {
                b'0'..=b'9' => Some(hi - b'0'),
                b'a'..=b'f' => Some(hi - b'a' + 10),
                b'A'..=b'F' => Some(hi - b'A' + 10),
                _ => None,
            };
            let lo_value = match lo {
                b'0'..=b'9' => Some(lo - b'0'),
                b'a'..=b'f' => Some(lo - b'a' + 10),
                b'A'..=b'F' => Some(lo - b'A' + 10),
                _ => None,
            };
            if let (Some(hi_nibble), Some(lo_nibble)) = (hi_value, lo_value) {
                decoded.push((hi_nibble << 4) | lo_nibble);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

#[allow(dead_code)]
pub(crate) fn read_image_as_data_url_core(path: &str) -> Result<String, String> {
    let trimmed_path = normalize_file_path(path);
    if trimmed_path.is_empty() {
        return Err("Image path is required".to_string());
    }
    if should_inline_image_path_for_codex(&trimmed_path) {
        #[cfg(target_os = "macos")]
        {
            let encoded = STANDARD.encode(convert_heif_image_to_jpeg_bytes(&trimmed_path)?);
            return Ok(format!("data:image/jpeg;base64,{encoded}"));
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err(format!(
                "HEIC/HEIF images are not supported on this platform; convert to JPEG or PNG first: {trimmed_path}"
            ));
        }
    }
    let mime_type = image_mime_type_for_path(&trimmed_path).ok_or_else(|| {
        format!("Unsupported or missing image extension for path: {trimmed_path}")
    })?;
    let metadata = std::fs::symlink_metadata(&trimmed_path)
        .map_err(|err| format!("Failed to stat image file at {trimmed_path}: {err}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Image path must not be a symlink: {trimmed_path}"));
    }
    if !metadata.is_file() {
        return Err(format!("Image path is not a file: {trimmed_path}"));
    }
    if metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(format!(
            "Image file exceeds maximum size of {MAX_INLINE_IMAGE_BYTES} bytes: {trimmed_path}"
        ));
    }
    let bytes = std::fs::read(&trimmed_path)
        .map_err(|err| format!("Failed to read image file at {trimmed_path}: {err}"))?;
    if bytes.is_empty() {
        return Err(format!("Image file is empty: {trimmed_path}"));
    }
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

pub(crate) enum CodexLoginCancelState {
    PendingStart(oneshot::Sender<()>),
    LoginId(String),
}

async fn get_session_clone(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
) -> Result<Arc<WorkspaceSession>, String> {
    let sessions = sessions.lock().await;
    sessions
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not connected".to_string())
}

async fn resolve_workspace_and_parent(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(WorkspaceEntry, Option<WorkspaceEntry>), String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .cloned()
        .ok_or_else(|| "workspace not found".to_string())?;
    let parent_entry = entry
        .parent_id
        .as_ref()
        .and_then(|parent_id| workspaces.get(parent_id))
        .cloned();
    Ok((entry, parent_entry))
}

async fn resolve_codex_home_for_workspace_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, workspace_id).await?;
    resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home)
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

async fn resolve_workspace_path_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<String, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "workspace not found".to_string())?;
    Ok(entry.path.clone())
}

pub(crate) async fn start_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    app_settings: &Mutex<AppSettings>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;
    let config_model = get_config_model_core(workspaces, workspace_id.clone())
        .await
        .ok()
        .and_then(|value| {
            value
                .get("model")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|model| !model.is_empty())
                .map(str::to_string)
        });
    let managed_runtime = app_settings.lock().await.managed_runtime.clone();
    let params = build_thread_start_params(workspace_path, &managed_runtime, config_model);
    session
        .send_request_for_workspace(&workspace_id, "thread/start", params)
        .await
}

pub(crate) fn build_thread_start_params(
    workspace_path: String,
    managed_runtime: &ManagedRuntimeConfig,
    fallback_model: Option<String>,
) -> Value {
    let mut params = json!({
        "cwd": workspace_path,
        "approvalPolicy": "on-request"
    });
    insert_managed_runtime_thread_config(&mut params, managed_runtime);
    params["config"] = json!({
        "features": {
            "image_generation": false,
            "generate_image_tool": true
        }
    });
    params["experimentalRawEvents"] = json!(true);
    insert_fallback_or_default_thread_model(&mut params, fallback_model);
    params
}

fn insert_fallback_or_default_thread_model(params: &mut Value, fallback_model: Option<String>) {
    if params.get("model").is_some() {
        return;
    }
    let model = fallback_model
        .map(|value| value.trim().to_string())
        .filter(|model| !model.is_empty())
        .unwrap_or_else(|| DEFAULT_MANAGED_RUNTIME_MODEL.to_string());
    params["model"] = json!(model);
}

fn insert_default_thread_model(params: &mut Value) {
    if params.get("model").is_none() {
        params["model"] = json!(DEFAULT_MANAGED_RUNTIME_MODEL);
    }
}

fn insert_managed_runtime_thread_config(
    params: &mut Value,
    managed_runtime: &ManagedRuntimeConfig,
) {
    params["modelProvider"] = json!(MANAGED_RUNTIME_PROVIDER_ID);
    if let Some(model) = effective_managed_runtime_model(managed_runtime) {
        params["model"] = json!(model);
    }
}

fn build_thread_resume_params(thread_id: String, managed_runtime: &ManagedRuntimeConfig) -> Value {
    let mut params = json!({ "threadId": thread_id });
    insert_managed_runtime_thread_config(&mut params, managed_runtime);
    insert_default_thread_model(&mut params);
    params
}

pub(crate) async fn resume_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let managed_runtime = app_settings.lock().await.managed_runtime.clone();
    let params = build_thread_resume_params(thread_id, &managed_runtime);
    session
        .send_request_for_workspace(&workspace_id, "thread/resume", params)
        .await
}

pub(crate) async fn read_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/read", params)
        .await
}

pub(crate) async fn thread_live_subscribe_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = get_session_clone(sessions, &workspace_id).await?;
    Ok(())
}

pub(crate) async fn thread_live_unsubscribe_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<(), String> {
    if thread_id.trim().is_empty() {
        return Err("threadId is required".to_string());
    }
    let _ = get_session_clone(sessions, &workspace_id).await?;
    Ok(())
}

pub(crate) async fn fork_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/fork", params)
        .await
}

pub(crate) async fn list_threads_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    sort_key: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = build_thread_list_params(cursor, limit, sort_key);
    session
        .send_request_for_workspace(&workspace_id, "thread/list", params)
        .await
}

pub(crate) async fn list_mcp_server_status_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session
        .send_request_for_workspace(&workspace_id, "mcpServerStatus/list", params)
        .await
}

pub(crate) async fn codex_config_read_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    include_layers: bool,
    cwd: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({
        "includeLayers": include_layers,
        "cwd": cwd,
    });
    session
        .send_request_for_workspace(&workspace_id, "config/read", params)
        .await
}

fn comparable_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return fs::canonicalize(path)
            .map_err(|err| format!("Failed to resolve {}: {err}", path.display()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    let parent = if parent.exists() {
        fs::canonicalize(parent)
            .map_err(|err| format!("Failed to resolve {}: {err}", parent.display()))?
    } else {
        parent.to_path_buf()
    };
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Path has no file name: {}", path.display()))?;
    Ok(parent.join(file_name))
}

fn validate_mcp_config_path(
    config_path: &Path,
    global_config_path: &Path,
    workspace_path: &Path,
) -> Result<(), String> {
    let config_path = comparable_path(config_path)?;
    let global_config_path = comparable_path(global_config_path)?;
    if config_path == global_config_path {
        return Ok(());
    }

    let file_name = config_path.file_name().and_then(|value| value.to_str());
    let dot_codex_folder = config_path.parent();
    let dot_codex_name = dot_codex_folder
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str());
    let project_root = dot_codex_folder.and_then(|path| path.parent());
    if file_name != Some("config.toml") || dot_codex_name != Some(".codex") {
        return Err(format!(
            "MCP config writes are limited to CODEX_HOME/config.toml or project .codex/config.toml: {}",
            config_path.display()
        ));
    }

    let project_root = project_root
        .ok_or_else(|| format!("Invalid project config path: {}", config_path.display()))?;
    let workspace_path = comparable_path(workspace_path)?;
    if !workspace_path.starts_with(project_root) {
        return Err(format!(
            "Project MCP config {} is outside workspace {}",
            config_path.display(),
            workspace_path.display()
        ));
    }
    Ok(())
}

fn read_config_document_at_path(path: &Path) -> Result<toml_edit::Document, String> {
    match fs::read_to_string(path) {
        Ok(contents) => config_toml_core::parse_document(&contents),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(toml_edit::Document::new()),
        Err(err) => Err(format!("Failed to read {}: {err}", path.display())),
    }
}

fn write_config_document_at_path(
    path: &Path,
    document: &toml_edit::Document,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create {}: {err}", parent.display()))?;
    }
    let mut rendered = document.to_string();
    if !rendered.ends_with('\n') {
        rendered.push('\n');
    }
    fs::write(path, rendered).map_err(|err| format!("Failed to write {}: {err}", path.display()))
}

pub(crate) async fn mcp_server_config_write_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    name: String,
    enabled: bool,
    source_path: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, &workspace_id).await?;
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home)
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())?;
    let global_config_path = codex_home.join("config.toml");
    let config_path = source_path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| global_config_path.clone());

    validate_mcp_config_path(
        &config_path,
        &global_config_path,
        Path::new(entry.path.as_str()),
    )?;

    let mut document = read_config_document_at_path(&config_path)?;
    config_toml_core::set_mcp_server_enabled(&mut document, &name, enabled)?;
    write_config_document_at_path(&config_path, &document)?;

    session
        .send_request_for_workspace(&workspace_id, "config/mcpServer/reload", Value::Null)
        .await?;
    Ok(json!({
        "ok": true,
        "sourcePath": config_path.to_string_lossy().to_string(),
    }))
}

pub(crate) async fn archive_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/archive", params)
        .await
}

pub(crate) async fn compact_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "thread/compact/start", params)
        .await
}

pub(crate) async fn set_thread_name_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    name: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id, "name": name });
    session
        .send_request_for_workspace(&workspace_id, "thread/name/set", params)
        .await
}

// Build a single `<attached_files>` text fragment referencing user-attached
// local files by path. The agent reads them on demand with its own tools —
// every sandbox policy (readOnly/workspaceWrite/dangerFullAccess) grants
// filesystem-wide read — so we pass paths instead of inlining content. This
// matches Codex's native `@`-mention behavior, lets the agent read selectively,
// and avoids context bloat for large files. Paths are emitted verbatim (no XML
// escaping) so the agent can use them as-is; filenames with XML metacharacters
// are vanishingly rare and not worth corrupting every usable path to guard.
fn build_attached_files_block(files: Vec<String>) -> Option<String> {
    let mut entries: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for raw in files {
        let path = normalize_file_path(&raw);
        if path.is_empty() {
            continue;
        }
        if !seen.insert(path.clone()) {
            continue;
        }
        entries.push(format!("  <path>{path}</path>"));
    }
    if entries.is_empty() {
        return None;
    }
    Some(format!(
        "<attached_files>\n{}\n</attached_files>",
        entries.join("\n")
    ))
}

fn build_turn_input_items(
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
    files: Option<Vec<String>>,
) -> Result<Vec<Value>, String> {
    let trimmed_text = text.trim();
    let mut input: Vec<Value> = Vec::new();
    if !trimmed_text.is_empty() {
        input.push(json!({ "type": "text", "text": trimmed_text }));
    }
    if let Some(files) = files {
        if let Some(block) = build_attached_files_block(files) {
            input.push(json!({ "type": "text", "text": block }));
        }
    }
    if let Some(paths) = images {
        for path in paths {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("data:")
                || trimmed.starts_with("http://")
                || trimmed.starts_with("https://")
            {
                input.push(json!({ "type": "image", "url": trimmed }));
            } else if should_inline_image_path_for_codex(trimmed) {
                input.push(json!({
                    "type": "image",
                    "url": read_image_as_data_url_core(trimmed)?,
                }));
            } else {
                input.push(json!({ "type": "localImage", "path": trimmed }));
            }
        }
    }
    if let Some(mentions) = app_mentions {
        let mut seen_paths: HashSet<String> = HashSet::new();
        for mention in mentions {
            let object = mention
                .as_object()
                .ok_or_else(|| "invalid app mention payload".to_string())?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid app mention name".to_string())?;
            let path = object
                .get("path")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "invalid app mention path".to_string())?;
            if !path.starts_with("app://") || path.len() <= "app://".len() {
                return Err("invalid app mention path".to_string());
            }
            if !seen_paths.insert(path.to_string()) {
                continue;
            }
            input.push(json!({ "type": "mention", "name": name, "path": path }));
        }
    }
    if input.is_empty() {
        return Err("empty user message".to_string());
    }
    Ok(input)
}

pub(crate) fn insert_optional_nullable_string(
    params: &mut Map<String, Value>,
    key: &str,
    value: Option<Option<String>>,
) {
    if let Some(value) = value {
        params.insert(key.to_string(), json!(value));
    }
}

fn json_rpc_error_message(value: &Value) -> Option<&str> {
    let error = value.get("error")?;
    if let Some(message) = error.as_str() {
        return Some(message);
    }
    error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.get("data").and_then(Value::as_str))
}

fn is_thread_not_found_response(value: &Value, thread_id: &str) -> bool {
    let Some(message) = json_rpc_error_message(value) else {
        return false;
    };
    (message.contains("thread not found") || message.contains("no rollout found for thread id"))
        && message.contains(thread_id)
}

pub(crate) async fn send_user_message_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    app_settings: &Mutex<AppSettings>,
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    service_tier: Option<Option<String>>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
    files: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;
    let managed_runtime = app_settings.lock().await.managed_runtime.clone();
    let managed_runtime_model = effective_managed_runtime_model(&managed_runtime);
    if managed_runtime_config_is_complete(&managed_runtime) {
        let resume_params = build_thread_resume_params(thread_id.clone(), &managed_runtime);
        let resume_response = session
            .send_request_for_workspace(&workspace_id, "thread/resume", resume_params)
            .await?;
        if json_rpc_error_message(&resume_response).is_some()
            && !is_thread_not_found_response(&resume_response, &thread_id)
        {
            return Ok(resume_response);
        }
    }
    let access_mode = access_mode.unwrap_or_else(|| "current".to_string());
    let sandbox_policy = match access_mode.as_str() {
        "full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly" }),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [workspace_path.clone()],
            "networkAccess": true
        }),
    };

    let approval_policy = if access_mode == "full-access" {
        "never"
    } else {
        "on-request"
    };

    let input = build_turn_input_items(text, images, app_mentions, files)?;

    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id.clone()));
    params.insert("input".to_string(), json!(input));
    params.insert("cwd".to_string(), json!(workspace_path));
    params.insert("approvalPolicy".to_string(), json!(approval_policy));
    params.insert("sandboxPolicy".to_string(), json!(sandbox_policy));
    params.insert("model".to_string(), json!(model.or(managed_runtime_model)));
    params.insert("effort".to_string(), json!(effort));
    insert_optional_nullable_string(&mut params, "serviceTier", service_tier);
    if let Some(mode) = collaboration_mode {
        if !mode.is_null() {
            params.insert("collaborationMode".to_string(), mode);
        }
    }

    let response = session
        .send_request_for_workspace(&workspace_id, "turn/start", Value::Object(params.clone()))
        .await?;
    if !is_thread_not_found_response(&response, &thread_id) {
        return Ok(response);
    }

    let resume_params = build_thread_resume_params(thread_id.clone(), &managed_runtime);
    let resume_response = session
        .send_request_for_workspace(&workspace_id, "thread/resume", resume_params)
        .await?;
    if json_rpc_error_message(&resume_response).is_some() {
        return Ok(resume_response);
    }

    session
        .send_request_for_workspace(&workspace_id, "turn/start", Value::Object(params))
        .await
}

pub(crate) async fn turn_steer_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    text: String,
    images: Option<Vec<String>>,
    app_mentions: Option<Vec<Value>>,
    files: Option<Vec<String>>,
) -> Result<Value, String> {
    if turn_id.trim().is_empty() {
        return Err("missing active turn id".to_string());
    }
    let session = get_session_clone(sessions, &workspace_id).await?;
    let input = build_turn_input_items(text, images, app_mentions, files)?;
    let params = json!({
        "threadId": thread_id,
        "expectedTurnId": turn_id,
        "input": input
    });
    session
        .send_request_for_workspace(&workspace_id, "turn/steer", params)
        .await
}

pub(crate) async fn collaboration_mode_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "collaborationMode/list", json!({}))
        .await
}

pub(crate) async fn turn_interrupt_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "threadId": thread_id, "turnId": turn_id });
    session
        .send_request_for_workspace(&workspace_id, "turn/interrupt", params)
        .await
}

pub(crate) async fn start_review_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id));
    params.insert("target".to_string(), target);
    if let Some(delivery) = delivery {
        params.insert("delivery".to_string(), json!(delivery));
    }
    session
        .send_request_for_workspace(&workspace_id, "review/start", Value::Object(params))
        .await
}

pub(crate) async fn model_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "model/list", json!({}))
        .await
}

pub(crate) async fn experimental_feature_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session
        .send_request_for_workspace(&workspace_id, "experimentalFeature/list", params)
        .await
}

pub(crate) async fn account_rate_limits_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session
        .send_request_for_workspace(&workspace_id, "account/rateLimits/read", Value::Null)
        .await
}

pub(crate) async fn account_read_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = {
        let sessions = sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };
    let response = if let Some(session) = session {
        session
            .send_request_for_workspace(&workspace_id, "account/read", Value::Null)
            .await
            .ok()
    } else {
        None
    };

    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, &workspace_id).await?;
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home);
    let fallback = read_auth_account(codex_home);

    Ok(build_account_response(response, fallback))
}

pub(crate) async fn codex_login_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    codex_login_cancels: &Mutex<HashMap<String, CodexLoginCancelState>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    {
        let mut cancels = codex_login_cancels.lock().await;
        if let Some(existing) = cancels.remove(&workspace_id) {
            match existing {
                CodexLoginCancelState::PendingStart(tx) => {
                    let _ = tx.send(());
                }
                CodexLoginCancelState::LoginId(_) => {}
            }
        }
        cancels.insert(
            workspace_id.clone(),
            CodexLoginCancelState::PendingStart(cancel_tx),
        );
    }

    let start = Instant::now();
    let mut cancel_rx = cancel_rx;
    let workspace_for_request = workspace_id.clone();
    let mut login_request: Pin<Box<_>> = Box::pin(session.send_request_for_workspace(
        &workspace_for_request,
        "account/login/start",
        json!({ "type": "chatgpt" }),
    ));

    let response = loop {
        match cancel_rx.try_recv() {
            Ok(_) => {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
                return Err("Codex login canceled.".to_string());
            }
            Err(TryRecvError::Closed) => {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
                return Err("Codex login canceled.".to_string());
            }
            Err(TryRecvError::Empty) => {}
        }

        let elapsed = start.elapsed();
        if elapsed >= LOGIN_START_TIMEOUT {
            let mut cancels = codex_login_cancels.lock().await;
            cancels.remove(&workspace_id);
            return Err("Codex login start timed out.".to_string());
        }

        let tick = Duration::from_millis(150);
        let remaining = LOGIN_START_TIMEOUT.saturating_sub(elapsed);
        let wait_for = remaining.min(tick);

        match timeout(wait_for, &mut login_request).await {
            Ok(result) => break result?,
            Err(_elapsed) => continue,
        }
    };

    let payload = response.get("result").unwrap_or(&response);
    let login_id = payload
        .get("loginId")
        .or_else(|| payload.get("login_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "missing login id in account/login/start response".to_string())?;
    let auth_url = payload
        .get("authUrl")
        .or_else(|| payload.get("auth_url"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "missing auth url in account/login/start response".to_string())?;

    {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.insert(
            workspace_id,
            CodexLoginCancelState::LoginId(login_id.clone()),
        );
    }

    Ok(json!({
        "loginId": login_id,
        "authUrl": auth_url,
        "raw": response,
    }))
}

pub(crate) async fn codex_login_cancel_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    codex_login_cancels: &Mutex<HashMap<String, CodexLoginCancelState>>,
    workspace_id: String,
) -> Result<Value, String> {
    let cancel_state = {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.remove(&workspace_id)
    };

    let Some(cancel_state) = cancel_state else {
        return Ok(json!({ "canceled": false }));
    };

    match cancel_state {
        CodexLoginCancelState::PendingStart(cancel_tx) => {
            let _ = cancel_tx.send(());
            return Ok(json!({
                "canceled": true,
                "status": "canceled",
            }));
        }
        CodexLoginCancelState::LoginId(login_id) => {
            let session = get_session_clone(sessions, &workspace_id).await?;
            let response = session
                .send_request_for_workspace(
                    &workspace_id,
                    "account/login/cancel",
                    json!({
                        "loginId": login_id,
                    }),
                )
                .await?;

            let payload = response.get("result").unwrap_or(&response);
            let status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let canceled = status.eq_ignore_ascii_case("canceled");

            Ok(json!({
                "canceled": canceled,
                "status": status,
                "raw": response,
            }))
        }
    }
}

pub(crate) async fn skills_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let workspace_path = resolve_workspace_path_core(workspaces, &workspace_id).await?;

    // Codex can discover project-scoped skills from `<workspace>/.agents/skills`.
    // Some environments don't surface those reliably in AgentDesk unless we
    // pass the default project skills path explicitly.
    let mut source_paths: Vec<String> = vec![];
    let project_skills_dir = Path::new(&workspace_path).join(".agents").join("skills");
    if project_skills_dir.is_dir() {
        if let Some(p) = project_skills_dir.to_str() {
            source_paths.push(p.to_string());
        }
    }
    let mut uninstall_allowed_roots = Vec::new();
    if let Some(codex_home) = resolve_default_codex_home() {
        uninstall_allowed_roots.push(codex_home.join("skills"));
    }
    uninstall_allowed_roots.push(project_skills_dir);

    let params = build_skills_list_params(workspace_path, source_paths.clone());

    let mut response = session
        .send_request_for_workspace(&workspace_id, "skills/list", params)
        .await?;
    enrich_skills_list_response_with_install_metadata(&mut response);
    enrich_skills_list_response_with_uninstallability(&mut response, &uninstall_allowed_roots);

    // Attach diagnostics for the UI (non-breaking: keep original response fields).
    if let Value::Object(ref mut obj) = response {
        obj.insert("sourcePaths".to_string(), json!(source_paths));
        obj.insert("sourceErrors".to_string(), json!([]));
    }

    Ok(response)
}

fn enrich_skill_with_install_metadata(skill: &mut Value) {
    let Value::Object(skill) = skill else {
        return;
    };
    let Some(path) = skill.get("path").and_then(Value::as_str) else {
        return;
    };
    let Some(metadata) = skills_market_core::read_skill_install_metadata(Path::new(path)) else {
        return;
    };
    skill.insert("marketId".to_string(), json!(metadata.id));
    skill.insert("installedVersion".to_string(), json!(metadata.version));
    skill.insert("marketSourcePath".to_string(), json!(metadata.source.path));
    skill.insert("installedAt".to_string(), json!(metadata.installed_at));
}

fn enrich_skill_with_uninstallability(skill: &mut Value, allowed_roots: &[PathBuf]) {
    let Value::Object(skill) = skill else {
        return;
    };
    let Some(path) = skill.get("path").and_then(Value::as_str) else {
        return;
    };
    skill.insert(
        "uninstallable".to_string(),
        json!(skills_market_core::is_skill_uninstall_target_allowed(
            path,
            allowed_roots,
        )),
    );
}

fn enrich_skills_container_with_install_metadata(value: &mut Value) {
    let Value::Object(object) = value else {
        return;
    };
    if let Some(Value::Array(skills)) = object.get_mut("skills") {
        for skill in skills {
            enrich_skill_with_install_metadata(skill);
        }
    }
    if let Some(Value::Array(buckets)) = object.get_mut("data") {
        for bucket in buckets {
            enrich_skills_container_with_install_metadata(bucket);
        }
    }
}

fn enrich_skills_container_with_uninstallability(value: &mut Value, allowed_roots: &[PathBuf]) {
    let Value::Object(object) = value else {
        return;
    };
    if let Some(Value::Array(skills)) = object.get_mut("skills") {
        for skill in skills {
            enrich_skill_with_uninstallability(skill, allowed_roots);
        }
    }
    if let Some(Value::Array(buckets)) = object.get_mut("data") {
        for bucket in buckets {
            enrich_skills_container_with_uninstallability(bucket, allowed_roots);
        }
    }
}

fn enrich_skills_list_response_with_install_metadata(response: &mut Value) {
    enrich_skills_container_with_install_metadata(response);
    if let Some(result) = response.get_mut("result") {
        enrich_skills_container_with_install_metadata(result);
    }
}

fn enrich_skills_list_response_with_uninstallability(
    response: &mut Value,
    allowed_roots: &[PathBuf],
) {
    enrich_skills_container_with_uninstallability(response, allowed_roots);
    if let Some(result) = response.get_mut("result") {
        enrich_skills_container_with_uninstallability(result, allowed_roots);
    }
}

pub(crate) async fn skills_config_write_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    path: Option<String>,
    name: Option<String>,
    enabled: bool,
) -> Result<Value, String> {
    if path.as_deref().unwrap_or_default().trim().is_empty()
        && name.as_deref().unwrap_or_default().trim().is_empty()
    {
        return Err("skill path or name is required".to_string());
    }

    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({
        "path": path,
        "name": name,
        "enabled": enabled,
    });
    session
        .send_request_for_workspace(&workspace_id, "skills/config/write", params)
        .await
}

pub(crate) async fn apps_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    thread_id: Option<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({ "cursor": cursor, "limit": limit, "threadId": thread_id });
    session
        .send_request_for_workspace(&workspace_id, "app/list", params)
        .await
}

pub(crate) async fn respond_to_server_request_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    session.send_response(request_id, result).await
}

pub(crate) async fn remember_approval_rule_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    command: Vec<String>,
) -> Result<Value, String> {
    let command = command
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if command.is_empty() {
        return Err("empty command".to_string());
    }

    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let rules_path = rules::default_rules_path(&codex_home);
    rules::append_prefix_rule(&rules_path, &command)?;

    Ok(json!({
        "ok": true,
        "rulesPath": rules_path,
    }))
}

pub(crate) async fn get_config_model_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let model = codex_config::read_config_model(Some(codex_home))?;
    Ok(json!({ "model": model }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn normalize_strips_file_uri_prefix() {
        assert_eq!(
            normalize_file_path("file:///var/mobile/Containers/Data/photo.jpg"),
            "/var/mobile/Containers/Data/photo.jpg"
        );
    }

    #[test]
    fn normalize_strips_file_localhost_prefix() {
        assert_eq!(
            normalize_file_path("file://localhost/Users/test/image.png"),
            "/Users/test/image.png"
        );
    }

    #[test]
    fn normalize_decodes_percent_encoding() {
        assert_eq!(
            normalize_file_path("file:///var/mobile/path%20with%20spaces/img.jpg"),
            "/var/mobile/path with spaces/img.jpg"
        );
    }

    #[test]
    fn normalize_plain_path_unchanged() {
        assert_eq!(
            normalize_file_path("/var/mobile/Containers/Data/photo.jpg"),
            "/var/mobile/Containers/Data/photo.jpg"
        );
    }

    #[test]
    fn normalize_plain_path_percent_sequences_unchanged() {
        assert_eq!(
            normalize_file_path("/tmp/report%20final.png"),
            "/tmp/report%20final.png"
        );
    }

    #[test]
    fn normalize_trims_whitespace() {
        assert_eq!(normalize_file_path("  /tmp/image.png  "), "/tmp/image.png");
    }

    #[test]
    fn attached_files_block_emits_one_path_entry_per_file() {
        let block = build_attached_files_block(vec![
            "/tmp/a.ts".to_string(),
            "/tmp/notes/b.md".to_string(),
        ])
        .expect("block should be produced");
        assert_eq!(
            block,
            "<attached_files>\n  <path>/tmp/a.ts</path>\n  <path>/tmp/notes/b.md</path>\n</attached_files>"
        );
    }

    #[test]
    fn attached_files_block_dedupes_and_skips_blank_paths() {
        let block = build_attached_files_block(vec![
            "/tmp/a.ts".to_string(),
            "   ".to_string(),
            "/tmp/a.ts".to_string(),
            String::new(),
        ])
        .expect("block should be produced");
        assert_eq!(
            block,
            "<attached_files>\n  <path>/tmp/a.ts</path>\n</attached_files>"
        );
    }

    #[test]
    fn attached_files_block_normalizes_file_uri_paths() {
        let block = build_attached_files_block(vec![
            "file:///tmp/report%20final.md".to_string(),
        ])
        .expect("block should be produced");
        assert_eq!(
            block,
            "<attached_files>\n  <path>/tmp/report final.md</path>\n</attached_files>"
        );
    }

    #[test]
    fn attached_files_block_returns_none_when_no_valid_paths() {
        assert!(build_attached_files_block(vec!["  ".to_string(), String::new()]).is_none());
        assert!(build_attached_files_block(Vec::new()).is_none());
    }

    #[test]
    fn build_turn_input_appends_attached_files_after_prompt_text() {
        let input = build_turn_input_items(
            "look at this".to_string(),
            None,
            None,
            Some(vec!["/tmp/a.ts".to_string()]),
        )
        .expect("input should build");
        assert_eq!(input.len(), 2);
        assert_eq!(input[0], json!({ "type": "text", "text": "look at this" }));
        assert_eq!(
            input[1],
            json!({
                "type": "text",
                "text": "<attached_files>\n  <path>/tmp/a.ts</path>\n</attached_files>"
            })
        );
    }

    #[test]
    fn build_turn_input_allows_files_only_message() {
        let input = build_turn_input_items(
            String::new(),
            None,
            None,
            Some(vec!["/tmp/a.ts".to_string()]),
        )
        .expect("files-only message should be valid");
        assert_eq!(input.len(), 1);
        assert_eq!(
            input[0],
            json!({
                "type": "text",
                "text": "<attached_files>\n  <path>/tmp/a.ts</path>\n</attached_files>"
            })
        );
    }

    #[test]
    fn thread_not_found_detection_reads_json_rpc_error_object() {
        let response = json!({
            "id": 12,
            "error": {
                "code": -32602,
                "message": "thread not found: thread-abc"
            }
        });

        assert!(is_thread_not_found_response(&response, "thread-abc"));
        assert!(!is_thread_not_found_response(&response, "thread-other"));
    }

    #[test]
    fn thread_not_found_detection_reads_string_error() {
        let response = json!({
            "id": 12,
            "error": "thread not found: thread-abc"
        });

        assert!(is_thread_not_found_response(&response, "thread-abc"));
    }

    #[test]
    fn thread_not_found_detection_treats_missing_rollout_as_recoverable() {
        let response = json!({
            "id": 12,
            "error": {
                "code": -32603,
                "message": "no rollout found for thread id 019ed091-da3d-7223-bf43-367682900e8c"
            }
        });

        assert!(is_thread_not_found_response(
            &response,
            "019ed091-da3d-7223-bf43-367682900e8c"
        ));
        assert!(!is_thread_not_found_response(&response, "thread-other"));
    }

    #[test]
    fn read_image_data_url_core_rejects_file_uri_that_does_not_exist() {
        let result = read_image_as_data_url_core("file:///nonexistent/photo.png");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            !err.contains("file://"),
            "error should reference normalized path, got: {err}"
        );
        assert!(err.contains("/nonexistent/photo.png"));
    }

    #[test]
    fn read_image_data_url_core_succeeds_with_file_uri_for_real_file() {
        let dir = std::env::temp_dir().join("codex_monitor_test");
        std::fs::create_dir_all(&dir).unwrap();
        let img_path = dir.join("test_photo.png");
        let png_bytes: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        std::fs::write(&img_path, png_bytes).unwrap();

        let file_uri = format!("file://{}", img_path.display());
        let result = read_image_as_data_url_core(&file_uri);
        assert!(
            result.is_ok(),
            "file:// URI for real file should succeed, got: {:?}",
            result.err()
        );
        let data_url = result.unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));

        let space_dir = dir.join("path with spaces");
        std::fs::create_dir_all(&space_dir).unwrap();
        let space_img = space_dir.join("photo.png");
        std::fs::write(&space_img, png_bytes).unwrap();
        let encoded_uri = format!(
            "file://{}",
            space_img.display().to_string().replace(' ', "%20")
        );
        let result2 = read_image_as_data_url_core(&encoded_uri);
        assert!(
            result2.is_ok(),
            "percent-encoded file:// URI should succeed, got: {:?}",
            result2.err()
        );

        let percent_img = dir.join("report%20final.png");
        std::fs::write(&percent_img, png_bytes).unwrap();
        let plain_percent_path = percent_img.display().to_string();
        let result3 = read_image_as_data_url_core(&plain_percent_path);
        assert!(
            result3.is_ok(),
            "plain filesystem paths with percent sequences should not be decoded, got: {:?}",
            result3.err()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn heif_paths_are_inlined_for_codex() {
        assert!(should_inline_image_path_for_codex("/tmp/photo.heic"));
        assert!(should_inline_image_path_for_codex("/tmp/photo.HEIF"));
        assert!(!should_inline_image_path_for_codex("/tmp/photo.png"));
    }

    #[test]
    fn insert_optional_nullable_string_omits_missing_and_preserves_null() {
        let mut params = Map::new();

        insert_optional_nullable_string(&mut params, "serviceTier", None);
        assert!(!params.contains_key("serviceTier"));

        insert_optional_nullable_string(&mut params, "serviceTier", Some(None));
        assert_eq!(params.get("serviceTier"), Some(&Value::Null));

        insert_optional_nullable_string(&mut params, "serviceTier", Some(Some("fast".to_string())));
        assert_eq!(params.get("serviceTier"), Some(&json!("fast")));
    }

    #[test]
    fn thread_list_source_kinds_exclude_generic_subagent_and_keep_explicit_variants() {
        assert!(!THREAD_LIST_SOURCE_KINDS.contains(&"subAgent"));
        assert!(THREAD_LIST_SOURCE_KINDS.contains(&"subAgentReview"));
        assert!(THREAD_LIST_SOURCE_KINDS.contains(&"subAgentCompact"));
        assert!(THREAD_LIST_SOURCE_KINDS.contains(&"subAgentThreadSpawn"));
    }

    #[test]
    fn thread_list_params_include_all_model_providers() {
        let params = build_thread_list_params(
            Some("cursor-1".to_string()),
            Some(50),
            Some("updatedAt".to_string()),
        );

        assert_eq!(params.get("cursor"), Some(&json!("cursor-1")));
        assert_eq!(params.get("limit"), Some(&json!(50)));
        assert_eq!(params.get("sortKey"), Some(&json!("updatedAt")));
        assert_eq!(params.get("modelProviders"), Some(&json!([])));
        assert_eq!(
            params.get("sourceKinds"),
            Some(&json!(THREAD_LIST_SOURCE_KINDS))
        );
    }

    #[test]
    fn thread_start_params_enable_gateway_image_tool_without_dynamic_tool() {
        let params = build_thread_start_params(
            "/tmp/workspace".to_string(),
            &ManagedRuntimeConfig::default(),
            Some("config-model".to_string()),
        );
        assert_eq!(
            params.pointer("/config/features/image_generation"),
            Some(&json!(false))
        );
        assert_eq!(
            params.pointer("/config/features/generate_image_tool"),
            Some(&json!(true))
        );
        assert_eq!(params.get("experimentalRawEvents"), Some(&json!(true)));
        assert!(params
            .pointer("/config/features.image_generation")
            .is_none());
        assert_eq!(params.get("model"), Some(&json!("config-model")));
        assert!(params.get("dynamicTools").is_none());
    }

    #[test]
    fn thread_start_params_force_gateway_image_tool_by_default() {
        let params = build_thread_start_params(
            "/tmp/workspace".to_string(),
            &ManagedRuntimeConfig::default(),
            None,
        );

        assert_eq!(params.get("cwd"), Some(&json!("/tmp/workspace")));
        assert_eq!(
            params.pointer("/config/features/image_generation"),
            Some(&json!(false))
        );
        assert_eq!(
            params.pointer("/config/features/generate_image_tool"),
            Some(&json!(true))
        );
        assert_eq!(params.get("experimentalRawEvents"), Some(&json!(true)));
        assert!(params.get("dynamicTools").is_none());
    }

    #[test]
    fn thread_start_params_keep_skills_enabled_by_default() {
        let params = build_thread_start_params(
            "/tmp/workspace".to_string(),
            &ManagedRuntimeConfig::default(),
            None,
        );

        assert!(params.pointer("/config/skills.config").is_none());
    }

    #[test]
    fn thread_start_params_force_managed_runtime_provider_when_configured() {
        let params = build_thread_start_params(
            "/tmp/workspace".to_string(),
            &ManagedRuntimeConfig {
                enabled: true,
                base_url: Some("https://adg.example.com/v1".to_string()),
                model: Some("enterprise-model".to_string()),
                image_model: None,
            },
            Some("config-model".to_string()),
        );

        assert_eq!(
            params.get("modelProvider"),
            Some(&json!("agentdesk_managed"))
        );
        assert_eq!(params.get("model"), Some(&json!("enterprise-model")));
    }

    #[test]
    fn thread_start_params_use_config_model_when_managed_runtime_is_incomplete() {
        let params = build_thread_start_params(
            "/tmp/workspace".to_string(),
            &ManagedRuntimeConfig::default(),
            Some("gpt-5.5".to_string()),
        );

        assert_eq!(
            params.get("modelProvider"),
            Some(&json!("agentdesk_managed"))
        );
        assert_eq!(params.get("model"), Some(&json!("gpt-5.5")));
        assert_eq!(
            params.pointer("/config/features/generate_image_tool"),
            Some(&json!(true))
        );
    }

    #[test]
    fn thread_start_params_use_default_model_when_no_runtime_or_config_model_exists() {
        let params = build_thread_start_params(
            "/tmp/workspace".to_string(),
            &ManagedRuntimeConfig::default(),
            None,
        );

        assert_eq!(
            params.get("modelProvider"),
            Some(&json!("agentdesk_managed"))
        );
        assert_eq!(params.get("model"), Some(&json!("gpt-5.5")));
    }

    #[test]
    fn thread_resume_params_force_managed_runtime_provider_when_configured() {
        let params = build_thread_resume_params(
            "thread-1".to_string(),
            &ManagedRuntimeConfig {
                enabled: true,
                base_url: Some("https://adg.example.com/v1".to_string()),
                model: None,
                image_model: None,
            },
        );

        assert_eq!(params.get("threadId"), Some(&json!("thread-1")));
        assert_eq!(
            params.get("modelProvider"),
            Some(&json!("agentdesk_managed"))
        );
        assert_eq!(params.get("model"), Some(&json!("gpt-5.5")));
    }

    #[test]
    fn thread_resume_params_force_managed_runtime_provider_when_config_is_incomplete() {
        let params =
            build_thread_resume_params("thread-1".to_string(), &ManagedRuntimeConfig::default());

        assert_eq!(params.get("threadId"), Some(&json!("thread-1")));
        assert_eq!(
            params.get("modelProvider"),
            Some(&json!("agentdesk_managed"))
        );
        assert_eq!(params.get("model"), Some(&json!("gpt-5.5")));
    }

    #[test]
    fn skills_list_params_use_current_app_server_shape_without_extra_roots() {
        let params = build_skills_list_params("/tmp/workspace".to_string(), Vec::new());

        assert_eq!(params.get("cwds"), Some(&json!(["/tmp/workspace"])));
        assert_eq!(params.get("forceReload"), Some(&json!(true)));
        assert!(params.get("cwd").is_none());
        assert!(params.get("skillsPaths").is_none());
        assert!(params.get("perCwdExtraUserRoots").is_none());
    }

    #[test]
    fn skills_list_params_pass_project_roots_as_per_cwd_extra_user_roots() {
        let params = build_skills_list_params(
            "/tmp/workspace".to_string(),
            vec!["/tmp/workspace/.agents/skills".to_string()],
        );

        assert_eq!(params.get("cwds"), Some(&json!(["/tmp/workspace"])));
        assert_eq!(params.get("forceReload"), Some(&json!(true)));
        assert_eq!(
            params.get("perCwdExtraUserRoots"),
            Some(&json!([
                {
                    "cwd": "/tmp/workspace",
                    "extraUserRoots": ["/tmp/workspace/.agents/skills"],
                }
            ]))
        );
        assert!(params.get("skillsPaths").is_none());
    }

    #[test]
    fn skills_list_response_includes_market_install_metadata() {
        let root = std::env::temp_dir().join(format!(
            "agentdesk-skills-list-metadata-{}",
            uuid::Uuid::new_v4()
        ));
        let skill_dir = root.join("skills").join("docs-writer");
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        fs::write(skill_dir.join("SKILL.md"), "---\nname: docs-writer\n---\n")
            .expect("write skill");
        fs::write(
            skill_dir.join(".agentdesk-install.json"),
            r#"{
              "schemaVersion": 1,
              "id": "docs-writer",
              "version": "0.2.0",
              "target": "global",
              "source": { "type": "repo", "path": "skills/docs-writer" },
              "installedAt": "2026-05-20T00:00:00Z"
            }"#,
        )
        .expect("write metadata");
        let mut response = json!({
            "result": {
                "skills": [
                    {
                        "name": "docs-writer",
                        "path": skill_dir.join("SKILL.md").to_string_lossy()
                    }
                ]
            }
        });

        enrich_skills_list_response_with_install_metadata(&mut response);

        let skill = response
            .pointer("/result/skills/0")
            .and_then(Value::as_object)
            .expect("skill object");
        assert_eq!(skill.get("marketId"), Some(&json!("docs-writer")));
        assert_eq!(skill.get("installedVersion"), Some(&json!("0.2.0")));
        assert_eq!(
            skill.get("marketSourcePath"),
            Some(&json!("skills/docs-writer"))
        );
    }

    #[test]
    fn skills_list_response_marks_only_managed_roots_uninstallable() {
        let root = std::env::temp_dir().join(format!(
            "agentdesk-skills-list-uninstallable-{}",
            uuid::Uuid::new_v4()
        ));
        let managed_root = root.join("codex-home").join("skills");
        let managed_skill = managed_root.join("docs-writer");
        let system_skill = managed_root.join(".system").join("imagegen");
        let external_skill = root.join("external").join("skills").join("local-helper");
        for dir in [&managed_skill, &system_skill, &external_skill] {
            fs::create_dir_all(dir).expect("create skill dir");
            fs::write(dir.join("SKILL.md"), "---\nname: test\n---\n").expect("write skill");
        }
        let mut response = json!({
            "result": {
                "skills": [
                    {
                        "name": "docs-writer",
                        "path": managed_skill.join("SKILL.md").to_string_lossy()
                    },
                    {
                        "name": "imagegen",
                        "path": system_skill.join("SKILL.md").to_string_lossy()
                    },
                    {
                        "name": "local-helper",
                        "path": external_skill.join("SKILL.md").to_string_lossy()
                    }
                ]
            }
        });

        enrich_skills_list_response_with_uninstallability(&mut response, &[managed_root]);

        assert_eq!(
            response.pointer("/result/skills/0/uninstallable"),
            Some(&json!(true))
        );
        assert_eq!(
            response.pointer("/result/skills/1/uninstallable"),
            Some(&json!(false))
        );
        assert_eq!(
            response.pointer("/result/skills/2/uninstallable"),
            Some(&json!(false))
        );
    }
}
