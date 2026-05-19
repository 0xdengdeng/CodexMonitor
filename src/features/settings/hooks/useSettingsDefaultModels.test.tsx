// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@/types";
import {
  connectWorkspace,
  getConfigModel,
  getModelList,
  getRuntimeModelList,
} from "@services/tauri";
import { useSettingsDefaultModels } from "./useSettingsDefaultModels";

vi.mock("@services/tauri", () => ({
  connectWorkspace: vi.fn(),
  getConfigModel: vi.fn(),
  getModelList: vi.fn(),
  getRuntimeModelList: vi.fn(),
}));

const connectWorkspaceMock = vi.mocked(connectWorkspace);
const getConfigModelMock = vi.mocked(getConfigModel);
const getModelListMock = vi.mocked(getModelList);
const getRuntimeModelListMock = vi.mocked(getRuntimeModelList);

function workspace(id: string, connected = true): WorkspaceInfo {
  return {
    id,
    name: `Workspace ${id}`,
    path: `/tmp/${id}`,
    connected,
    settings: { sidebarCollapsed: false },
  };
}

function modelListResponse(model: string) {
  return {
    result: {
      data: [
        {
          id: model,
          model,
          displayName: model,
          description: "",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          isDefault: false,
        },
      ],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushHookUpdates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSettingsDefaultModels", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("uses ADG runtime models without a workspace", async () => {
    getRuntimeModelListMock.mockResolvedValueOnce({
      object: "list",
      data: [
        { id: "adg-pro", object: "model", display_name: "ADG Pro" },
        { id: "adg-lite", object: "model", display_name: "ADG Lite" },
      ],
    });

    const { result } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [],
        },
      },
    );

    await waitFor(() => {
      expect(result.current.models.map((model) => model.id)).toEqual([
        "adg-pro",
        "adg-lite",
      ]);
    });
    expect(result.current.models[0]?.displayName).toBe("ADG Pro");
    expect(getModelListMock).not.toHaveBeenCalled();
    expect(connectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("does not fall back to workspace models when ADG runtime catalog is empty", async () => {
    getRuntimeModelListMock.mockResolvedValueOnce({
      object: "list",
      data: [],
    });

    const { result } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [workspace("w1", true)],
        },
      },
    );

    await waitFor(() => expect(getRuntimeModelListMock).toHaveBeenCalled());
    await flushHookUpdates();

    expect(result.current.models).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.connectedWorkspaceCount).toBe(1);
    expect(getModelListMock).not.toHaveBeenCalled();
    expect(getConfigModelMock).not.toHaveBeenCalled();
    expect(connectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("refreshes ADG runtime models every minute", async () => {
    vi.useFakeTimers();
    getRuntimeModelListMock
      .mockResolvedValueOnce({
        object: "list",
        data: [{ id: "adg-pro", object: "model", display_name: "ADG Pro" }],
      })
      .mockResolvedValueOnce({
        object: "list",
        data: [{ id: "adg-lite", object: "model", display_name: "ADG Lite" }],
      });

    const { result } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [],
        },
      },
    );

    await flushHookUpdates();

    expect(result.current.models[0]?.id).toBe("adg-pro");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await flushHookUpdates();

    expect(getRuntimeModelListMock).toHaveBeenCalledTimes(2);
    expect(result.current.models[0]?.id).toBe("adg-lite");
  });

  it("invalidates in-flight results when workspace list becomes empty", async () => {
    getRuntimeModelListMock.mockRejectedValue(new Error("runtime missing"));
    const pending = deferred<any>();
    getModelListMock.mockReturnValueOnce(pending.promise);
    getConfigModelMock.mockResolvedValueOnce(null);

    const { result, rerender } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [workspace("w1", true)],
        },
      },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
      expect(result.current.connectedWorkspaceCount).toBe(1);
    });

    rerender({ projects: [] });

    await waitFor(() => {
      expect(result.current.models).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.connectedWorkspaceCount).toBe(0);
    });

    await act(async () => {
      pending.resolve(modelListResponse("gpt-5"));
      await Promise.resolve();
    });

    expect(result.current.models).toEqual([]);
    expect(result.current.connectedWorkspaceCount).toBe(0);
  });

  it("ignores stale results when the first workspace changes", async () => {
    getRuntimeModelListMock.mockRejectedValue(new Error("runtime missing"));
    const first = deferred<any>();
    const second = deferred<any>();
    getModelListMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    getConfigModelMock.mockResolvedValue(null);

    const { result, rerender } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [workspace("w1", true)],
        },
      },
    );

    await waitFor(() => {
      expect(getModelListMock).toHaveBeenCalledWith("w1");
    });

    rerender({ projects: [workspace("w2", true)] });

    await waitFor(() => {
      expect(getModelListMock).toHaveBeenCalledWith("w2");
    });

    await act(async () => {
      second.resolve(modelListResponse("gpt-5.1"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.models[0]?.model).toBe("gpt-5.1");
    });

    await act(async () => {
      first.resolve(modelListResponse("gpt-4.1"));
      await Promise.resolve();
    });

    expect(result.current.models[0]?.model).toBe("gpt-5.1");
  });

  it("uses the first workspace as the model source even when disconnected", async () => {
    getRuntimeModelListMock.mockRejectedValue(new Error("runtime missing"));
    connectWorkspaceMock.mockResolvedValueOnce(undefined);
    getConfigModelMock.mockResolvedValueOnce(null);
    getModelListMock.mockResolvedValueOnce(modelListResponse("gpt-5.1"));

    const { result } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [workspace("w1", false), workspace("w2", true)],
        },
      },
    );

    await waitFor(() => {
      expect(connectWorkspaceMock).toHaveBeenCalledWith("w1");
      expect(getModelListMock).toHaveBeenCalledWith("w1");
      expect(getModelListMock).not.toHaveBeenCalledWith("w2");
      expect(result.current.models[0]?.model).toBe("gpt-5.1");
    });
  });

  it("falls back to config model when model list cannot be fetched", async () => {
    getRuntimeModelListMock.mockRejectedValue(new Error("runtime missing"));
    connectWorkspaceMock.mockRejectedValueOnce(new Error("connect failed"));
    getConfigModelMock.mockResolvedValueOnce("gpt-5-codex");

    const { result } = renderHook(
      ({ projects }: { projects: WorkspaceInfo[] }) => useSettingsDefaultModels(projects),
      {
        initialProps: {
          projects: [workspace("w1", false)],
        },
      },
    );

    await waitFor(() => {
      expect(result.current.models[0]?.model).toBe("gpt-5-codex");
      expect(result.current.models[0]?.displayName).toContain("(config)");
      expect(getModelListMock).not.toHaveBeenCalled();
    });
  });
});
