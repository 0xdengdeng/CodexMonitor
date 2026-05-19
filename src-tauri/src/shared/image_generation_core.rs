use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub(crate) const DEFAULT_IMAGE_MODEL: &str = "adg-image";
const DEFAULT_IMAGE_SIZE: &str = "auto";
const GPT_IMAGE_2_MAX_EDGE: u64 = 3840;
const GPT_IMAGE_2_MIN_PIXELS: u64 = 655_360;
const GPT_IMAGE_2_MAX_PIXELS: u64 = 8_294_400;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_REFERENCE_IMAGES: usize = 4;
const SUPPORTED_REFERENCE_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
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
    pub(crate) model: Option<String>,
    pub(crate) prompt: String,
    pub(crate) size: Option<String>,
    pub(crate) reference_image_ids: Option<Vec<String>>,
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
    pub(crate) reference_image_ids: Vec<String>,
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
    #[serde(default)]
    pub(crate) reference_image_ids: Vec<String>,
    pub(crate) status: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn build_adg_image_request(model: &str, prompt: &str, size: Option<&str>) -> Value {
    json!({
        "model": model,
        "prompt": prompt,
        "size": size.unwrap_or(DEFAULT_IMAGE_SIZE),
        "n": 1
    })
}

fn normalize_image_model(model: Option<&str>) -> String {
    model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_IMAGE_MODEL)
        .to_string()
}

pub(crate) fn normalize_image_size(size: Option<&str>) -> Result<String, String> {
    let size = size.map(str::trim).filter(|value| !value.is_empty());
    let Some(size) = size else {
        return Ok(DEFAULT_IMAGE_SIZE.to_string());
    };
    if size.eq_ignore_ascii_case(DEFAULT_IMAGE_SIZE) {
        return Ok(DEFAULT_IMAGE_SIZE.to_string());
    }

    let (width, height) = parse_image_size(size)?;
    validate_gpt_image_2_size(width, height)?;
    Ok(format!("{width}x{height}"))
}

fn parse_image_size(size: &str) -> Result<(u64, u64), String> {
    let Some((width, height)) = size.split_once('x').or_else(|| size.split_once('X')) else {
        return Err(invalid_image_size_message());
    };
    let width = width
        .trim()
        .parse::<u64>()
        .map_err(|_| invalid_image_size_message())?;
    let height = height
        .trim()
        .parse::<u64>()
        .map_err(|_| invalid_image_size_message())?;
    if width == 0 || height == 0 {
        return Err(invalid_image_size_message());
    }
    Ok((width, height))
}

fn validate_gpt_image_2_size(width: u64, height: u64) -> Result<(), String> {
    let max_edge = width.max(height);
    let min_edge = width.min(height);
    let total_pixels = width
        .checked_mul(height)
        .ok_or_else(invalid_image_size_message)?;

    if max_edge > GPT_IMAGE_2_MAX_EDGE {
        return Err(invalid_image_size_message());
    }
    if width % 16 != 0 || height % 16 != 0 {
        return Err(invalid_image_size_message());
    }
    if max_edge > min_edge * 3 {
        return Err(invalid_image_size_message());
    }
    if !(GPT_IMAGE_2_MIN_PIXELS..=GPT_IMAGE_2_MAX_PIXELS).contains(&total_pixels) {
        return Err(invalid_image_size_message());
    }
    Ok(())
}

fn invalid_image_size_message() -> String {
    "当前支持 auto，或符合图片模型约束的 WIDTHxHEIGHT：最大边不超过 3840px，宽高都是 16 的倍数，长短边比例不超过 3:1，总像素在 655,360 到 8,294,400 之间。"
        .to_string()
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
        "图片模型还未启用计费，请联系管理员在模型定价中启用当前图片模型。"
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

fn normalize_reference_image_ids(
    reference_image_ids: Option<&[String]>,
) -> Result<Vec<String>, String> {
    let Some(reference_image_ids) = reference_image_ids else {
        return Ok(Vec::new());
    };
    let mut normalized = Vec::new();
    for id in reference_image_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        if !normalized.iter().any(|existing| existing == id) {
            normalized.push(id.to_string());
        }
    }
    if normalized.len() > MAX_REFERENCE_IMAGES {
        return Err(format!("一次最多支持 {MAX_REFERENCE_IMAGES} 张参考图片。"));
    }
    Ok(normalized)
}

#[derive(Debug, Clone, PartialEq)]
struct ResolvedReferenceImage {
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
}

