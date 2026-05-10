# Enterprise AI Runtime Login Design

## Goal

CodexMonitor becomes a client of `ai-development-gateway` for runtime access while hiding gateway terminology from end users. Users authenticate with a tenant domain and tenant API key, CodexMonitor stores the key securely, automatically reconnects on future launches, displays enterprise account quota/usage state, and routes Codex AI requests through the gateway instead of direct OpenAI/Codex defaults.

## User Flow

1. User opens CodexMonitor and sees a login-required state in Settings and the home/account usage surfaces.
2. User enters:
   - Tenant domain, such as `free-bai`
   - Tenant API Key, such as `sk-adg_<tenant>_<secret>`
3. CodexMonitor validates the tenant domain and key against the gateway.
4. On success:
   - Non-secret enterprise account metadata is saved in app settings.
   - The tenant API key is saved in the encrypted runtime secret store.
   - Managed runtime is enabled and pointed at the configured internal gateway `/v1` endpoint.
   - The UI shows logged-in enterprise account status and quota/remaining usage.
5. On later launches, CodexMonitor auto-validates the saved key.
6. If the key is expired, revoked, suspended, or unauthorized, CodexMonitor clears or disables the secret-derived session state and asks the user to log in again.

## Scope

In scope:

- Add enterprise login state and non-secret account metadata to settings.
- Reuse the existing encrypted runtime secret store for the tenant API key.
- Validate the saved tenant domain and tenant key on startup and when the user edits credentials.
- Automatically sync Codex managed runtime config so AI requests use the gateway.
- Replace or augment local account usage display with enterprise quota/remaining usage.
- Handle offline, unauthorized, revoked, expired, and malformed configuration states.

Out of scope:

- Embedding the gateway admin web UI.
- Implementing platform-admin management flows.
- Replacing gateway backend endpoints.
- Changing CodexMonitor workspace/thread behavior unrelated to runtime routing.
- Storing tenant API keys in plaintext settings.
- Asking the user for gateway base URL or exposing gateway terminology in the UI.

## Gateway Contract

CodexMonitor needs a small client-facing contract from `ai-development-gateway`. This contract is internal implementation detail; user-facing copy must not mention gateway, base URL, or model provider.

Required behavior:

- Validate a tenant domain and tenant API key.
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
  tenantDomain?: string;
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
- `managedRuntime.baseUrl = <configured_internal_gateway_base_url>/v1`
- `managedRuntime.model` remains user-configurable and is not forced unless no model is set.
- The runtime API key env value comes from the encrypted secret store.

The existing managed runtime writer remains the source of truth for Codex `config.toml`:

- `model_provider = "agentdesk_managed"`
- `base_url = "<configured_internal_gateway_base_url>/v1"`
- `wire_api = "responses"`
- `requires_openai_auth = false`
- `env_key = <runtime secret env key>`

## Persistence And Security

- Gateway Base URL is implementation configuration and is not shown on the login page.
- Tenant domain is non-secret and stored in `AppSettings`.
- Tenant API Key is secret and stored through the existing encrypted runtime secret path.
- Settings may store non-secret metadata such as tenant domain, tenant slug, tenant name, key label, and last successful validation time.
- The secret must never be written into `settings.json`, Codex `config.toml`, logs, debug panels, or frontend-visible state beyond a boolean `hasSecret`.

## Frontend Surfaces

Settings:

- Add an enterprise AI login section or card.
- Show connection state: disconnected, validating, connected, offline, invalid.
- Provide fields for Tenant Domain and API Key.
- Provide actions: login/save, validate, change key, logout.
- User-facing copy uses "login", "enterprise account", "tenant domain", "API Key", and "account usage".
- User-facing copy does not use "gateway", "base URL", "model provider", or "runtime".

Home/sidebar usage:

- Prefer enterprise account quota/remaining data when logged in.
- Keep existing local/session token usage visible.
- Clearly distinguish enterprise account quota from local session usage.

Account switcher:

- Existing Codex login remains available for non-gateway setups.
- When enterprise login is active, labels should reference enterprise account state rather than OpenAI account auth.

## User-Facing Copy

Login card:

- Title: `登录启航 AI`
- Description: `输入企业提供的租户域和 API Key，登录后即可使用 AI 能力并查看额度与用量。`
- Tenant domain label: `租户域`
- Tenant domain placeholder: `例如 free-bai`
- Tenant domain hint: `请输入企业分配的租户域。`
- API Key label: `API Key`
- API Key placeholder: `sk-adg_...`
- API Key hint: `API Key 会加密保存在本机。`
- Submit button: `登录并保存`
- Loading text: `正在登录...`

Logged-in state:

- Status: `已登录`
- Account label: `企业账号`
- Account status label: `账号状态`
- Available status: `可用`
- Actions: `重新验证`, `更换 Key`, `退出登录`

Usage:

- Section title: `账号用量`
- Cards: `剩余额度`, `本周期已用`, `月度额度`, `下次重置`, `账号状态`, `企业账号`
- Empty state: `登录后显示额度与用量。`
- Offline state: `暂时无法登录，已保留本机凭据。`
- Invalid state: `登录已失效，请重新登录。`

Errors:

- Empty tenant domain: `请输入租户域。`
- Tenant not found: `未找到该企业账号，请检查租户域。`
- Empty API Key: `请输入 API Key。`
- Invalid API Key: `API Key 无效或无权限，请检查后重试。`
- Expired API Key: `API Key 已过期，请更换新的 Key。`
- Revoked API Key: `API Key 已不可用，请联系管理员。`
- Suspended account: `当前企业账号不可用，请联系管理员。`
- Network failure: `暂时无法登录，请稍后重试。`
- Server failure: `服务返回异常，请稍后重试。`

Logout confirmation:

- Title: `退出登录？`
- Description: `退出后将清除本机保存的 API Key，并停止使用当前企业 AI 服务。`
- Confirm: `退出登录`
- Cancel: `取消`

## Error Handling

- Network failure: keep saved config, mark login as offline, do not erase the key.
- `401` or `403`: mark credentials invalid and require re-login.
- Revoked/expired/suspended key response: mark invalid; clear the runtime secret if the gateway explicitly says the key is not usable.
- Missing tenant domain: block login with inline validation.
- Missing API Key: block login with inline validation.

## Testing

Frontend:

- Settings normalization preserves enterprise login fields and never exposes secret values.
- Login form handles success, offline failure, unauthorized failure, and logout.
- Home usage model maps enterprise quota into display cards without breaking existing local usage.

Backend/Tauri:

- AppSettings serialization/deserialization migrates missing enterprise login fields safely.
- Runtime secret store continues to encrypt/decrypt tenant API keys.
- Managed runtime sync writes gateway base URL and never writes the API key to config.

Integration:

- Login success enables managed runtime and saves secret.
- App restart auto-validates saved tenant domain and key.
- Invalid/expired key returns the UI to login-required state.

## Open Decisions

- Exact gateway validation and usage endpoints must be confirmed from `ai-development-gateway`. If missing, implement a minimal tenant-key self endpoint there. This endpoint remains an implementation detail and does not change user-facing copy.
- The default model should remain the current user setting unless product direction later chooses a gateway-provided default.
