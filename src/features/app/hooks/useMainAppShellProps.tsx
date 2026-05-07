import { SidebarCollapseButton } from "@/features/layout/components/SidebarToggleControls";
import type { ComponentProps } from "react";
import { MainAppShell } from "@app/components/MainAppShell";
import { useI18n } from "@/features/i18n/i18n";

type UseMainAppShellPropsArgs = {
  shell: Pick<
    ComponentProps<typeof MainAppShell>,
    | "appClassName"
    | "isResizing"
    | "appStyle"
    | "appRef"
    | "sidebarToggleProps"
    | "shouldLoadGitHubPanelData"
    | "appModalsProps"
    | "showMobileSetupWizard"
    | "mobileSetupWizardProps"
  >;
  gitHubPanelDataProps: ComponentProps<typeof MainAppShell>["gitHubPanelDataProps"];
  appLayout: Omit<ComponentProps<typeof MainAppShell>["appLayoutProps"], "desktopTopbarLeftNode" | "topbarActionsNode">;
  topbar: {
    isCompact: boolean;
    desktopTopbarLeftNode: ComponentProps<typeof MainAppShell>["appLayoutProps"]["desktopTopbarLeftNode"];
    hasActiveWorkspace: boolean;
    backendMode: "local" | "remote";
    remoteThreadConnectionState: "live" | "polling" | "disconnected";
  };
};

export function useMainAppShellProps({
  shell,
  gitHubPanelDataProps,
  appLayout,
  topbar,
}: UseMainAppShellPropsArgs) {
  const { t } = useI18n();
  const showThreadConnectionIndicator =
    topbar.hasActiveWorkspace && topbar.backendMode === "remote";
  const topbarActionsNode = showThreadConnectionIndicator ? (
    <span
      className={`compact-workspace-live-indicator ${
        topbar.remoteThreadConnectionState === "live"
          ? "is-live"
          : topbar.remoteThreadConnectionState === "polling"
            ? "is-polling"
            : "is-disconnected"
      }`}
      title={
        topbar.remoteThreadConnectionState === "live"
          ? t("connection.liveTitle")
          : topbar.remoteThreadConnectionState === "polling"
            ? t("connection.pollingTitle")
            : t("connection.disconnectedTitle")
      }
    >
      {topbar.remoteThreadConnectionState === "live"
        ? t("connection.live")
        : topbar.remoteThreadConnectionState === "polling"
          ? t("connection.polling")
          : t("connection.disconnected")}
    </span>
  ) : null;

  const desktopTopbarLeftNodeWithToggle = !topbar.isCompact ? (
    <div className="topbar-leading">
      <SidebarCollapseButton {...shell.sidebarToggleProps} />
      {topbar.desktopTopbarLeftNode}
    </div>
  ) : (
    topbar.desktopTopbarLeftNode
  );

  return {
    ...shell,
    gitHubPanelDataProps,
    appLayoutProps: {
      ...appLayout,
      desktopTopbarLeftNode: desktopTopbarLeftNodeWithToggle,
      topbarActionsNode,
    },
  };
}
