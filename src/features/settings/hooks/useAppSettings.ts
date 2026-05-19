import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "@/types";
import {
  getAppSettings,
  getRuntimeImageModelList,
  runCodexDoctor,
  updateAppSettings,
} from "@services/tauri";
import { clampUiScale, UI_SCALE_DEFAULT } from "@utils/uiScale";
import { CHAT_SCROLLBACK_DEFAULT, normalizeChatHistoryScrollbackItems } from "@utils/chatScrollback";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  CODE_FONT_SIZE_DEFAULT,
  clampCodeFontSize,
  normalizeFontFamily,
} from "@utils/fonts";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
  OPEN_APP_STORAGE_KEY,
} from "@app/constants";
import { normalizeOpenAppTargets } from "@app/utils/openApp";
import { getDefaultInterruptShortcut, isMacPlatform } from "@utils/shortcuts";
import { isMobilePlatform } from "@utils/platformPaths";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "@utils/commitMessagePrompt";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  normalizeInterfaceLanguage,
} from "@/features/i18n/i18n";
import { normalizePublicImageModel } from "@/utils/imageModels";
import { parseModelListResponse } from "@/features/models/utils/modelListResponse";

const allowedThemes = new Set(["system", "light", "dark", "dim"]);
const allowedPersonality = new Set(["friendly", "pragmatic"]);
const allowedFollowUpMessageBehavior = new Set(["queue", "steer"]);
const allowedGitRuntimePreference = new Set(["auto", "bundled", "system"]);
const DEFAULT_REMOTE_BACKEND_HOST = "127.0.0.1:4732";
const DEFAULT_REMOTE_BACKEND_ID = "remote-default";
const DEFAULT_REMOTE_BACKEND_NAME = "Primary remote";
const DEFAULT_REMOTE_PROVIDER: AppSettings["remoteBackendProvider"] = "tcp";

type RemoteBackendTarget = AppSettings["remoteBackends"][number];

function normalizeRemoteProvider(value: unknown): AppSettings["remoteBackendProvider"] {
  void value;
  return "tcp";
}

