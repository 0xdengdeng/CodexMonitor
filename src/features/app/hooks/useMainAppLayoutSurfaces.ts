import type { RefObject } from "react";
import type { AppSettings, ComposerEditorSettings, WorkspaceInfo } from "@/types";
import { useI18n, type I18nValues } from "@/features/i18n/i18n";
import type { ThreadState } from "@/features/threads/hooks/useThreadsReducer";
import type { WorkspaceLaunchScriptsState } from "@app/hooks/useWorkspaceLaunchScripts";
import type { useMainAppComposerWorkspaceState } from "@app/hooks/useMainAppComposerWorkspaceState";
import type { useMainAppDisplayNodes } from "@app/hooks/useMainAppDisplayNodes";
import type { useMainAppGitState } from "@app/hooks/useMainAppGitState";
import type { useMainAppPromptActions } from "@app/hooks/useMainAppPromptActions";
import type { useMainAppSidebarMenuOrchestration } from "@app/hooks/useMainAppSidebarMenuOrchestration";
import type { useMainAppWorktreeState } from "@app/hooks/useMainAppWorktreeState";
import type { LayoutNodesOptions } from "@/features/layout/hooks/layoutNodes/types";
import { buildCodexSurface } from "@app/pages/codex/buildCodexSurface";
import { buildGitSurface } from "@app/pages/git/buildGitSurface";
import { buildShellSurface } from "@app/pages/shell/buildShellSurface";

type SidebarProps = LayoutNodesOptions["primary"]["sidebarProps"];
type ComposerProps = NonNullable<LayoutNodesOptions["primary"]["composerProps"]>;
type ComposerQuickActions = NonNullable<ComposerProps["quickActions"]>;
type MainHeaderProps = NonNullable<LayoutNodesOptions["primary"]["mainHeaderProps"]>;
type GitDiffPanelProps = LayoutNodesOptions["git"]["gitDiffPanelProps"];

