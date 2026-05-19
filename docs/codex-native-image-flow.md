# Codex Native Image Flow

This document is the canonical reference for how Codex native image generation
is expected to work inside CodexMonitor. Use it before changing image generation,
image editing, image cards, thread replay, or follow-up chat behavior.

The goal is parity with native Codex:

- Brand-new image generation uses the Responses API native `image_generation`
  tool.
- Image edits and "use the previous image" follow-ups remain part of the same
  Responses conversation history through `image_generation_call` items.
- Normal follow-up chat must not create duplicate image cards or re-run image
  generation.
- CodexMonitor should render native image lifecycle items directly, not convert
  them into a separate dynamic-tool image flow when native image generation is
  enabled.

## Reference Source

Native behavior lives in `../Codex/codex-rs`. Check these files first:

| Area | File |
| --- | --- |
| Native tool definition | `../Codex/codex-rs/tools/src/tool_spec.rs` |
| Tool exposure plan | `../Codex/codex-rs/tools/src/tool_registry_plan.rs` |
| Provider capability gating | `../Codex/codex-rs/core/src/session/turn_context.rs` |
| Request construction | `../Codex/codex-rs/core/src/client.rs` |
| Conversation history normalization | `../Codex/codex-rs/core/src/context_manager/history.rs` |
| Image stripping rules | `../Codex/codex-rs/core/src/context_manager/normalize.rs` |
| Image result persistence and item emission | `../Codex/codex-rs/core/src/stream_events_utils.rs` |
| Image instruction injected after save | `../Codex/codex-rs/core/src/context/image_generation_instructions.rs` |
| Protocol response item shape | `../Codex/codex-rs/protocol/src/models.rs` |
| Protocol turn item shape | `../Codex/codex-rs/protocol/src/items.rs` |
| App-server thread reconstruction | `../Codex/codex-rs/app-server-protocol/src/protocol/thread_history.rs` |
| End-to-end image tests | `../Codex/codex-rs/core/tests/suite/items.rs` |
| Image history and model-switching tests | `../Codex/codex-rs/core/tests/suite/model_switching.rs` |

CodexMonitor integration points:

| Area | File |
| --- | --- |
| Managed runtime config writer | `src-tauri/src/shared/runtime_config_core.rs` |
| Thread start params and dynamic-tool fallback | `src-tauri/src/shared/codex_core.rs` |
| Frontend app-server event routing | `src/features/app/hooks/useAppServerEvents.ts` |
| Thread item event handling | `src/features/threads/hooks/useThreadItemEvents.ts` |
| Thread item conversion and replay normalization | `src/utils/threadItems.conversion.ts` |
| Image generation row rendering | `src/features/messages/components/MessageRows.tsx` |
| Legacy ADG image endpoint fallback | `src-tauri/src/shared/image_generation_core.rs` |
| Legacy dynamic tool executor | `src/features/threads/hooks/useThreads.ts` |

## Native Tool Exposure

Codex native image generation is a Responses API tool:

```json
{ "type": "image_generation", "output_format": "png" }
```

The tool is created by `create_image_generation_tool("png")` and appears in the
Responses request `tools` array when all of these are true:

- The model/provider path allows image generation.
- `Feature::ImageGeneration` is enabled.
- The active provider capability allows image generation, or the current auth
  path is the Codex backend path.

CodexMonitor must not expose the legacy `codex_monitor.generate_image` dynamic
tool as the primary path when native image generation is enabled. That legacy
tool is only a fallback path for providers that do not support native Responses
`image_generation`.

## Managed Provider Requirements

The AgentDesk managed provider should be configured as a Responses provider with
native image generation and WebSocket support:

```toml
[model_providers.agentdesk_managed]
name = "agentDesk Managed Runtime"
base_url = "https://..."
wire_api = "responses"
env_key = "AGENTDESK_RUNTIME_API_KEY"
requires_openai_auth = false
supports_websockets = true
stream_idle_timeout_ms = 300000

[model_providers.agentdesk_managed.http_headers]
X-ADG-Image-Model = "gpt-image-2"
```

`supports_websockets = true` is important. Native Codex follow-up chat over a
Responses WebSocket can send an incremental `response.create` with
`previous_response_id`. Without WebSocket support, Codex falls back to HTTP/SSE
and must resend the full prompt history. Full-history resend can include large
`image_generation_call.result` payloads for image-capable models.

`stream_idle_timeout_ms = 300000` prevents long image generations from being
retried as idle streams. A too-short idle timeout can cause the whole sampling
request to be retried, which produces multiple distinct `image_generation_call`
items and duplicate image cards.

## New Image Generation Flow

1. The user asks for a new image.
2. Codex builds a normal Responses request with:
   - current conversation `input`;
   - native `tools: [{ "type": "image_generation", "output_format": "png" }]`;
   - `tool_choice: "auto"`;
   - `stream: true`.
