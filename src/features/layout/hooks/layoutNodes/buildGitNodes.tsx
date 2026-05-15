import { FileTreePanel } from "../../../files/components/FileTreePanel";
import { GitDiffPanel } from "../../../git/components/GitDiffPanel";
import { GitDiffViewer } from "../../../git/components/GitDiffViewer";
import { PlanPanel } from "../../../plan/components/PlanPanel";
import { PromptPanel } from "../../../prompts/components/PromptPanel";
import { PanelShell } from "../../components/PanelShell";
import type {
  LayoutGitSurface,
  LayoutNodesResult,
} from "./types";

export type GitLayoutNodesOptions = LayoutGitSurface;

type GitLayoutNodes = Pick<LayoutNodesResult, "gitDiffPanelNode" | "gitDiffViewerNode">;

function resolveGitDiffStyle({
  isPhone,
  splitChatDiffView,
  centerMode,
  userPreference,
}: {
  isPhone: boolean;
  splitChatDiffView: boolean;
  centerMode: GitLayoutNodesOptions["diffViewProps"]["centerMode"];
  userPreference: GitLayoutNodesOptions["diffViewProps"]["gitDiffViewStyle"];
}): GitLayoutNodesOptions["diffViewProps"]["gitDiffViewStyle"] {
  const shouldForceSingleColumn =
    isPhone || (splitChatDiffView && centerMode === "chat");
  return shouldForceSingleColumn ? "unified" : userPreference;
}

function buildGitDiffPanelNode(options: GitLayoutNodesOptions) {
  const selectedDiffPath =
    options.diffViewProps.centerMode === "diff"
      ? options.gitDiffViewerProps.selectedPath
      : null;

  if (options.filePanelMode === "plan") {
    return (
      <PanelShell
        filePanelMode={options.filePanelMode}
        onFilePanelModeChange={options.gitDiffPanelProps.onFilePanelModeChange}
        className="plan-inspector-panel"
        headerClassName="git-panel-header"
      >
        <PlanPanel {...options.planPanelProps} />
      </PanelShell>
    );
  }
  if (options.filePanelMode === "files" && options.fileTreeProps) {
    return <FileTreePanel {...options.fileTreeProps} />;
  }
  if (options.filePanelMode === "prompts") {
    return <PromptPanel {...options.promptPanelProps} />;
  }
  return (
    <GitDiffPanel
      {...options.gitDiffPanelProps}
      selectedPath={selectedDiffPath}
    />
  );
}

function buildGitDiffViewerNode(options: GitLayoutNodesOptions) {
  return (
    <GitDiffViewer
      {...options.gitDiffViewerProps}
      diffStyle={resolveGitDiffStyle({
        isPhone: options.diffViewProps.isPhone,
        splitChatDiffView: options.diffViewProps.splitChatDiffView,
        centerMode: options.diffViewProps.centerMode,
        userPreference: options.diffViewProps.gitDiffViewStyle,
      })}
    />
  );
}

export function buildGitNodes(options: GitLayoutNodesOptions): GitLayoutNodes {
  return {
    gitDiffPanelNode: buildGitDiffPanelNode(options),
    gitDiffViewerNode: buildGitDiffViewerNode(options),
  };
}
