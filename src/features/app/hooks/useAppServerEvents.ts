import { useEffect, useRef } from "react";
import type {
  AppServerEvent,
  ApprovalRequest,
  DynamicToolCallRequest,
  RequestUserInputRequest,
} from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import {
  getAppServerParams,
  getAppServerRawMethod,
  getAppServerRequestId,
  isApprovalRequestMethod,
  isSupportedAppServerMethod,
} from "../../../utils/appServerEvents";
import type { SupportedAppServerMethod } from "../../../utils/appServerEvents";

type AgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  delta: string;
};

type AgentCompleted = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
};

type HookEvent = {
  workspaceId: string;
  threadId: string;
  turnId: string | null;
  run: Record<string, unknown>;
};

type AppServerEventHandlers = {
  onWorkspaceConnected?: (workspaceId: string) => void;
  onThreadStarted?: (workspaceId: string, thread: Record<string, unknown>) => void;
  onThreadNameUpdated?: (
    workspaceId: string,
    payload: { threadId: string; threadName: string | null },
  ) => void;
  onThreadStatusChanged?: (
    workspaceId: string,
    threadId: string,
    status: Record<string, unknown>,
  ) => void;
  onThreadClosed?: (workspaceId: string, threadId: string) => void;
  onThreadArchived?: (workspaceId: string, threadId: string) => void;
  onThreadUnarchived?: (workspaceId: string, threadId: string) => void;
  onBackgroundThreadAction?: (
    workspaceId: string,
    threadId: string,
    action: string,
  ) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onRequestUserInput?: (request: RequestUserInputRequest) => void;
  onDynamicToolCall?: (request: DynamicToolCallRequest) => void;
  onAgentMessageDelta?: (event: AgentDelta) => void;
  onAgentMessageCompleted?: (event: AgentCompleted) => void;
  onAppServerEvent?: (event: AppServerEvent) => void;
  onTurnStarted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnCompleted?: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnError?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { message: string; willRetry: boolean },
  ) => void;
  onTurnPlanUpdated?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { explanation: unknown; plan: unknown },
  ) => void;
  onHookStarted?: (event: HookEvent) => void;
  onHookCompleted?: (event: HookEvent) => void;
  onItemStarted?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
    turnId?: string | null,
  ) => void;
  onItemCompleted?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
    turnId?: string | null,
  ) => void;
  onReasoningSummaryDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onReasoningSummaryBoundary?: (workspaceId: string, threadId: string, itemId: string) => void;
  onReasoningTextDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onPlanDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onCommandOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTerminalInteraction?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    stdin: string,
  ) => void;
  onFileChangeOutputDelta?: (workspaceId: string, threadId: string, itemId: string, delta: string) => void;
  onTurnDiffUpdated?: (workspaceId: string, threadId: string, diff: string) => void;
  onThreadTokenUsageUpdated?: (
    workspaceId: string,
    threadId: string,
    tokenUsage: Record<string, unknown> | null,
  ) => void;
  onAccountRateLimitsUpdated?: (
    workspaceId: string,
    rateLimits: Record<string, unknown>,
  ) => void;
  onAccountUpdated?: (workspaceId: string, authMode: string | null) => void;
  onAccountLoginCompleted?: (
    workspaceId: string,
    payload: { loginId: string | null; success: boolean; error: string | null },
  ) => void;
};

export const METHODS_ROUTED_IN_USE_APP_SERVER_EVENTS = [
  "account/login/completed",
  "account/rateLimits/updated",
  "account/updated",
  "codex/backgroundThread",
  "codex/connected",
  "error",
  "hook/completed",
  "hook/started",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/completed",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "item/tool/call",
  "item/tool/requestUserInput",
  "rawResponseItem/completed",
  "thread/archived",
  "thread/closed",
  "thread/name/updated",
  "thread/status/changed",
  "thread/started",
  "thread/tokenUsage/updated",
  "thread/unarchived",
  "turn/completed",
  "turn/diff/updated",
  "turn/error",
  "turn/plan/updated",
  "turn/started",
] as const satisfies readonly SupportedAppServerMethod[];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return "";
}

type RawDynamicToolCall = {
  id: string;
  namespace: string | null;
  tool: string;
  arguments: Record<string, unknown>;
};

