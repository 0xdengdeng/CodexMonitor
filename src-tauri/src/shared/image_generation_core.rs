use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedImageAsset {
    pub(crate) id: String,
    pub(crate) workspace_id: Option<String>,
    pub(crate) thread_id: Option<String>,
    pub(crate) model: String,
    pub(crate) prompt: String,
    pub(crate) revised_prompt: Option<String>,
    pub(crate) size: String,
    pub(crate) local_path: String,
    pub(crate) mime_type: String,
    pub(crate) created_at_ms: i64,
    pub(crate) status: String,
    /// Assistant message that immediately precedes this image in the rollout.
    /// `thread/resume` strips generate_image function outputs, so this is the
    /// only position anchor available on history replay — the SPA inserts the
    /// image right after the message with this text instead of appending it.
    pub(crate) anchor_message_text: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn list_generated_images(
    data_dir: &Path,
    workspace_id: Option<&str>,
    thread_id: Option<&str>,
) -> Result<Vec<GeneratedImageAsset>, String> {
    let Some(thread_id) = thread_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(Vec::new());
    };
    let mut assets = list_runtime_generated_images(data_dir, workspace_id, thread_id)?;
    assets.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(assets)
}

fn list_runtime_generated_images(
    data_dir: &Path,
    workspace_id: Option<&str>,
    thread_id: &str,
) -> Result<Vec<GeneratedImageAsset>, String> {
    let codex_home = data_dir.join("codex-home");
    let thread_dir = codex_home.join("generated_images").join(thread_id);
    if !thread_dir.exists() {
        return Ok(Vec::new());
    }
    let anchors = read_thread_image_anchors(&codex_home, thread_id);
    let mut assets = Vec::new();
    for entry in fs::read_dir(&thread_dir)
        .map_err(|err| format!("Failed to read runtime generated image directory: {err}"))?
    {
        let entry =
            entry.map_err(|err| format!("Failed to read runtime generated image entry: {err}"))?;
        let path = entry.path();
        if !path.is_file() || !is_supported_runtime_image_path(&path) {
            continue;
        }
        let metadata = fs::metadata(&path)
            .map_err(|err| format!("Failed to read runtime generated image metadata: {err}"))?;
        let created_at_ms = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or_else(now_ms);
        let file_stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("runtime-image");
        let id = runtime_generated_image_id(file_stem);
        let anchor_message_text = anchors.get(&id).cloned();
        assets.push(GeneratedImageAsset {
            id: id.clone(),
            workspace_id: workspace_id.map(str::to_string),
            thread_id: Some(thread_id.to_string()),
            model: String::new(),
            prompt: String::new(),
            revised_prompt: None,
            size: String::new(),
            local_path: path.to_string_lossy().to_string(),
            mime_type: mime_type_for_path(&path).to_string(),
            created_at_ms,
            status: "completed".to_string(),
            anchor_message_text,
        });
    }
    assets.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(assets)
}

/// Walk the thread's rollout and map each generate_image call id to the
/// assistant message text that immediately precedes it. `thread/resume` returns
/// a normalized view without the function outputs, so the rollout is the only
/// source for where each image sits in the conversation.
fn read_thread_image_anchors(codex_home: &Path, thread_id: &str) -> HashMap<String, String> {
    let Some(rollout_path) = find_thread_rollout(codex_home, thread_id) else {
        return HashMap::new();
    };
    let Ok(contents) = fs::read_to_string(&rollout_path) else {
        return HashMap::new();
    };
    let mut anchors = HashMap::new();
    let mut generate_image_calls: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    let mut last_assistant_text: Option<String> = None;
    for line in contents.lines() {
        let line = line.trim();
        // Skip event_msg/token_count/session_meta lines before parsing.
        if line.is_empty() || !line.contains("\"response_item\"") {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<RolloutLine>(line) else {
            continue;
        };
        if parsed.kind.as_deref() != Some("response_item") {
            continue;
        }
        let Some(payload) = parsed.payload else {
            continue;
        };
        match payload.kind.as_deref() {
            Some("message") => {
                if payload.role.as_deref() == Some("assistant") {
                    let text = join_text_parts(payload.content.as_deref());
                    if !text.is_empty() {
                        last_assistant_text = Some(text);
                    }
                }
            }
            Some("function_call") => {
                if payload.name.as_deref() == Some("generate_image") {
                    if let Some(call_id) = payload.call_id {
                        generate_image_calls.insert(call_id);
                    }
                }
            }
            Some("function_call_output") => {
                let Some(call_id) = payload.call_id else {
                    continue;
                };
                // Primary signal: the output answers a generate_image call.
                // Fallback (output with no preceding call): a thread-scoped
                // saved_path anywhere in the line. A cheap substring check keeps
                // the inlined base64 image data out of the JSON we materialize.
                let is_image = generate_image_calls.contains(&call_id)
                    || line.contains("/generated_images/");
                if !is_image {
                    continue;
                }
                if let Some(text) = last_assistant_text.clone() {
                    anchors.entry(call_id).or_insert(text);
                }
            }
            _ => {}
        }
    }
    anchors
}

// Minimal projection of a rollout line. The `output` field of a
// function_call_output inlines multi-MB base64 image data and is deliberately
// NOT captured — serde skips it without allocating it.
#[derive(Deserialize)]
struct RolloutLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<RolloutPayload>,
}

#[derive(Deserialize)]
struct RolloutPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    role: Option<String>,
    name: Option<String>,
    call_id: Option<String>,
    content: Option<Vec<RolloutTextPart>>,
}

#[derive(Deserialize)]
struct RolloutTextPart {
    text: Option<String>,
}

fn join_text_parts(parts: Option<&[RolloutTextPart]>) -> String {
    let Some(parts) = parts else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|part| part.text.as_deref())
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_string()
}

