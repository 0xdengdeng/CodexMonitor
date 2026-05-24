# CodexMonitor Memory

## Local App Workflow

- When frontend changes affect the running local app, proactively restart the
  existing `codexmonitor-dev` Tauri dev session when practical instead of only
  telling the user to restart it.
- After changes that cannot be fully covered by hot reload, especially Rust,
  Tauri command, IPC, config, or backend changes, restart the local Tauri app
  before handing the result back to the user.
