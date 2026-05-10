import type { MouseEvent } from "react";

import type { WorkspaceInfo } from "../../../types";
import { useI18n } from "@/features/i18n/i18n";

type WorkspaceCardProps = {
  workspace: WorkspaceInfo;
  workspaceName?: React.ReactNode;
  summary?: string | null;
  isActive: boolean;
  isCollapsed: boolean;
  addMenuOpen: boolean;
  addMenuWidth: number;
  onSelectWorkspace: (id: string) => void;
  onShowWorkspaceMenu: (event: MouseEvent, workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onToggleAddMenu: (anchor: {
    workspaceId: string;
    top: number;
    left: number;
    width: number;
  } | null) => void;
  children?: React.ReactNode;
};

export function WorkspaceCard({
  workspace,
  workspaceName,
  summary = null,
  isActive,
  isCollapsed,
  addMenuOpen,
  addMenuWidth,
  onSelectWorkspace,
  onShowWorkspaceMenu,
  onToggleWorkspaceCollapse,
  onConnectWorkspace,
  onToggleAddMenu,
  children,
}: WorkspaceCardProps) {
  const { t } = useI18n();
  const contentCollapsedClass = isCollapsed ? " collapsed" : "";
  const summaryId = summary ? `${workspace.id}-workspace-summary` : undefined;

  return (
    <div className="workspace-card">
      <div
        className={`workspace-row ${isActive ? "active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelectWorkspace(workspace.id)}
        onContextMenu={(event) => onShowWorkspaceMenu(event, workspace.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectWorkspace(workspace.id);
          }
        }}
        aria-describedby={summaryId}
      >
        <div className="workspace-copy">
          <div className="workspace-name-row">
            <div className="workspace-title">
              <span className="workspace-name">{workspaceName ?? workspace.name}</span>
              <button
                className={`workspace-toggle ${isCollapsed ? "" : "expanded"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleWorkspaceCollapse(workspace.id, !isCollapsed);
                }}
                data-tauri-drag-region="false"
                aria-label={
                  isCollapsed ? t("sidebar.workspace.showAgents") : t("sidebar.workspace.hideAgents")
                }
                aria-expanded={!isCollapsed}
                type="button"
              >
                <span className="workspace-toggle-icon">›</span>
              </button>
            </div>
          </div>
          {summary && (
            <div className="workspace-meta">
              <div className="workspace-summary workspace-meta-summary" id={summaryId}>
                {summary}
              </div>
            </div>
          )}
        </div>
        <div className="workspace-actions">
          <button
            className="ghost workspace-add"
            onClick={(event) => {
              event.stopPropagation();
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              const left = Math.min(
                Math.max(rect.left, 12),
                window.innerWidth - addMenuWidth - 12,
              );
              const top = rect.bottom + 8;
              onToggleAddMenu(
                addMenuOpen
                  ? null
                  : {
                      workspaceId: workspace.id,
                      top,
                      left,
                      width: addMenuWidth,
                    },
              );
            }}
            data-tauri-drag-region="false"
            aria-label={t("sidebar.workspace.addAgentOptions")}
            aria-expanded={addMenuOpen}
            type="button"
          >
            <span aria-hidden>+</span>
            <span>{t("sidebar.workspace.addAgent")}</span>
          </button>
          {!workspace.connected && (
            <span
              className="connect"
              title={t("sidebar.workspace.connectTitle")}
              onClick={(event) => {
                event.stopPropagation();
                onConnectWorkspace(workspace);
              }}
            >
              {t("sidebar.workspace.connect")}
            </span>
          )}
        </div>
      </div>
      <div
        className={`workspace-card-content${contentCollapsedClass}`}
        aria-hidden={isCollapsed}
        inert={isCollapsed ? true : undefined}
      >
        <div className="workspace-card-content-inner">{children}</div>
      </div>
    </div>
  );
}
