export type WorkspaceSettings = {
  sidebarCollapsed: boolean;
  sortOrder?: number | null;
  groupId?: string | null;
  cloneSourceWorkspaceId?: string | null;
  gitRoot?: string | null;
  launchScript?: string | null;
  launchScripts?: LaunchScriptEntry[] | null;
  worktreeSetupScript?: string | null;
  worktreesFolder?: string | null;
  deploy?: WorkspaceDeployState | null;
};

// ADG deploy plugin (docs/deploy-plugin-design.md). Mirrors Rust types in src-tauri/src/types.rs.
export type DeployStatus =
  | "idle"
  | "uploading"
  | "pending"
  | "building"
  | "running"
  | "failed"
  | "stopped"
  | "suspended";

// Per-workspace binding to one ADG app (1:1). appName is frozen (DNS-sanitized) at first deploy.
export type WorkspaceDeployState = {
  appId: string;
  appName: string;
  sourcePlatform?: string | null;
  subdomain?: string | null;
  lastStatus?: DeployStatus | null;
  lastDeployAt?: number | null;
};

export type DeployMetadata = {
  name: string;
  sourcePlatform?: string | null;
};

// Plugin-facing projection of an ADG app. `status` is the resolved display state
// (suspended > stopped > deployStatus); `deployStatus` is the raw latest_deploy.status.
export type DeployApp = {
  appId: string;
  name: string;
  templateId?: string | null;
  sourcePlatform?: string | null;
  subdomain?: string | null;
  url?: string | null;
  status: DeployStatus;
  desiredState?: string | null;
  deployStatus: DeployStatus;
  errorMessage?: string | null;
  deploymentId?: string | null;
  buildLogRef?: string | null;
};

export type LaunchScriptIconId =
  | "play"
  | "build"
  | "debug"
  | "wrench"
  | "terminal"
  | "code"
  | "server"
  | "database"
  | "package"
  | "test"
  | "lint"
  | "dev"
  | "git"
  | "config"
  | "logs";

export type LaunchScriptEntry = {
  id: string;
  script: string;
  icon: LaunchScriptIconId;
  label?: string | null;
};

export type WorkspaceGroup = {
  id: string;
  name: string;
  sortOrder?: number | null;
  copiesFolder?: string | null;
};

export type WorkspaceKind = "main" | "worktree";

export type WorktreeInfo = {
  branch: string;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  connected: boolean;
  kind?: WorkspaceKind;
  parentId?: string | null;
  worktree?: WorktreeInfo | null;
  settings: WorkspaceSettings;
};

export type GitRuntimeInfo = {
  available: boolean;
  source: "bundled" | "PATH" | "fallback" | string | null;
  path: string | null;
  version: string | null;
  error: string | null;
};

export type GitRuntimePreference = "auto" | "bundled" | "system";

export type AppServerEvent = {
  workspace_id: string;
  message: Record<string, unknown>;
};

export type TrayRecentThreadEntry = {
  workspaceId: string;
  workspaceLabel: string;
  threadId: string;
  threadLabel: string;
  updatedAt: number;
};

export type TraySessionUsage = {
  sessionLabel: string;
  weeklyLabel: string | null;
};

