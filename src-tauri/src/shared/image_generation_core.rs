use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

const IMAGE_MODEL: &str = "gpt-image-2";
const IMAGE_SIZE: &str = "1024x1024";
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
static GENERATED_IMAGE_INDEX_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ParsedAdgImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) mime_type: String,
    pub(crate) url: Option<String>,
    pub(crate) model_visible_image_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ImageGenerationError {
    pub(crate) user_message: String,
    pub(crate) technical_message: Option<String>,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct GenerateImageRequest {
    pub(crate) workspace_id: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) prompt: String,
    pub(crate) size: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct StoreGeneratedImageInput {
    pub(crate) workspace_id: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) prompt: String,
    pub(crate) revised_prompt: Option<String>,
    pub(crate) model: String,
    pub(crate) size: String,
    pub(crate) request_id: Option<String>,
    pub(crate) mime_type: String,
    pub(crate) bytes: Vec<u8>,
    pub(crate) model_visible_image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedImageAsset {
    pub(crate) id: String,
    pub(crate) workspace_id: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) source: String,
    pub(crate) model: String,
    pub(crate) prompt: String,
    pub(crate) revised_prompt: Option<String>,
    pub(crate) size: String,
    pub(crate) local_path: String,
    pub(crate) model_visible_image_url: Option<String>,
    pub(crate) mime_type: String,
    pub(crate) created_at_ms: i64,
    pub(crate) request_id: Option<String>,
    pub(crate) status: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn build_adg_image_request(prompt: &str, size: Option<&str>) -> Value {
    json!({
        "model": IMAGE_MODEL,
        "prompt": prompt,
        "size": size.unwrap_or(IMAGE_SIZE),
        "n": 1
    })
}

pub(crate) fn normalize_adg_error(status: u16, body: &str) -> ImageGenerationError {
    let payload = serde_json::from_str::<Value>(body).unwrap_or(Value::Null);
    let error = payload.get("error").unwrap_or(&payload);
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let user_message = if code == "model_unpriced" || message.contains("model_unpriced") {
        "图片模型还未启用计费，请联系管理员在模型定价中启用 gpt-image-2。"
    } else if status == 401 || status == 403 {
        "当前 API Key 无法使用生图，请重新登录或联系管理员。"
    } else if status == 408 || status == 429 || status >= 500 {
        "暂时无法连接生图服务，请检查网络后重试。"
    } else {
        "生图服务返回错误，请稍后重试。"
    };
    ImageGenerationError {
        user_message: user_message.to_string(),
        technical_message: if message.is_empty() {
            None
        } else {
            Some(message.to_string())
        },
        request_id: None,
    }
}

pub(crate) fn parse_adg_image_response(body: &str) -> Result<ParsedAdgImage, ImageGenerationError> {
    let payload = serde_json::from_str::<Value>(body).map_err(|err| ImageGenerationError {
        user_message: "生图服务返回了无法识别的数据，请稍后重试。".to_string(),
        technical_message: Some(err.to_string()),
        request_id: None,
    })?;
    let first = payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(no_image_returned)?;
    if let Some(url) = first
        .get("url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(ParsedAdgImage {
            bytes: Vec::new(),
            mime_type: "image/png".to_string(),
            url: Some(url.to_string()),
            model_visible_image_url: Some(url.to_string()),
        });
    }
    let encoded = first
        .get("b64_json")
        .or_else(|| first.get("b64Json"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(no_image_returned)?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|err| ImageGenerationError {
            user_message: "生图服务返回了无法识别的图片数据，请稍后重试。".to_string(),
            technical_message: Some(err.to_string()),
            request_id: None,
        })?;
    let mime_type = detect_image_mime_type(&bytes).unwrap_or_else(|| "image/png".to_string());
    let model_visible_image_url = format!("data:{mime_type};base64,{encoded}");
    Ok(ParsedAdgImage {
        bytes,
        mime_type,
        url: None,
        model_visible_image_url: Some(model_visible_image_url),
    })
}

fn no_image_returned() -> ImageGenerationError {
    ImageGenerationError {
        user_message: "生图服务没有返回图片，请稍后重试。".to_string(),
        technical_message: None,
        request_id: None,
    }
}

fn detect_image_mime_type(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Some("image/png".to_string());
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg".to_string());
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp".to_string());
    }
    None
}

fn extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

