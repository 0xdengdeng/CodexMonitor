# Unified Model Gateway Design

## Goal

CodexMonitor supports Doubao, DeepSeek, GPT, and future model families through one unified gateway contract. CodexMonitor does not directly encode provider-specific request formats, authentication rules, model names, capability quirks, or error semantics. The gateway owns provider routing and normalization; CodexMonitor owns account connection, model selection UX, Codex runtime config sync, and per-turn model selection.

## Design Principles

- Keep one Codex runtime provider in Codex `config.toml`: `agentdesk_managed`.
- Treat Doubao, DeepSeek, GPT, and future providers as gateway-routed model catalog entries, not first-class Codex providers in the client.
- Use stable model IDs that survive display-name changes.
- Make capabilities explicit so UI behavior is driven by data, not model-name string matching.
- Keep the migration compatible with existing `managedRuntime.model` values and historical threads.
- Make identity/base instructions provider-neutral so non-GPT models do not claim to be based on GPT.

## Scope

In scope:

- Define the normalized gateway model catalog contract.
- Define the CodexMonitor settings and frontend model shape needed for provider-aware model selection.
- Define runtime config sync behavior for one gateway-backed Codex provider.
- Define how selected models flow from settings and composer UI to `turn/start`.
- Define prompt identity behavior for mixed-provider routing.
- Define migration and testing requirements.

Out of scope:

- Direct client-side API key management for Doubao, DeepSeek, OpenAI, or any other upstream provider.
- Provider-specific request/response conversion inside CodexMonitor.
- Gateway billing, quota accounting, and provider failover algorithms beyond the metadata needed by the client.
- Redesigning collaboration modes as the primary model picker.

## Current State

CodexMonitor already has a managed runtime path:

- `ManagedRuntimeConfig` stores `enabled`, `baseUrl`, `model`, `imageModel`, and `nativeImageGeneration`.
- Runtime config sync writes `model_provider = "agentdesk_managed"` and a single `[model_providers.agentdesk_managed]` block into Codex `config.toml`.
- `runtime_model_list` reads models from the managed runtime `/models` endpoint.
- `useModels` first tries `getRuntimeModelList`, then falls back to workspace `model/list`.
- Composer sends the selected `model` to `send_user_message`, which forwards it to Codex app-server `turn/start`.

This is already close to the desired architecture. The missing piece is a provider-aware, capability-aware, stable model catalog contract.

## Recommended Architecture

CodexMonitor continues to configure Codex with a single managed Responses provider:

```toml
model_provider = "agentdesk_managed"
model = "openai:gpt-5.5"

[model_providers.agentdesk_managed]
name = "agentDesk Managed Runtime"
base_url = "<gateway>/v1"
wire_api = "responses"
env_key = "<runtime-api-key-env>"
requires_openai_auth = false
supports_websockets = true
stream_idle_timeout_ms = 300000
```

The selected `model` is a gateway alias. It may look like `openai:gpt-5.5`, `deepseek:deepseek-chat`, or `doubao:doubao-seed-1.6`. Codex sends that alias as the Responses request model. The gateway resolves the alias to the real provider and model.

The gateway is responsible for:

- Mapping gateway model IDs to upstream provider models.
- Translating request fields when a provider is not natively Responses-compatible.
- Normalizing streaming events into Responses-compatible output.
- Normalizing provider errors into a stable error shape.
- Enforcing provider availability, tenant entitlements, quota, and routing policy.

CodexMonitor is responsible for:

- Fetching the model catalog.
- Showing provider-aware model labels and filters.
- Persisting the user's selected default text and image model IDs.
- Passing the selected model ID to `turn/start`.
- Avoiding provider-specific assumptions in UI and local runtime code.

## Gateway Model Catalog Contract

`GET /v1/models` returns a normalized catalog. Existing OpenAI-compatible `{ data: [...] }` shape is preserved.

```ts
type GatewayModelCatalogResponse = {
  data: GatewayModel[];
};

type GatewayModel = {
  id: string;
  providerId: string;
  providerName: string;
  model: string;
  displayName: string;
  description?: string;
  type?: "text" | "image" | "multimodal" | "embedding";
  isDefault?: boolean;
  sortOrder?: number;
  capabilities: GatewayModelCapabilities;
  supportedReasoningEfforts?: Array<{
    reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | string;
    description?: string;
  }>;
  defaultReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | string | null;
  supportedEndpoints?: string[];
};

type GatewayModelCapabilities = {
  text?: boolean;
  toolCalling?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  imageGeneration?: boolean;
  nativeImageGeneration?: boolean;
  webSearch?: boolean;
  computerUse?: boolean;
  parallelToolCalls?: boolean;
};
```

