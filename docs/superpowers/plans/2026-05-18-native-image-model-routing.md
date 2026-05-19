# Native Image Model Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentDesk's selected managed-runtime image model control native Responses `image_generation` execution without changing the chat/composer main text model.

**Architecture:** AgentDesk writes the selected public image alias into the managed Codex provider as an HTTP header. Codex runtime forwards that header with normal `/v1/responses` calls. ADG validates the alias only when the request actually exposes/calls image generation, normalizes it to internal supply-core routing headers, and supply-core uses it for image tool execution while keeping the request body's main `model` as the text model.

**Tech Stack:** CodexMonitor Tauri Rust settings/runtime config, Codex Rust model-provider HTTP headers, ADG Go edge forwarder/model catalog, ai-supply-core internal Responses dispatch.

---

## Current State

- Codex runtime now exposes native `image_generation` for ADG/custom providers when `Feature::ImageGeneration` is enabled and provider capability allows image generation.
- Codex runtime no longer requires the main text model's `input_modalities` to contain `image`.
- ADG now recognizes standard Responses `tools: [{ "type": "image_generation" }]` and forwards `X-ADG-Requested-Capabilities: image_generation` to supply-core.
- AgentDesk already stores `managedRuntime.imageModel`, defaults it to `adg-image`, and uses it in the old dynamic-tool image path.
- The missing piece: the native Responses path does not carry `managedRuntime.imageModel` to ADG, so ADG can route to image-capable supply but cannot honor the user's selected image model.

## Contract

### AgentDesk/Codex Runtime → ADG

CodexMonitor writes this static provider header for the managed runtime:

```toml
[model_providers.agentdesk_managed.http_headers]
"X-ADG-Image-Model" = "adg-image"
```

This header value is the ADG public image alias selected in AgentDesk settings.
It is not a secret.

Because provider headers are attached to all Responses calls, ADG must treat this
as a preference and validate/use it only when the same request requires
`image_generation`.

### ADG → supply-core

ADG strips inbound client-provided internal `X-ADG-*` routing headers before
forwarding, then injects trusted normalized headers:

```http
X-ADG-Requested-Capabilities: image_generation
X-ADG-Image-Model: <upstream image model>
X-ADG-Image-Model-Key: <upstream image model key>
X-ADG-Image-Model-Alias: <public image alias selected by AgentDesk>
```

`X-ADG-Image-Model` is intentionally rewritten from public alias to upstream
model before reaching supply-core. `X-ADG-Image-Model-Alias` is kept for audit
and for user-facing `image_generation_call.model` metadata.

### supply-core Behavior

When handling `/internal/v1/responses` and the request has
`X-ADG-Requested-Capabilities: image_generation`:

- Keep the request body's `model` as the text/reasoning model.
- Use `X-ADG-Image-Model-Key` / `X-ADG-Image-Model` as the preferred image tool
  execution model when present.
- If the preferred image model is absent, keep the current default image routing.
- Emit `image_generation_call.model` as `X-ADG-Image-Model-Alias` when present;
  otherwise use the actual image model.

## Non-Goals

- Do not put the image model into the main request `model`.
- Do not require users to select `gpt-image-*` as the composer/main model.
- Do not invent a nonstandard tool schema field unless the header path proves impossible.
- Do not break plain text Responses requests when the configured image model alias is temporarily invalid.

## File Map

### CodexMonitor

- Modify: `/Users/xiaodeng/project/CodexMonitor/src-tauri/src/shared/runtime_config_core.rs`
  - Writes managed provider `http_headers`.
  - Adds tests for `X-ADG-Image-Model`.
- Optional modify: `/Users/xiaodeng/project/CodexMonitor/src-tauri/src/shared/settings_core.rs`
  - Add/confirm tests that changing `managedRuntime.imageModel` triggers runtime config sync.

### Codex Runtime

- Expected no production code change if `ModelProviderInfo.http_headers` already reaches Responses requests.
- Optional test-only verification in `/Users/xiaodeng/project/Codex/codex-rs/core` or model-provider tests if there is no existing coverage for provider `http_headers`.

### ADG

- Modify: `/Users/xiaodeng/project/ai-development-gateway/internal/edge/forward.go`
  - Extract selected image model header.
  - Validate only when `image_generation` is requested.
  - Store normalized image model routing in request context.
  - Strip spoofable inbound internal headers before injecting trusted headers.
- Modify: `/Users/xiaodeng/project/ai-development-gateway/internal/edge/forward_test.go`
  - Add request routing and spoofing tests.
- Modify: `/Users/xiaodeng/project/ai-development-gateway/internal/modelcatalog/public_aliases.go`
  - Add helper to resolve one ready public alias by key and kind.