fn read_reference_image_path(
    path: &Path,
    fallback_name: &str,
) -> Result<ResolvedReferenceImage, String> {
    let bytes =
        fs::read(path).map_err(|_| "无法读取参考图片，请重新生成或选择图片。".to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("参考图片过大，无法用于改图。".to_string());
    }
    let mime_type = detect_image_mime_type(&bytes)
        .ok_or_else(|| "参考图片格式不支持，请使用 PNG、JPEG 或 WebP。".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{fallback_name}.{}", extension_for_mime_type(&mime_type)));
    Ok(ResolvedReferenceImage {
        file_name,
        mime_type,
        bytes,
    })
}

fn read_reference_image(asset: &GeneratedImageAsset) -> Result<ResolvedReferenceImage, String> {
    read_reference_image_path(&PathBuf::from(&asset.local_path), &asset.id)
}

fn is_supported_reference_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            SUPPORTED_REFERENCE_EXTENSIONS
                .iter()
                .any(|extension| value.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

fn reference_file_names(reference_id: &str) -> Vec<String> {
    if Path::new(reference_id).extension().is_some() {
        return vec![reference_id.to_string()];
    }
    SUPPORTED_REFERENCE_EXTENSIONS
        .iter()
        .map(|extension| format!("{reference_id}.{extension}"))
        .collect()
}

fn newest_supported_image_file(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_supported_reference_path(&path) {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .unwrap_or(UNIX_EPOCH);
        let should_replace = match &newest {
            Some((current, _)) => modified > *current,
            None => true,
        };
        if should_replace {
            newest = Some((modified, path));
        }
    }
    newest.map(|(_, path)| path)
}

fn resolve_native_codex_reference_image(
    data_dir: &Path,
    reference_id: &str,
) -> Result<Option<ResolvedReferenceImage>, String> {
    let reference_id = reference_id.trim();
    if reference_id.is_empty() {
        return Ok(None);
    }

    let root = data_dir.join("codex-home").join("generated_images");
    let direct_path = Path::new(reference_id);
    if direct_path.is_absolute()
        && direct_path.starts_with(data_dir)
        && direct_path.is_file()
        && is_supported_reference_path(direct_path)
    {
        return read_reference_image_path(direct_path, reference_id).map(Some);
    }

    if !root.is_dir() {
        return Ok(None);
    }

    let thread_dir = root.join(reference_id);
    if thread_dir.is_dir() {
        if let Some(path) = newest_supported_image_file(&thread_dir) {
            return read_reference_image_path(&path, reference_id).map(Some);
        }
    }

    let names = reference_file_names(reference_id);
    for entry in fs::read_dir(&root).map_err(|err| format!("无法读取参考图片目录：{err}"))?
    {
        let Ok(entry) = entry else {
            continue;
        };
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        for name in &names {
            let path = dir.join(name);
            if path.is_file() {
                return read_reference_image_path(&path, reference_id).map(Some);
            }
        }
    }

    Ok(None)
}

fn resolve_reference_images(
    data_dir: &Path,
    reference_ids: &[String],
) -> Result<Vec<ResolvedReferenceImage>, String> {
    if reference_ids.is_empty() {
        return Ok(Vec::new());
    }
    let assets = list_generated_images(data_dir, None, None)?;
    let mut images = Vec::with_capacity(reference_ids.len());
    for id in reference_ids {
        if let Some(asset) = assets.iter().find(|asset| asset.id == *id) {
            images.push(read_reference_image(asset)?);
            continue;
        }
        if let Some(image) = resolve_native_codex_reference_image(data_dir, id)? {
            images.push(image);
            continue;
        }
        return Err("找不到参考图片，请重新生成或选择一张已生成图片。".to_string());
    }
    Ok(images)
}

fn build_adg_image_edit_form(
    model: &str,
    prompt: &str,
    size: &str,
    reference_images: &[ResolvedReferenceImage],
) -> Result<Form, String> {
    let mut form = Form::new()
        .text("model", model.to_string())
        .text("prompt", prompt.to_string())
        .text("size", size.to_string())
        .text("n", "1".to_string());
    for image in reference_images {
        let part = Part::bytes(image.bytes.clone())
            .file_name(image.file_name.clone())
            .mime_str(&image.mime_type)
            .map_err(|err| format!("无法准备参考图片：{err}"))?;
        form = form.part("image[]", part);
    }
    Ok(form)
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
        reference_image_ids: input.reference_image_ids,
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
    let size = normalize_image_size(request.size.as_deref())?;
    let image_model = normalize_image_model(request.model.as_deref());
    let reference_image_ids =
        normalize_reference_image_ids(request.reference_image_ids.as_deref())?;
    let reference_images = resolve_reference_images(data_dir, &reference_image_ids)?;
    let base = service_base_url.trim().trim_end_matches('/');
    let is_edit = !reference_images.is_empty();
    let url = if is_edit {
        format!("{base}/v1/images/edits")
    } else {
        format!("{base}/v1/images/generations")
    };
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化生图请求：{err}"))?;
    let request_builder = client.post(url).bearer_auth(api_key);
    let request_builder = if is_edit {
        request_builder.multipart(build_adg_image_edit_form(
            &image_model,
            prompt,
            &size,
            &reference_images,
        )?)
    } else {
        request_builder
            .header(CONTENT_TYPE, "application/json")
            .json(&build_adg_image_request(&image_model, prompt, Some(&size)))
    };
    let response = request_builder
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
            model: image_model,
            size,
            request_id,
            mime_type,
            bytes: parsed.bytes,
            model_visible_image_url: parsed.model_visible_image_url,
            reference_image_ids,
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
    fn build_adg_request_defaults_to_auto_size() {
        let request = build_adg_image_request("adg-image", "A small blue rocket icon", None);

        assert_eq!(
            request,
            json!({
                "model": "adg-image",
                "prompt": "A small blue rocket icon",
                "size": "auto",
                "n": 1
            })
        );
    }

    #[test]
    fn normalize_reference_image_ids_trims_deduplicates_and_limits() {
        let ids = vec![
            " asset-1 ".to_string(),
            "asset-1".to_string(),
            "".to_string(),
            "asset-2".to_string(),
        ];

        assert_eq!(
            normalize_reference_image_ids(Some(&ids)).unwrap(),
            vec!["asset-1".to_string(), "asset-2".to_string()]
        );

        let too_many = vec![
            "asset-1".to_string(),
            "asset-2".to_string(),
            "asset-3".to_string(),
            "asset-4".to_string(),
            "asset-5".to_string(),
        ];
        assert!(normalize_reference_image_ids(Some(&too_many)).is_err());
    }

    #[test]
    fn resolve_reference_images_reads_stored_source_asset() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let bytes = [137, 80, 78, 71, 13, 10, 26, 10];
        let source = store_generated_image(
            &dir,
            StoreGeneratedImageInput {
                workspace_id: Some("ws-1".to_string()),
                thread_id: Some("thread-1".to_string()),
                prompt: "Source".to_string(),
                revised_prompt: None,
                model: DEFAULT_IMAGE_MODEL.to_string(),
                size: "1024x1024".to_string(),
                request_id: None,
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: None,
                reference_image_ids: Vec::new(),
            },
        )
        .expect("source image should be stored");

        let images =
            resolve_reference_images(&dir, &[source.id.clone()]).expect("source should resolve");

        assert_eq!(images.len(), 1);
        assert!(images[0].file_name.starts_with(&source.id));
        assert_eq!(images[0].mime_type, "image/png");
        assert_eq!(images[0].bytes, bytes);
        assert!(images[0].file_name.ends_with(".png"));
        assert!(build_adg_image_edit_form(
            DEFAULT_IMAGE_MODEL,
            "Change the outfit to a suit",
            "1024x1536",
            &images,
        )
        .is_ok());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_reference_images_reads_native_codex_generated_image_by_call_id() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let thread_dir = dir
            .join("codex-home")
            .join("generated_images")
            .join("thread-1");
        std::fs::create_dir_all(&thread_dir).expect("native image dir should be created");
        let bytes = [137, 80, 78, 71, 13, 10, 26, 10];
        let image_path = thread_dir.join("ig_native_1.png");
        std::fs::write(&image_path, bytes).expect("native image should be written");

        let images = resolve_reference_images(&dir, &["ig_native_1".to_string()])
            .expect("native codex image should resolve");

        assert_eq!(images.len(), 1);
        assert_eq!(images[0].file_name, "ig_native_1.png");
        assert_eq!(images[0].mime_type, "image/png");
        assert_eq!(images[0].bytes, bytes);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn normalize_image_size_accepts_auto_and_valid_flexible_sizes() {
        assert_eq!(normalize_image_size(None).unwrap(), "auto");
        assert_eq!(normalize_image_size(Some("")).unwrap(), "auto");
        assert_eq!(normalize_image_size(Some(" auto ")).unwrap(), "auto");
        assert_eq!(
            normalize_image_size(Some("2048x1152")).unwrap(),
            "2048x1152"
        );
        assert_eq!(
            normalize_image_size(Some("2160x3840")).unwrap(),
            "2160x3840"
        );
    }

    #[test]
    fn normalize_image_size_rejects_sizes_outside_adg_image_constraints() {
        let cases = [
            "1024",
            "0x1024",
            "3841x2160",
            "1025x1024",
            "3840x1024",
            "512x512",
            "3840x3840",
        ];

        for size in cases {
            assert!(
                normalize_image_size(Some(size)).is_err(),
                "{size} should be rejected"
            );
        }
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
            "图片模型还未启用计费，请联系管理员在模型定价中启用当前图片模型。"
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
                model: DEFAULT_IMAGE_MODEL.to_string(),
                size: "1024x1024".to_string(),
                request_id: Some("req-1".to_string()),
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: Some("data:image/png;base64,test".to_string()),
                reference_image_ids: vec!["asset-source".to_string()],
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
        assert_eq!(asset.reference_image_ids, vec!["asset-source"]);

        let index = std::fs::read_to_string(dir.join("generated-images/index.json"))
            .expect("index should be written");
        assert!(index.contains("asset-"));
        assert!(index.contains("asset-source"));
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
                model: DEFAULT_IMAGE_MODEL.to_string(),
                size: "1024x1024".to_string(),
                request_id: None,
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: None,
                reference_image_ids: Vec::new(),
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
                model: DEFAULT_IMAGE_MODEL.to_string(),
                size: "1024x1024".to_string(),
                request_id: None,
                mime_type: "image/png".to_string(),
                bytes: bytes.to_vec(),
                model_visible_image_url: None,
                reference_image_ids: Vec::new(),
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