const RAW_DYNAMIC_TOOL_CALL_CACHE_LIMIT = 200;

function parseJsonRecord(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeRawDynamicToolName(tool: string) {
  return tool === "codex_monitor.generate_image" ? "generate_image" : tool;
}

function normalizeRawDynamicToolNamespace(namespace: string, tool: string) {
  if (!namespace && normalizeRawDynamicToolName(tool) === "generate_image") {
    return "codex_monitor";
  }
  return namespace;
}

function normalizeRawDynamicToolArguments(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  if (record) {
    return record;
  }
  return typeof value === "string" ? (parseJsonRecord(value) ?? {}) : {};
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error.trim();
  }
  const record = asRecord(error);
  if (!record) {
    return "";
  }
  return readFirstString(
    record.message,
    record.error,
    asRecord(record.error)?.message,
    record.details,
    record.additionalDetails,
    record.additional_details,
  );
}

function turnErrorKey(workspaceId: string, threadId: string, turnId: string): string | null {
  if (!threadId || !turnId) {
    return null;
  }
  return `${workspaceId}:${threadId}:${turnId}`;
}

function parseTurnErrorParams(params: Record<string, unknown>) {
  const turn = asRecord(params.turn);
  const threadId = readFirstString(
    params.threadId,
    params.thread_id,
    turn?.threadId,
    turn?.thread_id,
  );
  const turnId = readFirstString(
    turn?.id,
    turn?.turnId,
    turn?.turn_id,
    params.turnId,
    params.turn_id,
  );
  const message = readFirstString(
    extractErrorMessage(params.error),
    extractErrorMessage(turn?.error),
    params.message,
  );
  return {
    threadId,
    turnId,
    message,
    willRetry: Boolean(params.willRetry ?? params.will_retry),
  };
}

function parseTurnCompletionError(
  params: Record<string, unknown>,
  threadId: string,
  turnId: string,
) {
  const turn = asRecord(params.turn);
  const message = readFirstString(
    extractErrorMessage(turn?.error),
    extractErrorMessage(params.error),
  );
  const status = readFirstString(turn?.status, params.status)
    .toLowerCase()
    .replace(/_/g, "");
  const failed = Boolean(message) || status === "failed" || status === "error";
  if (!failed) {
    return null;
  }
  return {
    threadId,
    turnId,
    message,
    willRetry: false,
  };
}

function parseHookEvent(
  workspaceId: string,
  params: Record<string, unknown>,
): HookEvent | null {
  const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
  if (!threadId) {
    return null;
  }
  const run = params.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    return null;
  }
  const turnIdRaw = params.turnId ?? params.turn_id ?? null;
  const turnId =
    typeof turnIdRaw === "string" && turnIdRaw.trim().length > 0
      ? turnIdRaw.trim()
      : null;
  return {
    workspaceId,
    threadId,
    turnId,
    run: run as Record<string, unknown>,
  };
}

function isRawImageGenerationItem(value: unknown): value is Record<string, unknown> {
  const item = asRecord(value);
  if (!item) {
    return false;
  }
  const itemType = readFirstString(item.type);
  return itemType === "image_generation_call" || itemType === "imageGeneration";
}

function getRawFunctionCallId(item: Record<string, unknown>) {
  return readFirstString(item.call_id, item.callId, item.id);
}

function parseRawDynamicToolCall(value: unknown): RawDynamicToolCall | null {
  const item = asRecord(value);
  if (!item || readFirstString(item.type) !== "function_call") {
    return null;
  }
  const id = getRawFunctionCallId(item);
  const rawNamespace = readFirstString(item.namespace);
  const rawTool = readFirstString(item.name, item.tool);
  const tool = normalizeRawDynamicToolName(rawTool);
  const namespace = normalizeRawDynamicToolNamespace(rawNamespace, rawTool);
  if (!id || namespace !== "codex_monitor" || tool !== "generate_image") {
    return null;
  }
  return {
    id,
    namespace,
    tool,
    arguments: normalizeRawDynamicToolArguments(item.arguments),
  };
}

