import { describe, expect, it } from "vitest";
import type { ElicitationRequest } from "@/types";
import type { ThreadState } from "../useThreadsReducer";
import { reduceThreadQueue } from "./threadQueueSlice";

// The queue reducer only reads/writes `elicitations`, so a minimal state stub is sufficient.
function makeState(elicitations: ElicitationRequest[]): ThreadState {
  return { elicitations } as unknown as ThreadState;
}

function makeElicitation(
  overrides: Partial<ElicitationRequest> = {},
): ElicitationRequest {
  return {
    workspace_id: "ws-1",
    request_id: 9,
    method: "mcpServer/elicitation/request",
    params: { message: "Allow browser navigation?" },
    ...overrides,
  };
}

describe("reduceThreadQueue elicitations", () => {
  it("queues a new elicitation", () => {
    const elicitation = makeElicitation();
    const next = reduceThreadQueue(makeState([]), {
      type: "addElicitation",
      elicitation,
    });
    expect(next.elicitations).toEqual([elicitation]);
  });

  it("dedupes by request_id + workspace_id", () => {
    const elicitation = makeElicitation();
    const state = makeState([elicitation]);
    const next = reduceThreadQueue(state, { type: "addElicitation", elicitation });
    // Same identity → no-op, returns the same reference.
    expect(next).toBe(state);
    expect(next.elicitations).toHaveLength(1);
  });

  it("keeps elicitations from different workspaces with the same request_id", () => {
    const first = makeElicitation({ workspace_id: "ws-1" });
    const second = makeElicitation({ workspace_id: "ws-2" });
    const next = reduceThreadQueue(makeState([first]), {
      type: "addElicitation",
      elicitation: second,
    });
    expect(next.elicitations).toEqual([first, second]);
  });

  it("removes only the matching elicitation on round-trip", () => {
    const target = makeElicitation({ request_id: 9 });
    const other = makeElicitation({ request_id: 10 });
    const next = reduceThreadQueue(makeState([target, other]), {
      type: "removeElicitation",
      requestId: 9,
      workspaceId: "ws-1",
    });
    expect(next.elicitations).toEqual([other]);
  });
});
