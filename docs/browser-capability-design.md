# Browser Capability Design (AI uses a browser)

> Status: **define-first draft, pending subagent review + T1 spike gate.** Not implemented.
> Goal: let the Codex agent drive a real browser (navigate + interact) from within AgentDesk,
> reusing the user's logged-in Chrome session, without forking codex-rs.

## 0. TL;DR decision

Give the agent browser automation by **bundling Microsoft Playwright MCP (`@playwright/mcp`)
as a stdio MCP server, registered into the managed `codex-home/config.toml` via the existing
`[mcp_servers]` pipeline.** No upstream fork. The agent calls the browser tools; results render
through the existing `mcpToolCall` / `view_image` UI paths; actions inherit Codex's existing
guardian approval policy.

**This is a built-in capability, not a user-registered MCP server.** Playwright MCP is an
*implementation detail*: AgentDesk bundles its runtime and owns the `[mcp_servers.playwright]`
registration (managed block, same discipline as the managed runtime provider). The user never
hand-registers an MCP server and never types `npx @playwright/mcp`. It is surfaced as a first-class
"Browser" capability, **not** an editable row in the user MCP-servers list.

## 1. Why not "native Codex browser" (investigated, rejected with evidence)

We were asked to reference native Codex. We did, against pinned source `318fe25` (= AgentDesk's
bundled runtime lineage). The native browser path is **structurally unavailable to AgentDesk**:

- `chrome@openai-bundled` / `computer-use@openai-bundled` are only allowlist string constants
  (`core-plugins/src/lib.rs:36-37`). No plugin manifest / bundled browser / Node / Playwright
  exists anywhere in `codex-rs`.
- The real `browser_navigate` tool (connector_id=playwright) is served by a **remote** MCP server
  `codex_apps` over StreamableHttp at `{chatgpt_base_url}/backend-api/wham/apps`
  (`codex-mcp/src/mcp/mod.rs:43,205-217`). Browser execution runs **server-side at OpenAI**, not local.
- Hard auth gate: `host_owned_codex_apps_enabled = apps_enabled && auth.uses_codex_backend()`
  (`mcp/mod.rs:217`). Plugin-bundle download is equally gated — `ensure_chatgpt_auth()` rejects
  API-key auth with `UnsupportedAuthMode` (`core-plugins/src/remote.rs:147`).
- AgentDesk's **managed API-key gateway provider** (`requires_openai_auth = false`,
  `runtime_config_core.rs:127`) cannot satisfy `uses_codex_backend()`. **In AgentDesk's default
  managed/API-key mode, native `browser_navigate` never appears and the chrome plugin never
  downloads.** Scope note: AgentDesk *does* wire a ChatGPT login path (`codex_login` Tauri command,
  `account/login/start {type:"chatgpt"}`), and the managed provider is off-by-default + conditional
  (`ManagedRuntimeConfig::default() = enabled:false`). So a non-managed, ChatGPT-logged-in user
  *could* satisfy the auth gate — this is NOT "structurally impossible for AgentDesk." But it does
  not rescue native for THIS feature (see below).
- The four flags `in_app_browser / browser_use / browser_use_external / computer_use` are
  `Stable, default_enabled:true` but doc-commented "Requirements-only gate" with **zero functional
  consumers** in the synced binary (`features/src/lib.rs:171-184,965-987`). Flipping them is inert.