export type TrayOpenThreadPayload = {
  workspaceId: string;
  threadId: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type CollabAgentRef = {
  threadId: string;
  nickname?: string;
  role?: string;
};

export type CollabAgentStatus = CollabAgentRef & {
  status: string;
};

export type ConversationItem =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant";
      text: string;
      createdAt?: number;
      images?: string[];
    }
  | {
      id: string;
      kind: "userInput";
      status: "answered";
      questions: {
        id: string;
        header: string;
        question: string;
        answers: string[];
      }[];
    }
  | { id: string; kind: "reasoning"; summary: string; content: string }
  | { id: string; kind: "diff"; title: string; diff: string; status?: string }
  | { id: string; kind: "review"; state: "started" | "completed"; text: string }
  | {
      id: string;
      kind: "explore";
      status: "exploring" | "explored";
      entries: { kind: "read" | "search" | "list" | "run"; label: string; detail?: string }[];
    }
  | {
      id: string;
      kind: "tool";
      toolType: string;
      title: string;
      detail: string;
      status?: string;
      output?: string;
      durationMs?: number | null;
      changes?: { path: string; kind?: string; diff?: string }[];
      collabSender?: CollabAgentRef;
      collabReceiver?: CollabAgentRef;
      collabReceivers?: CollabAgentRef[];
      collabStatuses?: CollabAgentStatus[];
    }
  | {
      id: string;
      kind: "imageGeneration";
      status: "in_progress" | "completed" | "failed";
      prompt: string;
      revisedPrompt: string | null;
      model: string;
      size: string;
      assetId: string | null;
      savedPath: string | null;
      imageSrc: string | null;
      error: string | null;
      createdAt?: number;
    };

export type GeneratedImageAsset = {
  id: string;
  workspaceId: string | null;
  threadId: string | null;
  model: string;
  prompt: string;
  revisedPrompt: string | null;
  size: string;
  localPath: string;
  mimeType: string;
  createdAtMs: number;
  status: "completed" | string;
  // Assistant message preceding this image in the rollout. On history replay
  // resume drops the function output, so this is the only signal for where the
  // image belongs — the reducer inserts it right after this message.
  anchorMessageText: string | null;
};

export type ThreadSummary = {
  id: string;
  name: string;
  updatedAt: number;
  createdAt?: number;
  modelId?: string | null;
  effort?: string | null;
  isSubagent?: boolean;
  subagentNickname?: string | null;
  subagentRole?: string | null;
};

export type ThreadListSortKey = "created_at" | "updated_at";
export type ThreadListOrganizeMode =
  | "by_project"
  | "by_project_activity"
  | "threads_only";

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string };

export type PullRequestReviewIntent =
  | "full"
  | "risks"
  | "tests"
  | "summary"
  | "question";

export type PullRequestReviewAction = {
  id: string;
  label: string;
  intent: PullRequestReviewIntent;
};

