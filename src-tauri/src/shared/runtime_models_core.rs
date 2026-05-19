use serde_json::Value;

use crate::shared::runtime_config_core::{
    managed_runtime_config_is_complete, normalize_managed_runtime_config,
};
use crate::shared::runtime_secret_core;
use crate::types::ManagedRuntimeConfig;

pub(crate) fn runtime_model_list_url(base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("ADG runtime Base URL is missing.".to_string());
    }
    Ok(format!("{base}/models"))
}

pub(crate) fn runtime_image_model_list_url(base_url: &str) -> Result<String, String> {
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("ADG runtime Base URL is missing.".to_string());
    }
    if let Some(root) = base.strip_suffix("/adg/v1") {
        base = root.to_string();
    } else if let Some(root) = base.strip_suffix("/v1") {
        base = root.to_string();
    }
    if base.is_empty() {
        return Err("ADG runtime Base URL is missing.".to_string());
    }
    Ok(format!("{base}/adg/v1/models/images"))
}

fn runtime_model_list_error(status: reqwest::StatusCode, body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let code = parsed
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("code"))
                .and_then(Value::as_str)
        });
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
        });
    match (code, message) {
        (Some(code), Some(message)) => format!("ADG model list failed: {code}: {message}"),
        (Some(code), None) => format!("ADG model list failed: {code}"),
        (None, Some(message)) => format!("ADG model list failed: {message}"),
        (None, None) => format!("ADG model list failed: HTTP {status}"),
    }
}

pub(crate) async fn runtime_model_list_core(
    config: &ManagedRuntimeConfig,
) -> Result<Value, String> {
    let config = normalize_managed_runtime_config(config);
    if !managed_runtime_config_is_complete(&config) {
        return Err("ADG runtime is not configured.".to_string());
    }
    let api_key = runtime_secret_core::get_runtime_api_key()?
        .ok_or_else(|| "ADG API Key is missing.".to_string())?;
    let url = runtime_model_list_url(config.base_url.as_deref().unwrap_or_default())?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("Unable to initialize ADG model request: {err}"))?;
    let response = client
        .get(url)
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|err| format!("Unable to fetch ADG models: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("Unable to read ADG model response: {err}"))?;
    if !status.is_success() {
        return Err(runtime_model_list_error(status, &body));
    }
    serde_json::from_str::<Value>(&body)
        .map_err(|err| format!("Unable to parse ADG model response: {err}"))
}

pub(crate) async fn runtime_image_model_list_core(
    config: &ManagedRuntimeConfig,
) -> Result<Value, String> {
    let config = normalize_managed_runtime_config(config);
    if !managed_runtime_config_is_complete(&config) {
        return Err("ADG runtime is not configured.".to_string());
    }
    let api_key = runtime_secret_core::get_runtime_api_key()?
        .ok_or_else(|| "ADG API Key is missing.".to_string())?;
    let url = runtime_image_model_list_url(config.base_url.as_deref().unwrap_or_default())?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("Unable to initialize ADG image model request: {err}"))?;
    let response = client
        .get(url)
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|err| format!("Unable to fetch ADG image models: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("Unable to read ADG image model response: {err}"))?;
    if !status.is_success() {
        return Err(runtime_model_list_error(status, &body));
    }
    serde_json::from_str::<Value>(&body)
        .map_err(|err| format!("Unable to parse ADG image model response: {err}"))
}

#[cfg(test)]
mod tests {
    use super::{runtime_image_model_list_url, runtime_model_list_url};

    #[test]
    fn runtime_model_list_url_appends_models_to_v1_base() {
        assert_eq!(
            runtime_model_list_url("https://adg-uat.zhaozhunai.com/v1").as_deref(),
            Ok("https://adg-uat.zhaozhunai.com/v1/models")
        );
    }

    #[test]
    fn runtime_model_list_url_trims_trailing_slash() {
        assert_eq!(
            runtime_model_list_url("https://adg-uat.zhaozhunai.com/v1/").as_deref(),
            Ok("https://adg-uat.zhaozhunai.com/v1/models")
        );
    }

    #[test]
    fn runtime_image_model_list_url_uses_app_api_root_from_v1_base() {
        assert_eq!(
            runtime_image_model_list_url("https://adg-uat.zhaozhunai.com/v1").as_deref(),
            Ok("https://adg-uat.zhaozhunai.com/adg/v1/models/images")
        );
    }
}