- Add/modify: `/Users/xiaodeng/project/ai-development-gateway/internal/modelcatalog/public_aliases_test.go`
  - Cover ready image alias lookup, wrong kind, missing price, unavailable supply.

### supply-core

- Modify in `/Users/xiaodeng/project/sub2api-fresh` Responses dispatch layer.
  - Exact files must be located before implementation with `rg -n "image_generation|responses|X-ADG-Requested-Capabilities"`.
  - Implement preferred image model selection from ADG internal headers.
  - Add focused tests around model selection and emitted `image_generation_call.model`.

---

## Chunk 1: AgentDesk Provider Header

### Task 1: Write selected image model into managed provider headers

**Files:**
- Modify: `/Users/xiaodeng/project/CodexMonitor/src-tauri/src/shared/runtime_config_core.rs`

- [ ] **Step 1: Write the failing test**

Add a test near `sync_managed_runtime_config_writes_provider_without_secret`:

```rust
#[test]
fn sync_managed_runtime_config_writes_image_model_header() {
    let codex_home =
        std::env::temp_dir().join(format!("agentdesk-runtime-config-{}", Uuid::new_v4()));
    fs::create_dir_all(&codex_home).expect("create temp codex home");

    let settings = ManagedRuntimeConfig {
        enabled: true,
        base_url: Some("https://runtime.example.com/v1".to_string()),
        model: Some("qihang-ultra-5.5".to_string()),
        image_model: Some("adg-image-pro".to_string()),
        native_image_generation: true,
    };

    sync_managed_runtime_config(&codex_home, &settings).expect("sync runtime config");

    let contents =
        fs::read_to_string(codex_home.join("config.toml")).expect("read config.toml");
    assert!(contents.contains("[model_providers.agentdesk_managed.http_headers]"));
    assert!(contents.contains("\"X-ADG-Image-Model\" = \"adg-image-pro\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/xiaodeng/project/CodexMonitor
cd src-tauri && cargo test runtime_config_core::tests::sync_managed_runtime_config_writes_image_model_header
```

Expected: FAIL because `http_headers` is not written.

- [ ] **Step 3: Implement minimal config write**

In `apply_managed_runtime_config_to_document`, after provider base fields:

```rust
let mut headers = Table::new();
headers["X-ADG-Image-Model"] = value(config.image_model.as_deref().unwrap_or("adg-image"));
provider["http_headers"] = Item::Table(headers);
```

Keep using `normalize_managed_runtime_config` so empty image model falls back to `adg-image`.

- [ ] **Step 4: Run test to verify it passes**

Run the same cargo test. Expected: PASS.

- [ ] **Step 5: Run broader CodexMonitor backend checks**

Run:

```bash
cd /Users/xiaodeng/project/CodexMonitor/src-tauri
cargo test runtime_config_core
cargo check
```

Expected: PASS.

### Task 2: Confirm image model setting changes resync runtime config

**Files:**
- Modify: `/Users/xiaodeng/project/CodexMonitor/src-tauri/src/shared/settings_core.rs`

- [ ] **Step 1: Write or confirm test**

Add a test for `managed_runtime_config_changed`:

```rust
#[test]
fn managed_runtime_config_changed_detects_image_model_changes() {
    let mut previous = AppSettings::default();
    previous.managed_runtime.enabled = true;
    previous.managed_runtime.base_url = Some("https://runtime.example.com/v1".to_string());
    previous.managed_runtime.model = Some("qihang-ultra-5.5".to_string());
    previous.managed_runtime.image_model = Some("adg-image".to_string());

    let mut updated = previous.clone();
    updated.managed_runtime.image_model = Some("adg-image-pro".to_string());

    assert!(managed_runtime_config_changed(&previous, &updated));
}
```

- [ ] **Step 2: Run test**

Run:

```bash
cd /Users/xiaodeng/project/CodexMonitor/src-tauri
cargo test settings_core::tests::managed_runtime_config_changed_detects_image_model_changes
```

Expected: PASS if existing normalization already handles it. If it fails, update
the comparison to include normalized `image_model`.

---

## Chunk 2: ADG Header Normalization

### Task 3: Add modelcatalog helper for one ready alias

**Files:**
- Modify: `/Users/xiaodeng/project/ai-development-gateway/internal/modelcatalog/public_aliases.go`
- Test: `/Users/xiaodeng/project/ai-development-gateway/internal/modelcatalog/public_aliases_test.go`

- [ ] **Step 1: Write failing tests**

Add tests covering:

