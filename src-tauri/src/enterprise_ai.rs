use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::{CONTENT_TYPE, COOKIE, SET_COOKIE};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::managed_runtime;
use crate::shared::runtime_secret_core;
use crate::shared::settings_core::{
    clear_managed_runtime_account_core, managed_runtime_config_changed, update_app_settings_core,
};
use crate::state::AppState;
use crate::types::{
    AppSettings, EnterpriseAiConfig, EnterpriseAiLoginResult, EnterpriseAiStatus,
    EnterpriseAiUsageSnapshot, ManagedRuntimeConfig,
};

// debug build (tauri dev) → UAT;release build (tauri build) → prod.
// 环境变量 CODEXMONITOR_ENTERPRISE_AI_BASE_URL / AI_DEVELOPMENT_GATEWAY_URL 仍可 override。
const DEFAULT_SERVICE_BASE_URL: &str = if cfg!(debug_assertions) {
    "https://adg-uat.zhaozhunai.com"
} else {
    "https://adg.zhaozhunai.com"
};

#[derive(Debug)]
struct EnterpriseSession {
    tenant_domain: String,
    account_name: Option<String>,
    key_last4: Option<String>,
    cookie_header: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn service_base_url() -> String {
    std::env::var("CODEXMONITOR_ENTERPRISE_AI_BASE_URL")
        .or_else(|_| std::env::var("AI_DEVELOPMENT_GATEWAY_URL"))
        .ok()
        .and_then(|value| {
            let trimmed = value.trim().trim_end_matches('/').to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(|| DEFAULT_SERVICE_BASE_URL.to_string())
}

fn runtime_base_url() -> String {
    format!("{}/v1", service_base_url())
}

fn key_last4(api_key: &str) -> Option<String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return None;
    }
    let chars: Vec<char> = trimmed.chars().collect();
    let start = chars.len().saturating_sub(4);
    Some(chars[start..].iter().collect())
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn json_i64(value: &Value, path: &[&str]) -> Option<i64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_i64()
}

fn json_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn cookie_header(response: &reqwest::Response) -> Result<String, String> {
    let cookies = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| value.split(';').next())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_string())
        .collect::<Vec<_>>();
    if cookies.is_empty() {
        return Err("登录成功但没有返回账号会话，请稍后重试。".to_string());
    }
    Ok(cookies.join("; "))
}

fn user_facing_login_error(status: reqwest::StatusCode, body: &str) -> String {
    if body.contains("api_key_expired") {
        return "API Key 已失效，请联系管理员更新。".to_string();
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return "租户域或 API Key 不正确。".to_string();
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return "登录尝试过于频繁，请稍后再试。".to_string();
    }
    format!("登录失败：HTTP {status}")
}

async fn login_session(tenant_domain: &str, api_key: &str) -> Result<EnterpriseSession, String> {
    let tenant_domain = tenant_domain.trim();
    let api_key = api_key.trim();
    if tenant_domain.is_empty() {
        return Err("请输入租户域。".to_string());
    }
    if api_key.is_empty() {
        return Err("请输入 API Key。".to_string());
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化登录请求：{err}"))?;
    let url = format!("{}/admin/api/auth/login", service_base_url());
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "tenant_slug": tenant_domain, "api_key": api_key }).to_string())
        .send()
        .await
        .map_err(|_| "无法连接登录服务，请检查网络后重试。".to_string())?;
    let status = response.status();
    let cookie = if status.is_success() {
        Some(cookie_header(&response)?)
    } else {
        None
    };
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(user_facing_login_error(status, &body));
    }
    let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    Ok(EnterpriseSession {
        tenant_domain: json_string(&payload, "tenant_slug")
            .unwrap_or_else(|| tenant_domain.to_string()),
        account_name: json_string(&payload, "label"),
        key_last4: key_last4(api_key),
        cookie_header: cookie.unwrap_or_default(),
    })
}

fn settings_with_connected_account(
    mut settings: AppSettings,
    session: &EnterpriseSession,
) -> AppSettings {
    settings.enterprise_ai = EnterpriseAiConfig {
        tenant_domain: Some(session.tenant_domain.clone()),
        status: EnterpriseAiStatus::Connected,
        account_name: session.account_name.clone(),
        key_last4: session.key_last4.clone(),
        last_validated_at_ms: Some(now_ms()),
        last_error: None,
    };
    settings.managed_runtime = ManagedRuntimeConfig {
        enabled: true,
        base_url: Some(runtime_base_url()),
        model: settings.managed_runtime.model,
    };
    settings
}

