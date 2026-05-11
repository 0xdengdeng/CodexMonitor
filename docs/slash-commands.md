# Composer Slash Commands

Canonical implementation map for AgentDesk composer slash commands.

## Current Model

Slash commands are implemented by AgentDesk, not dynamically supplied by Codex runtime.

The flow has three stages:

1. The composer autocomplete lists available slash entries.
2. Selecting an entry only inserts text into the composer.
3. Sending the message parses the leading slash command and routes it to a local handler.

Custom prompts also use the slash trigger, but they are expanded as prompt text before normal message sending rather than routed as built-in commands.

## Autocomplete

- Slash command list: `src/features/composer/hooks/useComposerAutocompleteState.ts`
- Generic trigger matching and ranking: `src/features/composer/hooks/useComposerAutocomplete.ts`
- Popover rendering and icons: `src/features/composer/components/ComposerSuggestionsPopover.tsx`
- Popover position relative to caret: `src/features/composer/hooks/useComposerSuggestionStyle.ts`
- Popover styles: `src/styles/composer.css`

Built-in slash entries are defined in `slashCommandItems`.

Current built-ins:

- `/apps` when experimental Apps are enabled
- `/compact`
- `/fast`
- `/fork`
- `/mcp`
- `/new`
- `/resume`
- `/review`
- `/status`

Autocomplete triggers:

- `/` shows built-in slash commands and `/prompts:*` custom prompts.
- `$` shows skills and app mentions.
- `@` shows workspace file suggestions.

Selecting a slash suggestion calls `applyAutocomplete`, which replaces the active range with the item insert text. It does not execute the command.

## Send-Time Routing

- Slash parser and queue integration: `src/features/threads/hooks/useQueuedSend.ts`
- Command handlers: `src/features/threads/hooks/useThreadMessaging.ts`
- Composer wiring: `src/features/app/hooks/useComposerController.ts`
- App-level wiring: `src/features/app/hooks/useMainAppComposerWorkspaceState.ts`

`useQueuedSend` trims the message, detects a leading built-in slash command, clears images/app mentions for that command, and calls the matching handler. Slash commands are recognized only when the sent message starts with the command, for example `/compact` or `/fork follow-up task`.

If the same text appears later in a message, it remains plain text.

## Built-In Command Behavior

| Command | Handler | Behavior |
| --- | --- | --- |
| `/apps` | `startApps` | Lists available app connectors as a local assistant message. Only active when Apps are enabled. |
| `/compact` | `startCompact` | Calls `compact_thread`, which routes to app-server `thread/compact/start`. |
| `/fast` | `startFast` | Toggles or reports Fast mode locally. Supports `/fast`, `/fast on`, `/fast off`, `/fast status`. |
| `/fork` | `startFork` | Calls thread fork logic. Any text after `/fork` is sent to the new thread. |
| `/mcp` | `startMcp` | Lists configured MCP servers/tools as a local assistant message. |
| `/new` | `useQueuedSend.runSlashCommand` | Starts a new thread. Any text after `/new` is sent to that thread. |
| `/resume` | `startResume` | Refreshes the active thread. |
| `/review` | `startReview` | Opens the review prompt with no args, or starts a review target when args are provided. |
| `/status` | `startStatus` | Shows local session/model/access/rate-limit status as an assistant message. |

## Runtime/Backend Path

Only some slash commands call backend commands.

`/compact` path:

1. `src/features/threads/hooks/useQueuedSend.ts`
2. `src/features/threads/hooks/useThreadMessaging.ts`
3. `src/services/tauri.ts` -> `compactThread`
4. `src-tauri/src/codex/mod.rs` -> `compact_thread`
5. `src-tauri/src/shared/codex_core.rs` -> `compact_thread_core`
6. Codex app-server request: `thread/compact/start`

`/fork` and `/resume` follow the same frontend routing pattern, then call their corresponding Tauri/app-server thread operations.

`/apps`, `/fast`, `/mcp`, and `/status` are local UI helpers. They generate local assistant messages or update composer state without sending user text to the model.

## Custom Prompts

- Prompt insertion text: `src/utils/customPrompts.ts`
- Prompt expansion before send: `src/features/threads/hooks/useThreadMessaging.ts`

Custom prompts appear in the `/` autocomplete as `/prompts:<name>`.

Unlike built-in slash commands, prompt commands are not consumed by `useQueuedSend.parseSlashCommand`. They continue through normal message sending and are expanded by `expandCustomPromptText` before `turn/start`.

## Adding A Built-In Slash Command

1. Add an autocomplete item in `slashCommandItems`.
2. Add the command kind and regex to `parseSlashCommand`.
3. Add a branch in `runSlashCommand`.
4. Implement the handler in `useThreadMessaging` or route to an existing shared action.
5. Wire the handler through `useComposerController`, `useMainAppComposerWorkspaceState`, and the app component if the handler is new.
6. If the command calls backend behavior, update `src/services/tauri.ts`, Tauri command adapters, shared core, daemon RPC parity, and tests.
7. Add or update focused tests in `useComposerAutocompleteState.test.tsx`, `useQueuedSend.test.tsx`, and any handler-specific test.

## Design Notes

- Slash autocomplete labels/descriptions are currently source-owned in the frontend command list.
- Popover style and layout should stay token-based in `src/styles/composer.css`.
- Built-in command execution intentionally discards images and app mentions.
- Prompt commands should stay separate from built-in command routing so prompts can expand into normal model-facing text.
