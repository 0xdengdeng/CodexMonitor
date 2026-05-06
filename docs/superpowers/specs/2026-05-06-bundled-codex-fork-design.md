# Bundled Custom Codex Fork Design

## Purpose

CodexMonitor will become a complete product that includes a custom Codex runtime instead of requiring users to install the official `codex` CLI separately.

The product will use a maintained Codex fork for protocol and product-policy extensions while preserving a disciplined path for syncing official Codex upstream updates.

## Chosen Architecture

CodexMonitor will consume the custom Codex fork through a git submodule at:

```text
vendor/codex
```

The submodule points to the product-maintained Codex fork, not directly to official upstream. Each CodexMonitor commit or release locks a specific custom Codex commit through the submodule pointer.

This keeps the product reproducible while allowing the Codex fork to remain independently syncable with official Codex.

## Repository Model

```text
official Codex upstream
  -> product Codex fork
      -> CodexMonitor vendor/codex submodule
          -> bundled custom Codex CLI/runtime
```

CodexMonitor remains the product repository. The custom Codex fork remains the runtime repository. The submodule is the version contract between them.

## First-Stage Scope

The first stage covers:

- App-server protocol and capability extensions.
- Product defaults and policy changes.
- Branding and enterprise configuration hooks.
- Default model, permission, and account behavior adjustments.
- Build and packaging support for a bundled custom Codex CLI.
- Protocol drift checks between the bundled fork and CodexMonitor.

The first stage does not include deep rewrites of:

- Agent scheduling.
- Tool execution internals.
- Sandbox internals.
- Context management internals.
- Core model orchestration.

Those runtime areas stay close to official Codex unless a later spec explicitly expands scope.

## Runtime Resolution

CodexMonitor will use one shared resolver for the Codex binary path. Both the Tauri app and daemon must use this resolver to avoid local/remote behavior drift.

Resolution order:

```text
workspace-specific override
-> app settings codexBin
-> bundled custom Codex binary
-> PATH codex fallback
```

The bundled binary is the default for product builds. The external override remains available for development, debugging, and compatibility testing.

## Build And Packaging

CodexMonitor will add scripts for building and packaging the submodule runtime:

```text
scripts/build-bundled-codex
scripts/check-codex-protocol
scripts/sync-codex-upstream
```

The build script compiles the Codex fork CLI/app-server from `vendor/codex` and copies the resulting binary into Tauri resources.

The packaged application must be able to start Codex app-server from the bundled binary without relying on `PATH`.

## Protocol Contract

The bundled Codex fork and CodexMonitor must stay aligned on app-server protocol behavior.

The protocol check must compare at least:

- Server notification methods emitted by the bundled Codex fork.
- Client request methods CodexMonitor sends.
- Server request methods CodexMonitor handles.
- Important payload/schema changes for routed events.
- Key config and agents schema fields used by settings UI.

CodexMonitor already treats these files as integration anchors:

- `docs/app-server-events.md`
- `docs/multi-agent-sync-runbook.md`
- `src/utils/appServerEvents.ts`
- `src/features/app/hooks/useAppServerEvents.ts`
- `src/features/threads/utils/threadNormalize.ts`
- `src/services/tauri.ts`
- `src-tauri/src/shared/codex_core.rs`
- `src-tauri/src/bin/codex_monitor_daemon/rpc/*`

When protocol behavior changes, the docs and adapters must be updated in the same change.

## Upstream Sync Flow

Official Codex updates flow through the product fork first:

```text
fetch official Codex upstream
-> merge or rebase official changes into product Codex fork
-> resolve fork conflicts
-> run Codex fork tests
-> update CodexMonitor vendor/codex submodule pointer
-> run protocol drift check
-> update CodexMonitor adapters, UI, and docs
-> run CodexMonitor validation
```

CodexMonitor should not update `vendor/codex` silently. A submodule pointer update is a runtime upgrade and must include validation evidence.

## Validation

Baseline CodexMonitor validation:

```bash
npm run typecheck
npm run test
cd src-tauri && cargo check
```

Bundled runtime validation must also include:

```bash
scripts/build-bundled-codex
scripts/check-codex-protocol
```

Focused tests should be added around the shared Codex binary resolver and protocol-drift script once those components exist.

## Risks And Guardrails

Protocol drift is the main risk. Guardrail: every submodule update runs the protocol diff and updates `docs/app-server-events.md` when behavior changes.

Fork divergence is the second risk. Guardrail: first-stage fork changes are limited to protocol extensions and product policy, not deep runtime rewrites.

Packaging drift is the third risk. Guardrail: app and daemon resolve the Codex binary through the same shared backend resolver.

Developer escape hatches remain available through `codexBin` overrides, but production builds default to the bundled custom Codex runtime.

## Acceptance Criteria

- CodexMonitor has a `vendor/codex` submodule pointing to the product Codex fork.
- Product builds include a bundled custom Codex CLI/app-server binary.
- App and daemon both resolve Codex through the same shared resolver.
- External `codexBin` override still works.
- CI can build the bundled runtime.
- CI can detect app-server protocol drift between `vendor/codex` and CodexMonitor.
- Runtime protocol docs are updated when the bundled Codex fork changes behavior.