Even under ChatGPT login, native browser execution is the **remote `codex_apps` connector running
server-side at OpenAI** (StreamableHttp → `/backend-api/wham/apps`) — not a local browser, not the
user's local Chrome. So native fails this feature's stated goal (drive a *local* browser reusing the
user's *local* logged-in Chrome) **regardless of auth mode**. Lighting it up would also mean
abandoning the gateway/API-key model for ChatGPT login (privacy + dependency regression). Rejected.
(Hybrid is also rejected: in managed mode the auth gate kills the native leg, so there is nothing to
"fall back" to; and even with ChatGPT auth the native leg is remote, not local.)

## 2. Locked product decisions (user, 2026-06-23)

| Axis | Decision |
| --- | --- |
| Packaging | **Built-in capability.** AgentDesk bundles the runtime + owns registration; user never registers an MCP server. Presented as a first-class "Browser" capability, not an editable MCP-server row |
| Default state | **Off by default; one-click first-class toggle to enable** (decision b, 2026-06-23). `ManagedBrowserConfig.enabled` defaults `false` (mirrors `ManagedRuntimeConfig`). Avoids the agent being able to drive the user's real Chrome out-of-box; the user enables consciously |
| Backend | Playwright MCP (`@playwright/mcp`), accessibility-tree driven (not screenshots) — an implementation detail, hidden from the user |
| Browser + auth | `--extension`: attach to the user's existing logged-in Chrome (reuse SSO/cookies, user-visible) |
| v1 action scope | navigate + interaction (navigate / snapshot / extract / screenshot + click / type / fill) |
| Approval | Inherit Codex's existing session approval/access mode (no bespoke gate). Full-access session → no prompt; on-request → prompt |
| Deployment | App-only; suppressed under `is_remote_mode` (mirrors deploy / file-attachment). The gate is load-bearing: a local browser cannot be driven from the headless/iOS daemon |
| Vision / computer-use | Deferred to v2 |

## 3. Architecture seam (confirmed against pinned source)

```
Settings toggle (browser enabled)
  └─ shared/runtime_config_core.rs : apply_browser_mcp_to_document()   ← writes [mcp_servers.playwright]
        └─ persist managed codex-home/config.toml
              └─ codex-runtime sidecar : McpConnectionManager spawns the stdio server (connection_manager.rs:173)
                    └─ tools unioned into the session (list_all_tools connection_manager.rs:337 → session/turn.rs:1184)
                          └─ model calls browser_navigate / browser_click / ...
                                └─ guardian approval (maybe_request_mcp_tool_approval mcp_tool_call.rs:204, GuardianApprovalRequest::McpToolCall, session approval_policy)
                                      └─ UI renders mcpToolCall (messageRenderUtils.ts:446) + screenshots via view_image
```

Empirically proven in the T1 spike (codex exec, RUST_LOG): the pinned runtime **spawns a
config.toml stdio MCP server, completes the MCP handshake, and pulls its tools/list**
(`codex_rmcp_client::stdio_server_launcher`). codex#3441 (config.toml stdio ignored) does NOT
affect this binary. node/npx present (v23.3.0); `@playwright/mcp` runs (v0.0.76).

## 4. Define-first contracts (freeze + review BEFORE any feature code)

### 4.1 MCP server config block (the cross-runtime contract)

The exact stdio block AgentDesk writes into managed `config.toml` (shape captured from
`codex mcp add` + `mcp list --json`; conforms to `config/src/mcp_types.rs` Stdio transport):

```toml
[mcp_servers.playwright]
command = "<bundled node>"          # T5 vendors node + @playwright/mcp; spike uses "npx"
args = ["<playwright-mcp entry>", "--extension"]   # + v1 tool-scope flag (see 4.3)
# optional: startup_timeout_sec, tool_timeout_sec
[mcp_servers.playwright.env]
# none required for --extension (no secret). If a backend token is ever needed it goes through
# runtime_secret_core + spawn env, NEVER plaintext in config.toml (upstream rejects bearer_token).
```

Managed-block discipline: mirror `apply_managed_runtime_config_to_document` /
`remove_managed_runtime_provider` (`runtime_config_core.rs:99-160`) — write the block only when
enabled, remove cleanly when disabled, **never clobber user-authored `[mcp_servers.*]` entries.**

### 4.2 Settings type pair (`types.rs` ↔ `types.ts`)

A global (codex-home-level) capability toggle, alongside the existing managed-runtime config:

```
ManagedBrowserConfig { enabled: bool }   // v1 minimal; room for headed/profile knobs in v2
```

Wired into the existing managed-config sync (`sync_managed_runtime_config_from_settings`,
`settings_core.rs`). Rust↔TS kept in lockstep (AGENTS.md rule 4).

### 4.3 v1 tool allowlist (pins scope + approval copy)

Playwright MCP exposes **23 tools** by default (enumerated via direct MCP handshake against
`@playwright/mcp` v0.0.76). v1 allow-list = **18** (navigate + interaction):

- navigate / tabs: `browser_navigate`, `browser_navigate_back`, `browser_tabs`
- read: `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`
- interact: `browser_click`, `browser_type`, `browser_fill_form`, `browser_select_option`,
  `browser_hover`, `browser_press_key`, `browser_drag`, `browser_drop`
- control: `browser_wait_for`, `browser_resize`, `browser_handle_dialog`, `browser_close`

**Excluded from v1** (re-evaluate in v2): `browser_evaluate`, `browser_run_code_unsafe`
(arbitrary JS exec — high blast radius), `browser_file_upload`, `browser_network_request`,
`browser_network_requests` (can leak auth headers/tokens from the user's logged-in tabs).

Both enforcement mechanisms are **confirmed available** in the pinned runtime — pick one, no spike
needed to discover support:
- codex per-server `[mcp_servers.playwright].enabled_tools` allow-list — parsed at
  `config/src/mcp_types.rs:160-164`, built into a `ToolFilter` (`codex-mcp/src/tools.rs:82-105`),
  applied at `connection_manager.rs:390`; **preferred** (enforced by our own config, server-agnostic).
- Playwright MCP's own `--caps` capability flag (server-side) — alternative / complementary.

Freeze the v1 list either way. Vision / JS-eval / file-upload explicitly excluded in v1.

### 4.4 Remote-mode suppression predicate

Suppression is an **adapter-layer guard**, not a `shared/` predicate: `is_remote_mode(&AppState)` is
async + state-bound (`remote_backend/mod.rs:110`) and cannot be called from runtime-agnostic
`shared/runtime_config_core.rs`. So the `lib.rs` settings-write adapter decides whether to invoke the
shared writer, and the Settings toggle greys out under remote. Exact precedent: deploy
(`deploy/mod.rs` early-returns on `is_remote_mode`). Keep it to that one adapter guard, not scattered checks.

## 5. Backend change flow (AGENTS.md order)

1. `shared/runtime_config_core.rs` — `apply_browser_mcp_to_document` / removal + `is_remote_mode` suppression.
2. `lib.rs` invoke_handler + app adapter (settings write path).
3. `src/services/tauri.ts` — typed IPC wrapper.
4. Daemon `rpc.rs` — app-only; leave an explicit parity comment (browser can't run from headless daemon).
5. Contract types `types.rs` ↔ `types.ts` + tests.

## 6. UI

- Tool calls + screenshots already render via existing `mcpToolCall` (`messageRenderUtils.ts:446`)
  and `view_image` grid — **no new event/renderer for v1** (confirm in T1; a bespoke "browser card"
  is optional v2 polish).
- Settings: a **dedicated first-class "Browser" capability toggle** (its own control), NOT a row in
  the user MCP-servers list. The managed `[mcp_servers.playwright]` entry must be **filtered out of**
  the user-facing MCP list (`src/features/capabilities/hooks/useMcpServers.ts`) so it never appears as
  a user-editable/removable server — same as the managed runtime provider is not user-editable. Greyed
  under remote.

## 7. Phasing

- **T1 — Spike gate (blocks everything). See §8.** Confirm Path B end-to-end + formally close Path A.
- **T2 — Define-first commit:** §4 contracts (types + TOML writer signature + tests), no behavior. User review.
- **T3 — Shared core:** `apply_browser_mcp_to_document` + removal + suppression predicate; cargo tests.
- **T4 — Adapters:** `lib.rs` → `tauri.ts` → daemon parity comment.
- **T5 — Bundling (required, not optional — it's built-in):** vendor Node + `@playwright/mcp` + the
  browser into the app bundle; the managed writer's `command` points at the **bundled absolute path**,
  never `npx`. `doctor` check for the runtime (fail-fast if absent — no silent degrade); offline-safe
  (no first-run download). A built-in tool must ship its runtime.
- **T6 — First-class capability UX + review:** a dedicated "Browser" capability toggle (NOT an
  MCP-server row); filter the managed `[mcp_servers.playwright]` out of the user MCP list; approval
  scope copy. `pr-reviewer` (code) + `security-reviewer` (new capability surface) before declaring done.
- **End-to-end validation = dogfood the built-in toggle** (flip Browser on → ask the agent to
  navigate), NOT manual MCP registration. The §8 developer spikes inject the block directly (= what
  the managed writer does) only to de-risk the seam before T2.

## 8. Must-spike unknowns (run against the pinned runtime BEFORE T2)

Partly done in the T1 spike; remaining gates:

1. **(DONE)** Pinned runtime honors a config.toml stdio MCP server: spawn + handshake + tools/list — proven.
2. **Native is dead under API-key auth:** run a real managed-auth `codex exec`, dump tools — expect
   `browser_navigate` ABSENT (proves Path A closed). Needs the user's gateway auth.
3. **Playwright stdio registers + tools surface to the model + route through approval:** add
   `[mcp_servers.playwright]` to a test codex-home, run `codex exec`, confirm the browser tools
   appear AND hit the MCP approval prompt. Validates the whole Path B seam. Needs a real model run
   + launches Chrome.
4. **`--extension` attach UX:** confirm the extension/attach handshake to the user's real Chrome
   works on macOS and that the user can pick the tab.
5. **Tauri-spawned sidecar PATH:** confirm the sidecar (launched by the app, not a login shell)
   resolves `node`/the Playwright runtime; if not, use an absolute bundled command path
   (`build_codex_path_env`).

Gate the build on spikes 2, 3, 5. Spikes 2/3 consume real gateway credits + launch a browser →
run with the user's explicit go-ahead (ideally inside the running app), not silently.

## 9. Risks / fail-fast posture

- No silent degrade: if host Chrome / the bundled runtime is missing, the capability surfaces a
  clear error (doctor + first-use), never a quiet no-op.
- Security: a browser tool is open-world + side-effecting + can touch logged-in sessions. Remote/daemon
  is hard-gated off so a remote operator can never drive the user's authenticated browser. `security-reviewer` in T6.
- **Accepted security risk (user, 2026-06-23) — full-access sessions have no browser checkpoint.**
  With `--extension` attaching to the user's *real logged-in Chrome*, a full-access session
  (`AskForApproval::Never`) lets the model navigate/click in ANY authenticated tab (banking, email,
  internal tools) with **zero prompts**. The security review recommended forcing on-request for the
  browser server; the user weighed this and **chose pure session-inherit (decision #4 stands)** for
  minimal friction, consciously accepting the full-access exposure. **Structural mitigation (decision b):
  the capability is off by default and requires a conscious one-click enable — so the exposure exists
  only after the user opts in, not out-of-box.** The per-tool mitigation remains available
  without a bespoke gate if this is revisited: `default_tools_approval_mode = "on-request"` on the
  managed `[mcp_servers.playwright]` block (`McpServerConfig.default_tools_approval_mode`, consumed
  `mcp_tool_call.rs:986`). `security-reviewer` re-flags this in T6 as informational, not a blocker.
- Bundle size: Node + Playwright MCP + (host) Chrome. `--extension` reuses the user's Chrome, so we
  ship the MCP server + its Node runtime, not a second Chromium.
