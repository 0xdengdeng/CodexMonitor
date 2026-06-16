use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::CONTENT_TYPE;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::managed_runtime;
use crate::shared::runtime_config_core::DEFAULT_MANAGED_RUNTIME_MODEL;
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
    monthly_limit_credits: Option<f64>,
    used_credits: Option<f64>,
    remaining_credits: Option<f64>,
    credit_balance_credits: Option<f64>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn service_base_url() -> String {
    std::env::var("CODEXMONITOR_ENTERPRISE_AI_BASE_URL")
        .or_else(|_| std::env::var("AI_DEVELOPMENT_GATEWAY_URL"))
        .ok()
        .and_then(|value| normalize_service_base_url(&value))
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

fn json_string_path(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
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

fn json_f64_path(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_f64()
}

fn normalize_service_base_url(value: &str) -> Option<String> {
    let mut trimmed = value.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(root) = trimmed.strip_suffix("/adg/v1") {
        trimmed = root.to_string();
    } else if let Some(root) = trimmed.strip_suffix("/v1") {
        trimmed = root.to_string();
    }
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn error_code_and_message(body: &str) -> (Option<String>, Option<String>) {
    let Ok(payload) = serde_json::from_str::<Value>(body) else {
        return (None, None);
    };
    let error = payload.get("error").unwrap_or(&payload);
    (
        json_string(error, "code"),
        json_string(error, "message").or_else(|| json_string(&payload, "message")),
    )
}

fn user_facing_app_error(status: reqwest::StatusCode, body: &str) -> String {
    let (code, message) = error_code_and_message(body);
    match code.as_deref() {
        Some("INVALID_API_KEY") | Some("API_KEY_REQUIRED") | Some("invalid_api_key") => {
            return "API Key 不正确或已失效，请重新输入 sk-adg_*。".to_string();
        }
        Some("api_key_expired") => {
            return "API Key 已失效，请联系管理员更新。".to_string();
        }
        _ => {}
    }
    if body.contains("api_key_expired") {
        return "API Key 已失效，请联系管理员更新。".to_string();
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return "API Key 不正确或已失效，请重新输入 sk-adg_*。".to_string();
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return "请求过于频繁，请稍后再试。".to_string();
    }
    if let Some(message) = message {
        return format!("{message}（HTTP {status}）");
    }
    format!("请求失败：HTTP {status}")
}

fn ensure_adg_api_key(api_key: &str) -> Result<&str, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("请输入 API Key。".to_string());
    }
    if !api_key.starts_with("sk-adg_") {
        return Err("请输入 sk-adg_ 开头的 ADG API Key。".to_string());
    }
    Ok(api_key)
}

fn app_profile_payload(payload: &Value) -> &Value {
    payload.get("profile").unwrap_or(payload)
}

fn session_from_app_profile(payload: &Value, api_key: &str) -> Result<EnterpriseSession, String> {
    if payload
        .get("authenticated")
        .and_then(Value::as_bool)
        .is_some_and(|authenticated| !authenticated)
    {
        return Err("API Key 未通过网关认证。".to_string());
    }
    let profile = app_profile_payload(payload);
    let tenant_domain = json_string_path(profile, &["tenant", "slug"])
        .ok_or_else(|| "登录成功但没有返回租户信息，请稍后重试。".to_string())?;
    let account_name = json_string_path(profile, &["tenant", "name"])
        .or_else(|| json_string_path(profile, &["key", "label"]));
    Ok(EnterpriseSession {
        tenant_domain,
        account_name,
        key_last4: key_last4(api_key),
        monthly_limit_credits: json_f64_path(profile, &["quota", "monthly_limit_credits"]),
        used_credits: json_f64_path(profile, &["quota", "used_credits"]),
        remaining_credits: json_f64_path(profile, &["quota", "remaining_credits"]),
        credit_balance_credits: json_f64_path(profile, &["quota", "credit_balance_credits"]),
    })
}

async fn login_session(api_key: &str) -> Result<EnterpriseSession, String> {
    let api_key = ensure_adg_api_key(api_key)?;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化登录请求：{err}"))?;
    let url = format!("{}/adg/v1/auth/login", service_base_url());
    let response = client
        .post(url)
        .header(CONTENT_TYPE, "application/json")
        .body(json!({ "api_key": api_key }).to_string())
        .send()
        .await
        .map_err(|_| "无法连接登录服务，请检查网络后重试。".to_string())?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(user_facing_app_error(status, &body));
    }
    let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    session_from_app_profile(&payload, api_key)
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
        model: settings
            .managed_runtime
            .model
            .filter(|model| !model.trim().is_empty())
            .or_else(|| Some(DEFAULT_MANAGED_RUNTIME_MODEL.to_string())),
        image_model: settings.managed_runtime.image_model,
        native_image_generation: settings.managed_runtime.native_image_generation,
    };
    settings.last_composer_model_id = None;
    settings
}