3. The provider emits a Responses item:

```json
{
  "type": "image_generation_call",
  "id": "ig_...",
  "status": "completed",
  "model": "gpt-image-2",
  "size": "1024x1536",
  "revised_prompt": "...",
  "result": "<base64 png>"
}
```

4. Codex converts that response item into `TurnItem::ImageGeneration`.
5. Codex emits a started item before the completed item if the completed item
   was not already active:
   - started item status is `in_progress`;
   - `result`, `revised_prompt`, and `saved_path` are empty;
   - `model` and `size` should still be present when known.
6. Codex saves the base64 result to:

```text
<codex_home>/generated_images/<thread_id>/<image_generation_call_id>.png
```

7. Codex emits `ItemCompleted` and `ImageGenerationEnd` with:
   - `id`;
   - `status`;
   - optional `model`;
   - optional `size`;
   - optional `revised_prompt`;
   - `result`;
   - `saved_path`.
8. Codex records the original `ResponseItem::ImageGenerationCall` in
   conversation history.
9. Codex injects a developer message telling the model where generated images
   are saved:

```text
Generated images are saved to <dir> as <path pattern> by default.
If you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it.
```

This save-path developer message is metadata for later turns. It is not a
replacement for `image_generation_call` history.

## Continue Chat Flow

Follow-up chat after image generation should stay in the same thread and should
not trigger another image generation unless the user asks for a new or edited
image.

Native Codex has two relevant transport behaviors:

- Responses WebSocket: later turns can include `previous_response_id` and only
  send the incremental new input.
- HTTP/SSE Responses: later turns send full normalized conversation history.

For CodexMonitor managed runtime, prefer WebSocket parity. It matches native
Codex and avoids repeatedly uploading large generated-image payloads.

For an ordinary follow-up like "looks great" or "describe it", the model should
see the prior image generation as part of conversation history. The UI should
not create a second card unless a new `image_generation_call` arrives from the
provider.

## Image Edit Flow

Native Codex edits are still conversation-native. The model uses the existing
`image_generation_call` history when the user says:

- "modify this image";
- "base it on the previous image";
- "keep the same character but change the background";
- "make this one more realistic";
- "use the generated image as reference".

CodexMonitor should not solve native edits by routing to its legacy
`/v1/images/edits` dynamic-tool path when native image generation is enabled.
The native path should let the provider interpret the prior
`image_generation_call` item and emit a new `image_generation_call` result for
the edited image.

The legacy ADG edit endpoint still exists for fallback mode. It resolves
`referenceImageIds` such as `asset-*`, `ig_*`, or saved local generated-image
paths and posts multipart data to `/v1/images/edits`. That path is not the
native Codex behavior and should not be used as the default native flow.

## History Normalization Rules

These rules are critical for preserving both follow-up chat and image editing:

### Image-Capable Models

When the active model supports image input, keep native
`ResponseItem::ImageGenerationCall` intact in prompt history:

```json
{
  "type": "image_generation_call",
  "id": "ig_123",
  "status": "completed",
  "revised_prompt": "lobster",
  "result": "Zm9v"
}
```

Do not clear `result` for image-capable models. Clearing it can prevent native
"edit this previous image" turns from having the source image in the same
conversation flow.

### Text-Only Models

When switching to a text-only model, clear the generated image bytes but keep
the response item shape:

```json
{
  "type": "image_generation_call",
  "id": "ig_123",
  "status": "completed",
  "revised_prompt": "lobster",
  "result": ""
}
```

The item should not be converted into a user `input_image`, and Codex should not
inject the generic image-omitted placeholder for generated image calls. Keeping
`result: ""` preserves the structured item identity without sending image bytes
to a text-only model.

### Pending Items

Pending or partial `image_generation_call` items may arrive without `result`.
They should deserialize to `result: ""` and render as in-progress rather than
being treated as malformed.

## App-Server And UI Rules

Codex emits native image generation through normal item lifecycle events:

- `item/started` with `item.type = "imageGeneration"`;
- `item/completed` with `item.type = "imageGeneration"`;
- rollout replay can also expose raw `image_generation_call` response items.

CodexMonitor should normalize all of these into one frontend item kind:

```ts
{
  kind: "imageGeneration",
  id: string,
  status: string,
  model: string | null,
  size: string,
  revisedPrompt: string | null,
  savedPath: string | null,
  imageSrc: string | null
}
```

Merge by item id. A started native item and the completed native item for the
same `ig_*` call must update the same card. Replay hydration of a raw
`image_generation_call` must also normalize to the same card model, otherwise
history can render duplicate cards.

Image card display should prefer:

1. `savedPath` when present;
2. data URL derived from `result`;
3. no image while in progress.

## Duplicate Card Failure Modes

Duplicate generated-image cards usually come from one of these causes:

