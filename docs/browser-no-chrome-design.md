# Browser Capability — No-Chrome Detection + Guide-to-Install (define-first)

> Status: **define-first draft v2 (2026-06-25). Contracts frozen for review BEFORE implementation.**
> Expands `browser-capability-design.md` §9.1. Decisions locked with the user (§8):
> **(1) Rust OS-path probe** for detection, **(2) chrome + msedge only**, **(3) guide the user to
> install Google Chrome — NO managed-Chromium auto-download.** This v2 deletes the entire
> download-with-progress subsystem from v1; folds in the 2026-06-25 subagent review's must-fixes.
> Grounded against the current wiring (`npx @playwright/mcp@latest`, pre-T5 bundling).

## 0. Problem (today's behavior)

`browser_mcp_core.rs:58` hardcodes `--browser chrome`. With no Chrome installed, `@playwright/mcp`
hard-errors **at first browser-tool use** ("chrome executable not found") — not silent, but late and
low-level. Goal: pick an installed Chromium-family browser (chrome → msedge) if present; else guide
the user to install Chrome and **don't enable until one exists**. Surface the gap **at toggle time**.

## 1. Domain model — browser readiness (the new state)

```
BrowserReadiness =
  | SystemChannel { channel }   // "chrome" | "msedge" installed → launch with --browser <channel>
  | NoBrowser                   // neither installed → guide user to install Chrome; do NOT enable
```
No `ManagedChromium` / `NeedsDownload` (v1's download path is dropped per decision 3). The config
block is **only ever written for `SystemChannel`** — never for `NoBrowser`.

## 2. Detection contract (`shared/browser_detect.rs`, new)

Pure, side-effect-free OS-path probe — checks the **exact standard locations `@playwright/mcp`'s
channel resolver checks** (empirically confirmed against `@playwright/mcp@0.0.76`: macOS `.app`
paths, the Windows `LOCALAPPDATA/ProgramFiles/ProgramFiles(x86)` roots, Linux `/opt` + `PATH`). So
"found here" ⟺ "`--browser <channel>` will actually launch" — no false positive/negative vs launch.
No subprocess, no node spawn.

```rust
pub(crate) enum BrowserReadiness { SystemChannel(&'static str), NoBrowser }

/// Probe order, first hit wins: chrome → msedge → none.
pub(crate) fn detect_browser_readiness() -> BrowserReadiness {
    detect_with(|p| p.exists(), on_path)
}

/// Injectable for hermetic unit tests (no real FS).
fn detect_with(exists: impl Fn(&Path) -> bool, on_path_any: impl Fn(&[&str]) -> bool) -> BrowserReadiness {
    if chrome_paths().iter().any(|p| exists(p)) || on_path_any(&["google-chrome", "google-chrome-stable"]) {
        BrowserReadiness::SystemChannel("chrome")
    } else if msedge_paths().iter().any(|p| exists(p)) || on_path_any(&["microsoft-edge", "microsoft-edge-stable"]) {
        BrowserReadiness::SystemChannel("msedge")
    } else {
        BrowserReadiness::NoBrowser
    }
}
```

**Standard path table** (chrome / msedge share the same Windows roots — review fix to v1's
over-narrow msedge cell):

| OS | chrome | msedge |
| --- | --- | --- |
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` |
| Windows | `{LOCALAPPDATA, ProgramFiles, ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe` | `{LOCALAPPDATA, ProgramFiles, ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe` |
| Linux | `/opt/google/chrome/chrome` + `PATH`: `google-chrome` / `google-chrome-stable` | `/opt/microsoft/msedge/msedge` + `PATH`: `microsoft-edge` / `microsoft-edge-stable` |

Windows roots come from env (`std::env::var_os`); Linux `PATH` via `std::env::split_paths`.

Detection runs **fresh at each enable/sync** (no channel persisted in settings) — installing Chrome
later is picked up on the next toggle.

## 3. Launch-mode → args contract (`browser_mcp_core.rs` change)

The static `BROWSER_LAUNCH_ARGS` push at **lines 122–124** is replaced by an explicit channel arg.
**Always emit `--browser`** — review found that if `--browser` is omitted, `@playwright/mcp`
silently defaults to system Chrome (`validateBrowserConfig`), the exact failure this feature
prevents. Real signatures gain a `launch_channel: &str` (the existing `command/base_args/profile_dir`
params stay):

```rust
// browser_mcp_core.rs:81  (was: …, base_args: &[String])
pub(crate) fn sync_browser_mcp_config(
    codex_home: &Path, config: &ManagedBrowserConfig, command: &str,
    base_args: &[String], launch_channel: &str) -> Result<(), String>;

// browser_mcp_core.rs:95  (was: …, profile_dir: &Path)
pub(crate) fn apply_browser_mcp_to_document(
    document: &mut Document, config: &ManagedBrowserConfig, command: &str,
    base_args: &[String], profile_dir: &Path, launch_channel: &str) -> Result<(), String>;

// args assembly (replaces the hardcoded ["--browser","chrome"] push):
args.push("--browser");
args.push(launch_channel);          // "chrome" | "msedge", validated non-empty (fail-fast)
args.push("--user-data-dir"); args.push(profile_dir);   // unchanged
```

- `launch_channel` is read **only on the enable path**; `apply_*` early-returns on `!config.enabled`
  (browser_mcp_core.rs:102-105) before the arg-assembly (lines 118-124), so the disable/remove path
  passes any value (tests pass `"chrome"`; it is dead on that path).
- **All call sites** must add the new arg or the contracts commit (§9.2) won't compile: the **9 test
  call sites** of `apply_browser_mcp_to_document` in `browser_mcp_core.rs`, the **internal production
  call at `browser_mcp_core.rs:89`** (inside `sync_browser_mcp_config`, threading the arg through to
  `apply_*` — easy to miss), and the real caller `settings/mod.rs:201`.
- Add a unit test asserting the written args **always contain `--browser <channel>`** and never omit
  it.

### 3.1 Detection seam — **detect BEFORE persist** (closes the enable-time race)

**Invariant: `managed_browser.enabled=true` is persisted only if detection yields a channel at that
moment.** Today `update_app_settings` (settings/mod.rs:44) calls `update_app_settings_core` —
which **durably writes `settings.json` + the in-memory mutex** (settings_core.rs:119-120) — and only
*after* that runs `sync_browser_mcp_from_settings` (line 57). If detection ran inside sync (after
persist), a `NoBrowser` result would leave `enabled=true` persisted with **no MCP block** — an
inconsistent state that survives reboot. So detection must run **before** the core persist:

```rust
// update_app_settings (settings/mod.rs), BEFORE update_app_settings_core:
let enabling = !previous.managed_browser.enabled
    && incoming.managed_browser.enabled
    && !matches!(incoming.backend_mode, BackendMode::Remote);
let mut to_persist = incoming;
if enabling && matches!(browser_detect::detect_browser_readiness(), BrowserReadiness::NoBrowser) {
    to_persist.managed_browser.enabled = false;   // refuse the enable at the persistence layer
}
let updated = update_app_settings_core(to_persist, …).await?;   // persists the CORRECTED value
```

Then the existing browser-sync branch (settings/mod.rs:54-57) writes the block — and because it only
runs when `updated.managed_browser.enabled` is still `true`, it is only ever reached with a channel
present:

```rust
fn sync_browser_mcp_from_settings(settings: &AppSettings) -> Result<BrowserSyncOutcome, String> {
    if !settings.managed_browser.enabled {
        return sync_browser_mcp_config(&codex_home, cfg, CMD, &base_args, "chrome"); // removes block; channel ignored
    }
    let launch_channel = match detect_browser_readiness() {  // re-detect; SystemChannel expected here
        BrowserReadiness::SystemChannel(ch) => ch,
        // Unreachable on the enable path — the pre-persist gate already coerced enabled=false on
        // NoBrowser, so this fn isn't even called. Only the sub-ms vanish race reaches it; "chrome"
        // reproduces today's "Playwright errors clearly at first use" (no regression).
        BrowserReadiness::NoBrowser => "chrome",
    };
    sync_browser_mcp_config(&codex_home, cfg, CMD, &base_args, launch_channel)
}
```

**Shipped vs draft:** the v2 draft proposed a `BrowserSyncOutcome { Enabled/Disabled/NoBrowser }`
return enum. Implementation dropped it (`sync_browser_mcp_from_settings` keeps `Result<(), String>`):
the detect-before-persist gate makes the `NoBrowser` arm unreachable on the enable path, so the enum
carried no information any caller used. Simpler form shipped. Persisted state is still always
consistent (`enabled` matches whether a block was written) — guaranteed by the gate, not the enum.

## 4. Tauri command contract (one new command)

```rust
// New #[tauri::command] (NOT a mirror of check_codex_installation — that one is async + not a
// command). Detection is pure/cheap, so this is synchronous. Registered in lib.rs invoke_handler.
#[tauri::command]
fn check_browser_readiness() -> Result<BrowserReadinessReport, String>;
```
```ts
// services/tauri.ts
export async function checkBrowserReadiness(): Promise<BrowserReadinessReport>;
```

- **App-only**: like the browser toggle itself, this is not exposed on the daemon/remote RPC surface
  (a local browser can't be driven from the headless daemon). The detection inside
  `sync_browser_mcp_from_settings` already inherits the existing `BackendMode::Remote` gate at
  `settings/mod.rs:54`.
- **Opening the Chrome download page needs no new command** — the SPA opens
  `https://www.google.com/chrome/` via the app's existing external-link/opener mechanism (confirm
  the exact helper in impl). Keeps the new surface to one detection command.

## 5. DTOs (Rust `types.rs` ↔ TS `types.ts`, lockstep)

```rust
#[serde(rename_all = "camelCase")]
struct BrowserReadinessReport {
    status: BrowserReadinessStatus,   // "system" | "no_browser"
    channel: Option<String>,          // Some("chrome"|"msedge") iff status == system
}
```
```ts
export type BrowserReadinessStatus = "system" | "no_browser";
export type BrowserReadinessReport = { status: BrowserReadinessStatus; channel?: string };
```
`ManagedBrowserConfig` stays `{ enabled }` — channel is resolved at sync-time, never persisted.

## 6. Enable-time flow (state machine, SPA-gated)

The SPA gates **before** flipping `enabled` (avoids enable-then-rollback). On toggle-intent-to-enable:

1. `checkBrowserReadiness()`:
   - **`system`** → set `managedBrowser.enabled = true` (→ `update_app_settings` → sync writes
     `--browser <channel>`) → toggle succeeds.
   - **`no_browser`** → **do NOT enable**; show an inline prompt (NOT a drawer):
     *"未检测到 Chrome,请先安装 Google Chrome。[打开下载页] [重新检测]"*. `重新检测` re-runs the
     check; `打开下载页` opens the Chrome download URL. Toggle stays off until a re-check returns
     `system`.
   - **the check itself `Err`s** → toggle stays off, surface the error (no silent enable).
2. Backend safety net (closes the race where the browser vanishes between the SPA check and the
   write): `update_app_settings` re-detects **before persisting** (§3.1) and, on `NoBrowser`,
   persists `enabled=false` instead of `true`. The returned `AppSettings` comes back with
   `managedBrowser.enabled === false` despite the SPA having requested `true`, and the root settings
   handler reconciles SPA state to the backend's returned value — so the toggle snaps back off. No
   `enabled=true` is ever persisted without a writable block — no half-enabled state, no config that
   fails at first use. **Shipped note:** the SPA does not *additionally* re-run `checkBrowserReadiness`
   to re-show the install prompt on this snap-back (the proactive gate in step 1 is the primary
   prompt trigger); this only matters in the sub-ms vanish race, where the toggle flickers off
   without re-prompting. Acceptable for v1.

## 7. Fail-fast posture

- `NoBrowser` never writes the MCP block (§3.1 ordering) → no late cryptic "chrome not found".
- `--browser <channel>` is **always** emitted (§3) → never falls through to playwright's silent
  system-Chrome default. Asserted by unit test.
- Empty/blank `launch_channel` on the enable path → `Err` (don't write a malformed block).
- **Persistence-layer consistency (not just SPA revert):** `enabled=true` is never written to
  `settings.json` unless detection yielded a channel at persist time (§3.1). A swallowed `NoBrowser`
  outcome therefore cannot leave the app believing the browser is on — the pre-persist coercion is
  the guarantee; the SPA revert is only UX.
- Detection is pure; the only env reads (Windows roots, `PATH`) are total (missing → that path just
  isn't probed → falls to `NoBrowser` → guide, never crash).

## 8. Decisions (locked 2026-06-25)

1. **Detection mechanism — Rust OS-path probe.** Spawning node/playwright was considered (more
   "authoritative") but for system channels playwright resolves the *same* standard paths, via an
   internal API + a node spawn → more fragile, no gain. Rust probe matches launch behavior 1:1.
2. **Channels — chrome + msedge only.** No Brave / chrome-beta in v1 (covers the common case).
3. **No managed-Chromium download — guide the user to install Chrome.** Deletes v1's entire
   download/progress/cancel/`playwright install` subsystem. Simpler, and the user gets real Chrome
   (what `--browser chrome` wants). Tradeoff: manual install step (acceptable for a dev tool).

## 9. Phasing (define-first order)

1. **This doc + subagent review + user review** (no code). ← we are here.
2. **Contracts commit**: DTOs (`types.rs`/`types.ts`), `BrowserReadiness`/`BrowserSyncOutcome`,
   the `launch_channel` signature change + all ~9 test call sites updated to compile, the
   `check_browser_readiness` command signature — no behavior change beyond threading. User review.
3. **Detection core**: `browser_detect.rs` (path table + `PATH` lookup + injectable `detect_with`)
   + unit tests (chrome present / msedge present / none → NoBrowser; always-`--browser` assertion).
4. **Sync wiring**: `sync_browser_mcp_from_settings` detection branch + `BrowserSyncOutcome`;
   `check_browser_readiness` command + `tauri.ts` wrapper; daemon parity (app-only) comment.
5. **SPA**: readiness gate on the toggle + the inline install prompt (open-URL + re-check) + the
   backend-defense revert path.
6. **Review**: `pr-reviewer` (the new command + sync branch) before declaring done.

## 10. Known limitations (disclosed, not hidden)

- **Non-standard Chrome install path** (rare) → probe reads "not found" → guide-to-install instead
  of using it. Fail-soft (a needless install prompt), never a crash.
- **Stale config**: user uninstalls Chrome *after* enabling → re-detect only runs at toggle/sync, so
  a stale `--browser chrome` can still error at runtime. Acceptable v1; a boot-time re-detect is a
  future option.
- **msedge supported but not "preferred"**: if both are absent we always point the user at Chrome
  (not Edge), since `--browser chrome` is the documented default and the most predictable target.