Field rules:

- `id` is the value CodexMonitor stores and sends to Codex as the model alias.
- `providerId` is stable and machine-readable, such as `openai`, `deepseek`, or `doubao`.
- `providerName` is user-facing, such as `GPT`, `DeepSeek`, or `Doubao`.
- `model` is the provider-facing model slug as understood by the gateway.
- `displayName` is the primary UI label.
- `capabilities` is additive. Unknown capability fields are ignored by older clients.
- `isDefault` is advisory. User selection and workspace/thread preference still win.
- `sortOrder` is advisory. When omitted, CodexMonitor keeps server order.

Example:

```json
{
  "data": [
    {
      "id": "openai:gpt-5.5",
      "providerId": "openai",
      "providerName": "GPT",
      "model": "gpt-5.5",
      "displayName": "GPT-5.5",
      "type": "text",
      "isDefault": true,
      "capabilities": {
        "text": true,
        "toolCalling": true,
        "reasoning": true,
        "vision": true,
        "nativeImageGeneration": true,
        "parallelToolCalls": true
      },
      "supportedReasoningEfforts": [
        { "reasoningEffort": "medium", "description": "Balanced" },
        { "reasoningEffort": "high", "description": "Deep reasoning" }
      ],
      "defaultReasoningEffort": "medium"
    },
    {
      "id": "deepseek:deepseek-chat",
      "providerId": "deepseek",
      "providerName": "DeepSeek",
      "model": "deepseek-chat",
      "displayName": "DeepSeek Chat",
      "type": "text",
      "capabilities": {
        "text": true,
        "toolCalling": true
      }
    },
    {
      "id": "doubao:doubao-seed-1.6",
      "providerId": "doubao",
      "providerName": "Doubao",
      "model": "doubao-seed-1.6",
      "displayName": "Doubao Seed 1.6",
      "type": "text",
      "capabilities": {
        "text": true,
        "toolCalling": true,
        "vision": true
      }
    }
  ]
}
```

## Stable Model ID Convention

Gateway model IDs use:

```text
<providerId>:<model-or-alias>
```

Examples:

- `openai:gpt-5.5`
- `deepseek:deepseek-chat`
- `deepseek:deepseek-reasoner`
- `doubao:doubao-seed-1.6`

The gateway may internally map these to different upstream model names. CodexMonitor does not need to know that mapping.

Backward compatibility:

- Existing plain model IDs such as `gpt-5-codex` remain accepted.
- If a plain model string appears in saved settings, CodexMonitor should preserve it until the model catalog contains a matching `id` or `model`.
- When the gateway catalog contains a provider-qualified replacement, the user can select it normally; no automatic destructive migration is required.

## CodexMonitor Data Model

Extend frontend `ModelOption` with provider metadata:

```ts
type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string | null;
  isDefault: boolean;
  type?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  capabilities?: Record<string, boolean>;
  supportedEndpoints?: string[];
};
```

Settings should continue to support the existing `managedRuntime.model` field for compatibility. Internally, it should be treated as the selected text model ID. A later cleanup can rename it to `defaultTextModelId` with migration, but the first implementation should avoid a broad settings rename.

`managedRuntime.imageModel` remains the selected image model ID. It can also use provider-qualified IDs.

## UI Behavior

Composer model picker:

- Shows `displayName` as the main label.
- Shows `providerName` as secondary metadata when more than one provider is present.
- Keeps existing model selection behavior: user selection wins, then preferred thread/workspace model, then catalog default, then first catalog entry.
- Shows reasoning effort controls only when the selected model advertises reasoning effort support.
- Uses capabilities to hide or disable unsupported affordances instead of matching model names.

Settings default model picker:

- Uses the same normalized catalog.
- Stores selected `id`, not display name.
- Preserves unknown saved models as a `(config)` option so users do not lose settings when the gateway catalog is temporarily unavailable.

Provider grouping:

- The picker may group entries by `providerName` once the catalog includes multiple providers.
- Grouping is visual only. It must not change the stored model ID or request payload.

## Request Flow

New thread:

1. CodexMonitor calls `thread/start` with `cwd`, approval policy, and dynamic tools.
2. Codex app-server resolves base config from Codex `config.toml`.
3. Codex uses `agentdesk_managed` as the provider.

Turn:

1. User selects a model in CodexMonitor.
2. CodexMonitor sends the selected catalog `id` as the `model` field to `send_user_message`.
3. `send_user_message_core` forwards that value to Codex app-server `turn/start`.
4. Codex sends a Responses request to the gateway using `model = "<provider:model>"`.
5. Gateway routes to the correct upstream provider and streams normalized Responses output back.