function normalizeRemoteToken(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function normalizeRemoteHost(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : DEFAULT_REMOTE_BACKEND_HOST;
}

function normalizeRemoteName(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function normalizeManagedRuntime(
  value: AppSettings["managedRuntime"] | null | undefined,
): AppSettings["managedRuntime"] {
  return {
    enabled: value?.enabled === true,
    baseUrl: normalizeNullableString(value?.baseUrl),
    model: normalizeNullableString(value?.model),
    imageModel: normalizeNullableString(normalizePublicImageModel(value?.imageModel)),
    nativeImageGeneration: value?.nativeImageGeneration !== false,
  };
}

function selectCatalogImageModel(
  response: unknown,
  savedImageModel: string | null,
): string | null {
  const imageModels = parseModelListResponse(response);
  if (imageModels.length === 0) {
    return null;
  }
  const saved = normalizePublicImageModel(savedImageModel);
  const selected =
    imageModels.find((model) => model.model === saved) ??
    imageModels.find((model) => model.id === saved) ??
    imageModels[0];
  return normalizeNullableString(normalizePublicImageModel(selected.model));
}

function normalizeEnterpriseAi(
  value: AppSettings["enterpriseAi"] | null | undefined,
): AppSettings["enterpriseAi"] {
  const status = value?.status;
  return {
    tenantDomain: normalizeNullableString(value?.tenantDomain),
    status:
      status === "connected" || status === "invalid" || status === "disconnected"
        ? status
        : "disconnected",
    accountName: normalizeNullableString(value?.accountName),
    keyLast4: normalizeNullableString(value?.keyLast4),
    lastValidatedAtMs:
      typeof value?.lastValidatedAtMs === "number" &&
      Number.isFinite(value.lastValidatedAtMs)
        ? value.lastValidatedAtMs
        : null,
    lastError: normalizeNullableString(value?.lastError),
  };
}

function normalizeRemoteBackends(settings: AppSettings): {
  remoteBackends: RemoteBackendTarget[];
  activeRemoteBackendId: string | null;
  remoteBackendProvider: AppSettings["remoteBackendProvider"];
  remoteBackendHost: string;
  remoteBackendToken: string | null;
} {
  const legacyProvider = normalizeRemoteProvider(settings.remoteBackendProvider);
  const legacyHost = normalizeRemoteHost(settings.remoteBackendHost);
  const legacyToken = normalizeRemoteToken(settings.remoteBackendToken);
  const usedIds = new Set<string>();

  const normalized = (settings.remoteBackends ?? []).map((entry, index) => {
    const baseId = entry.id?.trim() || `remote-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      name: normalizeRemoteName(entry.name, `Remote ${index + 1}`),
      provider: normalizeRemoteProvider(entry.provider),
      host: normalizeRemoteHost(entry.host),
      token: normalizeRemoteToken(entry.token),
      lastConnectedAtMs:
        typeof entry.lastConnectedAtMs === "number" && Number.isFinite(entry.lastConnectedAtMs)
          ? entry.lastConnectedAtMs
          : null,
    };
  });

  if (normalized.length === 0) {
    const fallback: RemoteBackendTarget = {
      id: DEFAULT_REMOTE_BACKEND_ID,
      name: DEFAULT_REMOTE_BACKEND_NAME,
      provider: legacyProvider,
      host: legacyHost,
      token: legacyToken,
      lastConnectedAtMs: null,
    };
    return {
      remoteBackends: [fallback],
      activeRemoteBackendId: fallback.id,
      remoteBackendProvider: fallback.provider,
      remoteBackendHost: fallback.host,
      remoteBackendToken: fallback.token,
    };
  }

  const activeIndexById =
    settings.activeRemoteBackendId == null
      ? -1
      : normalized.findIndex((entry) => entry.id === settings.activeRemoteBackendId);
  const activeIndex = activeIndexById >= 0 ? activeIndexById : 0;
  const active = normalized[activeIndex];
  const syncedActive = {
    ...active,
    provider: legacyProvider,
    host: legacyHost,
    token: legacyToken,
  };
  const remoteBackends = [...normalized];
  remoteBackends[activeIndex] = syncedActive;
  return {
    remoteBackends,
    activeRemoteBackendId: syncedActive.id,
    remoteBackendProvider: syncedActive.provider,
    remoteBackendHost: syncedActive.host,
    remoteBackendToken: syncedActive.token,
  };
}

function buildDefaultSettings(): AppSettings {
  const isMac = isMacPlatform();
  const isMobile = isMobilePlatform();
  const defaultRemote: RemoteBackendTarget = {
    id: DEFAULT_REMOTE_BACKEND_ID,
    name: DEFAULT_REMOTE_BACKEND_NAME,
    provider: DEFAULT_REMOTE_PROVIDER,
    host: DEFAULT_REMOTE_BACKEND_HOST,
    token: null,
    lastConnectedAtMs: null,
  };
  return {
    codexArgs: null,
    backendMode: isMobile ? "remote" : "local",
    remoteBackendProvider: defaultRemote.provider,
    remoteBackendHost: defaultRemote.host,
    remoteBackendToken: null,
    remoteBackends: [defaultRemote],
    activeRemoteBackendId: defaultRemote.id,
    managedRuntime: {
      enabled: false,
      baseUrl: null,
      model: null,
      imageModel: null,
      nativeImageGeneration: true,
    },
    enterpriseAi: {
      tenantDomain: null,
      status: "disconnected",
      accountName: null,
      keyLast4: null,
      lastValidatedAtMs: null,
      lastError: null,
    },
    keepDaemonRunningAfterAppClose: false,
    defaultAccessMode: "current",
    reviewDeliveryMode: "inline",
    composerModelShortcut: isMac ? "cmd+shift+m" : "ctrl+shift+m",
    composerAccessShortcut: isMac ? "cmd+shift+a" : "ctrl+shift+a",
    composerReasoningShortcut: isMac ? "cmd+shift+r" : "ctrl+shift+r",
    composerCollaborationShortcut: "shift+tab",
    interruptShortcut: getDefaultInterruptShortcut(),
    newAgentShortcut: isMac ? "cmd+n" : "ctrl+n",
    newWorktreeAgentShortcut: isMac ? "cmd+shift+n" : "ctrl+shift+n",
    newCloneAgentShortcut: isMac ? "cmd+alt+n" : "ctrl+alt+n",
    archiveThreadShortcut: isMac ? "cmd+ctrl+a" : "ctrl+alt+a",
    toggleProjectsSidebarShortcut: isMac ? "cmd+shift+p" : "ctrl+shift+p",
    toggleGitSidebarShortcut: isMac ? "cmd+shift+g" : "ctrl+shift+g",
    branchSwitcherShortcut: isMac ? "cmd+b" : "ctrl+b",
    toggleDebugPanelShortcut: isMac ? "cmd+shift+d" : "ctrl+shift+d",
    toggleTerminalShortcut: isMac ? "cmd+shift+t" : "ctrl+shift+t",
    cycleAgentNextShortcut: isMac ? "cmd+ctrl+down" : "ctrl+alt+down",
    cycleAgentPrevShortcut: isMac ? "cmd+ctrl+up" : "ctrl+alt+up",
    cycleWorkspaceNextShortcut: isMac ? "cmd+shift+down" : "ctrl+alt+shift+down",
    cycleWorkspacePrevShortcut: isMac ? "cmd+shift+up" : "ctrl+alt+shift+up",
    lastComposerModelId: null,
    lastComposerReasoningEffort: null,
    uiScale: UI_SCALE_DEFAULT,
    theme: "system",
    interfaceLanguage: DEFAULT_INTERFACE_LANGUAGE,
    usageShowRemaining: false,
    showMessageFilePath: true,
    chatHistoryScrollbackItems: CHAT_SCROLLBACK_DEFAULT,
    threadTitleAutogenerationEnabled: false,
    automaticAppUpdateChecksEnabled: true,
    uiFontFamily: DEFAULT_UI_FONT_FAMILY,
    codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
    codeFontSize: CODE_FONT_SIZE_DEFAULT,
    notificationSoundsEnabled: true,
    systemNotificationsEnabled: true,
    subagentSystemNotificationsEnabled: true,
    splitChatDiffView: false,
    preloadGitDiffs: true,
    gitDiffIgnoreWhitespaceChanges: false,
    gitRuntimePreference: "auto",
    commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
    commitMessageModelId: null,
    collaborationModesEnabled: true,
    steerEnabled: true,
    followUpMessageBehavior: "queue",
    composerFollowUpHintEnabled: true,
    pauseQueuedMessagesWhenResponseRequired: true,
    unifiedExecEnabled: true,
    experimentalAppsEnabled: false,
    personality: "friendly",
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
    openAppTargets: DEFAULT_OPEN_APP_TARGETS,
    selectedOpenAppId: DEFAULT_OPEN_APP_ID,
    globalWorktreesFolder: null,
  };
}

function normalizeAppSettings(settings: AppSettings): AppSettings {
  const remoteBackendSettings = normalizeRemoteBackends(settings);
  const normalizedTargets =
    settings.openAppTargets && settings.openAppTargets.length
      ? normalizeOpenAppTargets(settings.openAppTargets)
      : DEFAULT_OPEN_APP_TARGETS;
  const storedOpenAppId =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(OPEN_APP_STORAGE_KEY);
  const hasPersistedSelection = normalizedTargets.some(
    (target) => target.id === settings.selectedOpenAppId,
  );
  const hasStoredSelection =
    !hasPersistedSelection &&
    storedOpenAppId !== null &&
    normalizedTargets.some((target) => target.id === storedOpenAppId);
  const selectedOpenAppId = hasPersistedSelection
    ? settings.selectedOpenAppId
    : hasStoredSelection
      ? storedOpenAppId
      : normalizedTargets[0]?.id ?? DEFAULT_OPEN_APP_ID;
  const commitMessagePrompt =
    settings.commitMessagePrompt && settings.commitMessagePrompt.trim().length > 0
      ? settings.commitMessagePrompt
      : DEFAULT_COMMIT_MESSAGE_PROMPT;
  const chatHistoryScrollbackItems = normalizeChatHistoryScrollbackItems(
    settings.chatHistoryScrollbackItems,
  );
  return {
    ...settings,
    ...remoteBackendSettings,
    codexArgs: settings.codexArgs?.trim() ? settings.codexArgs.trim() : null,
    managedRuntime: normalizeManagedRuntime(settings.managedRuntime),
    enterpriseAi: normalizeEnterpriseAi(settings.enterpriseAi),
    uiScale: clampUiScale(settings.uiScale),
    theme: allowedThemes.has(settings.theme) ? settings.theme : "system",
    interfaceLanguage: normalizeInterfaceLanguage(settings.interfaceLanguage),
    uiFontFamily: normalizeFontFamily(
      settings.uiFontFamily,
      DEFAULT_UI_FONT_FAMILY,
    ),
    codeFontFamily: normalizeFontFamily(
      settings.codeFontFamily,
      DEFAULT_CODE_FONT_FAMILY,
    ),
    codeFontSize: clampCodeFontSize(settings.codeFontSize),
    personality: allowedPersonality.has(settings.personality)
      ? settings.personality
      : "friendly",
    followUpMessageBehavior: allowedFollowUpMessageBehavior.has(
      settings.followUpMessageBehavior,
    )
      ? settings.followUpMessageBehavior
      : settings.steerEnabled
        ? "steer"
        : "queue",
    composerFollowUpHintEnabled:
      typeof settings.composerFollowUpHintEnabled === "boolean"
        ? settings.composerFollowUpHintEnabled
        : true,
    reviewDeliveryMode:
      settings.reviewDeliveryMode === "detached" ? "detached" : "inline",
    gitRuntimePreference: allowedGitRuntimePreference.has(settings.gitRuntimePreference)
      ? settings.gitRuntimePreference
      : "auto",
    chatHistoryScrollbackItems,
    commitMessagePrompt,
    openAppTargets: normalizedTargets,
    selectedOpenAppId,
  };
}

export function useAppSettings() {
  const defaultSettings = useMemo(() => buildDefaultSettings(), []);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const settingsRef = useRef<AppSettings>(defaultSettings);
  const imageModelReconcileKeyRef = useRef<string | null>(null);
  const setSettingsState = useCallback<Dispatch<SetStateAction<AppSettings>>>((next) => {
    const resolved =
      typeof next === "function"
        ? (next as (value: AppSettings) => AppSettings)(settingsRef.current)
        : next;
    settingsRef.current = resolved;
    setSettings(resolved);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await getAppSettings();
        if (active) {
          setSettingsState(
            normalizeAppSettings({
              ...defaultSettings,
              ...response,
            }),
          );
        }
      } catch {
        // Defaults stay in place if loading settings fails.
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [defaultSettings, setSettingsState]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const runtime = settings.managedRuntime;
    if (!runtime.enabled || !runtime.baseUrl) {
      return;
    }
    const key = JSON.stringify([
      runtime.baseUrl,
      runtime.model,
      runtime.imageModel,
      settings.enterpriseAi.status,
      settings.enterpriseAi.keyLast4,
    ]);
    if (imageModelReconcileKeyRef.current === key) {
      return;
    }
    imageModelReconcileKeyRef.current = key;

    let active = true;
    void (async () => {
      try {
        const response = await getRuntimeImageModelList();
        if (!active) {
          return;
        }
        const selectedImageModel = selectCatalogImageModel(
          response,
          settingsRef.current.managedRuntime.imageModel,
        );
        if (!selectedImageModel) {
          return;
        }
        const current = settingsRef.current;
        if (
          !current.managedRuntime.enabled ||
          current.managedRuntime.baseUrl !== runtime.baseUrl
        ) {
          return;
        }
        const currentImageModel = normalizePublicImageModel(
          current.managedRuntime.imageModel,
        );
        if (currentImageModel === selectedImageModel) {
          return;
        }
        const normalized = normalizeAppSettings({
          ...current,
          managedRuntime: {
            ...current.managedRuntime,
            imageModel: selectedImageModel,
          },
        });
        setSettingsState(normalized);
        const saved = await updateAppSettings(normalized);
        if (settingsRef.current === normalized) {
          setSettingsState(
            normalizeAppSettings({
              ...defaultSettings,
              ...saved,
            }),
          );
        }
      } catch {
        imageModelReconcileKeyRef.current = null;
        // Keep the loaded settings if the runtime catalog is temporarily unavailable.
      }
    })();

    return () => {
      active = false;
    };
  }, [
    defaultSettings,
    isLoading,
    settings.managedRuntime.baseUrl,
    settings.managedRuntime.enabled,
    settings.managedRuntime.imageModel,
    settings.managedRuntime.model,
    settings.enterpriseAi.keyLast4,
    settings.enterpriseAi.status,
    setSettingsState,
  ]);

  const saveSettings = useCallback(async (next: AppSettings) => {
    const previous = settingsRef.current;
    const normalized = normalizeAppSettings({
      ...defaultSettings,
      ...next,
    });
    setSettingsState(normalized);

    try {
      const saved = await updateAppSettings(normalized);
      if (settingsRef.current === normalized) {
        setSettingsState(
          normalizeAppSettings({
            ...defaultSettings,
            ...saved,
          }),
        );
      }
      return saved;
    } catch (error) {
      if (settingsRef.current === normalized) {
        setSettingsState(previous);
      }
      throw error;
    }
  }, [defaultSettings, setSettingsState]);

  const doctor = useCallback(
    async (codexArgs: string | null) => {
      return runCodexDoctor(codexArgs);
    },
    [],
  );

  return {
    settings,
    setSettings: setSettingsState,
    saveSettings,
    doctor,
    isLoading,
  };
}
