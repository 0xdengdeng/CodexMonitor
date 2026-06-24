# MCP Elicitation Support — Define-First Design

> Status: **define-first draft, pending review.** Not implemented.
> Goal: MCP tool-call approvals (first consumer: the browser capability's `browser_navigate`) surface
> a prompt in on-request mode instead of hanging forever. Codex asks the client via
> `mcpServer/elicitation/request` (server→client, awaits Accept/Decline/Cancel); AgentDesk has **zero**
> elicitation handling today, so every MCP-tool approval in on-request mode blocks until turn timeout.

## 1. Root cause

AgentDesk only recognizes server→client requests whose method ends in `requestApproval`
(`isApprovalRequestMethod = method.endsWith("requestApproval")`, `src/utils/appServerEvents.ts:106`),
and the only request branch keyed on it is `useAppServerEvents.ts:342`. Codex's MCP elicitation arrives
as method **`mcpServer/elicitation/request`** (`Codex/.../app-server-protocol/src/protocol/common.rs:1297`),
which does not match that suffix and is not in `isSupportedAppServerMethod`. The inbound JSON-RPC request
(carries an `id`, forwarded verbatim to the frontend at `src-tauri/src/backend/app_server.rs:1028-1072`)
falls through `:342`, fails the `isSupportedAppServerMethod` gate at `:352`, and is silently dropped →
the sidecar's elicitation oneshot is never resolved → the tool call blocks. The transport works; the
**frontend has no parser branch and no UI** for this method. This is a general AgentDesk gap (any
approval-gated MCP tool hits it), not a browser bug.

## 2. Contract to freeze (define-first)

### 2.1 REQUEST — `mcpServer/elicitation/request` (server → client, has `id`, awaits a result)

Params (`Codex/.../v2/mcp.rs:282-297`), camelCase, internally tagged on `mode` (variant fields at the
**top level** of `params`, no nested object — wire test `common.rs:2124-2144`):

```jsonc
// Form variant (the browser_navigate approval case)
{ "method": "mcpServer/elicitation/request", "id": 7,   // app-server JSON-RPC id; echo back UNCHANGED
  "params": {
    "threadId": "thr_…", "turnId": "turn_…",            // turnId nullable
    "serverName": "playwright",                          // the MCP server (NOT the tool name)
    "mode": "form", "_meta": null,
    "message": "…",                                      // human-readable; codex builds it WITH the
                                                         //   tool name + params (see note below)
    "requestedSchema": { "type":"object", "properties": { "confirmed": {"type":"boolean"} }, "required":["confirmed"] }
} }
// Url variant: mode:"url", message, url, elicitationId   (instead of requestedSchema)
```

**`message` is meaningful (resolved):** there is no `toolName` field in params (TODO at `mcp.rs:294-296`),
but codex constructs `message` via `build_mcp_tool_approval_question(question_id, server, invocation.tool, …)`
+ `render_mcp_tool_approval_template(server, connector, …, invocation.arguments)`
(`core/src/mcp_tool_call.rs:1260-1300`) — i.e. it already embeds the tool name (`browser_navigate`) and the
params (the URL). So rendering `message` is sufficient for a good prompt. (Confirm exact wording in the
T1 smoke — see §6.)

### 2.2 RESPONSE — the JSON-RPC `result` (client → server)

`McpServerElicitationRequestResponse` (`mcp.rs:671-684`):

```jsonc
{ "action": "accept" | "decline" | "cancel",   // McpServerElicitationAction (camelCase rename ⇒ these exact wire values)
  "content": { "confirmed": true } | null,       // structured input on accept; null on decline/cancel
  "_meta": null }
```

Robustness (`bespoke_event_handling.rs:1728-1765`): a missing/garbled result degrades to **Decline**, a
turn-transition error to **Cancel** — so a missed reply won't hang, but we still answer promptly to avoid
turn-timeout stalls.

### 2.3 Request-id round-trip

Identical to approvals. `params.id` is the **app-server JSON-RPC id** — the only id the client sees; echo
it **unchanged**. Keep it `number | string` end to end (`getAppServerRequestId`, `appServerEvents.ts:93`;
Rust takes `serde_json::Value`; daemon validates `is_number()||is_string()`, `rpc/codex.rs:518-522`).
**Do not coerce to string** — sidecar ids are numeric.

### 2.4 Types (Rust ↔ TS)

- **TS** (`src/types.ts`, after `ApprovalRequest`): `ElicitationRequest { workspace_id; request_id: number|string;
  method: string; params: ElicitationParams }` where `ElicitationParams` is a discriminated union on
  `mode: "form" | "url"` (`serverName`, `message`, + `requestedSchema` | (`url` + `elicitationId`)). Plus
  `ElicitationAction = "accept" | "decline" | "cancel"`.
- **Rust** (`src-tauri/src/types.rs`): **no new struct needed** — `respond_to_server_request_core`
  (`codex_core.rs:1243-1250`) takes `result: Value` and is method-agnostic; the request `params` is held as
  opaque JSON on the frontend. Leave a comment in `types.rs` noting elicitation reuses the generic
  `respond_to_server_request` (per the CLAUDE.md type-sync rule).

## 3. Design — mirror the existing approval round-trip

**The backend needs no changes.** The inbound request already reaches the frontend with `id` intact, and
the outbound `respond_to_server_request` is generic (proof: approvals send `result:{decision}`,
`requestUserInput` sends `result:{answers}` through the same command — `tauri.ts:566` vs `:578`). Elicitation
sends `result:{action,content,_meta}`. So this is **frontend-only**.

- **(a) Recognize the method** — add `isElicitationRequestMethod(method) = method === "mcpServer/elicitation/request"`
  in `appServerEvents.ts` (exact-match, not `endsWith`, so it never misroutes into the approval toast).
- **(b) Route it ABOVE the `isSupportedAppServerMethod` gate** (`useAppServerEvents.ts`, mirror the approval
  branch at `:342`, sit above `:352`) → `onElicitationRequest?.({workspace_id, request_id, method, params})`.
- **(c) Queue it** — a new `elicitations[]` reducer slice (dedup by `workspace_id+request_id`, multi-pending,
  exactly like approvals), via a new `useThreadElicitationEvents` hook (model `useThreadApprovalEvents.ts:16`,
  but **no allowlist / no auto-respond** — always surface to the user).
- **(d) Render Accept/Decline/Cancel** — a **new** `ElicitationToasts` component (do NOT overload
  `ApprovalToasts`, which is 2-action; elicitation is 3-action + may carry a schema). v1 uses DS primitives
  `ToastViewport / ToastCard / ToastActions` with three buttons, rendering `params.message`. Scope the
  Enter-key shortcut so it does not collide with `ApprovalToasts`'s global Enter listener (`ApprovalToasts.tsx:36-61`).
- **(e) Respond** — a new thin `respondToElicitationRequest(workspaceId, requestId, action, content?)` in
  `tauri.ts` → `invoke("respond_to_server_request", { workspaceId, requestId, result:{action, content: content ?? null, _meta:null} })`,
  then `removeElicitation` (mirror `handleApprovalDecision`).

**`thread/increment_elicitation` / `thread/decrement_elicitation`: DEFER.** They are experimental,
feature-gated counters that only pause turn-timeout accounting (`paused = count>0`); not required for the
request/response loop. v2 robustness item.

## 4. Layering (AGENTS.md order) + edit points

Backend layers 1–4 = **no code change** (generic path already satisfies app + daemon). Frontend-only:

| Layer | File | Change |
|---|---|---|
| 1 shared / 2 adapter / 4 daemon | `shared/codex_core.rs:1243`, `codex/mod.rs:1032`, `app_server.rs:606/1028`, daemon `rpc/codex.rs:509` | **none** — generic `respond_to_server_request` |
| 3 tauri.ts | `src/services/tauri.ts` (~:566) | **add** `respondToElicitationRequest` |
| 5 types | `src/types.ts` (after `ApprovalRequest`); `types.rs` | **add** TS `ElicitationRequest` + `ElicitationAction`; comment-only in `types.rs` |
| 6a parse | `src/utils/appServerEvents.ts:105` | **add** `isElicitationRequestMethod` |
| 6b route | `src/features/app/hooks/useAppServerEvents.ts` (above :352, model :342, handler type :66) | **add** branch + `onElicitationRequest?` |
| 6c handler | `src/features/threads/hooks/useThreadElicitationEvents.ts` (NEW, model `useThreadApprovalEvents.ts:16`) | dispatch `addElicitation` |
| 6d reducer | `useThreadsReducer.ts:46,163-164` + `threadReducer/threadQueueSlice.ts:5-19` | **add** `elicitations[]` + `addElicitation`/`removeElicitation` |
| 6e wire | `useThreadEventHandlers.ts:87,219` | wire `onElicitationRequest` (model `onApprovalRequest`) |
| 6f submit | `useThreadApprovals.ts:38` (or sibling) | **add** `handleElicitationDecision(req, action, content?)` |
| 6g UI | `src/features/app/components/ElicitationToasts.tsx` (NEW) | DS toast, 3 buttons; mount via `buildPrimaryNodes.tsx:55` + props through `MainApp.tsx:1830`. **Also register the new file in the `.eslintrc.cjs:108-113` `files:` toast override** — the DS guardrails are file-scoped, so they won't cover a net-new file otherwise (review SHOULD-fix) |
| 6h i18n | `src/features/i18n/i18n.tsx` (EN + ZH) | `elicitation.{title,accept,decline,cancel,allow}` (both blocks) |

## 5. Scope / phasing + test plan

- **T1 (must-have, v1): Form-mode Accept/Decline/Cancel toast** — 6a–6h + types + `respondToElicitationRequest`.
  On accept, send `content` for the common boolean case (`{confirmed:true}`); for arbitrary Form schemas in
  v1, send `content:{}` and rely on `accept`/`decline`/`cancel` as the decision. **Unblocks `browser_navigate`
  on-request.**
- **T2: Url-mode** (`mode:"url"`, render `url`, echo `elicitationId`). URL elicitations are never policy-auto-accepted
  (`elicitation.rs:201-223`), so any URL-using MCP server hangs without this. Medium priority.
- **T3: Full Form rendering** — render `requestedSchema` fields (string/number/boolean/enum, `mcp.rs:303-435`)
  as inputs (model `RequestUserInputMessage.tsx`), submit typed `content`. Defer until a server elicits non-trivial input.
- **T4: increment/decrement_elicitation** timeout-pause wrapping. Deferred.

**Tests (offline, fail-fast):**
1. **Parser** (`appServerEvents.test.ts`): `isElicitationRequestMethod` matches the method, rejects `*requestApproval` + `requestUserInput`.
2. **Routing** (`useAppServerEvents`): feed the §2.1 Form fixture (copy from `common.rs:2124-2144`) → `onElicitationRequest` fires with `{request_id:7, params.mode:"form", params.message}`; an unrelated `*requestApproval` still routes to `onApprovalRequest`.
3. **Reducer**: `addElicitation`/`removeElicitation` dedup by `workspace_id+request_id`; coexists with approvals.
4. **Round-trip** (mock `invoke`): `handleElicitationDecision(req,"accept",{confirmed:true})` → `respond_to_server_request` with `result:{action:"accept",content:{confirmed:true},_meta:null}`, `requestId` preserved as **number**; decline/cancel send `content:null`.
5. **`cargo check`** — negative test of "no Rust changes needed".
6. **Manual smoke**: browser MCP under on-request → `browser_navigate` → toast appears (capture the real `message`/`requestedSchema`), Accept proceeds, Decline aborts.

## 6. Risks / spikes

1. **Exact `message` wording + `requestedSchema` shape** — source shows codex embeds tool name + params into
   `message` (resolved favorably, §2.1), but the precise string + whether the schema is exactly
   `{confirmed:boolean}` must be captured from a live `mcpServer/elicitation/request` in the T1 smoke before
   freezing the accept-`content` payload.
2. **Auto-accept/decline short-circuit** (`elicitation.rs:201-223`, `mcp_permission_prompt_is_auto_approved`):
   empty-schema Form may auto-accept; `AskForApproval::Never` auto-declines before the client sees anything.
   Confirm the browser server actually reaches the client under on-request (it does — that's the observed hang).
3. **Enter-key collision** between `ApprovalToasts` and the new `ElicitationToasts` global listeners when both
   render — deliberate focus/default-action decision, not a copy-paste.

**Evidence:** AgentDesk refs re-verified this session. Codex refs from the synced `../Codex` tree (flag for
reviewer if line numbers drift on the next upstream sync).
