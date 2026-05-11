# Enterprise AI Login Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-domain + API Key login journey that configures managed AI access, persists the key securely, auto-validates on next launch, and surfaces account usage without exposing gateway terminology.

**Architecture:** CodexMonitor owns the user journey and stores only tenant metadata in settings while reusing the existing runtime secret store for the API Key. Tauri backend commands call the existing enterprise service endpoints, update managed runtime config internally, and return UI-safe account/usage snapshots. React settings/home components consume typed service wrappers and keep all copy user-facing.

**Tech Stack:** Tauri Rust commands, reqwest HTTP client, React + TypeScript, existing settings and runtime secret cores.

---

## Chunk 1: Backend Login, Validation, Usage

### Task 1: Add enterprise account types and default settings

**Files:**
- Modify: `src-tauri/src/types.rs`
- Modify: `src/types.ts`
- Modify: `src/features/settings/hooks/useAppSettings.ts`

- [ ] Add `EnterpriseAiConfig` to app settings with `tenantDomain`, `status`, `accountName`, `keyLast4`, `lastValidatedAtMs`, and `lastError`.
- [ ] Add `EnterpriseAiLoginResult` and `EnterpriseAiUsageSnapshot` DTOs for Tauri responses.
- [ ] Normalize missing settings to a disconnected default.
- [ ] Run: `npm run typecheck`

### Task 2: Add Tauri enterprise AI commands

**Files:**
- Create: `src-tauri/src/enterprise_ai.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/settings/mod.rs` if shared settings helpers are needed

- [ ] Implement `enterprise_ai_login(tenant_domain, api_key)`:
  - validate non-empty inputs;
  - POST `/admin/api/auth/login` with `{ tenant_slug, api_key }`;
  - store the API key in the existing runtime secret store;
  - save `enterpriseAi` metadata in app settings;
  - enable managed runtime with the internal `/v1` endpoint.
- [ ] Implement `enterprise_ai_validate()` by reusing the saved key and tenant domain, marking status invalid on failure.
- [ ] Implement `enterprise_ai_logout()` to clear the saved key, disable managed runtime, and mark disconnected.
- [ ] Implement `enterprise_ai_usage()` using the authenticated session cookie from login, returning usage and credit fields when available.
- [ ] Register commands in Tauri.
- [ ] Run: `cd src-tauri && cargo check`.

## Chunk 2: Frontend Journey

### Task 3: Add service wrappers and settings section state

**Files:**
- Modify: `src/services/tauri.ts`
- Modify: `src/services/tauri.test.ts`
- Modify: `src/features/settings/hooks/useSettingsCodexSection.ts`

- [ ] Add typed wrappers for login, validate, logout, and usage commands.
- [ ] Replace the visible managed Runtime credential editor with enterprise login state: tenant domain, API Key, login/save, validate, logout.
- [ ] Keep all user-facing copy as “登录启航 AI”, “租户域”, “API Key”, “账号用量”.
- [ ] Run targeted settings tests.

### Task 4: Render settings and home usage

**Files:**
- Modify: `src/features/settings/components/sections/SettingsCodexSection.tsx`
- Modify: `src/features/home/components/Home.tsx`
- Modify: `src/features/home/components/HomeUsageSection.tsx`
- Modify: `src/features/app/components/MainApp.tsx`
- Modify: `src/features/i18n/i18n.tsx`

- [ ] Add the login card to settings with connected, invalid, loading, and error states.
- [ ] Auto-validate after settings load when saved metadata exists.
- [ ] Show enterprise account usage cards above local usage when available.
- [ ] Avoid any user-facing gateway/base URL/runtime service wording.
- [ ] Run: `npm run typecheck` and `npm run test -- src/features/settings/components/SettingsView.test.tsx src/services/tauri.test.ts`.

## Chunk 3: Verification

### Task 5: Final checks

**Files:**
- No additional planned files.

- [ ] Run `npm run typecheck`.
- [ ] Run focused frontend tests.
- [ ] Run `cd src-tauri && cargo check`.
- [ ] Inspect git diff for accidental gateway/base URL copy exposure in UI text.