export type PullRequestSelectionLine = {
  type: "add" | "del" | "context";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export type PullRequestSelectionRange = {
  path: string;
  status: string;
  start: number;
  end: number;
  lines: PullRequestSelectionLine[];
};

export type AccessMode = "read-only" | "current" | "full-access";
export type ServiceTier = "fast" | "flex";
export type BackendMode = "local" | "remote";
export type RemoteBackendProvider = "tcp";
export type RemoteBackendTarget = {
  id: string;
  name: string;
  provider: RemoteBackendProvider;
  host: string;
  token: string | null;
  lastConnectedAtMs?: number | null;
};
export type ManagedRuntimeConfig = {
  enabled: boolean;
  baseUrl: string | null;
  model: string | null;
  imageModel: string | null;
};
export type EnterpriseAiStatus = "disconnected" | "connected" | "invalid";
export type EnterpriseAiConfig = {
  tenantDomain: string | null;
  status: EnterpriseAiStatus;
  accountName: string | null;
  keyLast4: string | null;
  lastValidatedAtMs: number | null;
  lastError: string | null;
};
export type RuntimeApiKeyStatus = {
  hasApiKey: boolean;
};
export type EnterpriseAiLoginResult = {
  settings: AppSettings;
  usage: EnterpriseAiUsageSnapshot | null;
};
export type EnterpriseAiUsageSnapshot = {
  tenantDomain: string | null;
  accountName: string | null;
  updatedAtMs: number;
  requests7d: number | null;
  tokens7d: number | null;
  balance: number | null;
  creditedTotal: number | null;
  usageSpentTotal: number | null;
};
export type ThemePreference = "system" | "light" | "dark" | "dim";
export type InterfaceLanguagePreference = "system" | "en" | "zh-CN";
export type PersonalityPreference = "friendly" | "pragmatic";
export type FollowUpMessageBehavior = "queue" | "steer";
export type ComposerSendIntent = "default" | "queue" | "steer";
export type SendMessageResult = {
  status: "sent" | "blocked" | "steer_failed";
};

export type ComposerEditorPreset = "default" | "helpful" | "smart";

export type ComposerEditorSettings = {
  preset: ComposerEditorPreset;
  expandFenceOnSpace: boolean;
  expandFenceOnEnter: boolean;
  fenceLanguageTags: boolean;
  fenceWrapSelection: boolean;
  autoWrapPasteMultiline: boolean;
  autoWrapPasteCodeLike: boolean;
  continueListOnShiftEnter: boolean;
};

export type OpenAppTarget = {
  id: string;
  label: string;
  kind: "app" | "command" | "finder";
  appName?: string | null;
  command?: string | null;
  args: string[];
};

export type AppSettings = {
  codexArgs: string | null;
  backendMode: BackendMode;
  remoteBackendProvider: RemoteBackendProvider;
  remoteBackendHost: string;
  remoteBackendToken: string | null;
  remoteBackends: RemoteBackendTarget[];
  activeRemoteBackendId: string | null;
  managedRuntime: ManagedRuntimeConfig;
  enterpriseAi: EnterpriseAiConfig;
  keepDaemonRunningAfterAppClose: boolean;
  defaultAccessMode: AccessMode;
  reviewDeliveryMode: "inline" | "detached";
  composerModelShortcut: string | null;
  composerAccessShortcut: string | null;
  composerReasoningShortcut: string | null;
  composerCollaborationShortcut: string | null;
  interruptShortcut: string | null;
  newAgentShortcut: string | null;
  newWorktreeAgentShortcut: string | null;
  newCloneAgentShortcut: string | null;
  archiveThreadShortcut: string | null;
  toggleProjectsSidebarShortcut: string | null;
  toggleGitSidebarShortcut: string | null;
  branchSwitcherShortcut: string | null;
  toggleDebugPanelShortcut: string | null;
  toggleTerminalShortcut: string | null;
  cycleAgentNextShortcut: string | null;
  cycleAgentPrevShortcut: string | null;
  cycleWorkspaceNextShortcut: string | null;
  cycleWorkspacePrevShortcut: string | null;
  lastComposerModelId: string | null;
  lastComposerReasoningEffort: string | null;
  uiScale: number;
  theme: ThemePreference;
  interfaceLanguage: InterfaceLanguagePreference;
  usageShowRemaining: boolean;
  showMessageFilePath: boolean;
  chatHistoryScrollbackItems: number | null;
  threadTitleAutogenerationEnabled: boolean;
  automaticAppUpdateChecksEnabled: boolean;
  uiFontFamily: string;
  codeFontFamily: string;
  codeFontSize: number;
  notificationSoundsEnabled: boolean;
  systemNotificationsEnabled: boolean;
  subagentSystemNotificationsEnabled: boolean;
  splitChatDiffView: boolean;
  preloadGitDiffs: boolean;
  gitDiffIgnoreWhitespaceChanges: boolean;
  gitRuntimePreference: GitRuntimePreference;
  commitMessagePrompt: string;
  commitMessageModelId: string | null;
  collaborationModesEnabled: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: FollowUpMessageBehavior;
  composerFollowUpHintEnabled: boolean;
  pauseQueuedMessagesWhenResponseRequired: boolean;
  unifiedExecEnabled: boolean;
  experimentalAppsEnabled: boolean;
  personality: PersonalityPreference;
  composerEditorPreset: ComposerEditorPreset;
  composerFenceExpandOnSpace: boolean;
  composerFenceExpandOnEnter: boolean;
  composerFenceLanguageTags: boolean;
  composerFenceWrapSelection: boolean;
  composerFenceAutoWrapPasteMultiline: boolean;
  composerFenceAutoWrapPasteCodeLike: boolean;
  composerListContinuation: boolean;
  composerCodeBlockCopyUseModifier: boolean;
  workspaceGroups: WorkspaceGroup[];
  globalWorktreesFolder: string | null;
  openAppTargets: OpenAppTarget[];
  selectedOpenAppId: string;
};

export type CodexFeatureStage =
  | "under_development"
  | "beta"
  | "stable"
  | "deprecated"
  | "removed";

export type CodexFeature = {
  name: string;
  stage: CodexFeatureStage;
  enabled: boolean;
  defaultEnabled: boolean;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
};

export type TcpDaemonState = "stopped" | "running" | "error";

export type TcpDaemonStatus = {
  state: TcpDaemonState;
  pid: number | null;
  startedAtMs: number | null;
  lastError: string | null;
  listenAddr: string | null;
};

export type TailscaleStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  dnsName: string | null;
  hostName: string | null;
  tailnetName: string | null;
  ipv4: string[];
  ipv6: string[];
  suggestedRemoteHost: string | null;
  message: string;
};