type UseMainAppLayoutSurfacesArgs = {
  appSettings: Pick<
    AppSettings,
    | "usageShowRemaining"
    | "enterpriseAi"
    | "composerCodeBlockCopyUseModifier"
    | "showMessageFilePath"
    | "openAppTargets"
    | "selectedOpenAppId"
    | "experimentalAppsEnabled"
    | "followUpMessageBehavior"
    | "composerFollowUpHintEnabled"
    | "splitChatDiffView"
    | "gitDiffIgnoreWhitespaceChanges"
  >;
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: Array<{ id: string | null; name: string; workspaces: WorkspaceInfo[] }>;
  workspaceGroupsCount: number;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId: string | null;
  startingDraftThreadWorkspaceId: string | null;
  threadsByWorkspace: SidebarProps["threadsByWorkspace"];
  threadParentById: SidebarProps["threadParentById"];
  threadStatusById: ThreadState["threadStatusById"];
  threadResumeLoadingById: Record<string, boolean>;
  threadListLoadingByWorkspace: SidebarProps["threadListLoadingByWorkspace"];
  threadListPagingByWorkspace: SidebarProps["threadListPagingByWorkspace"];
  threadListCursorByWorkspace: SidebarProps["threadListCursorByWorkspace"];
  pinnedThreadsVersion: number;
  threadListSortKey: SidebarProps["threadListSortKey"];
  onSetThreadListSortKey: SidebarProps["onSetThreadListSortKey"];
  threadListOrganizeMode: SidebarProps["threadListOrganizeMode"];
  onSetThreadListOrganizeMode: SidebarProps["onSetThreadListOrganizeMode"];
  onRefreshAllThreads: SidebarProps["onRefreshAllThreads"];
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  activeItems: LayoutNodesOptions["primary"]["messagesProps"]["items"];
  agentBackgroundTasks: NonNullable<
    LayoutNodesOptions["secondary"]["planPanelProps"]["backgroundTasks"]
  >;
  userInputRequests: SidebarProps["userInputRequests"];
  approvals: LayoutNodesOptions["primary"]["approvalToastsProps"]["approvals"];
  activeRateLimits: SidebarProps["accountRateLimits"];
  activeAccount: SidebarProps["accountInfo"];
  homeRateLimits: LayoutNodesOptions["primary"]["homeProps"]["accountRateLimits"];
  homeAccount: LayoutNodesOptions["primary"]["homeProps"]["accountInfo"];
  enterpriseAiUsage: LayoutNodesOptions["primary"]["homeProps"]["enterpriseAiUsage"];
  accountSwitching: SidebarProps["accountSwitching"];
  onSwitchAccount: SidebarProps["onSwitchAccount"];
  onCancelSwitchAccount: SidebarProps["onCancelSwitchAccount"];
  onDecision: LayoutNodesOptions["primary"]["approvalToastsProps"]["onDecision"];
  onRemember: LayoutNodesOptions["primary"]["approvalToastsProps"]["onRemember"];
  onUserInputSubmit: LayoutNodesOptions["primary"]["messagesProps"]["onUserInputSubmit"];
  onPlanAccept: LayoutNodesOptions["primary"]["messagesProps"]["onPlanAccept"];
  onPlanSubmitChanges: LayoutNodesOptions["primary"]["messagesProps"]["onPlanSubmitChanges"];
  onOpenWorkspaceFileLink: LayoutNodesOptions["primary"]["messagesProps"]["onOpenWorkspaceFileLink"];
  activePlan: LayoutNodesOptions["secondary"]["planPanelProps"]["plan"];
  fileTreeOpenRequest: NonNullable<
    LayoutNodesOptions["git"]["fileTreeProps"]
  >["openFileRequest"];
  activeTokenUsage: ComposerProps["contextUsage"];
  latestAgentRuns: LayoutNodesOptions["primary"]["homeProps"]["latestAgentRuns"];
  isLoadingLatestAgents: LayoutNodesOptions["primary"]["homeProps"]["isLoadingLatestAgents"];
  localUsageSnapshot: LayoutNodesOptions["primary"]["homeProps"]["localUsageSnapshot"];
  isLoadingLocalUsage: LayoutNodesOptions["primary"]["homeProps"]["isLoadingLocalUsage"];
  localUsageError: LayoutNodesOptions["primary"]["homeProps"]["localUsageError"];
  onRefreshLocalUsage: LayoutNodesOptions["primary"]["homeProps"]["onRefreshLocalUsage"];
  usageMetric: LayoutNodesOptions["primary"]["homeProps"]["usageMetric"];
  onUsageMetricChange: LayoutNodesOptions["primary"]["homeProps"]["onUsageMetricChange"];
  usageWorkspaceId: LayoutNodesOptions["primary"]["homeProps"]["usageWorkspaceId"];
  usageWorkspaceOptions: LayoutNodesOptions["primary"]["homeProps"]["usageWorkspaceOptions"];
  onUsageWorkspaceChange: LayoutNodesOptions["primary"]["homeProps"]["onUsageWorkspaceChange"];
  onOpenEnterpriseAiSettings: () => void;
  onBeforeComposerSend: ComposerProps["onBeforeSend"];
  onOpenCapabilities: SidebarProps["onOpenCapabilities"];
  gitState: ReturnType<typeof useMainAppGitState>;
  composerWorkspaceState: ReturnType<typeof useMainAppComposerWorkspaceState>;
  composerQuickActions: ComposerQuickActions;
  promptActions: ReturnType<typeof useMainAppPromptActions>;
  worktreeState: ReturnType<typeof useMainAppWorktreeState>;
  sidebarHandlers: ReturnType<typeof useMainAppSidebarMenuOrchestration>;
  displayNodes: ReturnType<typeof useMainAppDisplayNodes>;
  threadPinning: Pick<
    SidebarProps,
    "pinThread" | "unpinThread" | "isThreadPinned" | "getPinTimestamp" | "getThreadArgsBadge"
  >;
  workspaceDrop: {
    workspaceDropTargetRef: SidebarProps["workspaceDropTargetRef"];
    isWorkspaceDropActive: SidebarProps["isWorkspaceDropActive"];
    workspaceDropText: SidebarProps["workspaceDropText"];
    onWorkspaceDragOver: SidebarProps["onWorkspaceDragOver"];
    onWorkspaceDragEnter: SidebarProps["onWorkspaceDragEnter"];
    onWorkspaceDragLeave: SidebarProps["onWorkspaceDragLeave"];
    onWorkspaceDrop: SidebarProps["onWorkspaceDrop"];
  };
  threadNavigation: {
    exitDiffView: () => void;
    clearDraftState: () => void;
    selectWorkspace: (workspaceId: string) => void;
    setActiveThreadId: (threadId: string | null, workspaceId: string) => void;
    resetPullRequestSelection: () => void;
    selectHome: () => void;
  };
  pullRequestComposer: {
    composerSendLabel: string | null | undefined;
    handleSelectPullRequest: NonNullable<GitDiffPanelProps["onSelectPullRequest"]>;
  };
  openAppIconById: MainHeaderProps["openAppIconById"];
  openInitGitRepoPrompt: GitDiffPanelProps["onInitGitRepo"];
  startUncommittedReview: (workspaceId: string | null) => void;
  handleAddWorkspace: () => void;
  openWorkspaceFromUrlPrompt: () => void;
  handleAddAgent: SidebarProps["onAddAgent"];
  handleAddWorktreeAgent: SidebarProps["onAddWorktreeAgent"];
  handleAddCloneAgent: SidebarProps["onAddCloneAgent"];
  handleOpenThreadLink: LayoutNodesOptions["primary"]["messagesProps"]["onOpenThreadLink"];
  handleSelectOpenAppId: MainHeaderProps["onSelectOpenAppId"];
  handleCopyThread: MainHeaderProps["onCopyThread"];
  handleToggleTerminalWithFocus: MainHeaderProps["onToggleTerminal"];
  launchScriptState: {
    launchScript: string | null;
    editorOpen: boolean;
    draftScript: string;
    isSaving: boolean;
    error: string | null;
    onRunLaunchScript: () => void;
    onOpenEditor: () => void;
    onCloseEditor: () => void;
    onDraftScriptChange: (value: string) => void;
    onSaveLaunchScript: () => void;
  };
  launchScriptsState: WorkspaceLaunchScriptsState | undefined;
  models: ComposerProps["models"];
  selectedModelId: ComposerProps["selectedModelId"];
  onSelectModel: ComposerProps["onSelectModel"];
  collaborationModes: ComposerProps["collaborationModes"];
  selectedCollaborationModeId: ComposerProps["selectedCollaborationModeId"];
  onSelectCollaborationMode: ComposerProps["onSelectCollaborationMode"];
  reasoningOptions: ComposerProps["reasoningOptions"];
  selectedEffort: ComposerProps["selectedEffort"];
  onSelectEffort: ComposerProps["onSelectEffort"];
  selectedServiceTier: ComposerProps["selectedServiceTier"];
  reasoningSupported: boolean;
  codexArgsOptions: ComposerProps["codexArgsOptions"];
  selectedCodexArgsOverride: ComposerProps["selectedCodexArgsOverride"];
  onSelectCodexArgsOverride: ComposerProps["onSelectCodexArgsOverride"];
  accessMode: ComposerProps["accessMode"];
  onSelectAccessMode: ComposerProps["onSelectAccessMode"];
  skills: ComposerProps["skills"];
  apps: ComposerProps["apps"];
  prompts: ComposerProps["prompts"];
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  composerEditorSettings: ComposerEditorSettings;
  composerEditorExpanded: boolean;
  onToggleComposerEditorExpanded: () => void;
  composerContextActions: ComposerProps["contextActions"];
  reviewPrompt: ComposerProps["reviewPrompt"];
  closeReviewPrompt: () => void;
  showPresetStep: () => void;
  choosePreset: ComposerProps["onReviewPromptChoosePreset"];
  highlightedPresetIndex: number;
  setHighlightedPresetIndex: (index: number) => void;
  highlightedBranchIndex: number;
  setHighlightedBranchIndex: (index: number) => void;
  highlightedCommitIndex: number;
  setHighlightedCommitIndex: (index: number) => void;
  handleReviewPromptKeyDown: ComposerProps["onReviewPromptKeyDown"];
  selectBranch: ComposerProps["onReviewPromptSelectBranch"];
  selectBranchAtIndex: ComposerProps["onReviewPromptSelectBranchAtIndex"];
  confirmBranch: ComposerProps["onReviewPromptConfirmBranch"];
  selectCommit: ComposerProps["onReviewPromptSelectCommit"];
  selectCommitAtIndex: ComposerProps["onReviewPromptSelectCommitAtIndex"];
  confirmCommit: ComposerProps["onReviewPromptConfirmCommit"];
  updateCustomInstructions: ComposerProps["onReviewPromptUpdateCustomInstructions"];
  confirmCustom: ComposerProps["onReviewPromptConfirmCustom"];
  handleComposerSendWithDraftStart: ComposerProps["onSend"];
  interruptTurn: () => void;
  terminalOpen: boolean;
  openTerminalWithFocus: () => void;
  debugOpen: boolean;
  debugEntries: LayoutNodesOptions["secondary"]["debugPanelProps"]["entries"];
  terminalTabs: LayoutNodesOptions["secondary"]["terminalDockProps"]["terminals"];
  activeTerminalId: LayoutNodesOptions["secondary"]["terminalDockProps"]["activeTerminalId"];
  onSelectTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onSelectTerminal"];
  onNewTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onNewTerminal"];
  onCloseTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onCloseTerminal"];
  terminalState: LayoutNodesOptions["secondary"]["terminalState"];
  onClearDebug: () => void;
  onCopyDebug: () => void;
  onResizeDebug: LayoutNodesOptions["secondary"]["debugPanelProps"]["onResizeStart"];
  onResizeTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onResizeStart"];
  isCompact: boolean;
  isPhone: boolean;
  activeTab: LayoutNodesOptions["primary"]["tabBarProps"]["activeTab"];
  setActiveTab: (tab: "home" | "projects" | "codex" | "git" | "log") => void;
  tabletTab: LayoutNodesOptions["primary"]["tabletNavProps"]["activeTab"];
  showMobilePollingFetchStatus: boolean;
  appModalsAboutOpen: boolean;
  updaterState: LayoutNodesOptions["primary"]["updateToastProps"]["state"];
  startUpdate: LayoutNodesOptions["primary"]["updateToastProps"]["onUpdate"];
  cancelUpdate: NonNullable<
    LayoutNodesOptions["primary"]["updateToastProps"]["onCancel"]
  >;
  dismissUpdate: LayoutNodesOptions["primary"]["updateToastProps"]["onDismiss"];
  postUpdateNotice: LayoutNodesOptions["primary"]["updateToastProps"]["postUpdateNotice"];
  dismissPostUpdateNotice: LayoutNodesOptions["primary"]["updateToastProps"]["onDismissPostUpdateNotice"];
  errorToasts: LayoutNodesOptions["primary"]["errorToastsProps"]["toasts"];
  dismissErrorToast: LayoutNodesOptions["primary"]["errorToastsProps"]["onDismiss"];
  showDebugButton: boolean;
  handleDebugClick: () => void;
};

