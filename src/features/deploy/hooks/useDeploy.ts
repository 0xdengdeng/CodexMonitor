import { useCallback, useEffect, useRef, useState } from "react";

import type { DeployApp, DeployMetadata, DeployStatus } from "@/types";
import { deployApp, deployBuildLog, deployStatus } from "@services/tauri";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

export type DeployUiState = {
  status: DeployStatus;
  app: DeployApp | null;
  error: string | null;
  buildLog: string | null;
  buildLogLoading: boolean;
};

const INITIAL: DeployUiState = {
  status: "idle",
  app: null,
  error: null,
  buildLog: null,
  buildLogLoading: false,
};

/** A deploy reaches a stable end when the build settled, the app was stopped, or it was taken down. */
function isTerminal(app: DeployApp): boolean {
  if (app.status === "suspended") {
    return true;
  }
  return (
    app.deployStatus === "running" ||
    app.deployStatus === "failed" ||
    app.deployStatus === "stopped"
  );
}

function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}

/**
 * Drives one workspace's deploy lifecycle: create/redeploy -> poll until running|failed ->
 * auto-load the build log on failure. App-only (the backend command rejects in remote mode).
 */
export function useDeploy(workspaceId: string) {
  const [state, setState] = useState<DeployUiState>(INITIAL);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  const mounted = useRef(true);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearPoll();
    };
  }, [clearPoll]);

  // Stop polling and reset when switching workspaces.
  useEffect(() => {
    clearPoll();
    setState(INITIAL);
  }, [workspaceId, clearPoll]);

  const loadBuildLog = useCallback(async () => {
    setState((prev) => ({ ...prev, buildLogLoading: true }));
    try {
      const log = await deployBuildLog(workspaceId);
      if (!mounted.current) return;
      setState((prev) => ({ ...prev, buildLog: log, buildLogLoading: false }));
    } catch (err) {
      if (!mounted.current) return;
      setState((prev) => ({ ...prev, buildLogLoading: false, error: errorText(err) }));
    }
  }, [workspaceId]);

  /** Fold a fresh DeployApp into state; returns whether the lifecycle is terminal. */
  const applyApp = useCallback(
    (app: DeployApp): boolean => {
      setState((prev) => ({
        ...prev,
        app,
        status: app.status,
        error: app.deployStatus === "failed" ? app.errorMessage ?? prev.error : prev.error,
      }));
      if (app.deployStatus === "failed") {
        void loadBuildLog();
      }
      return isTerminal(app);
    },
    [loadBuildLog],
  );

  const poll = useCallback(() => {
    clearPoll();
    pollTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const app = await deployStatus(workspaceId);
          if (!mounted.current) return;
          if (applyApp(app)) return;
          if (Date.now() >= deadline.current) {
            setState((prev) => ({
              ...prev,
              status: "failed",
              error: "部署超时（15 分钟未完成），请到控制台查看或重试。",
            }));
            return;
          }
          poll();
        } catch (err) {
          if (!mounted.current) return;
          setState((prev) => ({ ...prev, error: errorText(err) }));
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [workspaceId, applyApp, clearPoll]);

  const deploy = useCallback(
    async (metadata: DeployMetadata) => {
      clearPoll();
      setState((prev) => ({ ...prev, status: "uploading", error: null, buildLog: null }));
      try {
        const app = await deployApp(workspaceId, metadata);
        if (!mounted.current) return;
        if (!applyApp(app)) {
          deadline.current = Date.now() + POLL_TIMEOUT_MS;
          poll();
        }
      } catch (err) {
        if (!mounted.current) return;
        // A call-level failure (quota/token/network) is not a build failure: surface it and
        // return to idle so the user can fix and retry.
        setState((prev) => ({ ...prev, status: "idle", error: errorText(err) }));
      }
    },
    [workspaceId, applyApp, poll, clearPoll],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const app = await deployStatus(workspaceId);
      if (!mounted.current) return;
      applyApp(app);
    } catch (err) {
      if (!mounted.current) return;
      setState((prev) => ({ ...prev, error: errorText(err) }));
    }
  }, [workspaceId, applyApp]);

  return { state, deploy, refreshStatus, loadBuildLog };
}
