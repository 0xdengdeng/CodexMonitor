use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::backend::app_server::WorkspaceSession;
use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::shared::process_core::kill_child_process_tree;
use crate::types::{AppSettings, WorkspaceEntry};

use super::connect::workspace_session_spawn_lock;
use super::helpers::resolve_entry_and_parent;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceRuntimeCodexArgsResult {
    pub(crate) applied_codex_args: Option<String>,
    pub(crate) respawned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceRuntimeRestartResult {
    pub(crate) workspace_ids: Vec<String>,
    pub(crate) respawned: bool,
}

fn push_unique_session(
    sessions: &mut Vec<Arc<WorkspaceSession>>,
    candidate: Arc<WorkspaceSession>,
) {
    if sessions
        .iter()
        .any(|existing| Arc::ptr_eq(existing, &candidate))
    {
        return;
    }
    sessions.push(candidate);
}

pub(crate) async fn restart_connected_workspace_sessions_core<F, Fut>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    _app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<WorkspaceRuntimeRestartResult, String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let _spawn_guard = workspace_session_spawn_lock().lock().await;
    let (workspace_ids, current_session, old_sessions) = {
        let sessions = sessions.lock().await;
        let mut workspace_ids = sessions.keys().cloned().collect::<Vec<_>>();
        workspace_ids.sort();
        let Some(owner_workspace_id) = workspace_ids.first() else {
            return Ok(WorkspaceRuntimeRestartResult {
                workspace_ids,
                respawned: false,
            });
        };
        let Some(current_session) = sessions.get(owner_workspace_id).cloned() else {
            return Ok(WorkspaceRuntimeRestartResult {
                workspace_ids,
                respawned: false,
            });
        };
        let mut old_sessions = Vec::new();
        for session in sessions.values().cloned() {
            push_unique_session(&mut old_sessions, session);
        }
        (workspace_ids, current_session, old_sessions)
    };

    let owner_workspace_id = workspace_ids
        .first()
        .cloned()
        .ok_or_else(|| "workspace not connected".to_string())?;
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &owner_workspace_id).await?;
    let target_args = current_session.codex_args.clone();
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    let new_session = spawn_session(entry, target_args, codex_home).await?;
    let workspace_paths = {
        let workspaces = workspaces.lock().await;
        workspace_ids
            .iter()
            .map(|workspace_id| {
                let path = workspaces
                    .get(workspace_id)
                    .map(|entry| entry.path.clone())
                    .unwrap_or_default();
                (workspace_id.clone(), path)
            })
            .collect::<Vec<_>>()
    };
    {
        let mut sessions = sessions.lock().await;
        for workspace_id in &workspace_ids {
            sessions.insert(workspace_id.clone(), Arc::clone(&new_session));
        }
    }
    for (workspace_id, workspace_path) in &workspace_paths {
        let path = if workspace_path.is_empty() {
            None
        } else {
            Some(workspace_path.as_str())
        };
        new_session
            .register_workspace_with_path(workspace_id, path)
            .await;
    }
    for session in old_sessions {
        if Arc::ptr_eq(&session, &new_session) {
            continue;
        }
        let mut child = session.child.lock().await;
        kill_child_process_tree(&mut child).await;
    }

    Ok(WorkspaceRuntimeRestartResult {
        workspace_ids,
        respawned: true,
    })
}

