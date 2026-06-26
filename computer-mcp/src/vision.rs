//! Gateway-routed vision client (docs/computer-use-design.md). The observe tool sends the captured
//! screen to a configured vision model THROUGH the ADG gateway (OpenAI-compatible
//! `/v1/chat/completions`), authenticated by the tenant dispatch key — so the call is billed to the
//! tenant and uses the tenant's configured model, exactly like the `generate_image` delegation seam.
//! No Ark-direct, no upstream model key ever lives here.
//!
//! Config arrives the way codex hands it to a managed MCP server: gateway base + model as argv
//! (`--gateway-base-url`, `--model`), the secret dispatch key via the `AGENTDESK_RUNTIME_API_KEY`
//! env var that codex forwards from its own process env (it `env_clear()`s the child, then forwards
//! the names in `env_vars`). All three are business-correctness values — fail-fast if any is missing.

use std::time::Duration;

use base64::Engine;

/// Env var codex forwards (by name, not value) so the dispatch key never lands in config.toml.
pub const API_KEY_ENV: &str = "AGENTDESK_RUNTIME_API_KEY";

const DEFAULT_OBSERVE_PROMPT: &str = "Describe what is on this screen: which apps/windows are open, \
    any visible text or errors, and the overall layout. Be concise and concrete.";

/// Resolved sidecar config: where to reach the gateway, which model to ask, and the dispatch key.
pub struct GatewayConfig {
    /// Gateway base ending in `/v1` (e.g. `https://adg-uat.example.com/v1`); `/chat/completions` is appended.
    base_url: String,
    /// The tenant's configured vision model alias (must be enabled for the tenant on the gateway).
    model: String,
    /// `sk-adg_*` dispatch key, forwarded via `AGENTDESK_RUNTIME_API_KEY`.
    api_key: String,
}

impl GatewayConfig {
    /// Parse `--gateway-base-url <url> --model <id>` from argv; read the key from the env codex
    /// forwards. Fail-fast (no silent default) on any missing business-correctness value.
    pub fn from_args_and_env() -> Result<Self, String> {
        let mut base_url = None;
        let mut model = None;
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--gateway-base-url" => base_url = it.next(),
                "--model" => model = it.next(),
                // Lenient on extra args codex may add; we never silently drop a *value* we need.
                _ => {}
            }
        }
        let base_url = normalized(base_url).ok_or("missing --gateway-base-url")?;
        let model = normalized(model).ok_or("missing --model")?;
        let api_key = normalized(std::env::var(API_KEY_ENV).ok()).ok_or_else(|| {
            format!("missing {API_KEY_ENV} (codex must forward it via the MCP server's env_vars)")
        })?;
        // The dispatch key + the screen image ride this URL — refuse cleartext so a misconfigured
        // `--gateway-base-url` can never leak them over the wire. Loopback http is allowed (it never
        // leaves the machine) so a locally-run gateway works in dev.
        require_secure_scheme(&base_url)?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            model,
            api_key,
        })
    }

    #[cfg(test)]
    pub fn for_test(base_url: &str, model: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            model: model.to_string(),
            api_key: api_key.to_string(),
        }
    }

    fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url)
    }
}

/// Reject any non-loopback URL that isn't https — the dispatch key must never travel in cleartext.
fn require_secure_scheme(base_url: &str) -> Result<(), String> {
    if base_url.starts_with("https://") {
        return Ok(());
    }
    let is_loopback = ["http://localhost", "http://127.0.0.1", "http://[::1]"]
        .iter()
        .any(|prefix| base_url.starts_with(prefix));
    if is_loopback {
        return Ok(());
    }
    Err(format!(
        "--gateway-base-url must use https (non-loopback http would send the dispatch key in cleartext): {base_url}"
    ))
}

fn normalized(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Send a PNG screenshot (+ optional focus question) to the gateway vision model; return its text.
pub fn describe_screen(
    cfg: &GatewayConfig,
    png: &[u8],
    question: Option<&str>,
) -> Result<String, String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(png);
    let prompt = question
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_OBSERVE_PROMPT);
    let body = serde_json::json!({
        "model": cfg.model,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{b64}")}}
            ]
        }]
    });
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .into();
    let mut resp = agent
        .post(cfg.chat_completions_url())
        .header("Authorization", &format!("Bearer {}", cfg.api_key))
        .send_json(&body)
        .map_err(|e| format!("gateway vision request failed: {e}"))?;
    let v: serde_json::Value = resp
        .body_mut()
        .read_json()
        .map_err(|e| format!("gateway vision response parse failed: {e}"))?;
    // Surface the gateway's structured `error` (e.g. model_not_enabled, rate limit) when present —
    // it's the gateway's own response, never our key/image — but don't dump the whole blob.
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| match v.get("error") {
            Some(err) => format!("gateway vision error: {err}"),
            None => format!(
                "gateway vision response had no message content (choices={})",
                v["choices"].as_array().map(|a| a.len()).unwrap_or(0)
            ),
        })?;
    Ok(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_completions_url_appends_path_and_trims_trailing_slash() {
        let cfg = GatewayConfig::for_test("https://gw.example.com/v1/", "m", "k");
        assert_eq!(
            cfg.chat_completions_url(),
            "https://gw.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn normalized_rejects_blank_and_trims() {
        assert_eq!(normalized(Some("  ".to_string())), None);
        assert_eq!(normalized(None), None);
        assert_eq!(normalized(Some("  x ".to_string())), Some("x".to_string()));
    }

    #[test]
    fn require_secure_scheme_allows_https_and_loopback_http_only() {
        assert!(require_secure_scheme("https://adg-uat.example.com/v1").is_ok());
        assert!(require_secure_scheme("http://localhost:1457/v1").is_ok());
        assert!(require_secure_scheme("http://127.0.0.1/v1").is_ok());
        // Non-loopback cleartext must be refused — that's where the key would leak.
        assert!(require_secure_scheme("http://attacker.example.com/v1").is_err());
        assert!(require_secure_scheme("http://10.0.0.5/v1").is_err());
    }
}
