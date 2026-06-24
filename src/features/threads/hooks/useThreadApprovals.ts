import { useCallback, useRef } from "react";
import type { Dispatch } from "react";
import type { ApprovalRequest, DebugEntry, ElicitationRequest } from "@/types";
import { normalizeCommandTokens } from "@utils/approvalRules";
import {
  rememberApprovalRule,
  respondToElicitationRequest,
  respondToServerRequest,
} from "@services/tauri";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadApprovalsOptions = {
  dispatch: Dispatch<ThreadAction>;
  onDebug?: (entry: DebugEntry) => void;
};

export function useThreadApprovals({ dispatch, onDebug }: UseThreadApprovalsOptions) {
  const approvalAllowlistRef = useRef<Record<string, string[][]>>({});

  const rememberApprovalPrefix = useCallback((workspaceId: string, command: string[]) => {
    const normalized = normalizeCommandTokens(command);
    if (!normalized.length) {
      return;
    }
    const allowlist = approvalAllowlistRef.current[workspaceId] ?? [];
    const exists = allowlist.some(
      (entry) =>
        entry.length === normalized.length &&
        entry.every((token, index) => token === normalized[index]),
    );
    if (!exists) {
      approvalAllowlistRef.current = {
        ...approvalAllowlistRef.current,
        [workspaceId]: [...allowlist, normalized],
      };
    }
  }, []);

  const handleApprovalDecision = useCallback(
    async (request: ApprovalRequest, decision: "accept" | "decline") => {
      await respondToServerRequest(
        request.workspace_id,
        request.request_id,
        decision,
      );
      dispatch({
        type: "removeApproval",
        requestId: request.request_id,
        workspaceId: request.workspace_id,
      });
    },
    [dispatch],
  );

  const handleElicitationDecision = useCallback(
    async (
      request: ElicitationRequest,
      action: "accept" | "decline" | "cancel",
    ) => {
      // The approval-style elicitation's requestedSchema is `{ confirmed: boolean, required }`
      // (verified against codex app-server-protocol v2/mcp.rs + common.rs), so accept must echo
      // `{ confirmed: true }`; decline/cancel carry no content (response.content is nullable).
      await respondToElicitationRequest(
        request.workspace_id,
        request.request_id,
        action,
        action === "accept" ? { confirmed: true } : null,
      );
      dispatch({
        type: "removeElicitation",
        requestId: request.request_id,
        workspaceId: request.workspace_id,
      });
    },
    [dispatch],
  );

  const handleApprovalRemember = useCallback(
    async (request: ApprovalRequest, command: string[]) => {
      try {
        await rememberApprovalRule(request.workspace_id, command);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-approval-rule-error`,
          timestamp: Date.now(),
          source: "error",
          label: "approval rule error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }

      rememberApprovalPrefix(request.workspace_id, command);

      await respondToServerRequest(
        request.workspace_id,
        request.request_id,
        "accept",
      );
      dispatch({
        type: "removeApproval",
        requestId: request.request_id,
        workspaceId: request.workspace_id,
      });
    },
    [dispatch, onDebug, rememberApprovalPrefix],
  );

  return {
    approvalAllowlistRef,
    handleApprovalDecision,
    handleElicitationDecision,
    handleApprovalRemember,
  };
}