export type TailscaleDaemonCommandPreview = {
  command: string;
  daemonPath: string;
  args: string[];
  tokenConfigured: boolean;
};

export type CodexDoctorResult = {
  ok: boolean;
  version: string | null;
  appServerOk: boolean;
  details: string | null;
  path: string | null;
  nodeOk: boolean;
  nodeVersion: string | null;
  nodeDetails: string | null;
};

export type CodexUpdateMethod = "bundled" | "brew_formula" | "brew_cask" | "npm" | "unknown";

export type CodexUpdateResult = {
  ok: boolean;
  method: CodexUpdateMethod;
  package: string | null;
  beforeVersion: string | null;
  afterVersion: string | null;
  upgraded: boolean;
  output: string | null;
  details: string | null;
};

export type ApprovalRequest = {
  workspace_id: string;
  request_id: number | string;
  method: string;
  params: Record<string, unknown>;
};

export type RequestUserInputOption = {
  label: string;
  description: string;
};

export type RequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  options?: RequestUserInputOption[];
};

export type RequestUserInputParams = {
  thread_id: string;
  turn_id: string;
  item_id: string;
  questions: RequestUserInputQuestion[];
};

export type RequestUserInputRequest = {
  workspace_id: string;
  request_id: number | string;
  params: RequestUserInputParams;
};

export type RequestUserInputAnswer = {
  answers: string[];
};

export type RequestUserInputResponse = {
  answers: Record<string, RequestUserInputAnswer>;
};

export type GitFileStatus = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

export type GitFileDiff = {
  path: string;
  diff: string;
  oldLines?: string[];
  newLines?: string[];
  isBinary?: boolean;
  isImage?: boolean;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
};

export type GitCommitDiff = {
  path: string;
  status: string;
  diff: string;
  oldLines?: string[];
  newLines?: string[];
  isBinary?: boolean;
  isImage?: boolean;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
};

export type GitLogEntry = {
  sha: string;
  summary: string;
  author: string;
  timestamp: number;
};

export type GitLogResponse = {
  total: number;
  entries: GitLogEntry[];
  ahead: number;
  behind: number;
  aheadEntries: GitLogEntry[];
  behindEntries: GitLogEntry[];
  upstream: string | null;
};

export type GitHubIssue = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
};

export type GitHubIssuesResponse = {
  total: number;
  issues: GitHubIssue[];
};

export type GitHubUser = {
  login: string;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  createdAt: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  author: GitHubUser | null;
};

export type GitHubPullRequestsResponse = {
  total: number;
  pullRequests: GitHubPullRequest[];
};

export type GitHubPullRequestDiff = {
  path: string;
  status: string;
  diff: string;
};

export type GitHubPullRequestComment = {
  id: number;
  body: string;
  createdAt: string;
  url: string;
  author: GitHubUser | null;
};

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type LocalUsageDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  agentTimeMs: number;
  agentRuns: number;
};

