import { memo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { DesktopLayout } from "../../layout/components/DesktopLayout";
import { TabletLayout } from "../../layout/components/TabletLayout";
import { PhoneLayout } from "../../layout/components/PhoneLayout";
type AppLayoutProps = {
  isPhone: boolean;
  isTablet: boolean;
  showHome: boolean;
  showGitDetail: boolean;
  activeTab: "home" | "projects" | "codex" | "git" | "log";
  tabletTab: "codex" | "git" | "log";
  centerMode: "chat" | "diff";
  preloadGitDiffs: boolean;
  splitChatDiffView: boolean;
  activeWorkspace: boolean;
  sidebarNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  approvalToastsNode: ReactNode;
  elicitationToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  homeNode: ReactNode;
  mainHeaderNode: ReactNode;
  desktopTopbarLeftNode: ReactNode;
  topbarActionsNode?: ReactNode;
  tabletNavNode: ReactNode;
  tabBarNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  debugPanelNode: ReactNode;
  debugPanelFullNode: ReactNode;
  terminalDockNode: ReactNode;
  compactEmptyCodexNode: ReactNode;
  compactEmptyGitNode: ReactNode;
  compactGitBackNode: ReactNode;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onChatDiffSplitPositionResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
};

export const AppLayout = memo(function AppLayout({
  isPhone,
  isTablet,
  showHome,
  showGitDetail,
  activeTab,
  tabletTab,
  centerMode,
  preloadGitDiffs,
  splitChatDiffView,
  activeWorkspace,
  sidebarNode,
  messagesNode,
  composerNode,
  approvalToastsNode,
  elicitationToastsNode,
  updateToastNode,
  errorToastsNode,
  homeNode,
  mainHeaderNode,
  desktopTopbarLeftNode,
  topbarActionsNode,
  tabletNavNode,
  tabBarNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  debugPanelNode,
  debugPanelFullNode,
  terminalDockNode,
  compactEmptyCodexNode,
  compactEmptyGitNode,
  compactGitBackNode,
  onSidebarResizeStart,
  onChatDiffSplitPositionResizeStart,
  onRightPanelResizeStart,
}: AppLayoutProps) {
  if (isPhone) {
    return (
      <PhoneLayout
        approvalToastsNode={approvalToastsNode}
        elicitationToastsNode={elicitationToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        tabBarNode={tabBarNode}
        homeNode={homeNode}
        sidebarNode={sidebarNode}
        activeTab={activeTab}
        activeWorkspace={activeWorkspace}
        showGitDetail={showGitDetail}
        compactEmptyCodexNode={compactEmptyCodexNode}
        compactEmptyGitNode={compactEmptyGitNode}
        compactGitBackNode={compactGitBackNode}
        topbarLeftNode={mainHeaderNode}
        topbarActionsNode={topbarActionsNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        debugPanelNode={debugPanelFullNode}
      />
    );
  }

  if (isTablet) {
    return (
      <TabletLayout
        tabletNavNode={tabletNavNode}
        approvalToastsNode={approvalToastsNode}
        elicitationToastsNode={elicitationToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        homeNode={homeNode}
        showHome={showHome}
        showWorkspace={activeWorkspace && !showHome}
        sidebarNode={sidebarNode}
        tabletTab={tabletTab}
        onSidebarResizeStart={onSidebarResizeStart}
        topbarLeftNode={mainHeaderNode}
        topbarActionsNode={topbarActionsNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        debugPanelNode={debugPanelFullNode}
      />
    );
  }

  return (
    <DesktopLayout
      sidebarNode={sidebarNode}
      updateToastNode={updateToastNode}
      approvalToastsNode={approvalToastsNode}
      elicitationToastsNode={elicitationToastsNode}
      errorToastsNode={errorToastsNode}
      homeNode={homeNode}
      showHome={showHome}
      showWorkspace={activeWorkspace && !showHome}
      topbarLeftNode={desktopTopbarLeftNode}
      topbarActionsNode={topbarActionsNode}
      centerMode={centerMode}
      preloadGitDiffs={preloadGitDiffs}
      splitChatDiffView={splitChatDiffView}
      messagesNode={messagesNode}
      gitDiffViewerNode={gitDiffViewerNode}
      gitDiffPanelNode={gitDiffPanelNode}
      composerNode={composerNode}
      terminalDockNode={terminalDockNode}
      debugPanelNode={debugPanelNode}
      onSidebarResizeStart={onSidebarResizeStart}
      onChatDiffSplitPositionResizeStart={onChatDiffSplitPositionResizeStart}
      onRightPanelResizeStart={onRightPanelResizeStart}
    />
  );
});
