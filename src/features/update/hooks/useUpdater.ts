import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import type { DebugEntry } from "../../../types";
import {
  buildReleaseTagUrl,
  clearPendingPostUpdateVersion,
  fetchReleaseNotesForVersion,
  loadPendingPostUpdateVersion,
  normalizeReleaseVersion,
  savePendingPostUpdateVersion,
} from "../utils/postUpdateRelease";
import {
  hasSeenFirstLaunchGuide,
  hasSeenUpdateDemoGuide,
  markFirstLaunchGuideSeen,
  markUpdateDemoGuideSeen,
  resolveFirstLaunchDemoGuide,
  resolveUpdateDemoGuide,
  type UpdateDemoGuide,
} from "../utils/updateDemoGuides";

type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "latest"
  | "error";

type UpdateProgress = {
  totalBytes?: number;
  downloadedBytes: number;
};

export type UpdateState = {
  stage: UpdateStage;
  version?: string;
  progress?: UpdateProgress;
  error?: string;
  dismissed?: boolean;
};

type PostUpdateNotice =
  | {
      stage: "loading";
      version: string;
      htmlUrl: string;
    }
  | {
      stage: "ready";
      version: string;
      body: string;
      htmlUrl: string;
    }
  | {
      stage: "fallback";
      version: string;
      htmlUrl: string;
    };

export type PostUpdateNoticeState = PostUpdateNotice | null;

export type PostUpdateDemoGuideState = UpdateDemoGuide | null;

type UseUpdaterOptions = {
  enabled?: boolean;
  autoCheckOnMount?: boolean;
  firstLaunchGuideEligible?: boolean;
  onDebug?: (entry: DebugEntry) => void;
};

