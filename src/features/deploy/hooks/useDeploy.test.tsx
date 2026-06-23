// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeployApp } from "@/types";
import { deployApp, deployBuildLog, deployStatus } from "@services/tauri";
import { useDeploy } from "./useDeploy";

vi.mock("@services/tauri", () => ({
  deployApp: vi.fn(),
  deployStatus: vi.fn(),
  deployBuildLog: vi.fn(),
}));

function mkApp(over: Partial<DeployApp>): DeployApp {
  return {
    appId: "a1",
    name: "x",
    status: "pending",
    deployStatus: "pending",
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useDeploy", () => {
  it("goes straight to running when create returns a running app", async () => {
    vi.mocked(deployApp).mockResolvedValue(
      mkApp({ status: "running", deployStatus: "running", url: "http://x.sslip.io" }),
    );
    const { result } = renderHook(() => useDeploy("ws1"));

    await act(async () => {
      await result.current.deploy({ name: "x" });
    });

    expect(result.current.state.status).toBe("running");
    expect(result.current.state.app?.url).toBe("http://x.sslip.io");
    expect(result.current.state.error).toBeNull();
    expect(deployStatus).not.toHaveBeenCalled();
  });

  it("surfaces a call-level error and returns to idle (not a build failure)", async () => {
    vi.mocked(deployApp).mockRejectedValue("部署额度已用尽");
    const { result } = renderHook(() => useDeploy("ws1"));

    await act(async () => {
      await result.current.deploy({ name: "x" });
    });

    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.error).toContain("额度");
  });

  it("auto-loads the build log when the deploy fails", async () => {
    vi.mocked(deployApp).mockResolvedValue(
      mkApp({ status: "failed", deployStatus: "failed", errorMessage: "boom" }),
    );
    vi.mocked(deployBuildLog).mockResolvedValue("== build log ==");
    const { result } = renderHook(() => useDeploy("ws1"));

    await act(async () => {
      await result.current.deploy({ name: "x" });
    });

    await waitFor(() => expect(result.current.state.buildLog).toBe("== build log =="));
    expect(result.current.state.status).toBe("failed");
    expect(result.current.state.error).toBe("boom");
    expect(deployBuildLog).toHaveBeenCalledWith("ws1");
  });

  it("polls until the build reaches running", async () => {
    vi.useFakeTimers();
    vi.mocked(deployApp).mockResolvedValue(mkApp({ status: "building", deployStatus: "building" }));
    vi.mocked(deployStatus).mockResolvedValue(mkApp({ status: "running", deployStatus: "running" }));
    const { result } = renderHook(() => useDeploy("ws1"));

    await act(async () => {
      await result.current.deploy({ name: "x" });
    });
    expect(result.current.state.status).toBe("building");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.state.status).toBe("running");
    expect(deployStatus).toHaveBeenCalledWith("ws1");
  });
});
