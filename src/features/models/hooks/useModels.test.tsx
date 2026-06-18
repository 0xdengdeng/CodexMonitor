// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import {
  getConfigModel,
  getModelList,
  getRuntimeModelList,
} from "../../../services/tauri";
import { useModels } from "./useModels";

vi.mock("../../../services/tauri", () => ({
  getModelList: vi.fn(),
  getConfigModel: vi.fn(),
  getRuntimeModelList: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "CodexMonitor",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

async function flushHookUpdates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useModels", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("uses ADG runtime models without requiring a workspace", async () => {
    vi.mocked(getRuntimeModelList).mockResolvedValueOnce({
      object: "list",
      data: [
        {
          id: "adg-pro",
          object: "model",
          display_name: "ADG Pro",
          owned_by: "adg",
        },
      ],
    });

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("adg-pro"));

    expect(getModelList).not.toHaveBeenCalled();
    expect(getConfigModel).not.toHaveBeenCalled();
    expect(result.current.models[0]).toMatchObject({
      id: "adg-pro",
      model: "adg-pro",
      displayName: "ADG Pro",
    });
  });

  it("keeps models empty when runtime models are disabled", async () => {
    vi.mocked(getRuntimeModelList).mockResolvedValueOnce({
      object: "list",
      data: [
        {
          id: "adg-pro",
          object: "model",
          display_name: "ADG Pro",
          owned_by: "adg",
        },
      ],
    });

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: null, enabled: false }),
    );

    await flushHookUpdates();

    expect(getRuntimeModelList).not.toHaveBeenCalled();
    expect(result.current.models).toEqual([]);
    expect(result.current.selectedModelId).toBeNull();
  });

  it("treats an empty ADG runtime catalog as authoritative", async () => {
    vi.mocked(getRuntimeModelList).mockResolvedValueOnce({
      object: "list",
      data: [],
    });

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(getRuntimeModelList).toHaveBeenCalled());
    await flushHookUpdates();

    expect(result.current.models).toEqual([]);
    expect(result.current.selectedModelId).toBeNull();
    expect(getModelList).not.toHaveBeenCalled();
    expect(getConfigModel).not.toHaveBeenCalled();
  });

  it("does not fall back to workspace models when ADG fallback is disabled", async () => {
    vi.mocked(getRuntimeModelList).mockRejectedValueOnce(new Error("ADG unavailable"));
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "openai-model",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        allowWorkspaceFallback: false,
      }),
    );

    await waitFor(() => expect(getRuntimeModelList).toHaveBeenCalled());
    await flushHookUpdates();

    expect(result.current.models).toEqual([]);
    expect(result.current.selectedModelId).toBeNull();
    expect(getModelList).not.toHaveBeenCalled();
    expect(getConfigModel).not.toHaveBeenCalled();
  });

  it("refreshes ADG runtime models every minute", async () => {
    vi.useFakeTimers();
    vi.mocked(getRuntimeModelList)
      .mockResolvedValueOnce({
        object: "list",
        data: [{ id: "adg-pro", object: "model", display_name: "ADG Pro" }],
      })
      .mockResolvedValueOnce({
        object: "list",
        data: [{ id: "adg-lite", object: "model", display_name: "ADG Lite" }],
      });

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: null }),
    );

    await flushHookUpdates();

    expect(result.current.selectedModelId).toBe("adg-pro");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    await flushHookUpdates();

    expect(getRuntimeModelList).toHaveBeenCalledTimes(2);
    expect(result.current.selectedModelId).toBe("adg-lite");
  });

  it("adds the config model when it is missing from model/list", async () => {
    vi.mocked(getRuntimeModelList).mockRejectedValue(new Error("runtime missing"));
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(0));

    expect(getConfigModel).toHaveBeenCalledWith("workspace-1");
    expect(result.current.models[0]).toMatchObject({
      id: "custom-model",
      model: "custom-model",
    });
    expect(result.current.selectedModel?.model).toBe("custom-model");
    expect(result.current.reasoningSupported).toBe(false);
  });

  it("prefers the provider entry when the config model matches by slug", async () => {
    vi.mocked(getRuntimeModelList).mockRejectedValue(new Error("runtime missing"));
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "provider-id",
            model: "custom-model",
            displayName: "Provider Custom",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("provider-id"));

    expect(result.current.models).toHaveLength(1);
    expect(result.current.selectedModel?.id).toBe("provider-id");
    expect(result.current.reasoningSupported).toBe(true);
  });

  it("keeps the selected reasoning effort when switching models", async () => {
    vi.mocked(getRuntimeModelList).mockRejectedValue(new Error("runtime missing"));
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(1));

    act(() => {
      result.current.setSelectedEffort("high");
      result.current.setSelectedModelId("custom-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("custom-model");
      expect(result.current.selectedEffort).toBe("high");
    });
  });
});
