// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useCapabilitiesDialog } from "./useCapabilitiesDialog";

function workspace(id: string, connected: boolean): WorkspaceInfo {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    connected,
    settings: { sidebarCollapsed: false },
  };
}

describe("useCapabilitiesDialog", () => {
  it("connects the first workspace before opening when no project is selected", async () => {
    const first = workspace("first", false);
    const connectWorkspace = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useCapabilitiesDialog({
        activeWorkspace: null,
        workspaces: [first],
        connectWorkspace,
      }),
    );

    await act(async () => {
      await result.current.openCapabilities();
    });

    expect(connectWorkspace).toHaveBeenCalledWith(first);
    expect(result.current.capabilitiesOpen).toBe(true);
  });

  it("uses an already connected workspace without reconnecting", async () => {
    const connected = workspace("connected", true);
    const connectWorkspace = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useCapabilitiesDialog({
        activeWorkspace: null,
        workspaces: [connected],
        connectWorkspace,
      }),
    );

    await act(async () => {
      await result.current.openCapabilities();
    });

    expect(connectWorkspace).not.toHaveBeenCalled();
    expect(result.current.capabilitiesRuntimeWorkspace).toBe(connected);
    expect(result.current.capabilitiesOpen).toBe(true);
  });

  it("still opens when the background workspace connection fails", async () => {
    const first = workspace("first", false);
    const connectWorkspace = vi.fn().mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() =>
      useCapabilitiesDialog({
        activeWorkspace: null,
        workspaces: [first],
        connectWorkspace,
      }),
    );

    await act(async () => {
      await expect(result.current.openCapabilities()).resolves.toBeUndefined();
    });

    expect(connectWorkspace).toHaveBeenCalledWith(first);
    expect(result.current.capabilitiesOpen).toBe(true);
  });
});
