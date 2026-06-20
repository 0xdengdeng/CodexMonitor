import { cleanCommandText } from "@/features/messages/utils/messageRenderUtils";
import { asString } from "@utils/threadItems.shared";
import type { BackgroundTask } from "@/features/plan/components/PlanPanel";
import type { ThreadAction, ThreadState } from "../useThreadsReducer";

// A live agent background process, mirroring the Codex TUI's
// `unified_exec_processes` registry. A unified-exec startup command stays
// InProgress until the underlying process actually exits (Codex only emits
// ExecCommandEnd from the background exit watcher on real termination), so this
// registry is fed by item started/completed events and — unlike thread items —
// is never rebuilt from a rollout on resume, which lets a still-running process
// survive thread switches within the app session.
export type AgentBackgroundProcess = {
  // processId when available, else the item id — stable identity for add/remove.
  key: string;
  itemId: string;
  command: string;
  cwd: string | null;
};

const AGENT_BACKGROUND_SOURCE = "unifiedExecStartup";
const STATUS_RUNNING = "inProgress";
const TERMINAL_STATUSES = new Set(["completed", "failed", "declined"]);

function stringifyCommand(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((part) => asString(part)).join(" ");
  }
  return asString(value);
}

export function applyBackgroundProcessUpdate(
  current: AgentBackgroundProcess[],
  rawItem: Record<string, unknown>,
): AgentBackgroundProcess[] {
  if (asString(rawItem.type) !== "commandExecution") {
    return current;
  }
  if (asString(rawItem.source) !== AGENT_BACKGROUND_SOURCE) {
    return current;
  }

  const itemId = asString(rawItem.id);
  const processId = asString(rawItem.processId ?? rawItem.process_id);
  // `||` (not `??`) is intentional: asString yields "" for a missing processId,
  // and "" must fall through to the item id rather than being kept as the key.
  const key = processId || itemId;
  if (!key) {
    return current;
  }

  const status = asString(rawItem.status);
  if (TERMINAL_STATUSES.has(status)) {
    if (!current.some((process) => process.key === key)) {
      return current;
    }
    return current.filter((process) => process.key !== key);
  }

  if (status !== STATUS_RUNNING) {
    return current;
  }

  const next: AgentBackgroundProcess = {
    key,
    itemId: itemId || key,
    command: cleanCommandText(stringifyCommand(rawItem.command)),
    cwd: asString(rawItem.cwd) || null,
  };
  const existingIndex = current.findIndex((process) => process.key === key);
  if (existingIndex === -1) {
    return [...current, next];
  }
  const updated = current.slice();
  updated[existingIndex] = next;
  return updated;
}

function basename(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export function selectAgentBackgroundTasks(
  processes: AgentBackgroundProcess[],
): BackgroundTask[] {
  return processes.map((process) => ({
    id: process.itemId,
    title: process.command,
    status: "running" as const,
    detail: process.cwd ? basename(process.cwd) : null,
  }));
}

export function reduceThreadBackgroundProcesses(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  if (action.type !== "observeBackgroundProcess") {
    return state;
  }
  const current = state.backgroundProcessesByThread[action.threadId] ?? [];
  const next = applyBackgroundProcessUpdate(current, action.item);
  if (next === current) {
    return state;
  }
  return {
    ...state,
    backgroundProcessesByThread: {
      ...state.backgroundProcessesByThread,
      [action.threadId]: next,
    },
  };
}
