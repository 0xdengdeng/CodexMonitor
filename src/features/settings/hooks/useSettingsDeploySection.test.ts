// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deployClearToken, deploySetToken, deployTokenStatus } from "@services/tauri";
import { useSettingsDeploySection } from "./useSettingsDeploySection";

vi.mock("@services/tauri", () => ({
  deployTokenStatus: vi.fn(),
  deploySetToken: vi.fn(),
  deployClearToken: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSettingsDeploySection", () => {
  it("reflects the configured status reported on mount", async () => {
    vi.mocked(deployTokenStatus).mockResolvedValue(true);
    const { result } = renderHook(() => useSettingsDeploySection("local"));

    await waitFor(() => expect(result.current.tokenConfigured).toBe(true));
  });

  it("skips the token probe in remote mode and reports unsupported", () => {
    const { result } = renderHook(() => useSettingsDeploySection("remote"));

    expect(result.current.remoteUnsupported).toBe(true);
    expect(deployTokenStatus).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("saves a trimmed token, marks it configured, and clears the draft", async () => {
    vi.mocked(deployTokenStatus).mockResolvedValue(false);
    vi.mocked(deploySetToken).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSettingsDeploySection("local"));
    await waitFor(() => expect(result.current.tokenConfigured).toBe(false));

    act(() => result.current.onTokenDraftChange("  sk-adgd_abc  "));
    await act(async () => {
      await result.current.onSaveToken();
    });

    expect(deploySetToken).toHaveBeenCalledWith("sk-adgd_abc");
    expect(result.current.tokenConfigured).toBe(true);
    expect(result.current.tokenDraft).toBe("");
    expect(result.current.error).toBeNull();
  });

  it("refuses to save an empty token", async () => {
    vi.mocked(deployTokenStatus).mockResolvedValue(false);
    const { result } = renderHook(() => useSettingsDeploySection("local"));
    await waitFor(() => expect(result.current.tokenConfigured).toBe(false));

    act(() => result.current.onTokenDraftChange("   "));
    await act(async () => {
      await result.current.onSaveToken();
    });

    expect(deploySetToken).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Enter a token first.");
  });

  it("clears the token", async () => {
    vi.mocked(deployTokenStatus).mockResolvedValue(true);
    vi.mocked(deployClearToken).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSettingsDeploySection("local"));
    await waitFor(() => expect(result.current.tokenConfigured).toBe(true));

    await act(async () => {
      await result.current.onClearToken();
    });

    expect(deployClearToken).toHaveBeenCalledTimes(1);
    expect(result.current.tokenConfigured).toBe(false);
  });
});