export function useUpdater({
  enabled = true,
  autoCheckOnMount = true,
  firstLaunchGuideEligible = false,
  onDebug,
}: UseUpdaterOptions) {
  const [state, setState] = useState<UpdateState>({ stage: "idle" });
  const [postUpdateNotice, setPostUpdateNotice] = useState<PostUpdateNoticeState>(
    null,
  );
  const [postUpdateDemoGuide, setPostUpdateDemoGuide] =
    useState<PostUpdateDemoGuideState>(null);
  const stateRef = useRef<UpdateState>({ stage: "idle" });
  const updateRef = useRef<Update | null>(null);
  const hasAttemptedAutoCheckRef = useRef(false);
  const postUpdateFetchGenerationRef = useRef(0);
  const latestTimeoutRef = useRef<number | null>(null);
  const [demoGuideCheckNonce, setDemoGuideCheckNonce] = useState(0);
  const latestToastDurationMs = 2000;

  const clearLatestTimeout = useCallback(() => {
    if (latestTimeoutRef.current !== null) {
      window.clearTimeout(latestTimeoutRef.current);
      latestTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resetToIdle = useCallback(async () => {
    clearLatestTimeout();
    // First dismiss of an available update collapses it into a persistent
    // reminder pill; dismissing the pill itself fully closes the update.
    if (stateRef.current.stage === "available" && !stateRef.current.dismissed) {
      const nextState = {
        ...stateRef.current,
        dismissed: true,
      };
      stateRef.current = nextState;
      setState(nextState);
      return;
    }
    const update = updateRef.current;
    updateRef.current = null;
    stateRef.current = { stage: "idle" };
    setState({ stage: "idle" });
    await update?.close();
  }, [clearLatestTimeout]);

  const checkForUpdates = useCallback(async (options?: { announceNoUpdate?: boolean }) => {
    if (!enabled) {
      return;
    }
    let update: Awaited<ReturnType<typeof check>> | null = null;
    try {
      clearLatestTimeout();
      setState({ stage: "checking" });
      update = await check();
      if (!update) {
        if (options?.announceNoUpdate) {
          setState({ stage: "latest" });
          latestTimeoutRef.current = window.setTimeout(() => {
            latestTimeoutRef.current = null;
            setState({ stage: "idle" });
          }, latestToastDurationMs);
        } else {
          setState({ stage: "idle" });
        }
        return;
      }

      updateRef.current = update;
      setState({
        stage: "available",
        version: update.version,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      onDebug?.({
        id: `${Date.now()}-client-updater-error`,
        timestamp: Date.now(),
        source: "error",
        label: "updater/error",
        payload: message,
      });
      setState({ stage: "error", error: message });
    } finally {
      if (!updateRef.current) {
        await update?.close();
      }
    }
  }, [clearLatestTimeout, enabled, onDebug]);

  const startUpdate = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const update = updateRef.current;
    if (!update) {
      await checkForUpdates();
      return;
    }

    setState((prev) => ({
      ...prev,
      stage: "downloading",
      progress: { totalBytes: undefined, downloadedBytes: 0 },
      error: undefined,
    }));

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setState((prev) => ({
            ...prev,
            progress: {
              totalBytes: event.data.contentLength,
              downloadedBytes: 0,
            },
          }));
          return;
        }

        if (event.event === "Progress") {
          setState((prev) => ({
            ...prev,
            progress: {
              totalBytes: prev.progress?.totalBytes,
              downloadedBytes:
                (prev.progress?.downloadedBytes ?? 0) + event.data.chunkLength,
            },
          }));
          return;
        }

        if (event.event === "Finished") {
          setState((prev) => ({
            ...prev,
            stage: "installing",
          }));
        }
      });

      setState((prev) => ({
        ...prev,
        stage: "restarting",
      }));
      savePendingPostUpdateVersion(update.version);
      await relaunch();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      onDebug?.({
        id: `${Date.now()}-client-updater-error`,
        timestamp: Date.now(),
        source: "error",
        label: "updater/error",
        payload: message,
      });
      setState((prev) => ({
        ...prev,
        stage: "error",
        error: message,
      }));
    }
  }, [checkForUpdates, enabled, onDebug]);

  useEffect(() => {
    if (!enabled || !autoCheckOnMount || import.meta.env.DEV || !isTauri()) {
      return;
    }
    if (hasAttemptedAutoCheckRef.current) {
      return;
    }
    hasAttemptedAutoCheckRef.current = true;
    void checkForUpdates();
  }, [autoCheckOnMount, checkForUpdates, enabled]);

  useEffect(() => {
    if (!enabled || !isTauri()) {
      return;
    }

    const normalizedCurrentVersion = normalizeReleaseVersion(__APP_VERSION__);
    const showCurrentMajorDemo = () => {
      if (!normalizedCurrentVersion) {
        return false;
      }
      const currentDemoGuide = resolveUpdateDemoGuide(normalizedCurrentVersion);
      if (
        currentDemoGuide &&
        !hasSeenUpdateDemoGuide(normalizedCurrentVersion)
      ) {
        postUpdateFetchGenerationRef.current += 1;
        setPostUpdateNotice(null);
        setPostUpdateDemoGuide(currentDemoGuide);
        return true;
      }
      return false;
    };

    if (firstLaunchGuideEligible && !hasSeenFirstLaunchGuide()) {
      const firstLaunchGuide = resolveFirstLaunchDemoGuide();
      if (firstLaunchGuide) {
        postUpdateFetchGenerationRef.current += 1;
        setPostUpdateNotice(null);
        setPostUpdateDemoGuide(firstLaunchGuide);
        return;
      }
    }

    const pendingVersion = loadPendingPostUpdateVersion();
    if (!pendingVersion) {
      showCurrentMajorDemo();
      return;
    }

    const normalizedPendingVersion = normalizeReleaseVersion(pendingVersion);
    if (
      !normalizedPendingVersion ||
      normalizedPendingVersion !== normalizedCurrentVersion
    ) {
      clearPendingPostUpdateVersion();
      showCurrentMajorDemo();
      return;
    }

    const fallbackUrl = buildReleaseTagUrl(normalizedPendingVersion);
    const demoGuide = resolveUpdateDemoGuide(normalizedPendingVersion);
    if (demoGuide && !hasSeenUpdateDemoGuide(normalizedPendingVersion)) {
      setPostUpdateNotice(null);
      setPostUpdateDemoGuide(demoGuide);
      return;
    }

    const generation = postUpdateFetchGenerationRef.current + 1;
    postUpdateFetchGenerationRef.current = generation;
    let cancelled = false;
    setPostUpdateNotice({
      stage: "loading",
      version: normalizedPendingVersion,
      htmlUrl: fallbackUrl,
    });

    void fetchReleaseNotesForVersion(normalizedPendingVersion)
      .then((releaseInfo) => {
        if (
          cancelled ||
          postUpdateFetchGenerationRef.current !== generation
        ) {
          return;
        }
        if (releaseInfo.body) {
          setPostUpdateNotice({
            stage: "ready",
            version: normalizedPendingVersion,
            body: releaseInfo.body,
            htmlUrl: releaseInfo.htmlUrl,
          });
          return;
        }
        setPostUpdateNotice({
          stage: "fallback",
          version: normalizedPendingVersion,
          htmlUrl: releaseInfo.htmlUrl,
        });
      })
      .catch((error) => {
        if (
          cancelled ||
          postUpdateFetchGenerationRef.current !== generation
        ) {
          return;
        }
        const message =
          error instanceof Error ? error.message : JSON.stringify(error);
        onDebug?.({
          id: `${Date.now()}-client-updater-release-notes-error`,
          timestamp: Date.now(),
          source: "error",
          label: "updater/release-notes-error",
          payload: message,
        });
        setPostUpdateNotice({
          stage: "fallback",
          version: normalizedPendingVersion,
          htmlUrl: fallbackUrl,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [demoGuideCheckNonce, enabled, firstLaunchGuideEligible, onDebug]);

  useEffect(() => {
    return () => {
      clearLatestTimeout();
    };
  }, [clearLatestTimeout]);

  const dismissPostUpdateNotice = useCallback(() => {
    postUpdateFetchGenerationRef.current += 1;
    clearPendingPostUpdateVersion();
    setPostUpdateNotice(null);
  }, []);

  const dismissPostUpdateDemoGuide = useCallback(() => {
    const guide = postUpdateDemoGuide;
    const version = guide?.version;
    postUpdateFetchGenerationRef.current += 1;
    if (guide?.kind === "firstLaunch") {
      markFirstLaunchGuideSeen();
    } else if (version) {
      markUpdateDemoGuideSeen(version);
      clearPendingPostUpdateVersion();
    }
    setPostUpdateDemoGuide(null);
    setDemoGuideCheckNonce((value) => value + 1);
  }, [postUpdateDemoGuide]);

  const tryPostUpdateDemoGuide = useCallback(() => {
    dismissPostUpdateDemoGuide();
  }, [dismissPostUpdateDemoGuide]);

  return {
    state,
    startUpdate,
    checkForUpdates,
    dismiss: resetToIdle,
    postUpdateNotice,
    dismissPostUpdateNotice,
    postUpdateDemoGuide,
    dismissPostUpdateDemoGuide,
    tryPostUpdateDemoGuide,
  };
}