function normalizeRawDynamicToolOutputContentItem(value: Record<string, unknown>) {
  const type = readFirstString(value.type);
  if (type === "inputText" || type === "input_text") {
    const text = readFirstString(value.text);
    return text ? { type: "inputText" as const, text } : null;
  }
  if (type === "inputImage" || type === "input_image") {
    const imageUrl = readFirstString(value.imageUrl, value.image_url);
    return imageUrl ? { type: "inputImage" as const, imageUrl } : null;
  }
  return null;
}

function normalizeRawDynamicToolOutputContentItems(output: unknown) {
  if (Array.isArray(output)) {
    return output
      .map((entry) => {
        const record = asRecord(entry);
        return record ? normalizeRawDynamicToolOutputContentItem(record) : null;
      })
      .filter(
        (
          entry,
        ): entry is
          | { type: "inputText"; text: string }
          | { type: "inputImage"; imageUrl: string } => Boolean(entry),
      );
  }
  const text = typeof output === "string" ? output.trim() : "";
  return text ? [{ type: "inputText" as const, text }] : [];
}

function firstRawDynamicToolOutputText(
  contentItems: Array<
    { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
  >,
) {
  for (const item of contentItems) {
    if (item.type === "inputText" && item.text.trim()) {
      return item.text;
    }
  }
  return "";
}

function buildRawDynamicToolOutputItem(
  value: unknown,
  call: RawDynamicToolCall | undefined,
) {
  const item = asRecord(value);
  if (!item || !call || readFirstString(item.type) !== "function_call_output") {
    return null;
  }
  const contentItems = normalizeRawDynamicToolOutputContentItems(item.output);
  const metadata = parseJsonRecord(firstRawDynamicToolOutputText(contentItems)) ?? {};
  const success = !readFirstString(metadata.error, metadata.message);
  return {
    type: "dynamicToolCall",
    id: call.id,
    namespace: call.namespace,
    tool: call.tool,
    status: success ? "completed" : "failed",
    arguments: call.arguments,
    contentItems,
    success,
  };
}

function buildRawDynamicToolCallKey(
  workspaceId: string,
  threadId: string,
  turnId: string | null,
  callId: string,
) {
  return `${workspaceId}:${threadId}:${turnId ?? ""}:${callId}`;
}

function rememberRawDynamicToolCall(
  calls: Map<string, RawDynamicToolCall>,
  key: string,
  call: RawDynamicToolCall,
) {
  calls.set(key, call);
  while (calls.size > RAW_DYNAMIC_TOOL_CALL_CACHE_LIMIT) {
    const oldestKey = calls.keys().next().value;
    if (!oldestKey) {
      return;
    }
    calls.delete(oldestKey);
  }
}

function hasRawAssistantMessageText(item: Record<string, unknown>) {
  if (readFirstString(item.type) !== "message" || readFirstString(item.role) !== "assistant") {
    return false;
  }
  const content = Array.isArray(item.content) ? item.content : [];
  return content.some((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return false;
    }
    const type = readFirstString(record.type);
    if (type !== "output_text" && type !== "text") {
      return false;
    }
    return readFirstString(record.text).length > 0;
  });
}

function isRawDisplayResponseItem(value: unknown): value is Record<string, unknown> {
  const item = asRecord(value);
  if (!item) {
    return false;
  }
  return isRawImageGenerationItem(item) || hasRawAssistantMessageText(item);
}

