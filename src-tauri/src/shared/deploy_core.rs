//! ADG deploy plugin core (docs/deploy-plugin-design.md §3.2): workspace archiving, the ADG
//! HTTP calls, ADG-JSON projection, error mapping, and DNS-label sanitization.
//!
//! Single source of truth for deploy logic. App-only today (the app adapter calls these);
//! daemon parity (v2) would reuse this same module.

use std::path::{Path, PathBuf};

use flate2::write::GzEncoder;
use flate2::Compression;
use ignore::WalkBuilder;
use reqwest::multipart::{Form, Part};
use serde_json::{json, Value};

use crate::types::{DeployApp, DeployStatus};

/// ADG `maxSourceUpload` — the multipart body hard cap. The compressed archive must fit.
const MAX_ARCHIVE_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB

// ---- archive ----

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "dist" | "target" | "release-artifacts"
    )
}

/// Secret-bearing directories force-excluded regardless of .gitignore.
fn is_secret_dir(name: &str) -> bool {
    matches!(name, ".ssh" | ".aws")
}

/// Files force-excluded from the upload regardless of .gitignore — credentials must never be
/// baked into the build context (design §3.2). Matched by file name / extension.
fn is_secret_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == ".npmrc"
        || lower == ".netrc"
        || lower == "credentials.json"
        || lower.starts_with("id_rsa")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".p12")
        || lower.ends_with(".keystore")
}

/// Build a deterministic tar.gz of the workspace, mirroring the file-list WalkBuilder rules
/// (skip vendored/build dirs, honor .gitignore) plus the secret denylist. Errors if the
/// compressed archive exceeds the ADG 100 MiB cap.
pub(crate) fn build_workspace_archive_core(root: &Path) -> Result<Vec<u8>, String> {
    let mut files: Vec<(String, PathBuf)> = Vec::new();

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .follow_links(false)
        .require_git(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.file_type().is_some_and(|ft| ft.is_dir()) {
                return !should_skip_dir(&name) && !is_secret_dir(&name);
            }
            !is_secret_file(&name)
        })
        .build();

    for entry in walker {
        let entry = entry.map_err(|err| format!("遍历工作区失败：{err}"))?;
        if !entry.file_type().is_some_and(|ft| ft.is_file()) {
            continue;
        }
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if rel_str.is_empty() {
            continue;
        }
        files.push((rel_str, path.to_path_buf()));
    }

    // Deterministic entry order (reproducible archives, testable).
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    {
        let mut builder = tar::Builder::new(&mut gz);
        for (rel, path) in &files {
            builder
                .append_path_with_name(path, rel)
                .map_err(|err| format!("打包 {rel} 失败：{err}"))?;
        }
        builder
            .finish()
            .map_err(|err| format!("完成打包失败：{err}"))?;
    }
    let bytes = gz.finish().map_err(|err| format!("压缩失败：{err}"))?;

    if bytes.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "工程打包后约 {:.1} MiB，超过 100 MiB 上限，请清理后重试",
            bytes.len() as f64 / 1024.0 / 1024.0
        ));
    }

    Ok(bytes)
}

// ---- DNS label ----

/// Convert an arbitrary workspace name to a DNS label ([a-z0-9-], no leading/trailing hyphen,
/// ≤63 chars). Falls back to `app-<seed>` (seed = first 6 alphanumerics of `fallback_seed`)
/// when the sanitized result is empty.
pub(crate) fn sanitize_dns_label(name: &str, fallback_seed: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() {
            out.push(lowered);
            prev_dash = false;
        } else if !out.is_empty() && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let mut trimmed = out.trim_matches('-').to_string();
    if trimmed.len() > 63 {
        trimmed.truncate(63);
        trimmed = trimmed.trim_end_matches('-').to_string();
    }
    if trimmed.is_empty() {
        let seed: String = fallback_seed
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(6)
            .collect();
        format!("app-{}", seed.to_ascii_lowercase())
    } else {
        trimmed
    }
}

// ---- ADG JSON projection ----

fn str_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn opt_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn parse_deploy_status(raw: &str) -> DeployStatus {
    match raw {
        "building" => DeployStatus::Building,
        "running" => DeployStatus::Running,
        "failed" => DeployStatus::Failed,
        "stopped" => DeployStatus::Stopped,
        // "pending" and anything unrecognized fall back to Pending (a safe pre-running state).
        _ => DeployStatus::Pending,
    }
}

