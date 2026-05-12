import type { MainAppLayoutSurfacesContext } from "@app/hooks/useMainAppLayoutSurfaces";
import type { LayoutNodesOptions } from "@/features/layout/hooks/layoutNodes/types";

export function buildShellSurface({
  activePlan,
  composerWorkspaceState,
  gitState,
  terminalOpen,
  debugOpen,
  debugEntries,
  terminalTabs,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  terminalState,
  onClearDebug,
  onCopyDebug,
  onResizeDebug,
  onResizeTerminal,
  isPhone,
  setActiveTab,
}: MainAppLayoutSurfacesContext): LayoutNodesOptions["secondary"] {
  return {
    planPanelProps: {
      plan: activePlan,
      isProcessing: composerWorkspaceState.isProcessing,
    },
    terminalDockProps: {
      isOpen: terminalOpen,
      terminals: terminalTabs,
      activeTerminalId,
      onSelectTerminal,
      onNewTerminal,
      onCloseTerminal,
      onResizeStart: onResizeTerminal,
    },
    terminalState,
    debugPanelProps: {
      entries: debugEntries,
      isOpen: debugOpen,
      onClear: onClearDebug,
      onCopy: onCopyDebug,
      onResizeStart: onResizeDebug,
    },
    compactNavProps: {
      onGoProjects: () => setActiveTab("projects"),
      centerMode: gitState.centerMode,
      selectedDiffPath: gitState.selectedDiffPath,
      onBackFromDiff: () => {
        gitState.setCenterMode("chat");
      },
      onShowSelectedDiff: () => {
        const fallbackPath = gitState.selectedDiffPath ?? gitState.activeDiffs[0]?.path;

        if (!fallbackPath) {
          return;
        }

        if (!gitState.selectedDiffPath) {
          gitState.setSelectedDiffPath(fallbackPath);
        }

        gitState.setCenterMode("diff");
        if (isPhone) {
          setActiveTab("git");
        }
      },
      hasActiveGitDiffs: gitState.activeDiffs.length > 0,
    },
  };
}
