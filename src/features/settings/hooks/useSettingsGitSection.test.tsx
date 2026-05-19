// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "@utils/commitMessagePrompt";
import { getGitRuntimeInfo } from "@/services/tauri";
import { useSettingsGitSection } from "./useSettingsGitSection";

vi.mock("@/services/tauri", () => ({
  getGitRuntimeInfo: vi.fn(),
}));

const appSettings = {
  commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
} as AppSettings;

describe("useSettingsGitSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGitRuntimeInfo).mockResolvedValue({
      available: true,
      source: "bundled",
      path: "/tmp/git",
      version: "git version 2.39.5",
      error: null,
    });
  });

  it("does not probe Git runtime until the version section is active", async () => {
    renderHook(() =>
      useSettingsGitSection({
        appSettings,
        onUpdateAppSettings: vi.fn(),
        models: [],
        enabled: false,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getGitRuntimeInfo).not.toHaveBeenCalled();
  });

  it("probes Git runtime after the version section becomes active", async () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useSettingsGitSection({
          appSettings,
          onUpdateAppSettings: vi.fn(),
          models: [],
          enabled,
        }),
      {
        initialProps: { enabled: false },
      },
    );

    rerender({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getGitRuntimeInfo).toHaveBeenCalledTimes(1);
  });
});
