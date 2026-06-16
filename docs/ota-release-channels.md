# OTA Release Channels — Design Contract

Status: **proposed** (define-first; implement per the staged plan below).
Extends `docs/ota-release.md` (single-channel runbook).

## Scope history

v1 of this doc proposed separate test infrastructure + byte-identical promotion
+ a verify/write-once hardening layer, and claimed the verify gate alone would
have fixed the 0.7.70 incident. Independent review showed (a) that claim was
false (the incident was a post-publish artifact overwrite a same-run local
verify cannot see), and (b) the scope was over-built. **Narrowed by decision:**
test (测试版) and stable (正式版) share **one prod environment**; channels differ
only by which manifest file each build reads. The reliability hardening and the
0.7.70 unblock are tracked as separate work (see "Out of scope / follow-ups").

## Goal

Stage release rollout so the 测试版 build picks up an update before 正式版 users,
**within the same production environment** — same TOS bucket (`qihang-ai`), same
publish infra, same Apple/Tauri signing keys, same backend. The *only* thing
that differs between channels is the manifest path (and the artifact sub-path
under it).

## Plugin constraint

`@tauri-apps/plugin-updater` 2.10 takes its endpoint from compiled config;
`check()` cannot switch endpoint at runtime (verified: JS `CheckOptions` has no
endpoint field; the app calls JS `check()` directly with no custom Rust updater
command). So channel = a **build-time** baked endpoint. 测试版 and 正式版 are
therefore separate binaries with separate bundle ids — which already matches the
existing `com.agentdesk.app` (stable) and `com.agentdesk.app.dev` (test) builds.

## Channel contract

| Channel | Build config | Bundle id | Manifest read | Artifact root |
| --- | --- | --- | --- | --- |
| 正式版 stable | base `tauri.conf.json` | `com.agentdesk.app` | `codexmonitor/latest.json` | `codexmonitor/releases/<version>/` |
| 测试版 test | `tauri.dev.conf.json` | `com.agentdesk.app.dev` | `codexmonitor/beta/latest.json` | `codexmonitor/beta/releases/<version>/` |

Same bucket, keys, and infra for both. The channel signal is a single value,
`OTA_PREFIX` (`codexmonitor` for stable, `codexmonitor/beta` for test), which
drives every channel-dependent piece so they cannot drift:

1. **Updater endpoint** (Rust/config): `tauri.dev.conf.json` overrides
   `plugins.updater.endpoints` to `…/codexmonitor/beta/latest.json`. Today it
   does not override it, so the test build inherits the stable endpoint and is
   not actually a separate channel — this is the core gap to close.
2. **Release-notes prefix** (frontend): `postUpdateRelease.ts`'s base URL comes
   from a `__OTA_PREFIX__` Vite define fed by the same `OTA_PREFIX` env
   (default `codexmonitor`). Otherwise the test build fetches stable release
   notes for its own version.
3. **TOS publish prefix** (CI): the publish step already takes `OTA_PREFIX`.

The updater pubkey stays compiled from the base config for both channels (one
keypair; do not rotate).

## Staged plan

**Step 1 — client channel support (locally verifiable, no CI):**
- `tauri.dev.conf.json`: add the beta updater endpoint override.
- `vite.config.ts` + `src/vite-env.d.ts`: add `__OTA_PREFIX__` define
  (`process.env.OTA_PREFIX ?? "codexmonitor"`).
- `postUpdateRelease.ts`: build the base URL from `__OTA_PREFIX__`.
- Verify: a `--config tauri.dev.conf.json` build bakes the beta endpoint; an
  `OTA_PREFIX=codexmonitor/beta` build resolves beta release-note URLs; existing
  build defaults to stable unchanged.

> Until Step 2 publishes a beta manifest, a test build polling
> `…/beta/latest.json` will get "no update / fetch error" on checks. Acceptable
> for a dev-only build in the interim; the first beta release populates it.

**Step 2 — beta publish in CI (needs a real workflow run to validate):**
- `release.yml`: add a `channel: stable|beta` `workflow_dispatch` input. For
  beta, build with `--config src-tauri/tauri.dev.conf.json`, set
  `OTA_PREFIX=codexmonitor/beta`, and parameterize the macOS product-name paths
  — the job hardcodes `启航AI智慧平台.app` / `AgentDesk-*` in multiple steps
  (notarize/staple/ditto/tar/normalize), and the beta product name
  `启航AI智慧平台 Dev` contains a space that must be quoted in `tar`/`hdiutil`.
- Beta reuses the same Apple Team cert/notarization (notarization is per-Team,
  not per-bundle-id; ad-hoc is not required for a distributed test build).
- Windows: a beta build needs a distinct AppId or it collides with stable on
  install; gate beta to macOS first if Windows parameterization is not ready.

## Out of scope / follow-ups (tracked separately)

- **Reliability hardening (the real 0.7.70-class fix):** pre-upload `headObject`
  write-once guard in `publish-tos.mjs` (refuse to overwrite an existing
  `releases/<version>/` object with different bytes) + a post-upload verify that
  fetches the served TOS object over HTTP and checks it against the pubkey +
  manifest signature. Channel separation does **not** fix this; either channel
  can still ship a signature mismatch without it.
- **Hosting-flag drift:** `release.yml` / `publish-ota-manifest.yml` set
  `TOS_REWRITE_ARTIFACT_URLS`/`TOS_UPLOAD_REFERENCED_ARTIFACTS` to `false`
  (GitHub-URL manifest) while the live manifest carries TOS URLs. Reconcile to
  one model before relying on these workflows.
- **Immediate 0.7.70 unblock** (owner-run): re-publish so the served stable
  artifact and the stable manifest signature correspond again.
- **Runtime in-app channel toggle:** blocked by the plugin endpoint constraint
  (would need a custom Rust updater command). Test channel is opt-in by
  installing the test build.