No provider-specific fields are needed in `turn/start` for the first version.

## Prompt Identity

The current upstream base instructions can say "based on GPT-5". That is wrong once the same Codex runtime can route to Doubao, DeepSeek, GPT, or future providers.

The client-facing model identity should be provider-neutral:

```text
You are Codex, an agentic coding assistant. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.
```

Implementation options:

- Preferred: update upstream Codex model base instructions and model catalog entries to use provider-neutral wording.
- Compatible fallback: set `base_instructions` in the managed Codex config only for the managed gateway runtime.

The fallback should preserve the existing Codex engineering instructions and only change the identity sentence. It should not introduce provider-specific identities such as "You are DeepSeek" or "You are Doubao".

## Image Model Routing

Text model and image model remain separate selections:

- Text turns use `managedRuntime.model`.
- Native image generation uses `managedRuntime.imageModel` through the existing managed provider header path.

For provider-qualified image IDs, CodexMonitor writes:

```toml
[model_providers.agentdesk_managed.http_headers]
X-ADG-Image-Model = "openai:gpt-image-2"
```

The gateway validates the image model only when image generation is used. Normal text turns must not fail because an image-only model is unavailable.

## Error Handling

Gateway catalog errors:

- If `/v1/models` fails and workspace `model/list` is available, CodexMonitor falls back to workspace `model/list`.
- If both fail, the UI keeps the saved config model as a selectable `(config)` model.
- Existing user selection is not cleared solely because a catalog refresh failed.

Turn routing errors:

- Gateway should return stable error codes such as `model_not_found`, `model_unavailable`, `provider_unauthorized`, `quota_exceeded`, and `capability_unsupported`.
- CodexMonitor displays the normalized error message and keeps the user's selected model.
- If the gateway says the model is permanently unavailable, the UI can suggest selecting another model, but it must not auto-switch during the failed turn.

Capability mismatch:

- UI should prevent obvious mismatches where possible, such as selecting an image-only model for text.
- Gateway remains the final authority and returns `capability_unsupported` if the client is stale.

## Migration

Existing settings:

- `managedRuntime.model = "gpt-5-codex"` remains valid.
- `managedRuntime.model = "openai:gpt-5.5"` becomes the preferred new shape.
- Empty `managedRuntime.model` continues to mean "use gateway or Codex default".

Model list parser:

- Continue accepting `displayName` and `display_name`.
- Continue accepting `supportedReasoningEfforts` and `supported_reasoning_efforts`.
- Add `providerId`, `provider_id`, `providerName`, and `provider_name`.
- Keep unknown catalog fields ignored.

Thread metadata:

- Historical thread model strings are displayed as stored.
- Thread resume should not rewrite historical model metadata.

## Testing

Frontend:

- Parse provider-aware model catalog entries.
- Preserve existing plain model catalog entries.
- Prefer provider catalog entry when saved config matches by `id`.
- Fall back to matching by `model` for old saved values.
- Keep saved `(config)` option when runtime catalog fails.
- Show reasoning controls only for models with reasoning metadata.

Backend/Tauri:

- Runtime config sync writes a provider-qualified `model` unchanged.
- Runtime config sync keeps one `agentdesk_managed` provider.
- Runtime config sync writes provider-qualified `imageModel` to `X-ADG-Image-Model`.
- Settings migration preserves existing plain model strings.
- `runtime_model_list_core` accepts the normalized catalog response without rewriting provider fields.

Integration:

- User selects `deepseek:deepseek-chat`; `turn/start` receives that exact model value.
- User selects `doubao:doubao-seed-1.6`; `turn/start` receives that exact model value.
- Gateway catalog unavailable; existing selected model remains visible and usable.
- Non-GPT selected model does not receive GPT-specific identity instructions in a new managed-runtime thread.

## Rollout Plan

1. Extend the gateway `/v1/models` response to include provider and capability metadata.
2. Extend CodexMonitor model parsing and `ModelOption` to retain provider metadata.
3. Update model picker display to show provider metadata when multiple providers exist.
4. Keep `managedRuntime.model` as the stored selected model ID and pass it unchanged to Codex.
5. Update managed-runtime prompt identity to provider-neutral wording.
6. Add compatibility tests for plain model IDs and provider-qualified IDs.

## Success Criteria

- Doubao, DeepSeek, GPT, and future providers appear from one `/v1/models` catalog.
- CodexMonitor stores and sends stable provider-qualified model IDs without provider-specific branches.
- Adding a new provider requires gateway catalog/routing work and no CodexMonitor code changes unless new UI-visible capabilities are introduced.
- Non-GPT models no longer answer as if their system identity is GPT-specific.
- Existing user settings and historical threads continue to work.