- active image alias with active image pricing and enabled supply resolves;
- active text alias rejected when kind is `PublicAliasKindImage`;
- alias with no active pricing rejected;
- alias whose upstream model has no enabled supply rejected.

Expected helper shape:

```go
func ReadyPublicAliasByKey(ctx context.Context, client *ent.Client, aliasKey string, kind PublicAliasKind) (*ReadyPublicAlias, error)
```

The helper should return `(nil, nil)` for not-ready/not-found aliases and a real
error only for database failures.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/xiaodeng/project/ai-development-gateway
go test ./internal/modelcatalog -run ReadyPublicAliasByKey -count=1
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

Implementation outline:

```go
func ReadyPublicAliasByKey(ctx context.Context, client *ent.Client, aliasKey string, kind PublicAliasKind) (*ReadyPublicAlias, error) {
    key := strings.TrimSpace(aliasKey)
    if client == nil || key == "" {
        return nil, nil
    }
    row, err := client.PublicModelAlias.Query().
        Where(publicmodelalias.AliasKeyEQ(key), publicmodelalias.StatusEQ(publicmodelalias.StatusActive)).
        Only(ctx)
    if ent.IsNotFound(err) {
        return nil, nil
    }
    if err != nil {
        return nil, err
    }
    rule, err := activePublicPrice(ctx, client, row.AliasKey)
    if err != nil || rule == nil {
        return nil, err
    }
    supply, err := SupplySummaryForModel(ctx, client, row.UpstreamModelKey)
    if err != nil || !supply.Available {
        return nil, err
    }
    aliasKind := classifyPublicAlias(row, rule)
    if kind != "" && aliasKind != kind {
        return nil, nil
    }
    ready := ReadyPublicAlias{Alias: row, Rule: rule, Kind: aliasKind}
    return &ready, nil
}
```

- [ ] **Step 4: Run modelcatalog tests**

Run:

```bash
go test ./internal/modelcatalog -count=1
```

Expected: PASS.

### Task 4: ADG resolves selected image model only for image-generation requests

**Files:**
- Modify: `/Users/xiaodeng/project/ai-development-gateway/internal/edge/forward.go`
- Test: `/Users/xiaodeng/project/ai-development-gateway/internal/edge/forward_test.go`

- [ ] **Step 1: Write failing test for selected image model**

Add a test next to
`TestForwardHandler_ResponsesImageGenerationToolForwardsRequestedCapability`:

```go
func TestForwardHandler_ResponsesImageGenerationToolForwardsSelectedImageModel(t *testing.T) {
    client := newForwardTestClient(t)
    defer client.Close()
    // Create text alias adg-pro -> gpt-5.5 with token pricing and enabled supply.
    // Create image alias adg-image-pro -> gpt-image-2 with image pricing and enabled supply.

    req := httptest.NewRequest("POST", "/v1/responses", strings.NewReader(`{
        "model":"adg-pro",
        "input":"生成一张图",
        "tools":[{"type":"image_generation","output_format":"png"}]
    }`))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-ADG-Image-Model", "adg-image-pro")
    req = req.WithContext(makeAuthCtx(t, &gid, "203.0.113.5"))

    fwd.ServeHTTP(w, req)

    if got := fake.receivedHeader.Get("X-ADG-Image-Model"); got != "gpt-image-2" {
        t.Fatalf("X-ADG-Image-Model=%q want gpt-image-2", got)
    }
    if got := fake.receivedHeader.Get("X-ADG-Image-Model-Key"); got != "gpt-image-2" {
        t.Fatalf("X-ADG-Image-Model-Key=%q want gpt-image-2", got)
    }
    if got := fake.receivedHeader.Get("X-ADG-Image-Model-Alias"); got != "adg-image-pro" {
        t.Fatalf("X-ADG-Image-Model-Alias=%q want adg-image-pro", got)
    }
}
```

- [ ] **Step 2: Write failing test for text-only requests ignoring image header**

```go
func TestForwardHandler_TextRequestIgnoresSelectedImageModelHeader(t *testing.T) {
    req := httptest.NewRequest("POST", "/v1/responses", strings.NewReader(`{
        "model":"adg-pro",
        "input":"hello"
    }`))
    req.Header.Set("X-ADG-Image-Model", "missing-image-alias")

    fwd.ServeHTTP(w, req)

    if w.Code != http.StatusOK {
        t.Fatalf("text request should not fail on image model preference: status=%d body=%s", w.Code, w.Body.String())
    }
    if got := fake.receivedHeader.Get("X-ADG-Image-Model"); got != "" {
        t.Fatalf("unexpected internal image model header on text request: %q", got)
    }
}
```

- [ ] **Step 3: Write failing spoofing test**

