import { useMemo } from "react";
import type { ElicitationRequest, WorkspaceInfo } from "../../../types";
import {
  ToastActions,
  ToastBody,
  ToastCard,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "../../design-system/components/toast/ToastPrimitives";
import { useI18n } from "@/features/i18n/i18n";

type ElicitationToastsProps = {
  elicitations: ElicitationRequest[];
  workspaces: WorkspaceInfo[];
  onDecision: (
    request: ElicitationRequest,
    action: "accept" | "decline" | "cancel",
  ) => void;
};

/**
 * Renders MCP `mcpServer/elicitation/request` prompts (e.g. browser-tool approvals). Codex builds
 * `params.message` with the tool name + arguments, so rendering `message` is enough. Unlike
 * ApprovalToasts there is no global Enter shortcut (deliberate — avoids colliding with the approval
 * toast's Enter=accept listener) and three actions (accept / decline / cancel).
 */
export function ElicitationToasts({
  elicitations,
  workspaces,
  onDecision,
}: ElicitationToastsProps) {
  const { t } = useI18n();
  const workspaceLabels = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  if (!elicitations.length) {
    return null;
  }

  return (
    <ToastViewport className="elicitation-toasts" role="region" ariaLive="assertive">
      {elicitations.map((request) => {
        const params = request.params ?? {};
        const message =
          typeof params.message === "string" && params.message.trim()
            ? params.message
            : t("elicitation.fallback");
        const serverName =
          typeof params.serverName === "string" ? params.serverName : null;
        const workspaceName = workspaceLabels.get(request.workspace_id);
        return (
          <ToastCard
            key={`${request.workspace_id}-${request.request_id}`}
            className="elicitation-toast"
            role="alert"
          >
            <ToastHeader className="elicitation-toast-header">
              <ToastTitle className="elicitation-toast-title">
                {t("elicitation.title")}
              </ToastTitle>
              {workspaceName ? (
                <div className="elicitation-toast-workspace">{workspaceName}</div>
              ) : null}
            </ToastHeader>
            {serverName ? (
              <div className="elicitation-toast-server">{serverName}</div>
            ) : null}
            <ToastBody className="elicitation-toast-message">{message}</ToastBody>
            <ToastActions className="elicitation-toast-actions">
              <button className="ghost" onClick={() => onDecision(request, "cancel")}>
                {t("elicitation.cancel")}
              </button>
              <button
                className="secondary"
                onClick={() => onDecision(request, "decline")}
              >
                {t("elicitation.decline")}
              </button>
              <button className="primary" onClick={() => onDecision(request, "accept")}>
                {t("elicitation.accept")}
              </button>
            </ToastActions>
          </ToastCard>
        );
      })}
    </ToastViewport>
  );
}
