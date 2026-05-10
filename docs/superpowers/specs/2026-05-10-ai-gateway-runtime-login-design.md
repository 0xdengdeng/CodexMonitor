# AI Gateway Runtime Login Design

## Goal

CodexMonitor becomes a client of `ai-development-gateway` for runtime access. Users authenticate with a tenant API key, CodexMonitor stores that key securely, automatically reconnects on future launches, displays gateway quota/usage state, and routes Codex AI requests through the gateway instead of direct OpenAI/Codex defaults.

## User Flow

1. User opens CodexMonitor and sees an AI Gateway connection state in Settings and the home/account usage surfaces.
2. User enters:
   - Gateway Base URL, such as `http://localhost:1457`
   - Tenant API Key, such as `sk-adg_<tenant>_<secret>`
3. CodexMonitor validates the key against the gateway.
4. On success:
   - The base URL is saved in app settings.
   - The tenant API key is saved in the encrypted runtime secret store.
   - Managed runtime is enabled and pointed at `<gateway_base_url>/v1`.
   - The UI shows connected tenant/key status and quota/remaining usage.
5. On later launches, CodexMonitor auto-validates the saved key.
6. If the key is expired, revoked, suspended, or unauthorized, CodexMonitor clears or disables the secret-derived session state and asks the user to log in again.

## Scope

In scope:

- Add gateway login state and saved gateway base URL to settings.
- Reuse the existing encrypted runtime secret store for the tenant API key.
- Validate the saved tenant key on startup and when the user edits credentials.
- Automatically sync Codex managed runtime config so AI requests use the gateway.
- Replace or augment local account usage display with gateway quota/remaining usage.
- Handle offline, unauthorized, revoked, expired, and malformed configuration states.

Out of scope:

- Embedding the gateway admin web UI.
- Implementing platform-admin management flows.
- Replacing gateway backend endpoints.
- Changing CodexMonitor workspace/thread behavior unrelated to runtime routing.
- Storing tenant API keys in plaintext settings.

## Gateway Contract

CodexMonitor needs a small client-facing contract from `ai-development-gateway`.

Required behavior:

- Validate a tenant API key.
- Return enough identity metadata for UI display.
- Return runtime base URL information or allow CodexMonitor to derive `/v1`.
- Return current quota and remaining usage.

Expected client model:

```ts
type GatewaySession = {
  baseUrl: string;
  apiBaseUrl: string;
  tenantId?: string;
  tenantSlug?: string;
  tenantName?: string;
  apiKeyId?: string;
  keyLabel?: string;
  keyStatus?: "active" | "revoked" | "expired" | "suspended";
};

type GatewayUsage = {
  remainingCredits?: number | null;
  usedCredits?: number | null;
  monthlyLimitCredits?: number | null;
  windows?: Array<{
    label: string;
    usedPercent?: number | null;
    remainingPercent?: number | null;
    resetsAt?: string | null;
  }>;
};
```

Implementation should adapt to the actual gateway endpoints discovered in `ai-development-gateway`; if the exact validation/usage endpoint is missing, add the smallest gateway endpoint needed rather than scraping admin-only HTML or duplicating admin SPA behavior.

## Codex Runtime Routing

When gateway login succeeds, CodexMonitor updates managed runtime:

- `managedRuntime.enabled = true`
- `managedRuntime.baseUrl = <normalized_gateway_base_url>/v1`
- `managedRuntime.model` remains user-configurable and is not forced unless no model is set.
- The runtime API key env value comes from the encrypted secret store.

The existing managed runtime writer remains the source of truth for Codex `config.toml`:

- `model_provider = "agentdesk_managed"`
- `base_url = "<gateway>/v1"`
- `wire_api = "responses"`
- `requires_openai_auth = false`
- `env_key = <runtime secret env key>`

## Persistence And Security

- Gateway Base URL is non-secret and stored in `AppSettings`.
- Tenant API Key is secret and stored through the existing encrypted runtime secret path.
- Settings may store non-secret metadata such as tenant slug, tenant name, key label, and last successful validation time.
- The secret must never be written into `settings.json`, Codex `config.toml`, logs, debug panels, or frontend-visible state beyond a boolean `hasSecret`.

## Frontend Surfaces

Settings:

- Add an AI Gateway section or card.
- Show connection state: disconnected, validating, connected, offline, invalid.
- Provide fields for Base URL and Tenant API Key.
- Provide actions: connect/save, validate, disconnect.

Home/sidebar usage:

- Prefer gateway quota/remaining data when gateway is connected.
- Keep existing local/session token usage visible.
- Clearly distinguish gateway quota from local session usage.

Account switcher:

- Existing Codex login remains available for non-gateway setups.
- When gateway runtime is enabled, labels should reference gateway tenant/key state rather than OpenAI account auth.

## Error Handling

- Network failure: keep saved config, mark gateway as offline, do not erase the key.
- `401` or `403`: mark credentials invalid and require re-login.
- Revoked/expired/suspended key response: mark invalid; clear the runtime secret if the gateway explicitly says the key is not usable.
- Malformed Base URL: block save with inline validation.
- Missing API Key: allow saving Base URL only, but do not enable managed runtime.

## Testing

Frontend:

- Settings normalization preserves gateway fields and never exposes secret values.
- Gateway login form handles success, offline failure, unauthorized failure, and disconnect.
- Home usage model maps gateway quota into display cards without breaking existing local usage.

Backend/Tauri:

- AppSettings serialization/deserialization migrates missing gateway fields safely.
- Runtime secret store continues to encrypt/decrypt tenant API keys.
- Managed runtime sync writes gateway base URL and never writes the API key to config.

Integration:

- Login success enables managed runtime and saves secret.
- App restart auto-validates saved gateway credentials.
- Invalid/expired key returns the UI to login-required state.

## Open Decisions

- Exact gateway validation and usage endpoints must be confirmed from `ai-development-gateway`. If missing, implement a minimal tenant-key self endpoint there.
- The default model should remain the current user setting unless product direction later chooses a gateway-provided default.
