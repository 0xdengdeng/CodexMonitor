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
- **A reachable model grounds.** `doubao-seed-1-6-vision-250815` returned click coordinates at **~2px**
  accuracy (6/6 on a synthetic UI) using the **`/1000` normalized** convention — verified Ark-direct.
  **Caveat (review):** that probe was Ark-direct at native fidelity; the real path
  (computer-mcp → gateway → Ark) resamples by image-detail level, so the result must be **re-confirmed
  through the gateway path with `detail:original`** (§12.2) — it proves the model *can* ground, not
  that the gateway path preserves it.
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
- v1 seed (in the gateway manifest): `doubao-seed-1-6-vision-250815 → normalized_1000` (verified);
  `doubao-seed-1-6-flash → normalized_1000` (calibrate). A future Anthropic CUA → `absolute_pixels`.
- **User setting**: pick the grounding model from the gateway-provided CUA list; default
  `doubao-seed-1-6-vision-250815`.
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
   **`detail:original`** fidelity.
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

1. **Gateway-path fidelity** — the configured vision model through the gateway (not Ark-direct), with
   the native screenshot at `detail:original`; confirm `/1000` grounding survives (re-run the probe via
   the gateway). The 2px result is Ark-direct only.
2. **Real-screen robustness** — grounding on a dense, real UI (the 2px was a clean synthetic mockup).
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
