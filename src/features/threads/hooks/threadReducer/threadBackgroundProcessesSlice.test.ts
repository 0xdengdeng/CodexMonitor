import { describe, expect, it } from "vitest";
import {
  applyBackgroundProcessUpdate,
  selectAgentBackgroundTasks,
  type AgentBackgroundProcess,
} from "./threadBackgroundProcessesSlice";

function startupItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "commandExecution",
    id: "cmd-1",
    command: "bash -lc 'node server.js'",
    cwd: "/Users/me/projects/app",
    status: "inProgress",
    source: "unifiedExecStartup",
    processId: "42",
    ...overrides,
  };
}

describe("applyBackgroundProcessUpdate", () => {
  it("registers a live unified-exec startup process keyed by processId", () => {
    const next = applyBackgroundProcessUpdate([], startupItem());

    expect(next).toEqual([
      {
        key: "42",
        itemId: "cmd-1",
        command: "node server.js",
        cwd: "/Users/me/projects/app",
      },
    ]);
  });

  it("removes the process when it reaches a terminal status", () => {
    const current = applyBackgroundProcessUpdate([], startupItem());
    const next = applyBackgroundProcessUpdate(
      current,
      startupItem({ status: "completed" }),
    );

    expect(next).toEqual([]);
  });

  it.each(["failed", "declined"])(
    "removes the process on %s status",
    (status) => {
      const current = applyBackgroundProcessUpdate([], startupItem());
      expect(
        applyBackgroundProcessUpdate(current, startupItem({ status })),
      ).toEqual([]);
    },
  );

  it("updates an existing process in place (same processId) without duplicating", () => {
    const current = applyBackgroundProcessUpdate([], startupItem());
    const next = applyBackgroundProcessUpdate(
      current,
      startupItem({ command: "bash -lc 'node server.js --port 3000'" }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.command).toBe("node server.js --port 3000");
  });

  it("falls back to the item id when no processId is present", () => {
    const next = applyBackgroundProcessUpdate(
      [],
      startupItem({ processId: undefined }),
    );

    expect(next[0]?.key).toBe("cmd-1");
  });

  it("ignores foreground agent commands (non unified-exec source)", () => {
    expect(
      applyBackgroundProcessUpdate([], startupItem({ source: "agent" })),
    ).toEqual([]);
  });

  it("ignores non-command items", () => {
    expect(
      applyBackgroundProcessUpdate([], { type: "fileChange", id: "fc-1" }),
    ).toEqual([]);
  });

  it("returns the same array reference when nothing changes", () => {
    const current = applyBackgroundProcessUpdate([], startupItem());
    // A terminal event for an unknown key is a no-op.
    const next = applyBackgroundProcessUpdate(
      current,
      startupItem({ processId: "999", status: "completed" }),
    );

    expect(next).toBe(current);
  });

  it("accepts snake_case process_id from the wire", () => {
    const next = applyBackgroundProcessUpdate(
      [],
      startupItem({ processId: undefined, process_id: "77" }),
    );

    expect(next[0]?.key).toBe("77");
  });
});

describe("selectAgentBackgroundTasks", () => {
  it("maps processes to read-only running background tasks", () => {
    const processes: AgentBackgroundProcess[] = [
      { key: "42", itemId: "cmd-1", command: "node server.js", cwd: "/repo/app" },
    ];

    expect(selectAgentBackgroundTasks(processes)).toEqual([
      { id: "cmd-1", title: "node server.js", status: "running", detail: "app" },
    ]);
  });

  it("omits detail when there is no working directory", () => {
    const tasks = selectAgentBackgroundTasks([
      { key: "1", itemId: "cmd-1", command: "node server.js", cwd: null },
    ]);

    expect(tasks[0]?.detail).toBeNull();
  });
});