export type MainAppLayoutSurfacesContext = UseMainAppLayoutSurfacesArgs & {
  sidebarRateLimits: SidebarProps["accountRateLimits"];
  sidebarAccount: SidebarProps["accountInfo"];
  t: (key: string, values?: I18nValues) => string;
};


export function useMainAppLayoutSurfaces({
  appSettings,
  workspaces,
  groupedWorkspaces,
  workspaceGroupsCount,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId,
  startingDraftThreadWorkspaceId,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  threadResumeLoadingById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  pinnedThreadsVersion,
  threadListSortKey,
  onSetThreadListSortKey,
  threadListOrganizeMode,
  onSetThreadListOrganizeMode,
  onRefreshAllThreads,
  activeWorkspace,
  activeWorkspaceId,
  activeThreadId,
  activeItems,
  agentBackgroundTasks,
  userInputRequests,
  approvals,
  activeRateLimits,
  activeAccount,
  homeRateLimits,
  homeAccount,
  enterpriseAiUsage,
  accountSwitching,
  onSwitchAccount,
  onCancelSwitchAccount,
  onDecision,
  onRemember,
  onUserInputSubmit,
  onPlanAccept,
  onPlanSubmitChanges,
  onOpenWorkspaceFileLink,
  activePlan,
  fileTreeOpenRequest,
  activeTokenUsage,
  latestAgentRuns,
  isLoadingLatestAgents,
  localUsageSnapshot,
  isLoadingLocalUsage,
  localUsageError,
  onRefreshLocalUsage,
  usageMetric,
  onUsageMetricChange,
  usageWorkspaceId,
  usageWorkspaceOptions,
  onUsageWorkspaceChange,
  onOpenEnterpriseAiSettings,
  onBeforeComposerSend,
  onOpenCapabilities,
  gitState,
  composerWorkspaceState,
  composerQuickActions,
  promptActions,
  worktreeState,
  sidebarHandlers,
  displayNodes,
  threadPinning,
  workspaceDrop,
  threadNavigation,
  pullRequestComposer,
  openAppIconById,
  openInitGitRepoPrompt,
  startUncommittedReview,
  handleAddWorkspace,
  openWorkspaceFromUrlPrompt,
  handleAddAgent,
  handleAddWorktreeAgent,
  handleAddCloneAgent,
  handleOpenThreadLink,
  handleSelectOpenAppId,
  handleCopyThread,
  handleToggleTerminalWithFocus,
  launchScriptState,
  launchScriptsState,
  models,
  selectedModelId,
  onSelectModel,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  selectedServiceTier,
  reasoningSupported,
  codexArgsOptions,
  selectedCodexArgsOverride,
  onSelectCodexArgsOverride,
  accessMode,
  onSelectAccessMode,
  skills,
  apps,
  prompts,
  composerInputRef,
  composerEditorSettings,
  composerEditorExpanded,
  onToggleComposerEditorExpanded,
  composerContextActions,
  reviewPrompt,
  closeReviewPrompt,
  showPresetStep,
  choosePreset,
  highlightedPresetIndex,
  setHighlightedPresetIndex,
  highlightedBranchIndex,
  setHighlightedBranchIndex,
  highlightedCommitIndex,
  setHighlightedCommitIndex,
  handleReviewPromptKeyDown,
  selectBranch,
  selectBranchAtIndex,
  confirmBranch,
  selectCommit,
  selectCommitAtIndex,
  confirmCommit,
  updateCustomInstructions,
  confirmCustom,
  handleComposerSendWithDraftStart,
  interruptTurn,
  terminalOpen,
  openTerminalWithFocus,
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
  isCompact,
  isPhone,
  activeTab,
  setActiveTab,
  tabletTab,
  showMobilePollingFetchStatus,
  appModalsAboutOpen,
  updaterState,
  startUpdate,
  cancelUpdate,
  dismissUpdate,
  postUpdateNotice,
  dismissPostUpdateNotice,
  errorToasts,
  dismissErrorToast,
  showDebugButton,
  handleDebugClick,
}: UseMainAppLayoutSurfacesArgs): LayoutNodesOptions {
  const { t } = useI18n();
  const sidebarRateLimits = activeWorkspace ? activeRateLimits : homeRateLimits;
  const sidebarAccount = activeWorkspace ? activeAccount : homeAccount;
  const context: MainAppLayoutSurfacesContext = {
    t,
    appSettings,
    workspaces,
    groupedWorkspaces,
    workspaceGroupsCount,
    deletingWorktreeIds,
    newAgentDraftWorkspaceId,
    startingDraftThreadWorkspaceId,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    threadResumeLoadingById,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    pinnedThreadsVersion,
    threadListSortKey,
    onSetThreadListSortKey,
    threadListOrganizeMode,
    onSetThreadListOrganizeMode,
    onRefreshAllThreads,
    activeWorkspace,
    activeWorkspaceId,
    activeThreadId,
    activeItems,
    agentBackgroundTasks,
    userInputRequests,
    approvals,
    activeRateLimits,
    activeAccount,
    homeRateLimits,
    homeAccount,
    enterpriseAiUsage,
    accountSwitching,
    onSwitchAccount,
    onCancelSwitchAccount,
    onOpenEnterpriseAiSettings,
    onBeforeComposerSend,
    onOpenCapabilities,
    onDecision,
    onRemember,
    onUserInputSubmit,
    onPlanAccept,
    onPlanSubmitChanges,
    onOpenWorkspaceFileLink,
    activePlan,
    fileTreeOpenRequest,
    activeTokenUsage,
    latestAgentRuns,
    isLoadingLatestAgents,
    localUsageSnapshot,
    isLoadingLocalUsage,
    localUsageError,
    onRefreshLocalUsage,
    usageMetric,
    onUsageMetricChange,
    usageWorkspaceId,
    usageWorkspaceOptions,
    onUsageWorkspaceChange,
    gitState,
    composerWorkspaceState,
    composerQuickActions,
    promptActions,
    worktreeState,
    sidebarHandlers,
    displayNodes,
    threadPinning,
    workspaceDrop,
    threadNavigation,
    pullRequestComposer,
    openAppIconById,
    openInitGitRepoPrompt,
    startUncommittedReview,
    handleAddWorkspace,
    openWorkspaceFromUrlPrompt,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    handleOpenThreadLink,
    handleSelectOpenAppId,
    handleCopyThread,
    handleToggleTerminalWithFocus,
    launchScriptState,
    launchScriptsState,
    models,
    selectedModelId,
    onSelectModel,
    collaborationModes,
    selectedCollaborationModeId,
    onSelectCollaborationMode,
    reasoningOptions,
    selectedEffort,
    onSelectEffort,
    selectedServiceTier,
    reasoningSupported,
    codexArgsOptions,
    selectedCodexArgsOverride,
    onSelectCodexArgsOverride,
    accessMode,
    onSelectAccessMode,
    skills,
    apps,
    prompts,
    composerInputRef,
    composerEditorSettings,
    composerEditorExpanded,
    onToggleComposerEditorExpanded,
    composerContextActions,
    reviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    selectBranch,
    selectBranchAtIndex,
    confirmBranch,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleComposerSendWithDraftStart,
    interruptTurn,
    terminalOpen,
    openTerminalWithFocus,
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
    isCompact,
    isPhone,
    activeTab,
    setActiveTab,
    tabletTab,
    showMobilePollingFetchStatus,
    appModalsAboutOpen,
    updaterState,
    startUpdate,
    cancelUpdate,
    dismissUpdate,
    postUpdateNotice,
    dismissPostUpdateNotice,
    errorToasts,
    dismissErrorToast,
    showDebugButton,
    handleDebugClick,
    sidebarRateLimits,
    sidebarAccount,
  };

  return {
    primary: buildCodexSurface(context),
    git: buildGitSurface(context),
    secondary: buildShellSurface(context),
  };
}
