import type { MouseEvent, ReactNode } from "react";
import { MainTopbar } from "../../app/components/MainTopbar";
import { ChatPane } from "./ChatPane";
import { useI18n } from "@/features/i18n/i18n";

type TabletLayoutProps = {
  tabletNavNode: ReactNode;
  approvalToastsNode: ReactNode;
  elicitationToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  sidebarNode: ReactNode;
  tabletTab: "projects" | "codex" | "git" | "log";
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  topbarLeftNode: ReactNode;
  topbarActionsNode?: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  debugPanelNode: ReactNode;
};

export function TabletLayout({
  tabletNavNode,
  approvalToastsNode,
  elicitationToastsNode,
  updateToastNode,
  errorToastsNode,
  homeNode,
  showHome,
  showWorkspace,
  sidebarNode,
  tabletTab,
  onSidebarResizeStart,
  topbarLeftNode,
  topbarActionsNode,
  messagesNode,
  composerNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  debugPanelNode,
}: TabletLayoutProps) {
  const { t } = useI18n();
  return (
    <>
      {tabletNavNode}
      <div className="tablet-projects">{sidebarNode}</div>
      <div
        className="projects-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("layout.resizeProjects")}
        onMouseDown={onSidebarResizeStart}
      />
      <section className="tablet-main">
        {approvalToastsNode}
        {elicitationToastsNode}
        {updateToastNode}
        {errorToastsNode}
        {showHome && homeNode}
        {showWorkspace && (
          <>
            <MainTopbar
              leftNode={topbarLeftNode}
              actionsNode={topbarActionsNode}
              className="tablet-topbar"
            />
            {tabletTab === "codex" && (
              <div className="content tablet-content">
                <ChatPane messagesNode={messagesNode} composerNode={composerNode} />
              </div>
            )}
            {tabletTab === "git" && (
              <div className="tablet-git">
                {gitDiffPanelNode}
                <div className="tablet-git-viewer">{gitDiffViewerNode}</div>
              </div>
            )}
            {tabletTab === "log" && debugPanelNode}
          </>
        )}
      </section>
    </>
  );
}
