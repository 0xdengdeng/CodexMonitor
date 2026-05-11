# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Companion Docs (read for deeper context, do not duplicate here)

- `AGENTS.md` — full agent contract: routing rules, hotspots, parity checklist, design-system guardrails.
- `docs/codebase-map.md` — "if you need X, edit Y" task-oriented file map.
- `docs/multi-agent-sync-runbook.md` — upstream `../Codex` sync checklist.
- `docs/slash-commands.md` — composer slash command implementation map.
- `docs/ota-release.md` — desktop OTA release secrets / signing / smoke test.
- `docs/mobile-ios-tailscale-blueprint.md` — iOS remote-over-Tailscale runbook.
- `README.md` — setup, requirements, release builds, iOS scripts.

## Project Shape

AgentDesk is a Tauri app (product name; package name in `package.json` is `agentdesk`, repo name is CodexMonitor) that orchestrates Codex AI agents across local workspaces, with an optional headless remote-daemon mode for iOS / cross-machine use.

Three runtimes share one shared-core crate:

1. **Frontend** — React 19 + Vite (`src/`), feature-sliced under `src/features/<area>/{components,hooks,utils}`.
2. **Tauri app backend** — Rust process at `src-tauri/src/lib.rs`, with adapter modules per domain (`codex/`, `workspaces/`, `git/`, `files/`, `settings/`, `prompts.rs`, ...).
3. **Headless JSON-RPC daemon** — `src-tauri/src/bin/codex_monitor_daemon.rs` with router in `bin/codex_monitor_daemon/rpc.rs` and per-domain handlers in `bin/codex_monitor_daemon/rpc/*`. Lifecycle CLI: `bin/codex_monitor_daemonctl.rs`.

Both app and daemon are **thin adapters** around `src-tauri/src/shared/*` (the cross-runtime source of truth). The Codex agent itself runs as the bundled `codex-runtime` sidecar (built from `../Codex/codex-rs` via `scripts/sync-codex-runtime.mjs`, or from `AGENTDESK_CODEX_REPO` / `AGENTDESK_CODEX_BIN`).

## Non-Negotiable Architecture Rules (from AGENTS.md)

1. Cross-runtime behavior lives in `src-tauri/src/shared/*` first — app and daemon are thin adapters.
2. **Do not duplicate logic between app and daemon.** When you add a backend command:
   - Shared core (`src-tauri/src/shared/*`) →
   - App adapter + Tauri `invoke_handler` in `src-tauri/src/lib.rs` →
   - Frontend IPC wrapper in `src/services/tauri.ts` →
   - Daemon RPC method in `src-tauri/src/bin/codex_monitor_daemon/rpc.rs` (+ handler in `rpc/*`).
3. JSON-RPC method names / payload shapes are stable contracts — don't rename casually.
4. Keep Rust ↔ TypeScript types in sync: `src-tauri/src/types.rs` ↔ `src/types.ts`.
5. All Tauri calls go through `src/services/tauri.ts`; all event subscriptions fan out from `src/services/events.ts` (single listener).
6. `src/App.tsx` is composition/wiring only — stateful orchestration belongs in `src/features/app/{bootstrap,orchestration,hooks}/*`.

## Frontend Import Aliases

Configured in both `tsconfig.json` and `vite.config.ts`:

- `@/*` → `src/*`
- `@app/*` → `src/features/app/*`
- `@settings/*` → `src/features/settings/*`
- `@threads/*` → `src/features/threads/*`
- `@services/*` → `src/services/*`
- `@utils/*` → `src/utils/*`

## Commands

Use Node + npm and the Rust stable toolchain.

```bash
npm install                      # also runs sync:material-icons via postinstall
npm run tauri:dev                # full dev: syncs codex-runtime, doctor:strict, then tauri dev
npm run tauri:build              # release build (artifacts in src-tauri/target/release/bundle/)
npm run tauri:dev:win            # Windows-specific config (avoids macOS window effects)
npm run tauri:build:win
npm run build                    # frontend-only: tsc + vite build
```

Validation (run based on what you touched — match the matrix in `AGENTS.md`):

```bash
npm run typecheck                # always
npm run test                     # vitest (frontend behavior / hooks / components)
npm run test -- <path>           # single file, e.g. src/features/threads/hooks/useThreads.test.ts
npm run test:watch
npm run lint                     # eslint over .ts/.tsx (DS guardrails baked in — see below)
cd src-tauri && cargo check      # any Rust backend change
cd src-tauri && cargo build --bin agentdesk-daemon --bin agentdesk-daemonctl   # headless daemon
```