export type LocalUsageTotals = {
  last7DaysTokens: number;
  last30DaysTokens: number;
  averageDailyTokens: number;
  cacheHitRatePercent: number;
  peakDay: string | null;
  peakDayTokens: number;
};

export type LocalUsageModel = {
  model: string;
  tokens: number;
  sharePercent: number;
};

export type LocalUsageSnapshot = {
  updatedAt: number;
  days: LocalUsageDay[];
  totals: LocalUsageTotals;
  topModels: LocalUsageModel[];
};

export type TurnPlanStepStatus = "pending" | "inProgress" | "completed";

export type TurnPlanStep = {
  step: string;
  status: TurnPlanStepStatus;
};

export type TurnPlan = {
  turnId: string;
  explanation: string | null;
  steps: TurnPlanStep[];
};

export type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type CreditsSnapshot = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

export type RateLimitSnapshot = {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: CreditsSnapshot | null;
  planType: string | null;
};

export type AccountSnapshot = {
  type: "chatgpt" | "apikey" | "unknown";
  email: string | null;
  planType: string | null;
  requiresOpenaiAuth: boolean | null;
};

export type QueuedMessage = {
  id: string;
  text: string;
  createdAt: number;
  images?: string[];
  appMentions?: AppMention[];
};

export type AppMention = {
  name: string;
  path: string;
};

export type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
  type?: string | null;
  capabilities?: Record<string, boolean>;
  supportedEndpoints?: string[];
};

export type CollaborationModeOption = {
  id: string;
  label: string;
  mode: string;
  model: string;
  reasoningEffort: string | null;
  developerInstructions: string | null;
  value: Record<string, unknown>;
};

export type SkillOption = {
  name: string;
  path: string;
  description?: string;
  scope?: "user" | "repo" | "system" | "admin" | string;
  enabled?: boolean;
  effectiveEnabled?: boolean;
  sourcePath?: string;
  marketId?: string;
  installedVersion?: string;
  marketSourcePath?: string;
  installedAt?: string;
  uninstallable?: boolean;
};

export type SkillInstallTarget = "global" | "project";
export type SkillMarketInstallMode = "install" | "update";

export type SkillMarketItem = {
  id: string;
  name: string;
  version: string;
  title: string;
  description: string;
  categories: string[];
  tags: string[];
  publisher: string;
  verified: boolean;
  source: {
    type: string;
    path: string;
    files?: { path: string; executable?: boolean }[];
  };
};

export type SkillMarketInstallInput = {
  itemId: string;
  target: SkillInstallTarget;
  locale?: string | null;
  mode?: SkillMarketInstallMode;
};

export type SkillMarketInstallResult = {
  ok: boolean;
  name: string;
  version: string;
  path: string;
  target: SkillInstallTarget;
};

export type SkillUninstallInput = {
  path: string;
};

export type SkillUninstallResult = {
  ok: boolean;
  path: string;
};

export type McpServerOption = {
  name: string;
  scope?: "project" | "global" | "system" | "managed" | "runtime" | string;
  enabled?: boolean;
  configurable?: boolean;
  sourcePath?: string;
  toolsCount: number;
  resourcesCount: number;
  resourceTemplatesCount: number;
  authStatus?: string;
};

export type AppOption = {
  id: string;
  name: string;
  description?: string;
  isAccessible: boolean;
  installUrl?: string | null;
  distributionChannel?: string | null;
};

export type CustomPromptOption = {
  name: string;
  path: string;
  description?: string;
  argumentHint?: string;
  content: string;
  scope?: "workspace" | "global";
};

export type BranchInfo = {
  name: string;
  lastCommit: number;
};

export type DebugEntry = {
  id: string;
  timestamp: number;
  source: "client" | "server" | "event" | "stderr" | "error";
  label: string;
  payload?: unknown;
};

export type TerminalStatus = "idle" | "connecting" | "ready" | "error";