- The provider receives retried full sampling requests and emits multiple
  distinct `ig_*` calls.
- CodexMonitor renders both native `imageGeneration` thread items and raw
  `image_generation_call` replay items as separate UI entries.
- Started and completed events are not merged by the same item id.
- A legacy dynamic-tool generated-image item is emitted in addition to a native
  `image_generation_call` item.

Check these first:

1. Inspect the rollout JSONL for repeated distinct `image_generation_call.id`
   values.
2. Inspect runtime logs for stream idle timeout retries.
3. Inspect `/responses` request bodies for full-history resend size.
4. Inspect frontend reducer/list merge behavior for same-id image items.

## Follow-Up Chat Stuck Failure Modes

A follow-up turn after image generation can appear stuck when the provider
rejects or times out on a huge full-history HTTP request.

The common signature is:

- previous turn completed with an `image_generation_call.result` base64 payload;
- next HTTP `/responses` POST body is very large;
- request body contains `image_generation_call` and PNG base64;
- provider returns `502 Bad Gateway` or an upstream error;
- UI sees task completion/error state but no visible assistant text.

Preferred fix:

- Enable Responses WebSocket for the managed provider.
- Keep native image history semantics unchanged.
- Do not clear `image_generation_call.result` globally, because that breaks
  native image edits.

Fallback-only mitigation:

- If WebSocket is unavailable for a provider, text-only model normalization may
  clear result bytes.
- Do not apply that mitigation to image-capable native image models unless the
  provider cannot support native edit semantics.

## CodexMonitor Parity Checklist

Use this checklist before claiming image behavior is fixed:

- Managed provider config includes `wire_api = "responses"`.
- Managed provider config includes `supports_websockets = true`.
- Managed provider config includes `stream_idle_timeout_ms = 300000` or a value
  high enough for image generation streams.
- Native image mode does not expose the legacy dynamic image tool as the primary
  generation/edit path.
- `image_generation_call.result` is preserved for image-capable models.
- `image_generation_call.result` is serialized as `""` for text-only normalized
  history.
- Native `item/started` and `item/completed` image items merge by id.
- Raw rollout `image_generation_call` replay normalizes into the same frontend
  image card shape.
- Follow-up chat uses WebSocket incremental continuation when the provider
  supports it.
- Image edit prompts remain in the native conversation flow instead of being
  diverted to the legacy ADG edit endpoint.

## Verification Commands

Run targeted Codex tests after changing native image runtime behavior:

```bash
cd ../Codex/codex-rs
cargo test -p codex-core context_manager::history::tests::for_prompt
cargo test -p codex-core stream_events_utils::tests
cargo test -p codex-core --test all generated_image_is_replayed_for_image_capable_models
cargo test -p codex-core --test all model_change_from_generated_image_to_text_preserves_prior_generated_image_call
cargo test -p codex-protocol response_item_parses_image_generation_call
cargo check -p codex-core
```

Run CodexMonitor checks after changing integration/config/UI behavior:

```bash
cd /Users/xiaodeng/project/CodexMonitor/src-tauri
cargo test sync_managed_runtime_config_writes_provider_without_secret
cargo check

cd /Users/xiaodeng/project/CodexMonitor
npm run typecheck
npm run sync:codex-runtime
```

After syncing runtime, restart the local app and confirm the generated config:

```bash
grep -n "supports_websockets\\|wire_api\\|stream_idle_timeout\\|X-ADG-Image-Model" \
  "/Users/xiaodeng/Library/Application Support/com.agentdesk.app.dev/codex-home/config.toml"
```

Expected managed-runtime shape:

```text
wire_api = "responses"
supports_websockets = true
stream_idle_timeout_ms = 300000
X-ADG-Image-Model = "..."
```

## Do Not Do

- Do not globally strip `image_generation_call.result` to make follow-up chat
  smaller. That breaks native image edit context.
- Do not use the legacy dynamic image tool as a parallel path when native image
  generation is enabled. It can create duplicate cards and split image history
  away from the native conversation.
- Do not convert generated images into user `input_image` messages for normal
  follow-up history.
- Do not rely only on manual UI testing; inspect the rollout/request shape and
  run the native Codex tests above.
- Do not treat `saved_path` as a substitute for native `image_generation_call`
  history. The saved file is for artifact/UI/path access; the response item is
  the native conversation state.

## Quick Mental Model

Native Codex image flow is:

```text
user prompt
  -> Responses request with native image_generation tool
  -> image_generation_call result
  -> save image to codex-home/generated_images
  -> emit one imageGeneration UI item by id
  -> record image_generation_call in history
  -> follow-up uses same conversation, preferably via WebSocket previous_response_id
```

If a change preserves that shape, it is probably aligned with native Codex. If a
change creates a second image mechanism, removes image-generation result bytes
for image-capable models, or bypasses `previous_response_id` continuation, it is
probably drifting away from native behavior.
