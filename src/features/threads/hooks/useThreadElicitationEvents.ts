import { useCallback } from "react";
import type { Dispatch } from "react";
import type { ElicitationRequest } from "@/types";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadElicitationEventsOptions = {
  dispatch: Dispatch<ThreadAction>;
};

/**
 * Queue an incoming MCP elicitation (e.g. a tool-call approval prompt). Unlike approvals there is NO
 * allowlist / auto-respond — every elicitation is surfaced to the user (see useThreadApprovalEvents).
 */
export function useThreadElicitationEvents({ dispatch }: UseThreadElicitationEventsOptions) {
  return useCallback(
    (elicitation: ElicitationRequest) => {
      dispatch({ type: "addElicitation", elicitation });
    },
    [dispatch],
  );
}
