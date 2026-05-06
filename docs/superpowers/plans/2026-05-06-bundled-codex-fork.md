# Bundled Custom Codex Fork Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CodexMonitor ready to consume, build, package, and validate a bundled custom Codex fork from `vendor/codex`.

**Architecture:** Add a shared Rust Codex binary resolver used by app and daemon command paths, then add Node scripts that build the vendored Codex fork and detect protocol drift. The first implementation slice avoids adding the actual git submodule because the product fork URL is not yet known.

**Tech Stack:** Rust/Tauri backend, Node.js scripts, npm scripts, existing Vitest and Cargo validation.

---

## File Structure

- Create `src-tauri/src/shared/codex_binary.rs`: shared resolver for explicit overrides, bundled Codex candidates, and PATH fallback.
- Modify `src-tauri/src/shared/mod.rs`: expose the resolver module.
- Modify `src-tauri/src/shared/brand_core.rs`: keep brand constants and delegate Codex path resolution to the shared resolver.
- Create or extend Rust unit tests near the resolver.
- Create `scripts/build-bundled-codex.mjs`: builds `vendor/codex` and copies the binary into `src-tauri/resources/codex-bundled/`.
- Create `scripts/check-codex-protocol.mjs`: checks that `vendor/codex` exists and extracts upstream protocol method strings for later drift checks.
- Create `scripts/sync-codex-upstream.sh`: documented helper for the required upstream sync flow.
- Modify `package.json`: add `codex:build-bundled`, `codex:check-protocol`, and `codex:sync-upstream` scripts.
- Update docs if implemented behavior differs from `docs/superpowers/specs/2026-05-06-bundled-codex-fork-design.md`.

## Chunk 1: Shared Codex Binary Resolver

### Task 1: Resolver Tests

**Files:**
- Create: `src-tauri/src/shared/codex_binary.rs`
- Modify: `src-tauri/src/shared/mod.rs`
- Modify: `src-tauri/src/shared/brand_core.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests for:

- explicit override wins and is trimmed;
- empty override is ignored;
- bundled binary can be discovered through `CODEX_MONITOR_BUNDLED_CODEX_BIN`;
- fallback returns `None` when no explicit or bundled binary exists.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd src-tauri && cargo test codex_binary
```

Expected: FAIL because `codex_binary` does not exist yet.

- [ ] **Step 3: Implement minimal resolver**

Implement:

```rust
pub(crate) fn resolve_codex_bin(codex_bin: Option<String>) -> Option<String>
```

Rules:

```text
trimmed explicit override
-> CODEX_MONITOR_BUNDLED_CODEX_BIN if it points to a file
-> bundled candidate paths near current executable/current dir
-> local debug candidate for this developer workspace
-> None, allowing command builders to fall back to PATH "codex"
```

- [ ] **Step 4: Delegate existing resolver**

Update `brand_core::resolve_default_codex_bin` to call `shared::codex_binary::resolve_codex_bin`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd src-tauri && cargo test codex_binary
```

Expected: PASS.

## Chunk 2: Bundled Runtime Scripts

### Task 2: Build Script

**Files:**
- Create: `scripts/build-bundled-codex.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write script behavior first**

The script must:

- fail clearly when `vendor/codex` is missing;
- build `vendor/codex/codex-rs` with Cargo by default;
- accept `--skip-build` for CI and local packaging checks;
- copy the Codex binary into `src-tauri/resources/codex-bundled/codex` or `codex.exe`.

- [ ] **Step 2: Run script to verify missing-submodule failure**

Run:

```bash
node scripts/build-bundled-codex.mjs --skip-build
```

Expected: FAIL with a message explaining that `vendor/codex` is missing and the product fork submodule must be added.

- [ ] **Step 3: Add package script**

Add:

```json
"codex:build-bundled": "node scripts/build-bundled-codex.mjs"
```

### Task 3: Protocol Check Script

**Files:**
- Create: `scripts/check-codex-protocol.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write script behavior first**

The script must:

- fail clearly when `vendor/codex` is missing;
- look for `vendor/codex/codex-rs/app-server-protocol/src/protocol`;
- extract method-like string literals from protocol files;
- print a JSON summary that can become a stricter drift check later.

- [ ] **Step 2: Run script to verify missing-submodule failure**

Run:

```bash
node scripts/check-codex-protocol.mjs
```

Expected: FAIL with a message explaining that `vendor/codex` is missing.

- [ ] **Step 3: Add package script**

Add:

```json
"codex:check-protocol": "node scripts/check-codex-protocol.mjs"
```

### Task 4: Sync Helper

**Files:**
- Create: `scripts/sync-codex-upstream.sh`
- Modify: `package.json`

- [ ] **Step 1: Add helper script**

The script must document and run safe commands for:

- verifying `vendor/codex` exists;
- fetching official upstream and fork remotes;
- printing current fork branch and status;
- printing the submodule commit that CodexMonitor pins.

- [ ] **Step 2: Add package script**

Add:

```json
"codex:sync-upstream": "sh scripts/sync-codex-upstream.sh"
```

## Chunk 3: Validation And Follow-Up

### Task 5: Validate Current Slice

**Files:**
- All touched files.

- [ ] **Step 1: Run Rust focused tests**

```bash
cd src-tauri && cargo test codex_binary
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Run backend check if Rust changed**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: Review git diff**

```bash
git diff -- src-tauri/src/shared/codex_binary.rs src-tauri/src/shared/mod.rs src-tauri/src/shared/brand_core.rs scripts package.json docs/superpowers/plans/2026-05-06-bundled-codex-fork.md
```

- [ ] **Step 5: Commit owned files only**

```bash
git add docs/superpowers/plans/2026-05-06-bundled-codex-fork.md src-tauri/src/shared/codex_binary.rs src-tauri/src/shared/mod.rs src-tauri/src/shared/brand_core.rs scripts/build-bundled-codex.mjs scripts/check-codex-protocol.mjs scripts/sync-codex-upstream.sh package.json
git commit -m "feat: add bundled codex runtime scaffolding"
```

## Known External Input Needed

The actual submodule cannot be added until the product Codex fork URL is known.

When the URL is available, run:

```bash
git submodule add <product-codex-fork-url> vendor/codex
git submodule update --init --recursive vendor/codex
```

Then rerun:

```bash
npm run codex:build-bundled
npm run codex:check-protocol
```
