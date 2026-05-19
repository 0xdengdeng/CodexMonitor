# ADG Image Generation Design

## Goal

CodexMonitor should provide image generation in the conversation with a
Codex-native feel while using ADG as the controllable backend.

Users should be able to say, in natural language, that they want an image. The
assistant should trigger image generation, show the result inside the current
conversation, and keep the generated asset available in a global generated-image
library. Users should not need to understand ADG, OpenAI image endpoints, API
keys, or technical tool routing.

## Product Direction

The first version is an internal CodexMonitor image generation capability:

- The user asks for an image in chat.
- The assistant invokes an app-provided image generation tool.
- The app calls ADG `/v1/images/generations` from the Tauri backend.
- The result appears as a native-feeling image generation card in the chat.
- The image is automatically saved in an app-managed generated-image library.
- The user can later find generated images globally, with current-workspace and
  current-thread filtering.

This is intentionally not a standalone form-first image generator. The primary
experience is conversational and agent-driven.

## Non-Goals

- Do not expose ADG terminology in the main chat UI.
- Do not let the frontend fetch ADG directly in production.
- Do not write generated images into the project workspace by default.
- Do not implement image editing in the first phase.
- Do not depend on upstream Codex `image_generation` availability for phase 1.

## Why Not Reuse Upstream Codex Directly

Upstream Codex already defines a native Responses API `image_generation` tool and
an `imageGeneration` thread item. That is the experience shape we want.

However, the upstream tool is gated by Codex backend auth and provider
capabilities. CodexMonitor's enterprise runtime currently writes an
`agentdesk_managed` provider with `requires_openai_auth = false`, and ADG exposes
the image endpoint as OpenAI-compatible `/v1/images/generations`.

Therefore phase 1 should implement a CodexMonitor-owned backend tool that calls
ADG directly, while normalizing the result into a frontend model shaped like
upstream `imageGeneration`. This keeps the UX native and leaves a clean migration
path if ADG later supports the upstream Responses `image_generation` tool.

## ADG Contract

Base URL:

- Debug/UAT default: `https://adg-uat.zhaozhunai.com`
- Release default follows the existing enterprise AI base URL policy.
- Environment overrides should reuse the existing enterprise AI base URL logic.

Endpoint:

```http
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer <sk-adg_xxx>
```

Phase 1 request:

```json
{
  "model": "gpt-image-2",
  "prompt": "A small blue rocket icon on a clean white background",
  "size": "auto",
  "n": 1
}
```

`size` defaults to `auto`. The model may also provide any `WIDTHxHEIGHT`
dimension that satisfies the current `gpt-image-2` constraints: maximum edge
`<= 3840px`, both edges multiples of `16px`, long-to-short ratio `<= 3:1`, and
total pixels between `655,360` and `8,294,400`.

The backend must accept both common response shapes:

```json
{
  "data": [
    {
      "url": "https://..."
    }
  ]
}
```

```json
{
  "data": [
    {
      "b64_json": "..."
    }
  ]
}
```

For `url`, CodexMonitor downloads the image and stores it locally. For
`b64_json`, CodexMonitor decodes and stores it locally.

## Architecture

### Model-Visible Tool Strategy

Phase 1 should expose image generation as an app-server v2 dynamic tool, not as a
frontend intent detector and not as a user-operated form.

Codex app-server already supports `thread/start.dynamicTools` and the
`item/tool/call` server request path. CodexMonitor should add a dynamic tool when
starting new threads:

```ts
{
  namespace: "codex_monitor",
  name: "generate_image",
  description: "Generate an image from a text prompt. Use this when the user asks to create, draw, design, or generate an image, icon, illustration, background, poster, or visual asset.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      size: {
        type: "string",
        description: "Optional. Use auto, or WIDTHxHEIGHT when the user asks for a specific aspect ratio or resolution. For gpt-image-2, width and height must be multiples of 16, max edge <= 3840, aspect ratio <= 3:1, and total pixels between 655360 and 8294400."
      }
    },
    required: ["prompt"],
    additionalProperties: false
  }
}
```

