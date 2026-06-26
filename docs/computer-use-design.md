# Computer-Use Capability Design (define-first draft v2)

> Status: **define-first draft v2 (2026-06-25). Contracts for review BEFORE implementation.**
> Goal: let the Codex agent control the **local desktop** (screenshot → click/type/scroll) on
> **macOS AND Windows** — the v2 capability deferred from `browser-capability-design.md` §2.
> Decisions locked with the user (2026-06-25): **CUA / screenshot-coordinate style**; **cross-platform
> mac + win**; **(a) generate_image-style delegation** (coding session stays on the coding model, the
> grounding is delegated to a **configurable** vision model); **Rust** MCP server; **server-side**
> approval enforcement; **primary display only** (v1). v2 folds in the 2026-06-25 design review.

## 0. Feasibility — proven vs open

**Proven (this session):**
- **A reachable model grounds, AND the gateway path preserves it.** Probe results (synthetic UI,
  `/1000` normalized convention): `doubao-seed-1-6-vision-250815` ~2px Ark-direct;
  `doubao-seed-1-6-flash-250828` (the **gateway-exposed** `visual_grounding` model) ~2px Ark-direct;
  and via the **real gateway path** (codex→gateway→Ark) **~5px, 5/5** — i.e. the gateway's image
  handling adds ~0 grounding degradation (2026-06-25 A/B vs Ark-direct). **The review's image-detail
  /resampling concern is refuted.** Note: `doubao-seed-1-6-vision-250815` is **NOT gateway-served** —
  `doubao-seed-1-6-flash-250828` is the gateway equivalent (also `/1000`).
- **No codex fork needed.** A local stdio MCP server (codex-home `config.toml [mcp_servers.computer]`,
  the same seam the shipped browser feature uses) exposes the tools; native
  `computer-use@openai-bundled` is dead for AgentDesk (remote, ChatGPT-gated).
- **Cross-platform mechanism exists** (greenfield): `xcap` (capture) + `enigo` (inject), both macOS +
  Windows. Not yet dependencies.

**Open / must-spike (§12):** gateway-path fidelity; real-screen robustness; Windows DPI + UIPI;
per-model coordinate-convention calibration.

## 1. Model story — delegation, NOT a session takeover (corrects v1's false "hard constraint")

A codex **turn** is single-model (`core/src/client.rs:720` — one `model` per request; MCP tools carry
no per-tool model field). But a session is **not** locked to one model, and the ADG fork already
delegates a single tool call to a different model: **`generate_image`** routes one call to the image
model via `x-adg-image-model` (`core/src/tools/handlers/generate_image.rs:35,47,179`); `spawn_agent`
takes a per-spawn `model` override; `Op::OverrideTurnContext{model}` swaps per turn.

⇒ Computer-use uses **decision (a)**: the coding session **stays on the coding model**; the model
emits **high-level intents** (it is not a vision model and never grounds), and the **grounding is
delegated** to a configurable vision model **inside the computer-mcp**. The coding model never sees
raw screenshots or emits coordinates.

## 2. Architecture (the loop)

```
Coding session (coding model)
  └─ emits  computer_act("click the Submit button")        ← high-level intent (MCP tool call)
        └─ local computer-mcp  (executor + gateway client):
             1. xcap screenshot (local, native resolution)
             2. call the CONFIGURED vision model via the gateway (detail:original)
                  → grounded action in the model's coordinate convention
             3. denormalize per that model's convention → physical px (DPI-aware)
             4. enigo inject (local)        [main thread of its OWN process → no tauri#6421]
             5. return a TEXT result (`did`) to the coding model — never a raw image (it can't read pixels)
```
The vision model is an **internal dependency of the computer-mcp**, reached through the gateway with
the session's key. The coding model orchestrates; the vision model only grounds. Approval lands on
the **`computer_act`** call (the user sees "click the Submit button", not raw coordinates).

## 3. Configurable CUA model registry (§ requested by user — not hardcoded to doubao)