async fn persist_settings(
    settings: AppSettings,
    state: &State<'_, AppState>,
) -> Result<AppSettings, String> {
    update_app_settings_core(settings, &state.app_settings, &state.settings_path).await
}

async fn fetch_json(path: &str, cookie: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化账号请求：{err}"))?;
    let response = client
        .get(format!("{}{}", service_base_url(), path))
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|_| "无法获取账号信息，请稍后重试。".to_string())?;
    if !response.status().is_success() {
        return Err(format!("账号信息获取失败：HTTP {}", response.status()));
    }
    response
        .json::<Value>()
        .await
        .map_err(|err| format!("账号信息格式无法识别：{err}"))
}

async fn usage_for_session(session: &EnterpriseSession) -> EnterpriseAiUsageSnapshot {
    let usage = fetch_json("/admin/api/me/usage?range=7d", &session.cookie_header)
        .await
        .unwrap_or(Value::Null);
    let credits = fetch_json("/admin/api/me/credits", &session.cookie_header)
        .await
        .unwrap_or(Value::Null);

    EnterpriseAiUsageSnapshot {
        tenant_domain: Some(session.tenant_domain.clone()),
        account_name: session.account_name.clone(),
        updated_at_ms: now_ms(),
        requests_7d: json_i64(&usage, &["summary", "requests"]),
        tokens_7d: json_i64(&usage, &["summary", "total_tokens"]),
        balance: json_f64(&credits, "balance"),
        credited_total: json_f64(&credits, "credited_total"),
        usage_spent_total: json_f64(&credits, "usage_spent_total"),
    }
}

#[tauri::command]
pub(crate) async fn enterprise_ai_login(
    tenant_domain: String,
    api_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EnterpriseAiLoginResult, String> {
    let session = login_session(&tenant_domain, &api_key).await?;
    runtime_secret_core::set_runtime_api_key(api_key.trim())?;
    let current = state.app_settings.lock().await.clone();
    let settings =
        persist_settings(settings_with_connected_account(current, &session), &state).await?;
    managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    let usage = Some(usage_for_session(&session).await);
    Ok(EnterpriseAiLoginResult { settings, usage })
}

#[tauri::command]
pub(crate) async fn enterprise_ai_validate(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EnterpriseAiLoginResult, String> {
    let current = state.app_settings.lock().await.clone();
    let Some(tenant_domain) = current.enterprise_ai.tenant_domain.clone() else {
        return Ok(EnterpriseAiLoginResult {
            settings: current,
            usage: None,
        });
    };
    let Some(api_key) = runtime_secret_core::get_runtime_api_key()? else {
        let mut next = current;
        next.enterprise_ai.status = EnterpriseAiStatus::Invalid;
        next.enterprise_ai.last_error = Some("保存的 API Key 不存在，请重新登录。".to_string());
        let settings = persist_settings(next, &state).await?;
        return Ok(EnterpriseAiLoginResult {
            settings,
            usage: None,
        });
    };

    match login_session(&tenant_domain, &api_key).await {
        Ok(session) => {
            let settings = persist_settings(
                settings_with_connected_account(current.clone(), &session),
                &state,
            )
            .await?;
            if managed_runtime_config_changed(&current, &settings) {
                managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
            }
            let usage = Some(usage_for_session(&session).await);
            Ok(EnterpriseAiLoginResult { settings, usage })
        }
        Err(err) => {
            let mut next = current;
            next.enterprise_ai.status = EnterpriseAiStatus::Invalid;
            next.enterprise_ai.last_error = Some(err);
            next.enterprise_ai.last_validated_at_ms = Some(now_ms());
            let settings = persist_settings(next, &state).await?;
            Ok(EnterpriseAiLoginResult {
                settings,
                usage: None,
            })
        }
    }
}

#[tauri::command]
pub(crate) async fn enterprise_ai_logout(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSettings, String> {
    runtime_secret_core::clear_runtime_api_key()?;
    let settings =
        clear_managed_runtime_account_core(&state.app_settings, &state.settings_path).await?;
    managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn enterprise_ai_usage(
    state: State<'_, AppState>,
) -> Result<Option<EnterpriseAiUsageSnapshot>, String> {
    let current = state.app_settings.lock().await.clone();
    let Some(tenant_domain) = current.enterprise_ai.tenant_domain else {
        return Ok(None);
    };
    let Some(api_key) = runtime_secret_core::get_runtime_api_key()? else {
        return Ok(None);
    };
    let session = login_session(&tenant_domain, &api_key).await?;
    Ok(Some(usage_for_session(&session).await))
}
