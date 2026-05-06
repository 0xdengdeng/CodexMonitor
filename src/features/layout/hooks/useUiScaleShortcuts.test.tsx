// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { useUiScaleShortcuts } from "./useUiScaleShortcuts";

const isTauriMock = vi.hoisted(() => vi.fn(() => false));
const getCurrentWebviewMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("missing tauri metadata");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: getCurrentWebviewMock,
}));

function baseSettings(): AppSettings {
  return {
    codexBin: null,
    codexArgs: null,
    backendMode: "local",
    remoteBackendProvider: "tcp",
    remoteBackendHost: "127.0.0.1:4732",
    remoteBackendToken: null,
    remoteBackends: [],
    activeRemoteBackendId: null,
    keepDaemonRunningAfterAppClose: false,
    defaultAccessMode: "current",
    reviewDeliveryMode: "inline",
    composerModelShortcut: null,
    composerAccessShortcut: null,
    composerReasoningShortcut: null,
    composerCollaborationShortcut: null,
    interruptShortcut: null,
    newAgentShortcut: null,
    newWorktreeAgentShortcut: null,
    newCloneAgentShortcut: null,
    archiveThreadShortcut: null,
    toggleProjectsSidebarShortcut: null,
    toggleGitSidebarShortcut: null,
    branchSwitcherShortcut: null,
    toggleDebugPanelShortcut: null,
    toggleTerminalShortcut: null,
    cycleAgentNextShortcut: null,
    cycleAgentPrevShortcut: null,
    cycleWorkspaceNextShortcut: null,
    cycleWorkspacePrevShortcut: null,
    lastComposerModelId: null,
    lastComposerReasoningEffort: null,
    uiScale: 1,
    theme: "light",
    language: "zh-CN",
    usageShowRemaining: false,
    showMessageFilePath: true,
    chatHistoryScrollbackItems: 200,
    threadTitleAutogenerationEnabled: false,
    automaticAppUpdateChecksEnabled: false,
    uiFontFamily: "system-ui",
    codeFontFamily: "ui-monospace",
    codeFontSize: 11,
    notificationSoundsEnabled: true,
    systemNotificationsEnabled: true,
    subagentSystemNotificationsEnabled: true,
    splitChatDiffView: false,
    preloadGitDiffs: true,
    gitDiffIgnoreWhitespaceChanges: false,
    commitMessagePrompt: "",
    commitMessageModelId: null,
    collaborationModesEnabled: true,
    steerEnabled: true,
    followUpMessageBehavior: "queue",
    composerFollowUpHintEnabled: true,
    pauseQueuedMessagesWhenResponseRequired: true,
    unifiedExecEnabled: true,
    experimentalAppsEnabled: false,
    personality: "friendly",
    dictationEnabled: false,
    dictationModelId: "base",
    dictationPreferredLanguage: null,
    dictationHoldKey: null,
    composerEditorPreset: "default",
    composerFenceExpandOnSpace: false,
    composerFenceExpandOnEnter: false,
    composerFenceLanguageTags: false,
    composerFenceWrapSelection: false,
    composerFenceAutoWrapPasteMultiline: false,
    composerFenceAutoWrapPasteCodeLike: false,
    composerListContinuation: false,
    composerCodeBlockCopyUseModifier: false,
    workspaceGroups: [],
    globalWorktreesFolder: null,
    openAppTargets: [],
    selectedOpenAppId: "vscode",
  };
}

describe("useUiScaleShortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
  });

  it("does not touch the Tauri webview when running in a web preview", () => {
    expect(() => {
      renderHook(() =>
        useUiScaleShortcuts({
          settings: baseSettings(),
          setSettings: vi.fn(),
          saveSettings: vi.fn(),
        }),
      );
    }).not.toThrow();
    expect(getCurrentWebviewMock).not.toHaveBeenCalled();
  });
});
