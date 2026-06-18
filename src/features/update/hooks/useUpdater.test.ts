// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DebugEntry } from "../../../types";
import { useUpdater } from "./useUpdater";
import { STORAGE_KEY_PENDING_POST_UPDATE_VERSION } from "../utils/postUpdateRelease";
import {
  STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN,
  STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
} from "../utils/updateDemoGuides";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);
const fetchMock = vi.fn();

describe("useUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sets error state when update check fails", async () => {
    checkMock.mockRejectedValue(new Error("nope"));
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(result.current.state.stage).toBe("error");
    expect(result.current.state.error).toBe("nope");
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: expect.any(Number),
        label: "updater/error",
        source: "error",
        payload: "nope",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("returns to idle when no update is available", async () => {
    checkMock.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useUpdater({ autoCheckOnMount: false }),
    );

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(result.current.state.stage).toBe("idle");
  });

  it("announces when no update is available for manual checks", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useUpdater({ autoCheckOnMount: false }),
    );

    await act(async () => {
      await result.current.checkForUpdates({ announceNoUpdate: true });
    });

    expect(result.current.state.stage).toBe("latest");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.state.stage).toBe("idle");
  });

  it("downloads, installs, and restarts when update is available", async () => {
    const close = vi.fn();
    const download = vi.fn(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished", data: {} });
    });
    const install = vi.fn(async () => undefined);
    checkMock.mockResolvedValue({
      version: "1.2.3",
      download,
      install,
      close,
    } as any);

    const { result } = renderHook(() =>
      useUpdater({ autoCheckOnMount: false }),
    );

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(result.current.state.stage).toBe("available");
    expect(result.current.state.version).toBe("1.2.3");

    await act(async () => {
      await result.current.startUpdate();
    });

    await waitFor(() => expect(result.current.state.stage).toBe("restarting"));
    expect(result.current.state.progress?.totalBytes).toBe(100);
    expect(result.current.state.progress?.downloadedBytes).toBe(100);
    expect(download).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBe("1.2.3");
  });

  it("cancels an in-flight download without installing or relaunching", async () => {
    const close = vi.fn();
    const install = vi.fn(async () => undefined);
    let emitProgress: ((event: any) => void) | null = null;
    let resolveDownload: (() => void) | null = null;
    const download = vi.fn(
      (onEvent: (event: any) => void) =>
        new Promise<void>((resolve) => {
          emitProgress = onEvent;
          resolveDownload = resolve;
          onEvent({ event: "Started", data: { contentLength: 100 } });
          onEvent({ event: "Progress", data: { chunkLength: 30 } });
        }),
    );
    checkMock.mockResolvedValue({
      version: "3.0.0",
      download,
      install,
      close,
    } as any);
    const { result } = renderHook(() => useUpdater({ autoCheckOnMount: false }));

    await act(async () => {
      await result.current.startUpdate();
    });
    await act(async () => {
      void result.current.startUpdate();
    });
    expect(result.current.state.stage).toBe("downloading");

    // User cancels mid-download → collapses back to the reminder pill.
    await act(async () => {
      result.current.cancelUpdate();
    });
    expect(result.current.state).toMatchObject({
      stage: "available",
      version: "3.0.0",
      dismissed: true,
    });

    // The background download completes afterwards but must be discarded:
    // no install, no relaunch, and the UI stays on the pill.
    await act(async () => {
      emitProgress?.({ event: "Progress", data: { chunkLength: 70 } });
      emitProgress?.({ event: "Finished", data: {} });
      resolveDownload?.();
    });
    expect(install).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      stage: "available",
      dismissed: true,
    });
    // The superseded handle is released when its background download settles.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("retries on a fresh handle after cancel without reusing the stale one", async () => {
    const close = vi.fn();
    const install = vi.fn(async () => undefined);
    let resolveFirstDownload: (() => void) | null = null;
    const firstDownload = vi.fn(
      (onEvent: (event: any) => void) =>
        new Promise<void>((resolve) => {
          resolveFirstDownload = resolve;
          onEvent({ event: "Started", data: { contentLength: 100 } });
        }),
    );
    const secondDownload = vi.fn(async () => undefined);
    const firstHandle = {
      version: "3.0.0",
      download: firstDownload,
      install,
      close,
    };
    const secondHandle = {
      version: "3.0.0",
      download: secondDownload,
      install,
      close: vi.fn(),
    };
    checkMock
      .mockResolvedValueOnce(firstHandle as any)
      .mockResolvedValueOnce(secondHandle as any);
    const { result } = renderHook(() => useUpdater({ autoCheckOnMount: false }));

    // First check + start download, then cancel mid-flight.
    await act(async () => {
      await result.current.startUpdate();
    });
    await act(async () => {
      void result.current.startUpdate();
    });
    await act(async () => {
      result.current.cancelUpdate();
    });

    // Retry: must run a fresh check() and never touch the stale handle again.
    await act(async () => {
      await result.current.startUpdate();
    });
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(firstDownload).toHaveBeenCalledTimes(1);

    // The stale first download settling afterwards stays harmless.
    await act(async () => {
      resolveFirstDownload?.();
    });
    expect(secondDownload).not.toHaveBeenCalled();
  });

  it("keeps an available update as a dismissed reminder", async () => {
    const close = vi.fn();
    const download = vi.fn(async () => undefined);
    const install = vi.fn(async () => undefined);
    checkMock.mockResolvedValue({
      version: "1.0.0",
      download,
      install,
      close,
    } as any);
    const { result } = renderHook(() => useUpdater({}));

    await act(async () => {
      await result.current.startUpdate();
    });

    await act(async () => {
      await result.current.dismiss();
    });

    expect(result.current.state).toMatchObject({
      stage: "available",
      version: "1.0.0",
      dismissed: true,
    });
    expect(close).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(download).toHaveBeenCalledTimes(1);
  });

  it("fully closes the update when the reminder pill is dismissed", async () => {
    const close = vi.fn();
    const download = vi.fn(async () => undefined);
    const install = vi.fn(async () => undefined);
    checkMock.mockResolvedValue({
      version: "1.0.0",
      download,
      install,
      close,
    } as any);
    const { result } = renderHook(() => useUpdater({}));

    await act(async () => {
      await result.current.startUpdate();
    });

    // First dismiss collapses into the persistent reminder pill.
    await act(async () => {
      await result.current.dismiss();
    });
    expect(result.current.state).toMatchObject({ dismissed: true });
    expect(close).not.toHaveBeenCalled();

    // Dismissing the pill itself closes the update and returns to idle.
    await act(async () => {
      await result.current.dismiss();
    });
    expect(result.current.state.stage).toBe("idle");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("surfaces download errors and keeps progress", async () => {
    const close = vi.fn();
    const download = vi.fn(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 50 } });
      onEvent({ event: "Progress", data: { chunkLength: 20 } });
      throw new Error("download failed");
    });
    const install = vi.fn(async () => undefined);
    checkMock.mockResolvedValue({
      version: "2.0.0",
      download,
      install,
      close,
    } as any);
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.startUpdate();
    });

    await act(async () => {
      await result.current.startUpdate();
    });

    await waitFor(() => expect(result.current.state.stage).toBe("error"));
    expect(result.current.state.error).toBe("download failed");
    expect(result.current.state.progress?.downloadedBytes).toBe(20);
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: expect.any(Number),
        label: "updater/error",
        source: "error",
        payload: "download failed",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("does not run updater workflow when disabled", async () => {
    checkMock.mockResolvedValue({
      version: "9.9.9",
      download: vi.fn(),
      install: vi.fn(),
      close: vi.fn(),
    } as any);
    const { result } = renderHook(() => useUpdater({ enabled: false }));

    await act(async () => {
      await result.current.checkForUpdates({ announceNoUpdate: true });
      await result.current.startUpdate();
    });

    expect(checkMock).not.toHaveBeenCalled();
    expect(result.current.state.stage).toBe("idle");
  });

  it("skips automatic startup checks when auto-check is disabled but still allows manual checks", async () => {
    checkMock.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useUpdater({ autoCheckOnMount: false }),
    );

    expect(checkMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.checkForUpdates({ announceNoUpdate: true });
    });

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.stage).toBe("latest");
  });

  it("shows the configured post-update demo before fetching release notes", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );

    const { result } = renderHook(() => useUpdater({}));

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.featureId).toBe(
        "release-control-console-demo",
      ),
    );

    expect(result.current.postUpdateNotice).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the first-launch guide before post-update release notes when eligible", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );

    const { result } = renderHook(() =>
      useUpdater({ firstLaunchGuideEligible: true }),
    );

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.featureId).toBe(
        "first-launch-core-workflow",
      ),
    );

    expect(result.current.postUpdateDemoGuide?.kind).toBe("firstLaunch");
    expect(result.current.postUpdateNotice).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBe(__APP_VERSION__);
  });

  it("dismisses the first-launch guide without clearing the pending post-update marker", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );

    const { result } = renderHook(() =>
      useUpdater({ firstLaunchGuideEligible: true }),
    );

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.kind).toBe("firstLaunch"),
    );

    await act(async () => {
      result.current.dismissPostUpdateDemoGuide();
    });

    expect(window.localStorage.getItem(STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN)).toBe(
      "true",
    );
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBe(__APP_VERSION__);
  });

  it("shows the current major update demo even without a pending post-update marker", async () => {
    const { result } = renderHook(() =>
      useUpdater({ firstLaunchGuideEligible: false }),
    );

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.featureId).toBe(
        "release-control-console-demo",
      ),
    );

    expect(result.current.postUpdateDemoGuide?.kind).toBe("postUpdate");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not show the current major update demo after the version has been seen", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
      JSON.stringify([__APP_VERSION__]),
    );

    const { result } = renderHook(() =>
      useUpdater({ firstLaunchGuideEligible: false }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.postUpdateDemoGuide).toBeNull();
  });

  it("shows the current major update demo after the first-launch guide is dismissed", async () => {
    const { result } = renderHook(() =>
      useUpdater({ firstLaunchGuideEligible: true }),
    );

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.kind).toBe("firstLaunch"),
    );

    await act(async () => {
      result.current.dismissPostUpdateDemoGuide();
    });

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.featureId).toBe(
        "release-control-console-demo",
      ),
    );
    expect(result.current.postUpdateDemoGuide?.kind).toBe("postUpdate");
  });

  it("dismisses the post-update demo and marks the version as seen", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );

    const { result } = renderHook(() => useUpdater({}));

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.version).toBe(__APP_VERSION__),
    );

    await act(async () => {
      result.current.dismissPostUpdateDemoGuide();
    });

    expect(result.current.postUpdateDemoGuide).toBeNull();
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS) ?? "[]",
      ),
    ).toEqual([__APP_VERSION__]);
  });

  it("marks the post-update demo as seen when trying the feature", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );

    const { result } = renderHook(() => useUpdater({}));

    await waitFor(() =>
      expect(result.current.postUpdateDemoGuide?.version).toBe(__APP_VERSION__),
    );

    await act(async () => {
      result.current.tryPostUpdateDemoGuide();
    });

    expect(result.current.postUpdateDemoGuide).toBeNull();
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS) ?? "[]",
      ),
    ).toEqual([__APP_VERSION__]);
  });

  it("loads post-update release notes after restart when the current demo was already seen", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );
    window.localStorage.setItem(
      STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
      JSON.stringify([__APP_VERSION__]),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "## New\n- Added updater notes",
    } as Response);

    const { result } = renderHook(() => useUpdater({}));

    await waitFor(() =>
      expect(result.current.postUpdateNotice?.stage).toBe("ready"),
    );

    expect(result.current.postUpdateNotice).toMatchObject({
      stage: "ready",
      version: __APP_VERSION__,
      htmlUrl: `https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/${__APP_VERSION__}/release-notes.md`,
      body: "## New\n- Added updater notes",
    });

    await act(async () => {
      result.current.dismissPostUpdateNotice();
    });
    expect(result.current.postUpdateNotice).toBeNull();
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBeNull();
  });

  it("shows post-update fallback when release notes fetch fails", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );
    window.localStorage.setItem(
      STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
      JSON.stringify([__APP_VERSION__]),
    );
    fetchMock.mockRejectedValue(new Error("offline"));
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await waitFor(() =>
      expect(result.current.postUpdateNotice?.stage).toBe("fallback"),
    );

    expect(result.current.postUpdateNotice).toMatchObject({
      stage: "fallback",
      version: __APP_VERSION__,
      htmlUrl: `https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/${__APP_VERSION__}/release-notes.md`,
    });
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "updater/release-notes-error",
        source: "error",
      }),
    );
  });

  it("does not reopen post-update toast after dismissing during loading", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      __APP_VERSION__,
    );
    window.localStorage.setItem(
      STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
      JSON.stringify([__APP_VERSION__]),
    );

    let resolveFetch: ((value: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve as (value: Response) => void;
        }),
    );

    const { result } = renderHook(() => useUpdater({}));

    await waitFor(() =>
      expect(result.current.postUpdateNotice?.stage).toBe("loading"),
    );

    await act(async () => {
      result.current.dismissPostUpdateNotice();
    });

    expect(result.current.postUpdateNotice).toBeNull();
    expect(
      window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
    ).toBeNull();

    await act(async () => {
      resolveFetch?.({
        ok: true,
        status: 200,
        text: async () => "## Notes",
      } as Response);
      await Promise.resolve();
    });

    expect(result.current.postUpdateNotice).toBeNull();
  });

  it("clears stale post-update marker when version does not match current app", async () => {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      "0.0.1",
    );

    const { result } = renderHook(() => useUpdater({}));

    await waitFor(() =>
      expect(
        window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION),
      ).toBeNull(),
    );
    expect(result.current.postUpdateNotice).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
