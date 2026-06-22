//! ADG deploy plugin — app adapter (docs/deploy-plugin-design.md §3.3). App-only: every command
//! refuses in remote/daemon mode (workspace files + token live on the app side). All real logic
//! is in `shared::deploy_core`; this layer resolves the workspace, holds the token, and persists
//! the per-workspace deploy binding.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::enterprise_ai::service_base_url;
use crate::remote_backend;
use crate::shared::{deploy_core, runtime_secret_core};
use crate::state::AppState;
use crate::storage::write_workspaces;
use crate::types::{DeployApp, DeployMetadata, WorkspaceDeployState, WorkspaceEntry};

const REMOTE_UNSUPPORTED: &str = "部署暂仅支持本地模式。";

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn require_token() -> Result<String, String> {
    runtime_secret_core::get_adg_deploy_token()?
        .ok_or_else(|| "未配置部署令牌，请先在设置中粘贴 sk-adgd_ 令牌。".to_string())
}

async fn workspace_app_id(state: &AppState, workspace_id: &str) -> Result<String, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| "工作区不存在。".to_string())?;
    entry
        .settings
        .deploy
        .as_ref()
        .map(|d| d.app_id.clone())
        .ok_or_else(|| "该工作区尚未部署。".to_string())
}

#[tauri::command]
pub(crate) async fn deploy_app(
    workspace_id: String,
    metadata: DeployMetadata,
    state: State<'_, AppState>,
) -> Result<DeployApp, String> {
    if remote_backend::is_remote_mode(&state).await {
        return Err(REMOTE_UNSUPPORTED.to_string());
    }
    let token = require_token()?;
    let base_url = service_base_url();

    let (root, existing_app_id, raw_name) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| "工作区不存在。".to_string())?;
        let raw_name = if metadata.name.trim().is_empty() {
            entry.name.clone()
        } else {
            metadata.name.clone()
        };
        let existing = entry.settings.deploy.as_ref().map(|d| d.app_id.clone());
        (PathBuf::from(entry.path.clone()), existing, raw_name)
    };

    let name = deploy_core::sanitize_dns_label(&raw_name, &workspace_id);
    let app = deploy_core::deploy_workspace_core(
        &root,
        existing_app_id.as_deref(),
        &name,
        metadata.source_platform.as_deref(),
        &token,
        &base_url,
    )
    .await?;

    // Persist the binding immediately. If this fails after a successful create, surface the
    // app id (fail-fast) so the user can recover rather than silently re-creating a duplicate.
    let next = WorkspaceDeployState {
        app_id: app.app_id.clone(),
        app_name: name,
        source_platform: app.source_platform.clone(),
        subdomain: app.subdomain.clone(),
        last_status: Some(app.status),
        last_deploy_at: Some(now_ms()),
    };
    {
        let mut workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get_mut(&workspace_id)
            .ok_or_else(|| "工作区不存在。".to_string())?;
        entry.settings.deploy = Some(next);
        let entries: Vec<WorkspaceEntry> = workspaces.values().cloned().collect();
        write_workspaces(&state.storage_path, &entries).map_err(|err| {
            format!(
                "应用已创建（ID: {}）但本地未能保存部署信息：{err}。请记录此 ID 或重试。",
                app.app_id
            )
        })?;
    }

    Ok(app)
}

#[tauri::command]
pub(crate) async fn deploy_status(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<DeployApp, String> {
    if remote_backend::is_remote_mode(&state).await {
        return Err(REMOTE_UNSUPPORTED.to_string());
    }
    let token = require_token()?;
    let base_url = service_base_url();
    let app_id = workspace_app_id(&state, &workspace_id).await?;
    deploy_core::deploy_status_core(&app_id, &token, &base_url).await
}

#[tauri::command]
pub(crate) async fn deploy_build_log(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&state).await {
        return Err(REMOTE_UNSUPPORTED.to_string());
    }
    let token = require_token()?;
    let base_url = service_base_url();
    let app_id = workspace_app_id(&state, &workspace_id).await?;
    let app = deploy_core::deploy_status_core(&app_id, &token, &base_url).await?;
    let deployment_id = app
        .deployment_id
        .ok_or_else(|| "暂无构建（没有可取日志的部署）。".to_string())?;
    deploy_core::deploy_build_log_core(&app_id, &deployment_id, &token, &base_url).await
}

#[tauri::command]
pub(crate) async fn deploy_token_status(state: State<'_, AppState>) -> Result<bool, String> {
    if remote_backend::is_remote_mode(&state).await {
        return Err(REMOTE_UNSUPPORTED.to_string());
    }
    runtime_secret_core::adg_deploy_token_exists()
}

#[tauri::command]
pub(crate) async fn deploy_set_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&state).await {
        return Err(REMOTE_UNSUPPORTED.to_string());
    }
    runtime_secret_core::set_adg_deploy_token(&token)
}

#[tauri::command]
pub(crate) async fn deploy_clear_token(state: State<'_, AppState>) -> Result<(), String> {
    if remote_backend::is_remote_mode(&state).await {
        return Err(REMOTE_UNSUPPORTED.to_string());
    }
    runtime_secret_core::clear_adg_deploy_token()
}
