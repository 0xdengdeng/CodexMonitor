import { useEffect } from "react";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import type { DeployStatus, WorkspaceDeployState } from "@/types";
import { useI18n } from "@/features/i18n/i18n";
import { useDeploy } from "../hooks/useDeploy";

export type DeployPanelProps = {
  workspaceId: string | null;
  deployState: WorkspaceDeployState | null;
  backendMode: "local" | "remote";
};

const STATUS_KEYS: Record<DeployStatus, string> = {
  idle: "deploy.status.idle",
  uploading: "deploy.status.uploading",
  pending: "deploy.status.pending",
  building: "deploy.status.building",
  running: "deploy.status.running",
  failed: "deploy.status.failed",
  stopped: "deploy.status.stopped",
  suspended: "deploy.status.suspended",
};

function isInProgress(status: DeployStatus): boolean {
  return status === "uploading" || status === "pending" || status === "building";
}

/**
 * Deploy tab content for one workspace. Rendered inside the right-panel PanelShell only when the
 * deploy tab is active. App-only: in remote mode it shows the unsupported note. All lifecycle logic
 * lives in `useDeploy`; a missing token surfaces as the backend's actionable error on first deploy.
 */
export function DeployPanel({ workspaceId, deployState, backendMode }: DeployPanelProps) {
  const { t } = useI18n();
  // workspaceId is only null when no workspace is active (the right panel is hidden then), so the
  // "" sentinel never reaches a backend call.
  const { state, deploy, refreshStatus, loadBuildLog } = useDeploy(workspaceId ?? "");
  const hasBinding = Boolean(deployState?.appId);

  // Pull the live status for an already-bound app when the deploy tab mounts.
  useEffect(() => {
    if (backendMode === "remote" || !hasBinding) {
      return;
    }
    void refreshStatus();
  }, [backendMode, hasBinding, refreshStatus]);

  if (!workspaceId) {
    return (
      <div className="deploy-tab">
        <p className="deploy-tab-note">{t("deploy.notDeployed")}</p>
      </div>
    );
  }

  if (backendMode === "remote") {
    return (
      <div className="deploy-tab">
        <p className="deploy-tab-note">{t("deploy.remoteUnsupported")}</p>
      </div>
    );
  }

  const app = state.app;
  const status = state.status;
  const busy = isInProgress(status);
  const url = app?.url ?? null;
  const displayName = app?.name ?? deployState?.appName ?? null;
  const showLogSection =
    status === "failed" || Boolean(state.buildLog) || state.buildLogLoading;

  return (
    <div className="deploy-tab">
      <div className="deploy-tab-status-row">
        <span className={`deploy-status-badge deploy-status-${status}`}>
          {busy ? <Loader2 className="deploy-spin" size={12} aria-hidden /> : null}
          {t(STATUS_KEYS[status])}
        </span>
        {hasBinding ? (
          <button
            type="button"
            className="ghost icon-button deploy-tab-refresh"
            onClick={() => void refreshStatus()}
            aria-label={t("deploy.refresh")}
            title={t("deploy.refresh")}
          >
            <RefreshCw size={13} aria-hidden />
          </button>
        ) : null}
      </div>

      {displayName ? (
        <div className="deploy-tab-name">{displayName}</div>
      ) : (
        <p className="deploy-tab-note">{t("deploy.notDeployed")}</p>
      )}

      {url ? (
        <a
          className="deploy-tab-url"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={13} aria-hidden />
          <span>{t("deploy.open")}</span>
        </a>
      ) : null}

      {state.error ? <div className="deploy-tab-error">{state.error}</div> : null}

      <div className="deploy-tab-actions">
        <button
          type="button"
          className="button deploy-tab-deploy"
          onClick={() => void deploy({ name: "" })}
          disabled={busy}
        >
          {busy
            ? t("deploy.deploying")
            : hasBinding
              ? t("deploy.redeploy")
              : t("deploy.deploy")}
        </button>
      </div>

      {showLogSection ? (
        <div className="deploy-tab-log-section">
          <div className="deploy-tab-log-head">
            <span className="deploy-tab-log-title">{t("deploy.buildLog")}</span>
            <button
              type="button"
              className="ghost deploy-tab-log-refresh"
              onClick={() => void loadBuildLog()}
              disabled={state.buildLogLoading || !app?.deploymentId}
            >
              {t("deploy.viewLog")}
            </button>
          </div>
          {state.buildLog ? (
            <pre className="deploy-tab-log">{state.buildLog}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
