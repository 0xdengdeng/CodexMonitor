/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useComposerFiles } from "./useComposerFiles";

vi.mock("../../../services/tauri", () => ({
  pickFiles: vi.fn().mockResolvedValue([]),
}));

type HookResult = ReturnType<typeof useComposerFiles>;

type RenderedHook = {
  result: HookResult;
  rerender: (next: { activeThreadId: string | null; activeWorkspaceId: string | null }) => void;
  unmount: () => void;
};

function renderComposerFiles(
  initial: { activeThreadId: string | null; activeWorkspaceId: string | null },
): RenderedHook {
  let props = initial;
  let result: HookResult | undefined;

  function Test() {
    result = useComposerFiles(props);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(React.createElement(Test));
  });

  return {
    get result() {
      if (!result) {
        throw new Error("Hook not rendered");
      }
      return result;
    },
    rerender: (next) => {
      props = next;
      act(() => {
        root.render(React.createElement(Test));
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useComposerFiles", () => {
  it("attaches files and deduplicates paths", () => {
    const hook = renderComposerFiles({
      activeThreadId: "thread-1",
      activeWorkspaceId: "ws-1",
    });

    act(() => {
      hook.result.attachFiles(["/tmp/a.ts", "/tmp/b.md"]);
    });

    expect(hook.result.activeFiles).toEqual(["/tmp/a.ts", "/tmp/b.md"]);

    act(() => {
      hook.result.attachFiles(["/tmp/b.md", "/tmp/c.json"]);
    });

    expect(hook.result.activeFiles).toEqual([
      "/tmp/a.ts",
      "/tmp/b.md",
      "/tmp/c.json",
    ]);

    hook.unmount();
  });

  it("removes files and clears empty drafts", () => {
    const hook = renderComposerFiles({
      activeThreadId: "thread-2",
      activeWorkspaceId: "ws-1",
    });

    act(() => {
      hook.result.attachFiles(["/tmp/a.ts", "/tmp/b.md"]);
    });

    act(() => {
      hook.result.removeFile("/tmp/a.ts");
    });

    expect(hook.result.activeFiles).toEqual(["/tmp/b.md"]);

    act(() => {
      hook.result.removeFile("/tmp/b.md");
    });

    expect(hook.result.activeFiles).toEqual([]);

    hook.unmount();
  });

  it("keeps file drafts separate per thread and workspace", () => {
    const hook = renderComposerFiles({
      activeThreadId: "thread-1",
      activeWorkspaceId: "ws-1",
    });

    act(() => {
      hook.result.attachFiles(["/tmp/a.ts"]);
    });
    expect(hook.result.activeFiles).toEqual(["/tmp/a.ts"]);

    hook.rerender({ activeThreadId: null, activeWorkspaceId: "ws-1" });
    expect(hook.result.activeFiles).toEqual([]);

    act(() => {
      hook.result.attachFiles(["/tmp/b.md"]);
    });
    expect(hook.result.activeFiles).toEqual(["/tmp/b.md"]);

    hook.rerender({ activeThreadId: "thread-1", activeWorkspaceId: "ws-1" });
    expect(hook.result.activeFiles).toEqual(["/tmp/a.ts"]);

    hook.unmount();
  });
});
