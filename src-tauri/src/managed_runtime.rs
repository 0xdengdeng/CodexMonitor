use tauri::AppHandle;

use crate::shared::workspaces_core::{self, WorkspaceRuntimeRestartResult};
use crate::state::AppState;

pub(crate) async fn restart_connected_workspace_sessions(
    state: &AppState,
    app: &AppHandle,
) -> Result<WorkspaceRuntimeRestartResult, String> {
    let app = app.clone();
    workspaces_core::restart_connected_workspace_sessions_core(
        &state.workspaces,
        &state.sessions,
        &state.app_settings,
        move |entry, codex_args, codex_home| {
            crate::codex::spawn_workspace_session(entry, codex_args, app.clone(), codex_home)
        },
    )
    .await
}
