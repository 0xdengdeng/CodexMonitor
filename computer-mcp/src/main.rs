//! AgentDesk computer-use sidecar — observe-only MVP (docs/computer-use-design.md §14). A stdio MCP
//! server exposing ONE tool, `computer_observe`, in one of two modes:
//!
//! - **image** (default): capture the primary display and RETURN the screenshot. codex forwards it
//!   to a vision-capable conversation model, which sees the real pixels. No gateway call — the image
//!   rides the conversation's own model turn.
//! - **text**: capture, then delegate to a configured vision model THROUGH the gateway and return a
//!   text description. The fallback for a conversation model that can't take image input.
//!
//! Capture runs in a short-lived **`--capture-once` subprocess**: macOS ScreenCaptureKit can't deliver
//! its capture callback while the tokio serve loop owns the process's main thread, so the server
//! invokes itself in a clean process (same binary → same Screen-Recording TCC identity) that captures
//! synchronously on its own main thread and emits the PNG on stdout.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Content, Implementation, ProtocolVersion, ServerCapabilities, ServerInfo,
};
use rmcp::transport::stdio;
use rmcp::{tool, tool_handler, tool_router, ServerHandler, ServiceExt};
use schemars::JsonSchema;
use serde::Deserialize;

use computer_mcp::capture;
use computer_mcp::vision::{describe_screen, GatewayConfig};

/// Longest-side cap for the captured screenshot — keeps the conversation payload + vision-token cost
/// sane while staying well within model input limits.
const MAX_LONG_SIDE: u32 = 1568;

/// Kill + error out a capture that blocks this long (normal capture is ~2s; a multi-second stall
/// means Screen-Recording permission is missing and ScreenCaptureKit is hanging).
const CAPTURE_TIMEOUT_SECS: u64 = 20;

#[derive(Deserialize, JsonSchema)]
struct ObserveArgs {
    /// Optional: what to look for on the screen. Used in text mode to focus the description; in image
    /// mode the model sees the full screenshot, so the question lives in the conversation instead.
    #[serde(default)]
    question: Option<String>,
}

/// How `computer_observe` returns the screen.
enum ObserveMode {
    /// Return the screenshot itself — codex forwards it to a vision-capable conversation model. Default.
    Image,
    /// Delegate to a configured vision model through the gateway and return TEXT — fallback for a
    /// conversation model that can't take image input.
    Text(GatewayConfig),
}

#[derive(Clone)]
struct ComputerServer {
    mode: Arc<ObserveMode>,
}

#[tool_router]
impl ComputerServer {
    #[tool(
        description = "Capture and return the user's current primary-display screen so you can see \
                       what is on it (open apps/windows, visible text, errors, layout). Optionally \
                       pass `question` to focus on something specific. This only looks — it never \
                       clicks or types."
    )]
    async fn computer_observe(&self, Parameters(args): Parameters<ObserveArgs>) -> CallToolResult {
        let png = match capture_via_subprocess(MAX_LONG_SIDE).await {
            Ok(png) => png,
            Err(e) => {
                return CallToolResult::error(vec![Content::text(format!(
                    "screen capture failed: {e}"
                ))])
            }
        };
        match &*self.mode {
            ObserveMode::Image => {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                CallToolResult::success(vec![Content::image(b64, "image/png")])
            }
            ObserveMode::Text(cfg) => match describe_screen(cfg, &png, args.question.as_deref()) {
                Ok(text) => CallToolResult::success(vec![Content::text(text)]),
                Err(e) => CallToolResult::error(vec![Content::text(e)]),
            },
        }
    }
}

/// Capture the screen via a clean `--capture-once` subprocess and return the PNG bytes. A hung
/// capture (macOS Screen-Recording permission denied → ScreenCaptureKit blocks) is killed on timeout
/// and surfaced as a clear, actionable error instead of stalling the tool call forever.
async fn capture_via_subprocess(max_long_side: u32) -> Result<Vec<u8>, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let child = tokio::process::Command::new(exe)
        .arg("--capture-once")
        .arg("--max")
        .arg(max_long_side.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true) // timeout drops the future → drops the child → kills the hung capture
        .spawn()
        .map_err(|e| format!("capture subprocess spawn: {e}"))?;

    let output = match tokio::time::timeout(
        Duration::from_secs(CAPTURE_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("capture subprocess: {e}")),
        Err(_) => {
            return Err(format!(
                "screen capture timed out after {CAPTURE_TIMEOUT_SECS}s — grant Screen Recording \
                 permission (System Settings → Privacy & Security → Screen Recording), then restart \
                 the app and retry"
            ))
        }
    };
    if !output.status.success() {
        return Err(format!(
            "capture subprocess exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if output.stdout.is_empty() {
        return Err("capture subprocess produced no image".to_string());
    }
    Ok(output.stdout)
}

#[tool_handler]
impl ServerHandler for ComputerServer {
    fn get_info(&self) -> ServerInfo {
        // Override the macro default (which would report "rmcp/1.8.0").
        let mut server_info = Implementation::from_build_env();
        server_info.name = "computer-mcp".to_string();
        server_info.title = Some("AgentDesk computer-use (observe)".to_string());
        server_info.version = env!("CARGO_PKG_VERSION").to_string();
        server_info.description = Some(
            "Observe-only: capture the user's primary display so the agent can see it. Returns the \
             screenshot (image mode) or a text description (text mode). Does not click or type."
                .to_string(),
        );

        let mut info = ServerInfo::default();
        info.protocol_version = ProtocolVersion::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.server_info = server_info;
        info.instructions = Some(
            "Call `computer_observe` to SEE the user's current screen. It never clicks or types. The \
             screen leaves the machine to a model, so only observe when seeing the screen is needed."
                .to_string(),
        );
        info
    }
}

/// Resolve the observe mode from argv: `--mode image` (default) or `--mode text` (+ gateway config).
fn resolve_mode() -> Result<ObserveMode, String> {
    let mut mode = "image".to_string();
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        if arg == "--mode" {
            if let Some(value) = it.next() {
                mode = value;
            }
        }
    }
    match mode.trim() {
        "image" => Ok(ObserveMode::Image),
        "text" => Ok(ObserveMode::Text(GatewayConfig::from_args_and_env()?)),
        other => Err(format!("unknown --mode '{other}' (expected 'image' or 'text')")),
    }
}

/// `--capture-once`: capture synchronously on this clean process's main thread + emit the PNG on
/// stdout. Must run BEFORE any tokio runtime starts (that's the whole point — see the module docs).
fn capture_once() -> Result<(), Box<dyn std::error::Error>> {
    let mut max = MAX_LONG_SIDE;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        if arg == "--max" {
            if let Some(value) = it.next() {
                max = value.parse().map_err(|_| format!("bad --max value: {value}"))?;
            }
        }
    }
    let png = capture::capture_primary_png_scaled(max)?;
    use std::io::Write;
    let mut stdout = std::io::stdout();
    stdout.write_all(&png)?;
    stdout.flush()?;
    Ok(())
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mode = resolve_mode()?; // fail-fast on bad mode / missing text-mode config
    let server = ComputerServer {
        mode: Arc::new(mode),
    };
    let service = server.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|arg| arg == "--capture-once") {
        return capture_once();
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(run())
}