There is **more than one** vision model; the grounding model is **configurable**. Registry entry:

```
CuaModel { model_id: string, coordinate_convention: CoordConvention, /* future: action_format */ }
CoordConvention = "normalized_1000"   // doubao / UI-TARS family (per-axis 0..1000)
               | "absolute_pixels"    // Anthropic computer_20* / OpenAI CUA
               | "normalized_unit"    // (reserved, 0..1 float)
```
- **The registry is SOURCED FROM THE GATEWAY, not hardcoded in the client** (user decision
  2026-06-25). The gateway is already the model-capability SSOT (its manifest carries `gui` /
  `visual_grounding` labels); it gains a **`computer_use` capability flag + a `coordinate_convention`
  field** per CUA model. CodexMonitor **fetches the tenant's available CUA models (+ their
  conventions) from the gateway** (filter the existing model-catalog fetch by `computer_use`), so the
  model picker and the convention are always whatever the gateway currently serves — adding/removing a
  CUA model is a gateway change, zero client release.
- v1 seed (gateway manifest): **`doubao-seed-1-6-flash-250828 → normalized_1000`** (the gateway-served
  `visual_grounding` model; verified Ark-direct + gateway-path ~5px). `doubao-seed-1-6-vision-250815`
  also `normalized_1000` (~2px) but is **NOT gateway-served** — use it only if onboarded. A future
  Anthropic CUA → `absolute_pixels`.
- **User setting**: pick the grounding model from the gateway-provided CUA list; default
  `doubao-seed-1-6-flash-250828`.
- The computer-mcp is spawned with the selected `{model_id, coordinate_convention}` (both from the
  gateway) and denormalizes accordingly — **the convention is data-driven, never hardcoded `/1000`**
  (resolves the review's "convention is model-specific" finding).
- **Onboarding a new CUA model = calibrate then record in the gateway manifest.** Run the grounding
  probe (`run_probe.py`) against the new model; the per-axis error ratio reveals its convention (how
  `/1000` was detected); write `{computer_use:true, coordinate_convention}` into the gateway manifest.
  Clients pull it automatically.

## 4. MCP tool schema (frozen boundary — intent-level, since the coding model doesn't ground)

```
computer_act(instruction: string)    → { did: string }      // grounds + executes ONE UI action
computer_observe(question: string)   → { answer: string }   // vision model answers about the screen (read-only)
computer_wait(ms: int)               → { ok: true }
// On failure EVERY tool returns: { error: { code: ErrorCode, message: string } }
ErrorCode = "grounding_failed"    // vision model couldn't locate the target / low confidence
          | "injection_failed"    // OS injection error (e.g. windows_uipi_elevated)
          | "out_of_bounds"
          | "vision_model_error"  // gateway / model call failed
          | "rate_limited"        // server-side safety gate (§7)
          | "needs_reconfirm"     // per-N re-confirm required (§7)
          | "permission_missing"  // TCC not granted (should not reach here past the §6 gate)
```
- **No tool returns a raw image to the coding model** — it is NOT a vision model (§1), so a raw
  screenshot is dead weight at best and a misleading contract at worst (review). All "seeing" is
  encapsulated in computer-mcp; the coding model only ever gets **text** (`did` / `answer`). To verify
  screen state it calls `computer_observe`. (`computer_screenshot` was removed — a raw image to a
  non-vision consumer is dead; it overlapped `computer_observe`.)
- **One action per `computer_act`** in v1 (the coding model drives the loop + each action is
  separately approvable). No internal multi-step sub-loop in v1.
- Low-level coordinate tools are **internal** to the computer-mcp (it converts intent→coords→pixels);
  they are NOT exposed to the coding model.
- **`key` token set is enumerated** (not free-form) so destructive combos can be policy-gated; the
  server maps tokens to per-OS modifiers (`cmd` vs `ctrl`). **`scroll` unit = wheel "lines"** (one
  defined unit; the server maps to per-OS granularity). **"Active display" = primary** (v1).

## 5. Per-OS contract (cross-platform = mac + win, locked)

| Concern | macOS | Windows |
| --- | --- | --- |
| Capture | `xcap` (ScreenCaptureKit) | `xcap` (Windows Graphics Capture) |
| Inject | `enigo` (CGEvent) | `enigo` (SendInput) |
| Permissions | **TCC: Screen Recording + Accessibility** (manual grant, relaunch; **OTA re-sign can invalidate** → re-check on every launch) — a **net-new TCC query**, NOT the no-Chrome path-probe | **none** for capture+SendInput |
| **DPI / coords** | denormalize against the captured display's **actual backing-scale** (never hardcode 2.0); primary-only ⇒ uniform scale holds | **per-monitor DPI**: `xcap` returns **physical** px, `enigo`/`SetCursorPos` take **logical** px → after `px = coord/conv × physical_dim`, convert **physical → logical** before injecting (pin this direction) |
| UIPI | n/a | non-elevated cannot inject into elevated windows → surface a clear error (§4); do not run elevated |

DPI (esp. Windows physical↔logical) is the #1 mechanism risk → **must-spike on a Windows host (§12.3)**.

## 6. Capability toggle + permission flow

- First-class **"Computer use" toggle**, **off by default**; greyed under `is_remote_mode`.
- On enable, a per-OS **readiness check** (reuse the no-Chrome **pattern**, but the macOS check is a
  **net-new TCC query**, not a path probe): macOS → check Screen Recording + Accessibility; if missing,
  prompt + deep-link to System Settings + instruct relaunch (cannot auto-grant); **do not write the
  `[mcp_servers.computer]` block until granted** (detect-before-persist gate). Windows → enable directly.
- **Remove the managed block when entering remote mode**, not only on the toggle transition (review note).

## 7. Safety — server-side enforced, because the codex approval card is NOT a guaranteed gate

Full desktop control's blast radius far exceeds the isolated browser. The review established that
codex's MCP approval offers **always-allow** (`ACCEPT_FOR_SESSION` / `ACCEPT_AND_REMEMBER`,
`core/src/mcp_tool_call_tests.rs:721-774`), so "every action prompts" is **not** enforceable via the
elicitation card — that card is **advisory**. The real gate lives where we control it:

- **Server-side, in computer-mcp — two gates, not one:**
  - **Actuation gate:** a hard rate limit + a per-N re-confirm on **`computer_act`** (the only tool
    that injects), which the model cannot bypass (the server refuses + returns `rate_limited` /
    `needs_reconfirm` until re-confirmed), independent of codex's approval state.
  - **Egress gate (screen-leaves-the-machine):** the privacy boundary is crossed by **every**
    screenshot sent to the vision model — `computer_act` AND `computer_observe`. A second rate-limit +
    per-N re-confirm keyed on **frames leaving the machine** (not just actuations), so a model cannot
    loop `computer_observe` to exfiltrate the screen continuously without tripping a gate.
- **Injection chokepoint (deliberate):** only `computer_act` actuates — `enigo` is reached solely
  downstream of the codex-gated `computer_act` tool. The internal vision-model call carries **no
  actuation power**, so its invisibility to codex's turn/approval accounting does **not** widen the
  injection blast radius. `computer_act` is the single chokepoint, gated by BOTH codex approval and
  the server-side actuation gate. (Stated explicitly so `security-reviewer` reads the bypass as
  intended, not an oversight.)
- **Pin the session approval policy** so `computer.*` cannot be set to always-allow / full-access
  silently; default **on-request**.
- Remote/daemon **hard-gated off**. `security-reviewer` **mandatory** before shipping.
- **Privacy:** screenshots leave the machine to the (gateway) vision model — surface this clearly in
  the enable copy (the user's screen content is sent off-device for grounding).

## 8. External dependency (gateway side — tracked separately)

The computer-mcp calls the configured vision model **through the gateway**. Prereqs (gateway/supply-core):
1. **Serve + grant** the configurable **set** of CUA models (not just doubao-vision).
2. **Encode the CUA model facts in the manifest** — a `computer_use` capability flag + a
   `coordinate_convention` per model — and **expose them on the model-catalog/list endpoint** the
   client already fetches, so CodexMonitor's registry (§3) is gateway-sourced.
3. The `/v1` (chat or responses) path must pass **image input + the grounding tool** through to Ark at
   **`detail:original`** fidelity. **Verified 2026-06-25:** `/v1/chat/completions` with image +
   function-tool reaches doubao and grounds at ~5px (no degradation) — the path already works.
4. **Tenant enablement must go through the proper admin/grant path, not a raw `tenant_model_grants`
   insert** — the gateway **caches** the tenant's enabled-model set; a raw DB insert is NOT picked up
   (returns `model_not_enabled_for_tenant` despite the row). The model picker / enablement must use
   the cache-invalidating admin path.
This is a gateway task and a hard prerequisite for end-to-end use; it is the SSOT for which models are
CUA-capable and how their coordinates are interpreted.

## 9. Bundling

A per-OS `computer-mcp` binary in **`externalBin`**, built in CI per target (macOS arm64/x64, Windows
x64) — the **`codex-runtime` sidecar is the template** (a real bundled binary in `Contents/MacOS`),
**not** the browser feature (browser is `npx @playwright/mcp`, unbundled). The managed writer points
`[mcp_servers.computer].command` at the bundled absolute path.

## 10. Backend change flow

1. `shared/computer_mcp_core.rs` — managed `[mcp_servers.computer]` **managed-key** writer + removal +
   readiness gate (config-writer pattern from `browser_mcp_core`; managed-key, not begin/end markers).
2. `computer-mcp/` (Rust) — stdio MCP server: xcap + enigo + the configured-model grounding client +
   per-convention denorm + per-OS DPI + server-side safety gate.
3. `lib.rs` adapters + `tauri.ts` + daemon parity (app-only).
4. Contract types (`types.rs` ↔ `types.ts`: CuaModel, CoordConvention, readiness) + tests.
5. SPA: "Computer use" toggle + permission flow + **model picker** + safety/privacy copy.

## 11. Open decisions — RESOLVED (2026-06-25)

1. Grounding delegation → **(a)** generate_image-style; coding session kept, grounding delegated to the
   configured vision model in computer-mcp.
2. MCP server language → **Rust**.
3. Approval → **server-side enforced** (rate-limit + per-N re-confirm) + pinned on-request; card advisory.
4. v1 scope → **primary display only**.
5. Vision model → **configurable registry** (§3), default doubao-vision, not hardcoded.

## 12. Must-spike

1. **Gateway-path fidelity — ✅ RESOLVED (2026-06-25).** Ran the probe via the real gateway path on
   `doubao-seed-1-6-flash-250828`: **~5px, 5/5**, A/B vs Ark-direct showed ~0 degradation. `/1000`
   survives the gateway. (Used a temporary tenant grant, since removed.)
2. **Real-screen robustness** — grounding on a dense, real UI (the ~2-5px was a clean synthetic mockup).
3. **Windows DPI + UIPI** — needs a Windows host: physical→logical conversion correctness, cursor
   positioning, elevated-window limit. (Not yet verified — no Windows host available.)
4. **enigo process model** — confirm the separate-process MCP server avoids tauri#6421 on macOS.

## 13. Phasing

1. This doc + subagent re-review + your review (no code).
2. Contracts: tool schema + CuaModel/CoordConvention types + the managed-writer signature (no behavior).
3. `computer-mcp` core (macOS first: xcap + enigo + configured-model grounding + denorm) + the
   gateway-path/real-screen probe.
4. Managed writer + readiness/TCC gate + toggle + model picker (mirror the no-Chrome config-writer).
5. Windows backend (DPI/UIPI spike → impl).
6. `security-reviewer` (mandatory) + `pr-reviewer`.

## 14. Phase 3a — observe-only MVP (2026-06-26, IMPLEMENTED)

The full act+observe vision (§1–§13) stands; we ship it in two cuts and this section pins the first.
**De-scope decision (user, 2026-06-26):** ship `computer_observe` ALONE first; defer `computer_act` /
`computer_wait`.

**Why observe-first.** Act carries the hard, irreducible risk — pixel-grounding precision and
synthetic-click reliability (a click-verify on the macOS menu bar landed on the right coords but the
synthetic click did not open the menu). Observe needs **none** of it: no coordinates, no
denormalization, no injection, no Accessibility grant — and it sidesteps most of the Windows risk
(no `enigo`/SendInput/UIPI/DPI-inject, only `xcap` capture). It is independently useful ("read my
screen / this error / this UI") and is the foundation act builds on.

**Tool surface (this cut).** Only `computer_observe(question?: string) → text`. The managed
`enabled_tools` allow-list is trimmed to `["computer_observe"]`; `computer_act` / `computer_wait`
remain in §4 as the next cut. No coordinate convention is passed (observe needs no grounding coords).

**Vision model = the conversation model (user decision, 2026-06-26; supersedes §3's "default
doubao-vision" for the MVP).** The observe vision model defaults to the session's own codex `model`
(consistent with the conversation), NOT a separately-configured default. This drops the model-picker
UI **and** the §8.2 gateway capability-tagging OFF the MVP critical path — they become an optional
**override** (for when the conversation model isn't vision-capable, or the user wants a cheaper /
specialized vision model). So the managed writer sets `--model` to the configured codex model; if that
model isn't vision-capable, observe fails fast with a clear error and the user sets an override.
Verified: the dev build's coding model `doubao-seed-2-0-code-preview-260215` is vision-capable, so
observe works with zero extra config. (The §3 configurable registry still governs the override path.)

**Auth seam (NEW — corrects the old `computer_mcp_core` comment, i.e. the `[mcp_servers.computer].env`
secret approach §10.1 implied).** codex
spawns a stdio MCP server with a **clean env** (`env_clear()`,
`codex-rs/rmcp-client/src/stdio_server_launcher.rs:259`), then forwards only the names listed in the
server config's `env_vars` (`create_env_for_mcp_server`, `rmcp-client/src/utils.rs`). Therefore:
- the managed block sets **`env_vars = ["AGENTDESK_RUNTIME_API_KEY"]`** — a forward-by-**name** list;
  codex passes the dispatch key's **value** from its own process env, so **the secret is never
  written to config.toml** (only the var name is). Same mechanism as codex's own `bearer_token_env_var`.
  The earlier idea of `[mcp_servers.computer].env = { KEY = … }` is **rejected** — it would persist the
  secret on disk.
- the **gateway base URL + vision model** are non-secret → argv (`--gateway-base-url`, `--model`).
- the sidecar **enforces https** on the base URL (loopback-http carve-out for local dev) so the key +
  screen are never sent in cleartext (`security-reviewer` Medium, fixed).

**Safety (this cut).** Only the §7 **egress gate** applies (no actuation ⇒ no actuation gate yet): the
screenshot-leaves-the-machine rate-limit + per-N re-confirm is THE gate for observe-only, plus the
privacy enable-copy. (Egress gate enforcement/UI still to wire.)

**Implementation status (2026-06-26).** `computer-mcp` Rust crate, stdio server via **rmcp 1.8.0**
(`#[tool_router]`/`#[tool]`/`#[tool_handler]`, `transport::stdio`). Built + **protocol-verified**
(initialize / tools/list / tool schema), **fail-fast-verified** (missing key/base/model exits non-zero),
and **security-reviewed clean** (no Critical/High) on macOS. **Pending:** gateway-routed `tools/call`
E2E (gated on §8.4 — grant the vision model to a tenant via the cache-invalidating admin path), the
managed-writer observe-only update, the toggle/consent UX, and bundling.
