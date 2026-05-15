import type { MainAppLayoutSurfacesContext } from "@app/hooks/useMainAppLayoutSurfaces";
import type { LayoutNodesOptions } from "@/features/layout/hooks/layoutNodes/types";

export function buildGitSurface({
  appSettings,
  activeWorkspace,
  gitState,
  composerWorkspaceState,
  activePlan,
  promptActions,
  worktreeState,
  pullRequestComposer,
  openAppIconById,
  openInitGitRepoPrompt,
  startUncommittedReview,
  handleSelectOpenAppId,
  prompts,
  isPhone,
  t,
}: MainAppLayoutSurfacesContext): LayoutNodesOptions["git"] {
  return {
    filePanelMode: gitState.filePanelMode,
    planPanelProps: {
      plan: activePlan,
      isProcessing: composerWorkspaceState.isProcessing,
    },
    fileTreeProps: activeWorkspace
      ? {
          workspaceId: activeWorkspace.id,
          workspacePath: activeWorkspace.path,
          files: composerWorkspaceState.files,
          modifiedFiles: [
            ...new Set([
              ...gitState.gitStatus.stagedFiles.map((file) => file.path),
              ...gitState.gitStatus.unstagedFiles.map((file) => file.path),
            ]),
          ],
          isLoading: composerWorkspaceState.isFilesLoading,
          filePanelMode: gitState.filePanelMode,
          onFilePanelModeChange: gitState.setFilePanelMode,
          onInsertText: composerWorkspaceState.handleInsertComposerText,
          canInsertText: composerWorkspaceState.canInsertComposerText,
          openTargets: appSettings.openAppTargets,
          openAppIconById,
          selectedOpenAppId: appSettings.selectedOpenAppId,
          onSelectOpenAppId: handleSelectOpenAppId,
        }
      : null,
    promptPanelProps: {
      prompts,
      workspacePath: activeWorkspace?.path ?? null,
      filePanelMode: gitState.filePanelMode,
      onFilePanelModeChange: gitState.setFilePanelMode,
      onSendPrompt: composerWorkspaceState.handleSendPrompt,
      onSendPromptToNewAgent: promptActions.handleSendPromptToNewAgent,
      onCreatePrompt: promptActions.handleCreatePrompt,
      onUpdatePrompt: promptActions.handleUpdatePrompt,
      onDeletePrompt: promptActions.handleDeletePrompt,
      onMovePrompt: promptActions.handleMovePrompt,
      onRevealWorkspacePrompts: promptActions.handleRevealWorkspacePrompts,
      onRevealGeneralPrompts: promptActions.handleRevealGeneralPrompts,
      canRevealGeneralPrompts: Boolean(activeWorkspace),
    },
    gitDiffPanelProps: {
      workspaceId: activeWorkspace?.id ?? null,
      workspacePath: activeWorkspace?.path ?? null,
      mode: gitState.gitPanelMode,
      onModeChange: gitState.handleGitPanelModeChange,
      filePanelMode: gitState.filePanelMode,
      onFilePanelModeChange: gitState.setFilePanelMode,
      worktreeApplyLabel: "apply",
      worktreeApplyTitle: worktreeState.activeParentWorkspace?.name
        ? t("git.applyToParentWorkspaceNamed", {
          workspace: worktreeState.activeParentWorkspace.name,
        })
        : t("git.applyToParentWorkspace"),
      worktreeApplyLoading: worktreeState.isWorktreeWorkspace
        ? gitState.worktreeApplyLoading
        : false,
      worktreeApplyError: worktreeState.isWorktreeWorkspace
        ? gitState.worktreeApplyError
        : null,
      worktreeApplySuccess: worktreeState.isWorktreeWorkspace
        ? gitState.worktreeApplySuccess
        : false,
      onApplyWorktreeChanges: worktreeState.isWorktreeWorkspace
        ? gitState.handleApplyWorktreeChanges
        : undefined,
      branchName: gitState.gitStatus.branchName || "unknown",
      totalAdditions: gitState.gitStatus.totalAdditions,
      totalDeletions: gitState.gitStatus.totalDeletions,
      fileStatus: gitState.fileStatus,
      perFileDiffGroups: gitState.perFileDiffGroups,
      error: gitState.gitStatus.error,
      logError: gitState.gitLogError,
      logLoading: gitState.gitLogLoading,
      stagedFiles: gitState.gitStatus.stagedFiles,
      unstagedFiles: gitState.gitStatus.unstagedFiles,
      onSelectFile:
        gitState.gitPanelMode === "perFile"
          ? gitState.handleSelectPerFileDiff
          : gitState.handleSelectDiff,
      logEntries: gitState.gitLogEntries,
      logTotal: gitState.gitLogTotal,
      logAhead: gitState.gitLogAhead,
      logBehind: gitState.gitLogBehind,
      logAheadEntries: gitState.gitLogAheadEntries,
      logBehindEntries: gitState.gitLogBehindEntries,
      logUpstream: gitState.gitLogUpstream,
      selectedCommitSha: gitState.selectedCommitSha,
      onSelectCommit: (entry) => {
        gitState.handleSelectCommit(entry.sha);
      },
      issues: gitState.gitIssues,
      issuesTotal: gitState.gitIssuesTotal,
      issuesLoading: gitState.gitIssuesLoading,
      issuesError: gitState.gitIssuesError,
      pullRequests: gitState.gitPullRequests,
      pullRequestsTotal: gitState.gitPullRequestsTotal,
      pullRequestsLoading: gitState.gitPullRequestsLoading,
      pullRequestsError: gitState.gitPullRequestsError,
      selectedPullRequest: gitState.selectedPullRequest?.number ?? null,
      onSelectPullRequest: (pullRequest) => {
        gitState.setSelectedCommitSha(null);
        pullRequestComposer.handleSelectPullRequest(pullRequest);
      },
      gitRemoteUrl: gitState.gitRemoteUrl,
      gitRoot: gitState.activeGitRoot,
      gitRootCandidates: gitState.gitRootCandidates,
      gitRootScanDepth: gitState.gitRootScanDepth,
      gitRootScanLoading: gitState.gitRootScanLoading,
      gitRootScanError: gitState.gitRootScanError,
      gitRootScanHasScanned: gitState.gitRootScanHasScanned,
      onGitRootScanDepthChange: gitState.setGitRootScanDepth,
      onScanGitRoots: gitState.scanGitRoots,
      onSelectGitRoot: (path) => {
        void gitState.handleSetGitRoot(path);
      },
      onClearGitRoot: () => {
        void gitState.handleSetGitRoot(null);
      },
      onPickGitRoot: gitState.handlePickGitRoot,
      onInitGitRepo: openInitGitRepoPrompt,
      initGitRepoLoading: gitState.initGitRepoLoading,
      onStageAllChanges: gitState.handleStageGitAll,
      onStageFile: gitState.handleStageGitFile,
      onUnstageFile: gitState.handleUnstageGitFile,
      onRevertFile: gitState.handleRevertGitFile,
      onRevertAllChanges: gitState.handleRevertAllGitChanges,
      onReviewUncommittedChanges: (workspaceId) =>
        startUncommittedReview(workspaceId ?? activeWorkspace?.id ?? null),
      commitMessage: gitState.commitMessage,
      commitMessageLoading: gitState.commitMessageLoading,
      commitMessageError: gitState.commitMessageError,
      onCommitMessageChange: gitState.handleCommitMessageChange,
      onGenerateCommitMessage: gitState.handleGenerateCommitMessage,
      onCommit: gitState.handleCommit,
      onCommitAndPush: gitState.handleCommitAndPush,
      onCommitAndSync: gitState.handleCommitAndSync,
      onPull: gitState.handlePull,
      onFetch: gitState.handleFetch,
      onPush: gitState.handlePush,
      onSync: gitState.handleSync,
      commitLoading: gitState.commitLoading,
      pullLoading: gitState.pullLoading,
      fetchLoading: gitState.fetchLoading,
      pushLoading: gitState.pushLoading,
      syncLoading: gitState.syncLoading,
      commitError: gitState.commitError,
      pullError: gitState.pullError,
      fetchError: gitState.fetchError,
      pushError: gitState.pushError,
      syncError: gitState.syncError,
      commitsAhead: gitState.gitLogAhead,
    },
    gitDiffViewerProps: {
      diffs: gitState.activeDiffs,
      selectedPath: gitState.selectedDiffPath,
      scrollRequestId: gitState.diffScrollRequestId,
      isLoading: gitState.activeDiffLoading,
      error: gitState.activeDiffError,
      ignoreWhitespaceChanges:
        appSettings.gitDiffIgnoreWhitespaceChanges && gitState.diffSource !== "pr",
      pullRequest: gitState.diffSource === "pr" ? gitState.selectedPullRequest : null,
      pullRequestComments:
        gitState.diffSource === "pr" ? gitState.gitPullRequestComments : [],
      pullRequestCommentsLoading: gitState.gitPullRequestCommentsLoading,
      pullRequestCommentsError: gitState.gitPullRequestCommentsError,
      pullRequestReviewActions: gitState.pullRequestReviewActions,
      onRunPullRequestReview: gitState.runPullRequestReview,
      pullRequestReviewLaunching: gitState.isLaunchingPullRequestReview,
      pullRequestReviewThreadId: gitState.lastPullRequestReviewThreadId,
      onCheckoutPullRequest: (pullRequest) =>
        gitState.handleCheckoutPullRequest(pullRequest.number),
      canRevert: gitState.diffSource === "local",
      onRevertFile: gitState.handleRevertGitFile,
      onActivePathChange: gitState.handleActiveDiffPath,
      onInsertComposerText: composerWorkspaceState.canInsertComposerText
        ? composerWorkspaceState.handleInsertComposerText
        : undefined,
    },
    diffViewProps: {
      centerMode: gitState.centerMode,
      isPhone,
      splitChatDiffView: appSettings.splitChatDiffView,
      gitDiffViewStyle: gitState.gitDiffViewStyle,
    },
  };
}