/// Project an ADG AppDTO/AppDetailDTO (`+ latest_deploy`) into the plugin's DeployApp, applying
/// the display-status precedence: suspended > desired_state=stopped > latest_deploy.status.
pub(crate) fn deploy_app_from_json(app: &Value) -> DeployApp {
    let latest = app.get("latest_deploy").filter(|v| !v.is_null());
    let deploy_status = latest
        .and_then(|d| d.get("status"))
        .and_then(Value::as_str)
        .map(parse_deploy_status)
        .unwrap_or(DeployStatus::Pending);
    let desired_state = opt_str(app, "desired_state");
    let status = if app.get("status").and_then(Value::as_str) == Some("suspended") {
        DeployStatus::Suspended
    } else if desired_state.as_deref() == Some("stopped") {
        DeployStatus::Stopped
    } else {
        deploy_status
    };

    DeployApp {
        app_id: str_field(app, "id"),
        name: str_field(app, "name"),
        template_id: opt_str(app, "template_id"),
        source_platform: opt_str(app, "source_platform"),
        subdomain: opt_str(app, "subdomain"),
        url: opt_str(app, "url"),
        status,
        desired_state,
        deploy_status,
        error_message: latest.and_then(|d| opt_str(d, "error_message")),
        deployment_id: latest.and_then(|d| opt_str(d, "id")),
        build_log_ref: latest.and_then(|d| opt_str(d, "build_log_ref")),
    }
}

// ---- error mapping ----

/// Parse the gateway-wide `{"error":{"code","message"}}` envelope (with a root-level fallback).
/// Reimplemented here (not imported from enterprise_ai) because shared/* must not depend on app
/// modules; mirrors `enterprise_ai::error_code_and_message`.
fn error_code_and_message(body: &str) -> (Option<String>, Option<String>) {
    let Ok(payload) = serde_json::from_str::<Value>(body) else {
        return (None, None);
    };
    let error = payload.get("error").unwrap_or(&payload);
    let pick = |v: &Value, k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    };
    (
        pick(error, "code"),
        pick(error, "message").or_else(|| pick(&payload, "message")),
    )
}

/// Strip any `sk-adgd_…` run so a deploy token can never leak into a surfaced/logged message.
fn redact_token(input: &str) -> String {
    const PAT: &str = "sk-adgd_";
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(pos) = rest.find(PAT) {
        out.push_str(&rest[..pos]);
        out.push_str("[REDACTED]");
        let after = &rest[pos + PAT.len()..];
        let end = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Map an ADG deploy error (HTTP status + JSON body) to a user-facing zh message. Unknown codes
/// fall through to a status-bearing message (never swallowed). Always token-redacted.
pub(crate) fn deploy_user_facing_error(status: u16, body: &str) -> String {
    let (code, message) = error_code_and_message(body);
    let msg = match (status, code.as_deref()) {
        (401, _) => "部署令牌无效或已吊销，请在设置中重新配置".to_string(),
        (_, Some("deploy_not_mounted")) => "该网关未启用部署功能".to_string(),
        (_, Some("not_found")) => "应用已不存在（可能被删除），请重新创建".to_string(),
        (_, Some("no_build_log")) => "暂无构建日志".to_string(),
        (_, Some("deploy_not_enabled")) => "你的租户未开通部署，请联系管理员".to_string(),
        (_, Some("app_quota_exceeded")) | (_, Some("resource_quota_exceeded")) => {
            "部署额度已用尽".to_string()
        }
        (_, Some("app_suspended")) => "应用已被平台下架，请联系管理员".to_string(),
        (_, Some("name_taken")) => {
            "名称/子域名已被占用（也可能是上次未保存），请换名或找回".to_string()
        }
        (_, Some("deploy_in_progress")) => "该应用正在构建中，请稍候".to_string(),
        (_, Some("no_deployment")) | (_, Some("not_suspended")) => {
            "没有可操作的活动部署".to_string()
        }
        (_, Some("source_required")) | (_, Some("invalid_archive")) => {
            "源码归档为空或无法识别".to_string()
        }
        (_, Some("template_not_buildable")) | (_, Some("invalid")) => {
            "模板/参数不被支持".to_string()
        }
        (_, Some("build_concurrency_limit")) => "并发构建已达上限，请稍后重试".to_string(),
        (_, Some("builder_busy")) => "构建队列已满，请稍后重试".to_string(),
        _ => message
            .map(|m| format!("{m}（HTTP {status}）"))
            .unwrap_or_else(|| format!("部署失败（HTTP {status}）")),
    };
    redact_token(&msg)
}

// ---- HTTP (ADG /admin/api/me/apps; Bearer sk-adgd_) ----

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .build()
        .map_err(|err| format!("无法初始化部署请求：{err}"))
}

/// metadata JSON string for the multipart `metadata` part. `include_name` is false on redeploy
/// (ADG preserves the original app name; RedeployRequest has no name field).
fn metadata_json(name: Option<&str>, source_platform: Option<&str>) -> String {
    let mut map = serde_json::Map::new();
    if let Some(name) = name {
        map.insert("name".to_string(), json!(name));
    }
    if let Some(platform) = source_platform.filter(|p| !p.trim().is_empty()) {
        map.insert("source_platform".to_string(), json!(platform));
    }
    Value::Object(map).to_string()
}

async fn parse_app_response(resp: reqwest::Response) -> Result<DeployApp, String> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(deploy_user_facing_error(status.as_u16(), &body));
    }
    let value: Value =
        serde_json::from_str(&body).map_err(|err| format!("部署响应无法解析：{err}"))?;
    Ok(deploy_app_from_json(&value))
}