async fn persist_settings(
    settings: AppSettings,
    state: &State<'_, AppState>,
) -> Result<AppSettings, String> {
    update_app_settings_core(settings, &state.app_settings, &state.settings_path).await
}

async fn fetch_app_json(path: &str, api_key: &str) -> Result<Value, String> {
    let api_key = ensure_adg_api_key(api_key)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化账号请求：{err}"))?;
    let response = client
        .get(format!("{}{}", service_base_url(), path))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|_| "无法获取账号信息，请稍后重试。".to_string())?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(user_facing_app_error(status, &body));
    }
    serde_json::from_str::<Value>(&body).map_err(|err| format!("账号信息格式无法识别：{err}"))
}

async fn post_app_json(path: &str, api_key: &str) -> Result<(), String> {
    let api_key = ensure_adg_api_key(api_key)?;
    let client = reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化账号请求：{err}"))?;
    let response = client
        .post(format!("{}{}", service_base_url(), path))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|_| "无法连接账号服务，请稍后重试。".to_string())?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(user_facing_app_error(status, &body));
    }
    Ok(())
}

async fn profile_session(api_key: &str) -> Result<EnterpriseSession, String> {
    let payload = fetch_app_json("/adg/v1/me/profile", api_key).await?;
    session_from_app_profile(&payload, api_key)
}

fn usage_total_tokens(usage: &Value) -> Option<i64> {
    json_i64(usage, &["summary", "total_tokens"]).or_else(|| {
        let parts = [
            json_i64(usage, &["summary", "input_tokens"]),
            json_i64(usage, &["summary", "output_tokens"]),
            json_i64(usage, &["summary", "cache_creation_tokens"]),
            json_i64(usage, &["summary", "cache_read_tokens"]),
        ];
        let mut seen = false;
        let mut total = 0;
        for value in parts.into_iter().flatten() {
            seen = true;
            total += value;
        }
        seen.then_some(total)
    })
}

fn usage_snapshot_from_app_payload(
    session: &EnterpriseSession,
    usage: &Value,
) -> EnterpriseAiUsageSnapshot {
    let balance = session
        .remaining_credits
        .filter(|value| *value > 0.0)
        .or(session.credit_balance_credits)
        .or(session.remaining_credits)
        .or(session.monthly_limit_credits);

    EnterpriseAiUsageSnapshot {
        tenant_domain: Some(session.tenant_domain.clone()),
        account_name: session.account_name.clone(),
        updated_at_ms: now_ms(),
        requests_7d: json_i64(usage, &["summary", "requests"]),
        tokens_7d: usage_total_tokens(usage),
        balance,
        credited_total: session.monthly_limit_credits,
        usage_spent_total: session.used_credits,
    }
}

async fn usage_for_session(
    session: &EnterpriseSession,
    api_key: &str,
) -> EnterpriseAiUsageSnapshot {
    let usage = fetch_app_json("/adg/v1/me/usage?range=30d", api_key)
        .await
        .unwrap_or(Value::Null);
    usage_snapshot_from_app_payload(session, &usage)
}