```go
func TestForwardHandler_StripsSpoofedADGImageRoutingHeaders(t *testing.T) {
    req.Header.Set("X-ADG-Requested-Capabilities", "image_generation")
    req.Header.Set("X-ADG-Image-Model", "evil-upstream")
    req.Header.Set("X-ADG-Image-Model-Key", "evil-key")
    req.Header.Set("X-ADG-Image-Model-Alias", "evil-alias")

    fwd.ServeHTTP(w, req)

    if got := fake.receivedHeader.Get("X-ADG-Image-Model"); got != "" {
        t.Fatalf("spoofed image model leaked upstream: %q", got)
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```bash
cd /Users/xiaodeng/project/ai-development-gateway
go test ./internal/edge -run 'SelectedImageModel|TextRequestIgnores|StripsSpoofedADGImage' -count=1
```

Expected: FAIL because ADG does not resolve or strip these headers yet.

- [ ] **Step 5: Implement context keys and extraction**

In `forward.go`, add context keys:

```go
CtxImageModelAlias ctxKey = "adg.image_model_alias"
CtxImageModel      ctxKey = "adg.image_model"
CtxImageModelKey   ctxKey = "adg.image_model_key"
```

Add helper:

```go
func extractSelectedImageModel(r *http.Request) string {
    if r == nil {
        return ""
    }
    return strings.TrimSpace(r.Header.Get("X-ADG-Image-Model"))
}
```

Add helper:

```go
func hasRequestedCapability(caps []string, needle string) bool
```

- [ ] **Step 6: Resolve header after requested capabilities are final**

In `ServeHTTP`, after alias/request tool capabilities have been merged:

```go
selectedImageModel := extractSelectedImageModel(r)
if h.pricingDB != nil && selectedImageModel != "" && hasRequestedCapability(requestedCapabilities, "image_generation") {
    ready, err := modelcatalog.ReadyPublicAliasByKey(ctx, h.pricingDB, selectedImageModel, modelcatalog.PublicAliasKindImage)
    if err != nil {
        h.writeImageModelAliasError(w, err, selectedImageModel, requestID)
        return
    }
    if ready == nil {
        h.writeImageModelAliasError(w, errModelAliasNotFound, selectedImageModel, requestID)
        return
    }
    ctx = context.WithValue(ctx, CtxImageModelAlias, ready.Alias.AliasKey)
    ctx = context.WithValue(ctx, CtxImageModel, ready.Alias.UpstreamModel)
    ctx = context.WithValue(ctx, CtxImageModelKey, ready.Alias.UpstreamModelKey)
}
```

Use a small JSON error:

```json
{
  "error": {
    "code": "image_model_alias_not_found",
    "message": "image model is not available",
    "image_model": "adg-image-pro",
    "request_id": "..."
  }
}
```

- [ ] **Step 7: Strip spoofable inbound headers before trusted injection**

At the start of `makeDirector` after auth/session stripping:

```go
stripADGRoutingHeaders(req.Header)
```

Minimum list:

```go
X-ADG-Requested-Capabilities
X-ADG-Image-Model
X-ADG-Image-Model-Key
X-ADG-Image-Model-Alias
X-ADG-Model-Allowed-Source-Refs
X-ADG-Model-Blocked-Source-Refs
```

Then inject trusted context-derived values as today plus:

```go
if v, ok := ctx.Value(CtxImageModel).(string); ok && v != "" {
    req.Header.Set("X-ADG-Image-Model", v)
}
if v, ok := ctx.Value(CtxImageModelKey).(string); ok && v != "" {
    req.Header.Set("X-ADG-Image-Model-Key", v)
}
if v, ok := ctx.Value(CtxImageModelAlias).(string); ok && v != "" {
    req.Header.Set("X-ADG-Image-Model-Alias", v)
}
```

- [ ] **Step 8: Run edge tests**

Run:

```bash
go test ./internal/edge -count=1
```

Expected: PASS.

---

## Chunk 3: supply-core Preferred Image Model Dispatch

### Task 5: Locate Responses image-generation dispatch

**Files:**
- Inspect: `/Users/xiaodeng/project/sub2api-fresh`

- [ ] **Step 1: Find files**

Run:

```bash
cd /Users/xiaodeng/project/sub2api-fresh
rg -n "image_generation|image_generation_call|X-ADG-Requested-Capabilities|responses|Responses" .
```

- [ ] **Step 2: Identify the function that executes image generation**

Document exact files before editing. Expected responsibilities:

- parse incoming `/internal/v1/responses`;
- detect `image_generation` tool;
- dispatch to an image model/upstream endpoint;
- emit `image_generation_call` items in streaming and non-streaming responses.

### Task 6: Add preferred image model routing

**Files:**
- Modify: exact supply-core Responses dispatch files found in Task 5.
- Test: matching supply-core handler/dispatch tests.

- [ ] **Step 1: Write failing test for preferred image model**

Construct an internal `/v1/responses` request:

```http
X-ADG-Requested-Capabilities: image_generation
X-ADG-Image-Model: gpt-image-2
X-ADG-Image-Model-Key: gpt-image-2
X-ADG-Image-Model-Alias: adg-image-pro
```

Body:

```json
{
  "model": "gpt-5.5",
  "input": "生成一张海边美女图",
  "tools": [{ "type": "image_generation", "output_format": "png" }]
}
```

Assert:

- text model remains `gpt-5.5`;
- image generation dispatch uses `gpt-image-2`;
- returned `image_generation_call.model` is `adg-image-pro`;
- returned `image_generation_call.size` is preserved when available.

- [ ] **Step 2: Run test to verify it fails**

Run the focused supply-core test command after locating the package.

Expected: FAIL because preferred image model headers are ignored.

- [ ] **Step 3: Implement minimal dispatch override**

Implementation rules:

- Only consult image model headers when `X-ADG-Requested-Capabilities` contains `image_generation`.
- Do not mutate the request body's main `model`.
- Use preferred image model for image tool calls only.
- Preserve fallback behavior when headers are missing.
- Include public alias in emitted image call metadata.

- [ ] **Step 4: Run focused supply-core tests**

Expected: PASS.

- [ ] **Step 5: Run broader supply-core checks**

Run the package suite or the repo's standard Go test command. Do not deploy until it passes.

---

## Chunk 4: End-to-End Smoke

### Task 7: Local/UAT smoke through AgentDesk

**Files:**
- No planned code files.

- [ ] **Step 1: Configure AgentDesk**

Set:

- main model: a text model, e.g. `qihang-ultra-5.5`;
- image model: non-default public image alias, e.g. `adg-image-pro`;
- `nativeImageGeneration=true`.

- [ ] **Step 2: Confirm Codex provider config**

Inspect config:

```bash
rg -n "X-ADG-Image-Model|agentdesk_managed|http_headers" "$CODEX_HOME/config.toml"
```

Expected:

```toml
[model_providers.agentdesk_managed.http_headers]
"X-ADG-Image-Model" = "adg-image-pro"
```

- [ ] **Step 3: Send a chat request**

Prompt:

```text
生成一张海边美女图，竖版，不要文字。
```

Expected:

- Codex request body still uses the selected text model as `model`;
- ADG forwards `X-ADG-Requested-Capabilities: image_generation`;
- ADG forwards normalized image model headers to supply-core;
- supply-core image dispatch uses the selected image model;
- CodexMonitor chat renders the native image generation card;
- the card metadata displays the selected image alias or a normalized public display name.

- [ ] **Step 4: Change image model and retry**

Change AgentDesk image model to another public image alias.

Expected:

- new thread/runtime session sends the new `X-ADG-Image-Model`;
- the next generated image uses the new image model;
- text-only messages continue to work even if no image is requested.

## Verification Checklist

- [ ] `cd /Users/xiaodeng/project/CodexMonitor/src-tauri && cargo test runtime_config_core settings_core`
- [ ] `cd /Users/xiaodeng/project/CodexMonitor/src-tauri && cargo check`
- [ ] `cd /Users/xiaodeng/project/ai-development-gateway && go test ./internal/modelcatalog -count=1`
- [ ] `cd /Users/xiaodeng/project/ai-development-gateway && go test ./internal/edge -count=1`
- [ ] `cd /Users/xiaodeng/project/ai-development-gateway && go test ./...`
- [ ] supply-core focused image-generation dispatch tests pass
- [ ] supply-core broader test suite passes
- [ ] Manual/UAT smoke confirms selected AgentDesk image model changes image dispatch while main model stays text.

## Rollout Notes

- AgentDesk image model changes are written to Codex provider config. If the running Codex app-server does not reload provider config for existing sessions, treat the change as applying to newly started runtime processes or newly started threads and surface that behavior in release notes.
- ADG must not reject ordinary text requests just because the static image model header is invalid. Validate the image alias only when image generation is requested.
- ADG should strip spoofable inbound internal routing headers before injecting trusted context values. This prevents external clients from forcing supply-core routing without passing ADG validation.
- If supply-core cannot immediately support preferred image dispatch, ship CodexMonitor + ADG header plumbing behind a no-op supply-core fallback. The UX will continue using default image routing until supply-core lands its part.