export function useAppServerEvents(handlers: AppServerEventHandlers) {
  // Use ref to keep handlers current without triggering re-subscription
  const handlersRef = useRef(handlers);
  const reportedTurnErrorsRef = useRef(new Set<string>());
  const rawDynamicToolCallsRef = useRef(new Map<string, RawDynamicToolCall>());
  
  // Update ref on every render to always have latest handlers
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const unlisten = subscribeAppServerEvents((payload) => {
      const currentHandlers = handlersRef.current;
      currentHandlers.onAppServerEvent?.(payload);

      const { workspace_id } = payload;
      const method = getAppServerRawMethod(payload);
      if (!method) {
        return;
      }
      const params = getAppServerParams(payload);

      if (method === "codex/connected") {
        currentHandlers.onWorkspaceConnected?.(workspace_id);
        return;
      }

      const requestId = getAppServerRequestId(payload);
      const hasRequestId = requestId !== null;

      if (isApprovalRequestMethod(method) && hasRequestId) {
        currentHandlers.onApprovalRequest?.({
          workspace_id,
          request_id: requestId as string | number,
          method,
          params,
        });
        return;
      }

      if (!isSupportedAppServerMethod(method)) {
        return;
      }

      if (method === "item/tool/requestUserInput" && hasRequestId) {
        const questionsRaw = Array.isArray(params.questions) ? params.questions : [];
        const questions = questionsRaw
          .map((entry) => {
            const question = entry as Record<string, unknown>;
            const optionsRaw = Array.isArray(question.options) ? question.options : [];
            const options = optionsRaw
              .map((option) => {
                const record = option as Record<string, unknown>;
                const label = String(record.label ?? "").trim();
                const description = String(record.description ?? "").trim();
                if (!label && !description) {
                  return null;
                }
                return { label, description };
              })
              .filter((option): option is { label: string; description: string } => Boolean(option));
            return {
              id: String(question.id ?? "").trim(),
              header: String(question.header ?? ""),
              question: String(question.question ?? ""),
              isOther: Boolean(question.isOther ?? question.is_other),
              options: options.length ? options : undefined,
            };
          })
          .filter((question) => question.id);
        currentHandlers.onRequestUserInput?.({
          workspace_id,
          request_id: requestId as string | number,
          params: {
            thread_id: String(params.threadId ?? params.thread_id ?? ""),
            turn_id: String(params.turnId ?? params.turn_id ?? ""),
            item_id: String(params.itemId ?? params.item_id ?? ""),
            questions,
          },
        });
        return;
      }

      if (method === "item/tool/call" && hasRequestId) {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        const turnId = String(params.turnId ?? params.turn_id ?? "").trim();
        const callId = String(params.callId ?? params.call_id ?? "").trim();
        const namespaceRaw = params.namespace;
        const namespace =
          typeof namespaceRaw === "string" && namespaceRaw.trim().length > 0
            ? namespaceRaw.trim()
            : null;
        const tool = String(params.tool ?? "").trim();
        const argsRaw = params.arguments;
        const args =
          argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
            ? (argsRaw as Record<string, unknown>)
            : {};
        if (threadId && turnId && callId && tool) {
          currentHandlers.onDynamicToolCall?.({
            workspace_id,
            request_id: requestId as string | number,
            params: {
              thread_id: threadId,
              turn_id: turnId,
              call_id: callId,
              namespace,
              tool,
              arguments: args,
            },
          });
        }
        return;
      }

      if (method === "item/agentMessage/delta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onAgentMessageDelta?.({
            workspaceId: workspace_id,
            threadId,
            itemId,
            delta,
          });
        }
        return;
      }

      if (method === "turn/started") {
        const turn = params.turn as Record<string, unknown> | undefined;
        const threadId = String(
          params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
        );
        const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          currentHandlers.onTurnStarted?.(workspace_id, threadId, turnId);
        }
        return;
      }

      if (method === "hook/started") {
        const event = parseHookEvent(workspace_id, params);
        if (event) {
          currentHandlers.onHookStarted?.(event);
        }
        return;
      }

      if (method === "hook/completed") {
        const event = parseHookEvent(workspace_id, params);
        if (event) {
          currentHandlers.onHookCompleted?.(event);
        }
        return;
      }

      if (method === "thread/started") {
        const thread = (params.thread as Record<string, unknown> | undefined) ?? null;
        const threadId = String(thread?.id ?? "");
        if (thread && threadId) {
          currentHandlers.onThreadStarted?.(workspace_id, thread);
        }
        return;
      }

      if (method === "thread/name/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        const threadNameRaw = params.threadName ?? params.thread_name ?? null;
        const threadName =
          typeof threadNameRaw === "string" && threadNameRaw.trim().length > 0
            ? threadNameRaw.trim()
            : null;
        if (threadId) {
          currentHandlers.onThreadNameUpdated?.(workspace_id, { threadId, threadName });
        }
        return;
      }

      if (method === "thread/status/changed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (!threadId) {
          return;
        }
        const statusRaw = params.status;
        if (statusRaw && typeof statusRaw === "object" && !Array.isArray(statusRaw)) {
          currentHandlers.onThreadStatusChanged?.(
            workspace_id,
            threadId,
            statusRaw as Record<string, unknown>,
          );
          return;
        }
        if (typeof statusRaw === "string" && statusRaw.trim().length > 0) {
          currentHandlers.onThreadStatusChanged?.(workspace_id, threadId, {
            type: statusRaw.trim(),
          });
        }
        return;
      }

      if (method === "thread/closed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (threadId) {
          currentHandlers.onThreadClosed?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "thread/archived") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (threadId) {
          currentHandlers.onThreadArchived?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "thread/unarchived") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        if (threadId) {
          currentHandlers.onThreadUnarchived?.(workspace_id, threadId);
        }
        return;
      }

      if (method === "codex/backgroundThread") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const action = String(params.action ?? "hide");
        if (threadId) {
          currentHandlers.onBackgroundThreadAction?.(workspace_id, threadId, action);
        }
        return;
      }

      if (method === "error" || method === "turn/error") {
        const turnError = parseTurnErrorParams(params);
        if (turnError.threadId) {
          const key = turnError.willRetry
            ? null
            : turnErrorKey(workspace_id, turnError.threadId, turnError.turnId);
          if (key) {
            reportedTurnErrorsRef.current.add(key);
          }
          currentHandlers.onTurnError?.(
            workspace_id,
            turnError.threadId,
            turnError.turnId,
            {
              message: turnError.message,
              willRetry: turnError.willRetry,
            },
          );
        }
        return;
      }

      if (method === "turn/completed") {
        const turn = params.turn as Record<string, unknown> | undefined;
        const threadId = String(
          params.threadId ?? params.thread_id ?? turn?.threadId ?? turn?.thread_id ?? "",
        );
        const turnId = String(turn?.id ?? params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          const completionError = parseTurnCompletionError(params, threadId, turnId);
          if (completionError) {
            const key = turnErrorKey(workspace_id, threadId, turnId);
            if (!key || !reportedTurnErrorsRef.current.has(key)) {
              if (key) {
                reportedTurnErrorsRef.current.add(key);
              }
              currentHandlers.onTurnError?.(workspace_id, threadId, turnId, {
                message: completionError.message,
                willRetry: false,
              });
            }
          }
          currentHandlers.onTurnCompleted?.(workspace_id, threadId, turnId);
        }
        return;
      }

      if (method === "turn/plan/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "");
        if (threadId) {
          currentHandlers.onTurnPlanUpdated?.(workspace_id, threadId, turnId, {
            explanation: params.explanation,
            plan: params.plan,
          });
        }
        return;
      }

      if (method === "turn/diff/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const diff = String(params.diff ?? "");
        if (threadId && diff) {
          currentHandlers.onTurnDiffUpdated?.(workspace_id, threadId, diff);
        }
        return;
      }

      if (method === "thread/tokenUsage/updated") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const tokenUsage =
          (params.tokenUsage as Record<string, unknown> | null | undefined) ??
          (params.token_usage as Record<string, unknown> | null | undefined);
        if (threadId && tokenUsage !== undefined) {
          currentHandlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
        }
        return;
      }

      if (method === "account/rateLimits/updated") {
        const rateLimits =
          (params.rateLimits as Record<string, unknown> | undefined) ??
          (params.rate_limits as Record<string, unknown> | undefined);
        if (rateLimits) {
          currentHandlers.onAccountRateLimitsUpdated?.(workspace_id, rateLimits);
        }
        return;
      }

      if (method === "account/updated") {
        const authModeRaw = params.authMode ?? params.auth_mode ?? null;
        const authMode =
          typeof authModeRaw === "string" && authModeRaw.trim().length > 0
            ? authModeRaw
            : null;
        currentHandlers.onAccountUpdated?.(workspace_id, authMode);
        return;
      }

      if (method === "account/login/completed") {
        const loginIdRaw = params.loginId ?? params.login_id ?? null;
        const loginId =
          typeof loginIdRaw === "string" && loginIdRaw.trim().length > 0
            ? loginIdRaw
            : null;
        const success = Boolean(params.success);
        const errorRaw = params.error ?? null;
        const error =
          typeof errorRaw === "string" && errorRaw.trim().length > 0 ? errorRaw : null;
        currentHandlers.onAccountLoginCompleted?.(workspace_id, {
          loginId,
          success,
          error,
        });
        return;
      }

      if (method === "item/completed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "").trim() || null;
        const item = params.item as Record<string, unknown> | undefined;
        if (threadId && item) {
          if (turnId) {
            currentHandlers.onItemCompleted?.(workspace_id, threadId, item, turnId);
          } else {
            currentHandlers.onItemCompleted?.(workspace_id, threadId, item);
          }
        }
        if (threadId && item?.type === "agentMessage") {
          const itemId = String(item.id ?? "");
          const text = String(item.text ?? "");
          if (itemId && text.trim().length > 0) {
            currentHandlers.onAgentMessageCompleted?.({
              workspaceId: workspace_id,
              threadId,
              itemId,
              text,
            });
          }
        }
        return;
      }

      if (method === "rawResponseItem/completed") {
        const threadId = String(params.threadId ?? params.thread_id ?? "").trim();
        const turnId = String(params.turnId ?? params.turn_id ?? "").trim() || null;
        const item = params.item;
        if (threadId) {
          const rawCall = parseRawDynamicToolCall(item);
          if (rawCall) {
            rememberRawDynamicToolCall(
              rawDynamicToolCallsRef.current,
              buildRawDynamicToolCallKey(workspace_id, threadId, turnId, rawCall.id),
              rawCall,
            );
            return;
          }

          const rawOutput = asRecord(item);
          const rawOutputCallId = rawOutput ? getRawFunctionCallId(rawOutput) : "";
          const rawCallKey = rawOutputCallId
            ? buildRawDynamicToolCallKey(workspace_id, threadId, turnId, rawOutputCallId)
            : "";
          const dynamicToolOutput = buildRawDynamicToolOutputItem(
            item,
            rawCallKey ? rawDynamicToolCallsRef.current.get(rawCallKey) : undefined,
          );
          if (dynamicToolOutput) {
            rawDynamicToolCallsRef.current.delete(rawCallKey);
            if (turnId) {
              currentHandlers.onItemCompleted?.(
                workspace_id,
                threadId,
                dynamicToolOutput,
                turnId,
              );
            } else {
              currentHandlers.onItemCompleted?.(workspace_id, threadId, dynamicToolOutput);
            }
            return;
          }
        }
        if (threadId && isRawDisplayResponseItem(item)) {
          if (turnId) {
            currentHandlers.onItemCompleted?.(workspace_id, threadId, item, turnId);
          } else {
            currentHandlers.onItemCompleted?.(workspace_id, threadId, item);
          }
        }
        return;
      }

      if (method === "item/started") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const turnId = String(params.turnId ?? params.turn_id ?? "").trim() || null;
        const item = params.item as Record<string, unknown> | undefined;
        if (threadId && item) {
          if (turnId) {
            currentHandlers.onItemStarted?.(workspace_id, threadId, item, turnId);
          } else {
            currentHandlers.onItemStarted?.(workspace_id, threadId, item);
          }
        }
        return;
      }

      if (method === "item/reasoning/summaryTextDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onReasoningSummaryDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/reasoning/summaryPartAdded") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        if (threadId && itemId) {
          currentHandlers.onReasoningSummaryBoundary?.(workspace_id, threadId, itemId);
        }
        return;
      }

      if (method === "item/reasoning/textDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onReasoningTextDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/plan/delta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onPlanDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/commandExecution/outputDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onCommandOutputDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }

      if (method === "item/commandExecution/terminalInteraction") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const stdin = String(params.stdin ?? "");
        if (threadId && itemId) {
          currentHandlers.onTerminalInteraction?.(workspace_id, threadId, itemId, stdin);
        }
        return;
      }

      if (method === "item/fileChange/outputDelta") {
        const threadId = String(params.threadId ?? params.thread_id ?? "");
        const itemId = String(params.itemId ?? params.item_id ?? "");
        const delta = String(params.delta ?? "");
        if (threadId && itemId && delta) {
          currentHandlers.onFileChangeOutputDelta?.(workspace_id, threadId, itemId, delta);
        }
        return;
      }
    });

    return () => {
      unlisten();
    };
  }, []);
}