pub(crate) fn store_generated_image(
    data_dir: &Path,
    input: StoreGeneratedImageInput,
) -> Result<GeneratedImageAsset, String> {
    if input.bytes.is_empty() {
        return Err("生图服务没有返回图片，请稍后重试。".to_string());
    }
    let root = data_dir.join("generated-images");
    let images_dir = root.join("images");
    fs::create_dir_all(&images_dir)
        .map_err(|err| format!("Failed to create generated image directory: {err}"))?;
    let id = format!("asset-{}", Uuid::new_v4());
    let ext = extension_for_mime_type(&input.mime_type);
    let local_path = images_dir.join(format!("{id}.{ext}"));
    fs::write(&local_path, &input.bytes)
        .map_err(|err| format!("Failed to write generated image: {err}"))?;

    let asset = GeneratedImageAsset {
        id,
        workspace_id: input.workspace_id,
        thread_id: input.thread_id,
        source: "adg".to_string(),
        model: input.model,
        prompt: input.prompt,
        revised_prompt: input.revised_prompt,
        size: input.size,
        local_path: local_path.to_string_lossy().to_string(),
        model_visible_image_url: input.model_visible_image_url,
        mime_type: input.mime_type,
        created_at_ms: now_ms(),
        request_id: input.request_id,
        status: "completed".to_string(),
    };
    let _guard = GENERATED_IMAGE_INDEX_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Failed to lock generated image index.".to_string())?;
    append_asset_to_index(&root.join("index.json"), &asset)?;
    Ok(asset)
}

pub(crate) fn list_generated_images(
    data_dir: &Path,
    workspace_id: Option<&str>,
    thread_id: Option<&str>,
) -> Result<Vec<GeneratedImageAsset>, String> {
    let index_path = data_dir.join("generated-images").join("index.json");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(&index_path)
        .map_err(|err| format!("Failed to read generated image index: {err}"))?;
    let mut assets = serde_json::from_str::<Vec<GeneratedImageAsset>>(&contents)
        .map_err(|err| format!("Failed to parse generated image index: {err}"))?;
    if let Some(workspace_id) = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        assets.retain(|asset| asset.workspace_id.as_deref() == Some(workspace_id));
    }
    if let Some(thread_id) = thread_id.map(str::trim).filter(|value| !value.is_empty()) {
        assets.retain(|asset| asset.thread_id.as_deref() == Some(thread_id));
    }
    assets.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(assets)
}

fn append_asset_to_index(index_path: &Path, asset: &GeneratedImageAsset) -> Result<(), String> {
    let mut assets = if index_path.exists() {
        let contents = fs::read_to_string(index_path)
            .map_err(|err| format!("Failed to read generated image index: {err}"))?;
        serde_json::from_str::<Vec<GeneratedImageAsset>>(&contents).unwrap_or_default()
    } else {
        Vec::new()
    };
    assets.push(asset.clone());
    let rendered = serde_json::to_string_pretty(&assets)
        .map_err(|err| format!("Failed to encode generated image index: {err}"))?;
    let temp_path = index_path.with_extension("json.tmp");
    fs::write(&temp_path, rendered)
        .map_err(|err| format!("Failed to write generated image index: {err}"))?;
    fs::rename(&temp_path, index_path)
        .map_err(|err| format!("Failed to replace generated image index: {err}"))?;
    Ok(())
}

pub(crate) async fn generate_image_core(
    data_dir: &Path,
    service_base_url: &str,
    api_key: &str,
    request: GenerateImageRequest,
) -> Result<GeneratedImageAsset, String> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("请输入图片描述。".to_string());
    }
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("请先登录启航 AI 后再生成图片。".to_string());
    }
    let size = request
        .size
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(IMAGE_SIZE);
    if size != IMAGE_SIZE {
        return Err("当前仅支持 1024x1024 图片尺寸。".to_string());
    }
    let base = service_base_url.trim().trim_end_matches('/');
    let url = format!("{base}/v1/images/generations");
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化生图请求：{err}"))?;
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .header(CONTENT_TYPE, "application/json")
        .json(&build_adg_image_request(prompt, Some(size)))
        .send()
        .await
        .map_err(|_| "暂时无法连接生图服务，请检查网络后重试。".to_string())?;
    let status = response.status();
    let request_id = response
        .headers()
        .get("x-adg-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let mut error = normalize_adg_error(status.as_u16(), &body);
        error.request_id = request_id;
        return Err(error.user_message);
    }
    let mut parsed = parse_adg_image_response(&body).map_err(|mut err| {
        err.request_id = request_id.clone();
        err.user_message
    })?;
    if let Some(url) = parsed.url.as_deref() {
        let downloaded = download_image_url(&client, url).await?;
        parsed.bytes = downloaded.0;
        parsed.mime_type = downloaded.1;
    }
    let mime_type =
        detect_image_mime_type(&parsed.bytes).unwrap_or_else(|| parsed.mime_type.clone());
    store_generated_image(
        data_dir,
        StoreGeneratedImageInput {
            workspace_id: request.workspace_id,
            thread_id: request.thread_id,
            prompt: prompt.to_string(),
            revised_prompt: None,
            model: IMAGE_MODEL.to_string(),
            size: size.to_string(),
            request_id,
            mime_type,
            bytes: parsed.bytes,
            model_visible_image_url: parsed.model_visible_image_url,
        },
    )
}

