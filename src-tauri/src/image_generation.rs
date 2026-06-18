use tauri::State;

use crate::shared::image_generation_core::{self, GeneratedImageAsset};
use crate::state::AppState;

fn app_data_dir(state: &State<'_, AppState>) -> std::path::PathBuf {
    state
        .storage_path
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()))
}

#[tauri::command]
pub(crate) async fn list_generated_images(
    workspace_id: Option<String>,
    thread_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<GeneratedImageAsset>, String> {
    let data_dir = app_data_dir(&state);
    image_generation_core::list_generated_images(
        &data_dir,
        workspace_id.as_deref(),
        thread_id.as_deref(),
    )
}