When the model calls the dynamic tool, app-server sends `item/tool/call` to the
client. CodexMonitor handles that request by calling the Tauri backend image
generation command and responds with a `DynamicToolCallResponse`.

This gives the desired native behavior:

- The model chooses when image generation is appropriate.
- The call is part of the normal turn lifecycle.
- The result is visible to the model as tool output.
- CodexMonitor can render the matching `dynamicToolCall` as a first-class
  `imageGeneration` card instead of a generic tool row.

Existing threads that were started before the dynamic tool was available will
not automatically have the tool. Phase 1 should apply the tool to newly started
threads. A follow-up can add resume-time migration or thread restart guidance if
needed.

### Backend Modules

Add shared backend logic first, following the repo architecture rules:

- `src-tauri/src/shared/image_generation_core.rs`
  - Builds and sends ADG image generation requests.
  - Parses ADG success and error responses.
  - Downloads URL responses or decodes base64 responses.
  - Writes generated image files and metadata.

- `src-tauri/src/image_generation.rs`
  - Thin Tauri command adapter.
  - Reads the encrypted ADG runtime key through the existing runtime secret
    store.
  - Calls shared core and returns frontend-safe result metadata.

- `src-tauri/src/lib.rs`
  - Registers the Tauri commands.

- `src/services/tauri.ts`
  - Adds typed frontend IPC wrappers.

- `src-tauri/src/shared/codex_core.rs`
  - Adds the `dynamicTools` entry to `thread/start`.
  - Leaves normal `turn/start` behavior unchanged, because dynamic tools are
    thread-scoped in app-server.

The first phase should handle the app-server `item/tool/call` request in the
Tauri app. If remote daemon parity becomes necessary, mirror the same shared core
through daemon RPC in a follow-up.

### Frontend Modules

- `src/types.ts`
  - Add a `ConversationItem` variant or tool subtype that represents generated
    images without presenting them as generic MCP output.

- `src/utils/threadItems.conversion.ts`
  - Convert `imageGeneration`-shaped thread items into the chat item model.
  - Preserve `status`, `revisedPrompt`, `assetId`, and `savedPath`.

- `src/features/messages/components/MessageRows.tsx`
  - Render a native-feeling image generation card.
  - Show progress, preview, prompt, model, size, and actions.

- `src/features/app/orchestration` or existing thread messaging hooks
  - Handle `item/tool/call` when the requested dynamic tool is
    `codex_monitor.generate_image`.
  - Respond to app-server with dynamic tool output after the backend finishes.

## Runtime Flow

```text
User: "生成一张蓝色小火箭图标"
  -> Assistant decides an image is needed
  -> Assistant calls codex_monitor.generate_image dynamic tool
  -> App-server emits item/tool/call to CodexMonitor
  -> Tauri command reads encrypted ADG key
  -> Rust sends POST /v1/images/generations
  -> Rust stores image under the app generated-image library
  -> Rust returns generated image metadata
  -> CodexMonitor responds to item/tool/call with text and image content
  -> Chat renders the native image generation card
```

## Generated Image Library

Generated images are stored in the app data directory, not the project directory.

Suggested layout:

```text
<app-data>/
  generated-images/
    images/
      <asset_id>.png
    index.json
```

Each metadata record:

```ts
type GeneratedImageAsset = {
  id: string;
  workspaceId: string | null;
  threadId: string | null;
  source: "adg";
  model: "gpt-image-2" | string;
  prompt: string;
  revisedPrompt: string | null;
  size: string;
  localPath: string;
  mimeType: "image/png" | string;
  createdAtMs: number;
  requestId: string | null;
  status: "completed";
};
```

Phase 1 can use a JSON index if that matches existing storage patterns. If the
library grows into tagging, search, deletion, and cross-device sync, migrate the
index to SQLite later.

## Chat Item Model

Use a Codex-native-inspired shape:

```ts
type ImageGenerationConversationItem = {
  id: string;
  kind: "imageGeneration";
  status: "in_progress" | "completed" | "failed";
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  assetId: string | null;
  savedPath: string | null;
  imageSrc: string | null;
  error: string | null;
  createdAt?: number;
};
```

