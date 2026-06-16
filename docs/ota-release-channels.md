# OTA Release Channels — Design Contract

Status: **implemented** (CI wiring is in place; real release runs remain the
final validation gate).
Extends `docs/ota-release.md` (single-channel runbook).

## Scope history

v1 of this doc proposed separate test infrastructure + byte-identical promotion
+ a verify/write-once hardening layer, and claimed the verify gate alone would
have fixed the 0.7.70 incident. Independent review showed (a) that claim was
false (the incident was a post-publish artifact overwrite a same-run local
verify cannot see), and (b) the scope was over-built. **Narrowed by decision:**
test (测试版) and stable (正式版) share **one prod environment** and the same
customer-facing updater manifest. The reliability hardening and the 0.7.70
unblock are tracked as separate work (see "Out of scope / follow-ups").

## Goal

Keep separate installable test and stable builds while both read the same
customer-facing updater endpoint. 测试版 is for manually installing and verifying
GitHub Release artifacts before the stable OTA manifest is switched. Both builds
use the same TOS bucket (`qihang-ai`), publish infra, Apple/Tauri signing keys,
backend, and updater manifest path.

## Plugin constraint

`@tauri-apps/plugin-updater` 2.10 takes its endpoint from compiled config;
`check()` cannot switch endpoint at runtime (verified: JS `CheckOptions` has no
endpoint field; the app calls JS `check()` directly with no custom Rust updater
command). Because 测试版 and 正式版 intentionally use the same endpoint, channel
separation is only install/runtime identity: separate product names and bundle
ids so the test app can be installed beside stable.

## Channel contract

| Channel | Build config | Bundle id | Manifest read | Artifact root |
| --- | --- | --- | --- | --- |
| 正式版 stable | base `tauri.conf.json` | `com.agentdesk.app` | `codexmonitor/latest.json` | stable GitHub Release `v<version>` |
| 测试版 test | `tauri.dev.conf.json` | `com.agentdesk.app.dev` | `codexmonitor/latest.json` | prerelease GitHub Release `v<version>-beta` |

Same bucket, keys, updater endpoint, and infra for both. The release channel
signal is limited to packaging:

1. **Build identity** (Rust/config): `tauri.dev.conf.json` overrides the product
   name, bundle id, and window title only. It must not override
   `plugins.updater.endpoints`.
2. **GitHub Release tag** (CI): beta builds publish `v<version>-beta` as a
   prerelease; stable builds publish `v<version>`.
3. **Stable OTA gate** (CI): `.github/workflows/publish-ota-manifest.yml`
   publishes only the stable release manifest to `codexmonitor/latest.json` after
   manual verification.

The updater pubkey stays compiled from the base config for both channels (one
keypair; do not rotate).

## Implementation Notes

**Client channel support:**
- `tauri.dev.conf.json`: keep test app identity overrides only; inherit the
  stable updater endpoint from `tauri.conf.json`.
- Local verification: a `--config tauri.dev.conf.json` build installs beside stable but
  still reads `codexmonitor/latest.json`.

**CI release channel support:**
- `release.yml` exposes a `channel: stable|beta` `workflow_dispatch` input. Beta
  builds with `--config src-tauri/tauri.dev.conf.json` and parameterized macOS
  product-name paths, then publishes `v<version>-beta` as a prerelease.
- Beta reuses the same Apple Team cert/notarization (notarization is per-Team,
  not per-bundle-id; ad-hoc is not required for a distributed test build).
- Windows: a beta build needs a distinct AppId or it collides with stable on
  install; gate beta to macOS first if Windows parameterization is not ready.

## Out of scope / follow-ups (tracked separately)

- **Reliability hardening (the real 0.7.70-class fix):** pre-upload `headObject`
  write-once guard in `publish-tos.mjs` (refuse to overwrite an existing
  `releases/<version>/` object with different bytes) + a post-upload verify that
  fetches the served TOS object over HTTP and checks it against the pubkey +
  manifest signature. Test builds do **not** fix this because they share the same
  stable OTA endpoint.
- **Hosting-flag drift:** `release.yml` / `publish-ota-manifest.yml` set
  `TOS_REWRITE_ARTIFACT_URLS`/`TOS_UPLOAD_REFERENCED_ARTIFACTS` to `false`
  (GitHub-URL manifest) while the live manifest carries TOS URLs. Reconcile to
  one model before relying on these workflows.
- **Immediate 0.7.70 unblock** (owner-run): re-publish so the served stable
  artifact and the stable manifest signature correspond again.
- **Runtime in-app channel toggle:** blocked by the plugin endpoint constraint
  (would need a custom Rust updater command). Test channel is opt-in by
  installing the test build.