/// Find the rollout JSONL for a thread under `codex-home/sessions/**`. Files are
/// named `rollout-<timestamp>-<threadId>.jsonl`; the newest matching name wins.
/// Archived/compacted rollouts use other names and won't match — those images
/// fall back to bottom-append, which is acceptable for best-effort recovery.
fn find_thread_rollout(codex_home: &Path, thread_id: &str) -> Option<PathBuf> {
    let suffix = format!("-{thread_id}.jsonl");
    let mut matches = Vec::new();
    collect_rollout_matches(&codex_home.join("sessions"), &suffix, &mut matches);
    matches.sort();
    matches.pop()
}

fn collect_rollout_matches(dir: &Path, suffix: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollout_matches(&path, suffix, out);
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(suffix))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn is_supported_runtime_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp"
            )
        })
        .unwrap_or(false)
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn runtime_generated_image_id(file_stem: &str) -> String {
    if let Some((_, call_id)) = file_stem.rsplit_once("_call_") {
        return format!("call_{call_id}");
    }
    file_stem.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn list_generated_images_requires_thread_scope() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let images = list_generated_images(&dir, Some("ws-1"), None).expect("list should work");
        assert!(images.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn list_generated_images_includes_runtime_codex_images_for_thread() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let thread_dir = dir
            .join("codex-home")
            .join("generated_images")
            .join("thread-1");
        std::fs::create_dir_all(&thread_dir).expect("runtime image dir should be created");
        let image_path = thread_dir
            .join("019ed634-a3db-73c3-9966-5dc090236089_call_blqxvot2i5yrefmqiyfpo5q6.png");
        std::fs::write(&image_path, [137, 80, 78, 71, 13, 10, 26, 10])
            .expect("runtime image should be written");

        let images =
            list_generated_images(&dir, Some("ws-1"), Some("thread-1")).expect("list should work");

        assert_eq!(images.len(), 1);
        assert_eq!(images[0].id, "call_blqxvot2i5yrefmqiyfpo5q6");
        assert_eq!(images[0].workspace_id.as_deref(), Some("ws-1"));
        assert_eq!(images[0].thread_id.as_deref(), Some("thread-1"));
        assert_eq!(images[0].mime_type, "image/png");
        assert_eq!(images[0].local_path, image_path.to_string_lossy());
        assert_eq!(images[0].anchor_message_text, None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn list_generated_images_anchors_to_preceding_assistant_message_from_rollout() {
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let codex_home = dir.join("codex-home");
        let thread = "thread-anchor";
        let thread_dir = codex_home.join("generated_images").join(thread);
        std::fs::create_dir_all(&thread_dir).expect("image dir");
        for call in ["call_aaa", "call_bbb"] {
            std::fs::write(
                thread_dir.join(format!("019_{call}.png")),
                [137, 80, 78, 71, 13, 10, 26, 10],
            )
            .expect("image write");
        }
        let session_dir = codex_home.join("sessions").join("2026").join("06").join("18");
        std::fs::create_dir_all(&session_dir).expect("session dir");
        let rollout = [
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"text","text":"draw two"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"text","text":"first one"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"generate_image","call_id":"call_aaa"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_aaa","output":[{"type":"input_text","text":"{\"saved_path\":\"/x/generated_images/thread-anchor/019_call_aaa.png\"}"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"text","text":"second one"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call","name":"generate_image","call_id":"call_bbb"}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_bbb","output":[{"type":"input_text","text":"{\"saved_path\":\"/x/generated_images/thread-anchor/019_call_bbb.png\"}"}]}}"#,
        ]
        .join("\n");
        std::fs::write(
            session_dir.join(format!("rollout-2026-06-18T11-48-26-{thread}.jsonl")),
            rollout,
        )
        .expect("rollout write");

        let images = list_generated_images(&dir, Some("ws-1"), Some(thread)).expect("list");

        let by_id: std::collections::HashMap<_, _> =
            images.iter().map(|a| (a.id.as_str(), a)).collect();
        assert_eq!(
            by_id["call_aaa"].anchor_message_text.as_deref(),
            Some("first one")
        );
        assert_eq!(
            by_id["call_bbb"].anchor_message_text.as_deref(),
            Some("second one")
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn list_generated_images_anchors_output_without_preceding_function_call() {
        // Defensive: an output line whose generate_image call is missing is
        // still recognized by its thread-scoped saved_path.
        let dir = std::env::temp_dir().join(format!("agentdesk-image-test-{}", Uuid::new_v4()));
        let codex_home = dir.join("codex-home");
        let thread = "thread-fallback";
        let thread_dir = codex_home.join("generated_images").join(thread);
        std::fs::create_dir_all(&thread_dir).expect("image dir");
        std::fs::write(
            thread_dir.join("019_call_ccc.png"),
            [137, 80, 78, 71, 13, 10, 26, 10],
        )
        .expect("image write");
        let session_dir = codex_home.join("sessions").join("2026").join("06").join("18");
        std::fs::create_dir_all(&session_dir).expect("session dir");
        let rollout = [
            r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"text","text":"here you go"}]}}"#,
            r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_ccc","output":[{"type":"input_text","text":"{\"saved_path\":\"/x/generated_images/thread-fallback/019_call_ccc.png\"}"}]}}"#,
        ]
        .join("\n");
        std::fs::write(
            session_dir.join(format!("rollout-2026-06-18T11-48-26-{thread}.jsonl")),
            rollout,
        )
        .expect("rollout write");

        let images = list_generated_images(&dir, Some("ws-1"), Some(thread)).expect("list");

        assert_eq!(images.len(), 1);
        assert_eq!(
            images[0].anchor_message_text.as_deref(),
            Some("here you go")
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
