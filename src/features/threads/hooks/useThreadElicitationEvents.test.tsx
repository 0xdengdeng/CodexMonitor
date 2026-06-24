// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ElicitationRequest } from "@/types";
import { useThreadElicitationEvents } from "./useThreadElicitationEvents";

describe("useThreadElicitationEvents", () => {
  it("always dispatches an addElicitation action (no allowlist / auto-respond)", () => {
    const dispatch = vi.fn();
    const elicitation: ElicitationRequest = {
      workspace_id: "ws-1",
      request_id: 9,
      method: "mcpServer/elicitation/request",
      params: { message: "Allow browser navigation?", serverName: "browser" },
    };

    const { result } = renderHook(() => useThreadElicitationEvents({ dispatch }));

    act(() => {
      result.current(elicitation);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: "addElicitation", elicitation });
  });
});