async fn download_image_url(
    client: &reqwest::Client,
    url: &str,
) -> Result<(Vec<u8>, String), String> {
    if !url.starts_with("https://") {
        return Err("生图服务返回了不安全的图片地址。".to_string());
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "暂时无法下载生成的图片，请稍后重试。".to_string())?;
    if !response.status().is_success() {
        return Err("暂时无法下载生成的图片，请稍后重试。".to_string());
    }
    if let Some(length) = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
    {
        if length > MAX_IMAGE_BYTES {
            return Err("生成的图片过大，已停止下载。".to_string());
        }
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .map(str::to_string);
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "暂时无法下载生成的图片，请稍后重试。".to_string())?;
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
            return Err("生成的图片过大，已停止下载。".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let detected = detect_image_mime_type(&bytes);
    let mime_type = detected
        .or(content_type)
        .ok_or_else(|| "生图服务返回的文件不是可识别的图片，请稍后重试。".to_string())?;
    Ok((bytes, mime_type))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn build_adg_request_uses_phase_one_defaults() {
        let request = build_adg_image_request("A small blue rocket icon", None);

        assert_eq!(
            request,
            json!({
                "model": "gpt-image-2",
                "prompt": "A small blue rocket icon",
                "size": "1024x1024",
                "n": 1
            })
        );
    }

    #[test]
    fn parse_adg_response_accepts_base64_images() {
        let encoded = STANDARD.encode([137, 80, 78, 71, 13, 10, 26, 10]);
        let parsed = parse_adg_image_response(
            &json!({
                "data": [
                    { "b64_json": encoded }
                ]
            })
            .to_string(),
        )
        .expect("base64 response should parse");

        assert_eq!(parsed.mime_type, "image/png");
        assert_eq!(parsed.bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
        assert_eq!(
            parsed.model_visible_image_url,
            Some(format!("data:image/png;base64,{encoded}"))
        );
    }

    #[test]
    fn normalize_adg_error_maps_model_unpriced() {
        let error = normalize_adg_error(
            400,
            r#"{"error":{"code":"model_unpriced","message":"model is not priced"}}"#,
        );

        assert_eq!(
            error.user_message,
            "图片模型还未启用计费，请联系管理员在模型定价中启用 gpt-image-2。"
        );
    }

    #[test]
    fn generated_asset_index_persists_without_api_key() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let bytes = [137, 80, 78, 71, 13, 10, 26, 10];
        let asset = store_generated_image(
            &dir,
            StoreGeneratedImageInput {
                workspace_id: Some("ws-1".to_string()),
                thread_id: Some("thread-1".to_string()),
                prompt: "A small blue rocket icon".to_string(),
                revised_prompt: None,
                model: "gpt-image-2".to_string(),
                size: "1024x1024".to_string(),
                request_id: Some("req-1".to_string()),
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: Some("data:image/png;base64,test".to_string()),
            },
        )
        .expect("image should be stored");

        assert!(asset.local_path.ends_with(".png"));
        assert_eq!(asset.workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(asset.thread_id.as_deref(), Some("thread-1"));
        assert_eq!(asset.prompt, "A small blue rocket icon");
        assert_eq!(
            asset.model_visible_image_url.as_deref(),
            Some("data:image/png;base64,test")
        );

        let index = std::fs::read_to_string(dir.join("generated-images/index.json"))
            .expect("index should be written");
        assert!(index.contains("asset-"));
        assert!(!index.contains("apiKey"));
        assert!(!index.contains("sk-secret"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn list_generated_images_filters_by_workspace_and_thread() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let bytes = [137, 80, 78, 71, 13, 10, 26, 10];
        let first = store_generated_image(
            &dir,
            StoreGeneratedImageInput {
                workspace_id: Some("ws-1".to_string()),
                thread_id: Some("thread-1".to_string()),
                prompt: "First".to_string(),
                revised_prompt: None,
                model: "gpt-image-2".to_string(),
                size: "1024x1024".to_string(),
                request_id: None,
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: None,
            },
        )
        .expect("first image should be stored");
        let second = store_generated_image(
            &dir,
            StoreGeneratedImageInput {
                workspace_id: Some("ws-2".to_string()),
                thread_id: Some("thread-2".to_string()),
                prompt: "Second".to_string(),
                revised_prompt: None,
                model: "gpt-image-2".to_string(),
                size: "1024x1024".to_string(),
                request_id: None,
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: None,
            },
        )
        .expect("second image should be stored");

        let workspace_images =
            list_generated_images(&dir, Some("ws-1"), None).expect("list should work");
        assert_eq!(workspace_images.len(), 1);
        assert_eq!(workspace_images[0].id, first.id);

        let thread_images =
            list_generated_images(&dir, None, Some("thread-2")).expect("list should work");
        assert_eq!(thread_images.len(), 1);
        assert_eq!(thread_images[0].id, second.id);
        let _ = std::fs::remove_dir_all(dir);
    }
}
