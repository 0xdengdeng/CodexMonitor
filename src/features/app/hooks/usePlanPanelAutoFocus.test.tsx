// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TurnPlan } from "@/types";
import { usePlanPanelAutoFocus } from "./usePlanPanelAutoFocus";

function makePlan(turnId: string, step = "Inspect context"): TurnPlan {
  return {
    turnId,
    explanation: null,
    steps: [{ step, status: "inProgress" }],
  };
}

describe("usePlanPanelAutoFocus", () => {
  it("switches to plan only when a new plan first appears", () => {
    const setFilePanelMode = vi.fn();
    const { rerender } = renderHook(
      ({ activePlan, filePanelMode }) =>
        usePlanPanelAutoFocus({
          activeThreadId: "thread-1",
          activePlan,
          filePanelMode,
          setFilePanelMode,
        }),
      {
        initialProps: {
          activePlan: null as TurnPlan | null,
          filePanelMode: "git" as const,
        },
      },
    );

    expect(setFilePanelMode).not.toHaveBeenCalled();

    rerender({ activePlan: makePlan("turn-1"), filePanelMode: "git" });
    expect(setFilePanelMode).toHaveBeenCalledTimes(1);
    expect(setFilePanelMode).toHaveBeenLastCalledWith("plan");

    rerender({
      activePlan: makePlan("turn-1", "Keep working"),
      filePanelMode: "git",
    });
    expect(setFilePanelMode).toHaveBeenCalledTimes(1);

    rerender({ activePlan: makePlan("turn-2"), filePanelMode: "git" });
    expect(setFilePanelMode).toHaveBeenCalledTimes(2);
    expect(setFilePanelMode).toHaveBeenLastCalledWith("plan");
  });
});