/// Build the archive and create (no existing app) or redeploy (existing app) via multipart POST.
pub(crate) async fn deploy_workspace_core(
    root: &Path,
    existing_app_id: Option<&str>,
    name: &str,
    source_platform: Option<&str>,
    token: &str,
    base_url: &str,
) -> Result<DeployApp, String> {
    let archive = build_workspace_archive_core(root)?;
    let (url, metadata) = match existing_app_id {
        Some(app_id) => (
            format!("{base_url}/admin/api/me/apps/{app_id}/deploy"),
            metadata_json(None, source_platform),
        ),
        None => (
            format!("{base_url}/admin/api/me/apps"),
            metadata_json(Some(name), source_platform),
        ),
    };
    let part = Part::bytes(archive)
        .file_name("workspace.tar.gz")
        .mime_str("application/gzip")
        .map_err(|err| format!("构造上传内容失败：{err}"))?;
    let form = Form::new().text("metadata", metadata).part("source", part);
    let resp = http_client()?
        .post(url)
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|err| format!("无法连接部署服务，请检查网络后重试：{err}"))?;
    parse_app_response(resp).await
}

pub(crate) async fn deploy_status_core(
    app_id: &str,
    token: &str,
    base_url: &str,
) -> Result<DeployApp, String> {
    let resp = http_client()?
        .get(format!("{base_url}/admin/api/me/apps/{app_id}"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|err| format!("无法获取部署状态：{err}"))?;
    parse_app_response(resp).await
}

pub(crate) async fn deploy_build_log_core(
    app_id: &str,
    deployment_id: &str,
    token: &str,
    base_url: &str,
) -> Result<String, String> {
    let resp = http_client()?
        .get(format!("{base_url}/admin/api/me/apps/{app_id}/logs"))
        .query(&[("type", "build"), ("deployment", deployment_id)])
        .bearer_auth(token)
        .send()
        .await
        .map_err(|err| format!("无法获取构建日志：{err}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(deploy_user_facing_error(status.as_u16(), &body));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn sanitize_dns_label_normalizes_arbitrary_names() {
        assert_eq!(sanitize_dns_label("My Project (WIP)", "ws123"), "my-project-wip");
        assert_eq!(sanitize_dns_label("foo/bar", "ws123"), "foo-bar");
        assert_eq!(sanitize_dns_label("  --Hello--  ", "ws123"), "hello");
        assert_eq!(sanitize_dns_label("UPPER", "ws123"), "upper");
        // All non-ascii -> empty -> fallback seeded from the workspace id.
        assert_eq!(sanitize_dns_label("你好世界", "AbCdEfGhij"), "app-abcdef");
        // ≤63 chars, no trailing hyphen.
        let long = sanitize_dns_label(&"x".repeat(100), "ws");
        assert_eq!(long.len(), 63);
        assert!(!long.ends_with('-'));
    }

    #[test]
    fn metadata_json_omits_name_on_redeploy_and_blank_platform() {
        assert_eq!(metadata_json(Some("acme"), None), r#"{"name":"acme"}"#);
        assert_eq!(
            metadata_json(Some("acme"), Some("bolt")),
            r#"{"name":"acme","source_platform":"bolt"}"#
        );
        assert_eq!(metadata_json(None, Some("  ")), "{}");
    }

    #[test]
    fn deploy_app_from_json_applies_status_precedence() {
        let suspended = deploy_app_from_json(&json!({
            "id": "a1", "name": "x", "status": "suspended", "desired_state": "running",
            "latest_deploy": {"id": "d1", "status": "running"}
        }));
        assert_eq!(suspended.status, DeployStatus::Suspended);
        assert_eq!(suspended.deploy_status, DeployStatus::Running);

        let stopped = deploy_app_from_json(&json!({
            "id": "a1", "name": "x", "status": "active", "desired_state": "stopped",
            "latest_deploy": {"id": "d1", "status": "running"}
        }));
        assert_eq!(stopped.status, DeployStatus::Stopped);

        let failed = deploy_app_from_json(&json!({
            "id": "a1", "name": "x", "subdomain": "x.example.io", "url": "http://x.example.io",
            "latest_deploy": {"id": "d9", "status": "failed", "error_message": "boom", "build_log_ref": "d9"}
        }));
        assert_eq!(failed.status, DeployStatus::Failed);
        assert_eq!(failed.error_message.as_deref(), Some("boom"));
        assert_eq!(failed.deployment_id.as_deref(), Some("d9"));
        assert_eq!(failed.build_log_ref.as_deref(), Some("d9"));

        let pending = deploy_app_from_json(&json!({"id": "a1", "name": "x"}));
        assert_eq!(pending.status, DeployStatus::Pending);
        assert_eq!(pending.deployment_id, None);
    }

    #[test]
    fn deploy_user_facing_error_maps_codes_and_redacts() {
        assert_eq!(
            deploy_user_facing_error(403, r#"{"error":{"code":"deploy_not_enabled"}}"#),
            "你的租户未开通部署，请联系管理员"
        );
        assert_eq!(
            deploy_user_facing_error(401, r#"{"error":{"code":"whatever"}}"#),
            "部署令牌无效或已吊销，请在设置中重新配置"
        );
        assert_eq!(
            deploy_user_facing_error(500, r#"{"error":{"code":"weird_new_code"}}"#),
            "部署失败（HTTP 500）"
        );
        let redacted = deploy_user_facing_error(
            400,
            r#"{"error":{"message":"bad token sk-adgd_acme_abc123XYZ here"}}"#,
        );
        assert!(redacted.contains("[REDACTED]"));
        assert!(!redacted.contains("sk-adgd_acme_abc123XYZ"));
    }

    #[test]
    fn build_workspace_archive_excludes_secrets() {
        let dir =
            std::env::temp_dir().join(format!("agentdesk-archive-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(dir.join(".ssh")).unwrap();
        fs::write(dir.join("index.html"), b"<h1>hi</h1>").unwrap();
        fs::write(dir.join("src/main.rs"), b"fn main(){}").unwrap();
        fs::write(dir.join(".env"), b"SECRET=1").unwrap();
        fs::write(dir.join("server.pem"), b"KEY").unwrap();
        fs::write(dir.join("node_modules/pkg/index.js"), b"x").unwrap();
        fs::write(dir.join(".ssh/id_ed25519"), b"k").unwrap();

        let bytes = build_workspace_archive_core(&dir).expect("archive");

        let mut names = Vec::new();
        let gz = flate2::read::GzDecoder::new(&bytes[..]);
        let mut archive = tar::Archive::new(gz);
        for entry in archive.entries().unwrap() {
            let entry = entry.unwrap();
            names.push(entry.path().unwrap().to_string_lossy().replace('\\', "/"));
        }

        assert!(names.contains(&"index.html".to_string()));
        assert!(names.contains(&"src/main.rs".to_string()));
        // Hard-excluded regardless of .gitignore:
        assert!(!names.iter().any(|n| n == ".env"));
        assert!(!names.iter().any(|n| n == "server.pem"));
        assert!(!names.iter().any(|n| n.starts_with("node_modules/")));
        assert!(!names.iter().any(|n| n.starts_with(".ssh/")));

        let _ = fs::remove_dir_all(&dir);
    }
}
