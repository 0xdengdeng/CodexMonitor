import type { OpenAppTarget } from "@/types";

export const SETTINGS_SECTION_IDS = [
  "ai",
  "projects",
  "version",
  "about",
  "advanced",
  "deploy",
] as const;

export const SETTINGS_ROUTE_SECTION_IDS = [
  ...SETTINGS_SECTION_IDS,
  "profile",
] as const;

export type CodexSection = (typeof SETTINGS_SECTION_IDS)[number];

export type ShortcutSettingKey =
  | "composerModelShortcut"
  | "composerAccessShortcut"
  | "composerReasoningShortcut"
  | "composerCollaborationShortcut"
  | "interruptShortcut"
  | "newAgentShortcut"
  | "newWorktreeAgentShortcut"
  | "newCloneAgentShortcut"
  | "archiveThreadShortcut"
  | "toggleProjectsSidebarShortcut"
  | "toggleGitSidebarShortcut"
  | "branchSwitcherShortcut"
  | "toggleDebugPanelShortcut"
  | "toggleTerminalShortcut"
  | "cycleAgentNextShortcut"
  | "cycleAgentPrevShortcut"
  | "cycleWorkspaceNextShortcut"
  | "cycleWorkspacePrevShortcut";

export type ShortcutDraftKey =
  | "model"
  | "access"
  | "reasoning"
  | "collaboration"
  | "interrupt"
  | "newAgent"
  | "newWorktreeAgent"
  | "newCloneAgent"
  | "archiveThread"
  | "projectsSidebar"
  | "gitSidebar"
  | "branchSwitcher"
  | "debugPanel"
  | "terminal"
  | "cycleAgentNext"
  | "cycleAgentPrev"
  | "cycleWorkspaceNext"
  | "cycleWorkspacePrev";

export type ShortcutDrafts = Record<ShortcutDraftKey, string>;

export type OpenAppDraft = OpenAppTarget & { argsText: string };
