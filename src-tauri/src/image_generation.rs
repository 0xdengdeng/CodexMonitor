use tauri::State;

use crate::shared::image_generation_core::{self, GenerateImageRequest, GeneratedImageAsset};
use crate::shared::runtime_secret_core;
use crate::state::AppState;

fn app_data_dir(state: &State<'_, AppState>) -> std::path::PathBuf {
    state
        .storage_path
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()))
}

#[tauri::command]
pub(crate) async fn generate_image(
    workspace_id: Option<String>,
    thread_id: Option<String>,
    prompt: String,
    size: Option<String>,
    state: State<'_, AppState>,
) -> Result<GeneratedImageAsset, String> {
    let api_key = runtime_secret_core::get_runtime_api_key()?
        .ok_or_else(|| "请先登录启航 AI 后再生成图片。".to_string())?;
    let data_dir = app_data_dir(&state);
    image_generation_core::generate_image_core(
        &data_dir,
        &crate::enterprise_ai::service_base_url(),
        &api_key,
        GenerateImageRequest {
            workspace_id,
            thread_id,
            prompt,
            size,
        },
    )
    .await
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
