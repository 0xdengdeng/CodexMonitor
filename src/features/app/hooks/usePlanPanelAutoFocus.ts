import { useEffect, useRef } from "react";
import type { TurnPlan } from "@/types";
import type { PanelTabId } from "@/features/layout/components/PanelTabs";

type UsePlanPanelAutoFocusOptions = {
  activeThreadId: string | null;
  activePlan: TurnPlan | null;
  filePanelMode: PanelTabId;
  setFilePanelMode: (mode: PanelTabId) => void;
};

export function usePlanPanelAutoFocus({
  activeThreadId,
  activePlan,
  filePanelMode,
  setFilePanelMode,
}: UsePlanPanelAutoFocusOptions) {
  const focusedPlanKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!activeThreadId || !activePlan) {
      return;
    }
    const planKey = `${activeThreadId}:${activePlan.turnId}`;
    if (focusedPlanKeysRef.current.has(planKey)) {
      return;
    }
    focusedPlanKeysRef.current.add(planKey);
    if (filePanelMode !== "plan") {
      setFilePanelMode("plan");
    }
  }, [activePlan, activeThreadId, filePanelMode, setFilePanelMode]);
}