#[tauri::command]
pub(crate) async fn enterprise_ai_login(
    api_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EnterpriseAiLoginResult, String> {
    let session = login_session(&api_key).await?;
    runtime_secret_core::set_runtime_api_key(api_key.trim())?;
    let current = state.app_settings.lock().await.clone();
    let settings =
        persist_settings(settings_with_connected_account(current, &session), &state).await?;
    managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    let usage = Some(usage_for_session(&session, &api_key).await);
    Ok(EnterpriseAiLoginResult { settings, usage })
}

#[tauri::command]
pub(crate) async fn enterprise_ai_validate(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EnterpriseAiLoginResult, String> {
    let current = state.app_settings.lock().await.clone();
    let Some(api_key) = runtime_secret_core::get_runtime_api_key()? else {
        if matches!(
            current.enterprise_ai.status,
            EnterpriseAiStatus::Disconnected
        ) {
            return Ok(EnterpriseAiLoginResult {
                settings: current,
                usage: None,
            });
        }
        let mut next = current;
        next.enterprise_ai.status = EnterpriseAiStatus::Invalid;
        next.enterprise_ai.last_error = Some("保存的 API Key 不存在，请重新登录。".to_string());
        let settings = persist_settings(next, &state).await?;
        return Ok(EnterpriseAiLoginResult {
            settings,
            usage: None,
        });
    };

    match profile_session(&api_key).await {
        Ok(session) => {
            let settings = persist_settings(
                settings_with_connected_account(current.clone(), &session),
                &state,
            )
            .await?;
            if managed_runtime_config_changed(&current, &settings) {
                managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
            }
            let usage = Some(usage_for_session(&session, &api_key).await);
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
    if let Some(api_key) = runtime_secret_core::get_runtime_api_key()? {
        let _ = post_app_json("/adg/v1/auth/logout", &api_key).await;
    }
    runtime_secret_core::clear_runtime_api_key()?;
    let settings =
        clear_managed_runtime_account_core(&state.app_settings, &state.settings_path).await?;
    managed_runtime::restart_connected_workspace_sessions(&state, &app).await?;
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn enterprise_ai_usage() -> Result<Option<EnterpriseAiUsageSnapshot>, String> {
    let Some(api_key) = runtime_secret_core::get_runtime_api_key()? else {
        return Ok(None);
    };
    let session = profile_session(&api_key).await?;
    Ok(Some(usage_for_session(&session, &api_key).await))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_service_base_url_strips_runtime_suffixes() {
        assert_eq!(
            normalize_service_base_url("https://adg-uat.zhaozhunai.com/v1").as_deref(),
            Some("https://adg-uat.zhaozhunai.com")
        );
        assert_eq!(
            normalize_service_base_url("https://adg-uat.zhaozhunai.com/adg/v1/").as_deref(),
            Some("https://adg-uat.zhaozhunai.com")
        );
    }

    #[test]
    fn app_profile_payload_maps_public_account_fields() {
        let payload = json!({
            "profile": {
                "tenant": { "slug": "acme", "name": "Acme Team" },
                "key": { "label": "agentdesk-prod", "status": "active" },
                "quota": {
                    "remaining_credits": 876.55,
                    "used_credits": 123.45,
                    "monthly_limit_credits": 1000
                }
            }
        });

        let session =
            session_from_app_profile(&payload, "sk-adg_acme_abcdef").expect("profile session");

        assert_eq!(session.tenant_domain, "acme");
        assert_eq!(session.account_name.as_deref(), Some("Acme Team"));
        assert_eq!(session.key_last4.as_deref(), Some("cdef"));
    }

    #[test]
    fn app_usage_payload_maps_summary_and_profile_quota() {
        let session = session_from_app_profile(
            &json!({
                "profile": {
                    "tenant": { "slug": "acme", "name": "Acme Team" },
                    "key": { "label": "agentdesk-prod", "status": "active" },
                    "quota": {
                        "remaining_credits": 876.55,
                        "used_credits": 123.45,
                        "monthly_limit_credits": 1000
                    }
                }
            }),
            "sk-adg_acme_abcdef",
        )
        .expect("profile session");
        let usage = json!({
            "summary": {
                "requests": 12,
                "input_tokens": 1000,
                "output_tokens": 200,
                "cache_read_tokens": 300,
                "cost_credits": 25
            }
        });

        let snapshot = usage_snapshot_from_app_payload(&session, &usage);

        assert_eq!(snapshot.tenant_domain.as_deref(), Some("acme"));
        assert_eq!(snapshot.account_name.as_deref(), Some("Acme Team"));
        assert_eq!(snapshot.requests_7d, Some(12));
        assert_eq!(snapshot.tokens_7d, Some(1500));
        assert_eq!(snapshot.balance, Some(876.55));
        assert_eq!(snapshot.credited_total, Some(1000.0));
        assert_eq!(snapshot.usage_spent_total, Some(123.45));
    }

    #[test]
    fn app_usage_payload_uses_credit_balance_when_plan_remaining_is_zero() {
        let session = session_from_app_profile(
            &json!({
                "profile": {
                    "tenant": { "slug": "company1", "name": "company1" },
                    "key": { "label": "agentdesk-dev", "status": "active" },
                    "quota": {
                        "remaining_credits": 0,
                        "credit_balance_credits": 1000000,
                        "monthly_limit_credits": 0,
                        "used_credits": 0
                    }
                }
            }),
            "sk-adg_company1_abcdef",
        )
        .expect("profile session");
        let usage = json!({
            "summary": {
                "requests": 2323,
                "total_tokens": 11460505,
                "cost_credits": 46.2322914916
            }
        });

        let snapshot = usage_snapshot_from_app_payload(&session, &usage);

        assert_eq!(snapshot.balance, Some(1000000.0));
    }

    #[test]
    fn connected_account_sets_managed_runtime_model_and_clears_old_composer_model() {
        let session = EnterpriseSession {
            tenant_domain: "qihang".to_string(),
            account_name: Some("启航AI平台-内部".to_string()),
            key_last4: Some("qWxH".to_string()),
            monthly_limit_credits: None,
            used_credits: None,
            remaining_credits: None,
            credit_balance_credits: None,
        };
        let mut settings = AppSettings::default();
        settings.last_composer_model_id = Some("gpt-5.5".to_string());

        let settings = settings_with_connected_account(settings, &session);

        assert_eq!(
            settings.managed_runtime.model.as_deref(),
            Some(DEFAULT_MANAGED_RUNTIME_MODEL)
        );
        assert_eq!(settings.last_composer_model_id, None);
        assert!(settings.managed_runtime.enabled);
        assert!(matches!(
            settings.enterprise_ai.status,
            EnterpriseAiStatus::Connected
        ));
    }
}