This keeps generated images distinct from normal user image attachments and from
generic tool rows.

For app-server events, phase 1 can receive a normal `dynamicToolCall` item.
CodexMonitor should normalize calls matching
`namespace === "codex_monitor" && tool === "generate_image"` into the
`imageGeneration` conversation item. Other dynamic tools should continue to use
the generic tool rendering path.

## Chat Card UX

The chat card should feel like a first-class assistant action:

- In progress: show an image icon, spinner, and `正在生成图片...`.
- Completed: show the generated image preview, model, size, and prompt.
- Failed: show a compact error state with a retry affordance when possible.

Actions:

- Open image preview.
- Copy prompt.
- Reveal in generated-image library.
- Save to project, only when the user chooses to do so.

The first phase can implement "save to project" as a command on the card or as a
follow-up chat action. It should not happen automatically.

## Error Handling

Backend errors should be normalized before reaching the UI.

Examples:

- Missing enterprise key:
  - `请先登录启航 AI 后再生成图片。`
- Invalid or unauthorized key:
  - `当前 API Key 无法使用生图，请重新登录或联系管理员。`
- `model_unpriced`:
  - `图片模型还未启用计费，请联系管理员在模型定价中启用 gpt-image-2。`
- No image returned:
  - `生图服务没有返回图片，请稍后重试。`
- Network failure:
  - `暂时无法连接生图服务，请检查网络后重试。`

If ADG returns `X-ADG-Request-Id`, include it in backend logs and metadata. The
UI may show it in an expandable technical detail area but should not make it the
primary message.

## Security

- The frontend must never receive or store the ADG API key.
- The backend reads the key from the encrypted runtime secret store.
- Logs must not include prompts with secrets if a future prompt may contain user
  credentials. Request IDs are safe to log.
- Downloaded URL responses must be size-limited and validated as image content.
- Generated assets live in app data and are not copied into workspaces without
  explicit user action.

## Phase 1 Scope

In scope:

- Text-to-image only.
- ADG `/v1/images/generations`.
- `model = "gpt-image-2"`.
- `size = "auto"` by default, or any valid `gpt-image-2` `WIDTHxHEIGHT`.
- `n = 1`.
- Response compatibility for `url` and `b64_json`.
- App-managed generated-image cache and metadata.
- Chat card display with image preview and prompt.
- Error normalization.

Out of scope:

- `/v1/images/edits`.
- Multiple generated candidates.
- User-operated custom size picker.
- Prompt template gallery.
- Background removal, masks, or image-to-image editing.
- Cloud sync for generated assets.

## Migration Path To Upstream Native ImageGeneration

The frontend item model should stay close to the upstream app-server
`imageGeneration` shape:

```ts
{
  type: "imageGeneration",
  id: string,
  status: string,
  revisedPrompt: string | null,
  result?: string,
  savedPath?: string
}
```

If ADG later supports the upstream Responses `image_generation` tool through
Codex runtime, CodexMonitor can map upstream `imageGeneration` items into the
same generated-image library and card. The UI should not care whether the source
was the Codex native tool or CodexMonitor's ADG tool.

## Testing

Backend:

- Unit test request payload construction.
- Unit test parsing `url` and `b64_json` responses.
- Unit test `model_unpriced` and unauthorized error normalization.
- Unit test generated asset metadata persistence.
- Unit test that API keys are not returned in command responses.

Frontend:

- Test that `thread/start` includes the `codex_monitor.generate_image` dynamic
  tool for new local threads.
- Test `item/tool/call` handling for a successful image generation request.
- Conversion test for `imageGeneration` items.
- Conversion test for `dynamicToolCall` items from
  `codex_monitor.generate_image`.
- Rendering tests for in-progress, completed, and failed image cards.
- Test that generated image cards do not render as generic MCP/tool output.
- Test copy prompt and preview actions.

Integration:

- Mock ADG response with `b64_json`; verify a local image file and metadata are
  created.
- Mock ADG response with `url`; verify the image is downloaded and cached.
- Simulate missing enterprise key; verify the user-facing login-required error.