pub(crate) async fn set_workspace_runtime_codex_args_core<F, Fut>(
    workspace_id: String,
    codex_args_override: Option<String>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    app_settings: &Mutex<AppSettings>,
    spawn_session: F,
) -> Result<WorkspaceRuntimeCodexArgsResult, String>
where
    F: Fn(WorkspaceEntry, Option<String>, Option<PathBuf>) -> Fut,
    Fut: Future<Output = Result<Arc<WorkspaceSession>, String>>,
{
    let (entry, parent_entry) = resolve_entry_and_parent(workspaces, &workspace_id).await?;
    let _spawn_guard = workspace_session_spawn_lock().lock().await;

    let resolved_args = {
        let settings = app_settings.lock().await;
        resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings))
    };

    let target_args = codex_args_override
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(resolved_args);

    // If we are not connected, we can't respawn. Treat this as a no-op success; callers
    // should call again after connecting.
    let (workspace_connected, current_session) = {
        let sessions = sessions.lock().await;
        (
            sessions.contains_key(&entry.id),
            sessions.values().next().cloned(),
        )
    };
    if !workspace_connected {
        return Ok(WorkspaceRuntimeCodexArgsResult {
            applied_codex_args: target_args,
            respawned: false,
        });
    }

    let Some(current_session) = current_session else {
        return Ok(WorkspaceRuntimeCodexArgsResult {
            applied_codex_args: target_args,
            respawned: false,
        });
    };

    if current_session.codex_args == target_args {
        return Ok(WorkspaceRuntimeCodexArgsResult {
            applied_codex_args: target_args,
            respawned: false,
        });
    }

    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    let new_session = spawn_session(entry.clone(), target_args.clone(), codex_home).await?;
    let workspace_ids = {
        let mut sessions = sessions.lock().await;
        let keys: Vec<String> = sessions.keys().cloned().collect();
        for key in &keys {
            sessions.insert(key.clone(), Arc::clone(&new_session));
        }
        keys
    };
    let workspace_paths = {
        let workspaces = workspaces.lock().await;
        workspace_ids
            .iter()
            .map(|workspace_id| {
                let path = workspaces
                    .get(workspace_id)
                    .map(|entry| entry.path.clone())
                    .unwrap_or_default();
                (workspace_id.clone(), path)
            })
            .collect::<Vec<_>>()
    };
    for (workspace_id, workspace_path) in &workspace_paths {
        let path = if workspace_path.is_empty() {
            None
        } else {
            Some(workspace_path.as_str())
        };
        new_session
            .register_workspace_with_path(workspace_id, path)
            .await;
    }
    let mut child = current_session.child.lock().await;
    kill_child_process_tree(&mut child).await;

    Ok(WorkspaceRuntimeCodexArgsResult {
        applied_codex_args: target_args,
        respawned: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::HashSet;
    use std::process::Stdio;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

    use tokio::process::Command;

    use crate::types::{WorkspaceKind, WorkspaceSettings};

    fn make_workspace_entry(id: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: id.to_string(),
            name: id.to_string(),
            path: "/tmp".to_string(),
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings: WorkspaceSettings::default(),
        }
    }

    fn make_session(_entry: WorkspaceEntry, codex_args: Option<String>) -> WorkspaceSession {
        let mut cmd = if cfg!(windows) {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", "more"]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", "cat"]);
            cmd
        };

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let mut child = cmd.spawn().expect("spawn dummy child");
        let stdin = child.stdin.take().expect("dummy child stdin");

        WorkspaceSession {
            codex_args,
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            request_context: Mutex::new(HashMap::new()),
            thread_workspace: Mutex::new(HashMap::new()),
            hidden_thread_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(0),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            owner_workspace_id: "test-owner".to_string(),
            workspace_ids: Mutex::new(HashSet::from(["test-owner".to_string()])),
            workspace_roots: Mutex::new(HashMap::new()),
        }
    }

    #[test]
    fn set_workspace_runtime_codex_args_is_noop_when_workspace_not_connected() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-1");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());

            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            let result = set_workspace_runtime_codex_args_core(
                entry.id.clone(),
                Some("  --profile dev  ".to_string()),
                &workspaces,
                &sessions,
                &app_settings,
                move |entry, args, _home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(make_session(entry, args)))
                    }
                },
            )
            .await
            .expect("core call succeeds");

            assert_eq!(
                result,
                WorkspaceRuntimeCodexArgsResult {
                    applied_codex_args: Some("--profile dev".to_string()),
                    respawned: false
                }
            );
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 0);
        });
    }

    #[test]
    fn set_workspace_runtime_codex_args_is_noop_when_args_match() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-1");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let current_session = Arc::new(make_session(entry.clone(), Some("--same".to_string())));
            let sessions = Mutex::new(HashMap::from([(entry.id.clone(), current_session)]));
            let app_settings = Mutex::new(AppSettings::default());

            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            let result = set_workspace_runtime_codex_args_core(
                entry.id.clone(),
                Some("--same".to_string()),
                &workspaces,
                &sessions,
                &app_settings,
                move |entry, args, _home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(make_session(entry, args)))
                    }
                },
            )
            .await
            .expect("core call succeeds");

            assert_eq!(
                result,
                WorkspaceRuntimeCodexArgsResult {
                    applied_codex_args: Some("--same".to_string()),
                    respawned: false
                }
            );
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 0);
        });
    }

    #[test]
    fn set_workspace_runtime_codex_args_respawns_when_args_change() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-1");
            let workspaces = Mutex::new(HashMap::from([(entry.id.clone(), entry.clone())]));
            let current_session = Arc::new(make_session(entry.clone(), Some("--old".to_string())));
            let sessions = Mutex::new(HashMap::from([(entry.id.clone(), current_session)]));
            let app_settings = Mutex::new(AppSettings::default());

            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            let result = set_workspace_runtime_codex_args_core(
                entry.id.clone(),
                Some("--new".to_string()),
                &workspaces,
                &sessions,
                &app_settings,
                move |entry, args, _home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(make_session(entry, args)))
                    }
                },
            )
            .await
            .expect("core call succeeds");

            assert_eq!(
                result,
                WorkspaceRuntimeCodexArgsResult {
                    applied_codex_args: Some("--new".to_string()),
                    respawned: true
                }
            );
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);

            let next = sessions
                .lock()
                .await
                .get(&entry.id)
                .expect("session updated")
                .codex_args
                .clone();
            assert_eq!(next, Some("--new".to_string()));
        });
    }

    #[test]
    fn restart_connected_workspace_sessions_respawns_shared_runtime_with_existing_args() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let entry = make_workspace_entry("ws-1");
            let mut second_entry = make_workspace_entry("ws-2");
            second_entry.path = "/tmp/second".to_string();
            let workspaces = Mutex::new(HashMap::from([
                (entry.id.clone(), entry.clone()),
                (second_entry.id.clone(), second_entry.clone()),
            ]));
            let current_session = Arc::new(make_session(
                entry.clone(),
                Some("--profile managed".to_string()),
            ));
            let sessions = Mutex::new(HashMap::from([
                (entry.id.clone(), current_session.clone()),
                (second_entry.id.clone(), current_session.clone()),
            ]));
            let app_settings = Mutex::new(AppSettings::default());

            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            let result = restart_connected_workspace_sessions_core(
                &workspaces,
                &sessions,
                &app_settings,
                move |entry, args, _home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(make_session(entry, args)))
                    }
                },
            )
            .await
            .expect("runtime restart succeeds");

            assert!(result.respawned);
            assert_eq!(
                result.workspace_ids,
                vec!["ws-1".to_string(), "ws-2".to_string()]
            );
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 1);

            let sessions_guard = sessions.lock().await;
            let next_session = sessions_guard.get("ws-1").expect("ws-1 session").clone();
            assert!(Arc::ptr_eq(
                &next_session,
                sessions_guard.get("ws-2").expect("ws-2 session")
            ));
            assert!(!Arc::ptr_eq(&next_session, &current_session));
            assert_eq!(
                next_session.codex_args,
                Some("--profile managed".to_string())
            );
            drop(sessions_guard);

            let workspace_ids = next_session.workspace_ids_snapshot().await;
            assert!(workspace_ids.contains(&"ws-1".to_string()));
            assert!(workspace_ids.contains(&"ws-2".to_string()));
            let roots = next_session.workspace_roots.lock().await.clone();
            assert_eq!(roots.get("ws-1").map(String::as_str), Some("/tmp"));
            assert_eq!(roots.get("ws-2").map(String::as_str), Some("/tmp/second"));
        });
    }

    #[test]
    fn restart_connected_workspace_sessions_is_noop_without_connected_workspaces() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let workspaces = Mutex::new(HashMap::<String, WorkspaceEntry>::new());
            let sessions = Mutex::new(HashMap::<String, Arc<WorkspaceSession>>::new());
            let app_settings = Mutex::new(AppSettings::default());
            let spawn_calls = Arc::new(AtomicUsize::new(0));
            let spawn_calls_ref = spawn_calls.clone();

            let result = restart_connected_workspace_sessions_core(
                &workspaces,
                &sessions,
                &app_settings,
                move |entry, args, _home| {
                    let spawn_calls_ref = spawn_calls_ref.clone();
                    async move {
                        spawn_calls_ref.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(make_session(entry, args)))
                    }
                },
            )
            .await
            .expect("runtime restart no-op succeeds");

            assert_eq!(
                result,
                WorkspaceRuntimeRestartResult {
                    workspace_ids: Vec::new(),
                    respawned: false,
                }
            );
            assert_eq!(spawn_calls.load(Ordering::SeqCst), 0);
        });
    }
}