Diagnostics / native deps:

```bash
npm run doctor                   # check CMake / clang / Rust toolchain etc.
npm run doctor:strict            # fail on warnings (used by tauri:dev/tauri:build)
npm run doctor:win               # Windows variant
```

iOS (scripts auto-merge `src-tauri/tauri.ios.local.conf.json` if present):

```bash
./scripts/build_run_ios.sh                  # simulator
./scripts/build_run_ios_device.sh --device <name> --team <TEAM_ID>
./scripts/release_testflight_ios.sh         # archive + upload + submit
```

Codex runtime sync (rerun if `../Codex` changes):

```bash
npm run sync:codex-runtime              # debug
npm run sync:codex-runtime:release      # release
```

OTA release publishing: `npm run ota:publish:tos` (see `docs/ota-release.md`).

## Backend Change Flow (memorize this)

For any behavior that should work in both desktop and the remote daemon, edit in this order — skipping a layer creates app/daemon drift:

1. `src-tauri/src/shared/*` — domain logic.
2. `src-tauri/src/lib.rs` `invoke_handler!` registration + app adapter module under `src-tauri/src/{codex,workspaces,git,files,settings,prompts}/`.
3. `src/services/tauri.ts` — typed IPC wrapper.
4. `src-tauri/src/bin/codex_monitor_daemon/rpc.rs` dispatcher + handler in `rpc/*`.
5. Update contract types (`src-tauri/src/types.rs` ↔ `src/types.ts`) and tests.

Daemon method names and payload shapes must mirror Tauri commands. If something is intentionally app-only or daemon-only, leave a comment.

## Hotspots (extra care, high-churn)

- `src/App.tsx`
- `src/features/settings/components/SettingsView.tsx`
- `src/features/threads/hooks/useThreadsReducer.ts` (+ slices under `threadReducer/*`)
- `src-tauri/src/shared/git_ui_core.rs` (+ submodules)
- `src-tauri/src/shared/workspaces_core.rs` (+ submodules)
- `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`

## Thread Reducer Invariants

- `setThreads` reconciliation preserves incoming order and retains active/processing/ancestor anchors when payloads are partial.
- Never resurrect hidden threads — `hiddenThreadIdsByWorkspace` wins.
- `useThreadRows` only nests children under parents whose summaries are in the visible list; missing parent summaries promote children to roots.

## Design System Guardrails (ESLint-enforced)

`.eslintrc.cjs` has per-file `no-restricted-syntax` rules that block:

- Raw modal markup (`<div role="dialog">`, `aria-modal`, legacy `*-modal-*` classes) — use `ModalShell`.
- Raw `<aside>` for panel shells — use `PanelFrame` / `PanelMeta` / `PanelSearchField`.
- Raw toast wrappers / `<div aria-live>` — use `ToastViewport` / `ToastCard` / `ToastHeader` / `ToastActions` / `ToastError`.
- Raw popover/dropdown shells — use `PopoverSurface` / `PopoverMenuItem`.
- Hardcoded color literals (`#hex`, `rgba(`, `hsla(`) in DS-targeted components — use design-system CSS variables.

If lint fails on these, switch to the DS primitive — do not silence the rule.

## Runtime / State Notes

- **App data dir** owns persistent state: `workspaces.json`, `settings.json`, `codex-home/` (managed Codex runtime home — does NOT default to `~/.codex`), `worktrees/<workspace-id>/` (legacy `.codex-worktrees/` still readable).
- **localStorage** holds UI state only (panel sizes, reduced transparency, recent thread activity).
- Codex runtime always uses the bundled `codex-runtime` sidecar over stdio. Persisted custom-binary paths are ignored at runtime; choose runtime at sync time via `AGENTDESK_CODEX_REPO` / `AGENTDESK_CODEX_BIN`.
- On launch and on window focus, app reconnects each workspace and refreshes thread lists; threads are filtered by workspace `cwd`. Selecting a thread always calls `thread/resume`.
- Backend → frontend events flow through `src-tauri/src/event_sink.rs` → event name `app-server-event` (+ `terminal-output` / `terminal-exit`) → fanout in `src/services/events.ts` → router `src/features/app/hooks/useAppServerEvents.ts` → thread hooks/reducer. If payload shape changes, update parser/guards in `src/utils/appServerEvents.ts` first.
