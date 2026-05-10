import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  EnterpriseAiUsageSnapshot,
  WorkspaceInfo,
} from "@/types";
import {
  enterpriseAiLogin,
  enterpriseAiLogout,
  enterpriseAiUsage,
  enterpriseAiValidate,
} from "@services/tauri";
import { useGlobalAgentsMd } from "./useGlobalAgentsMd";
import { useGlobalCodexConfigToml } from "./useGlobalCodexConfigToml";
import { useSettingsDefaultModels } from "./useSettingsDefaultModels";
import { buildEditorContentMeta } from "@settings/components/settingsViewHelpers";
import { normalizeCodexArgsInput } from "@/utils/codexArgsInput";
import { useI18n } from "@/features/i18n/i18n";

type UseSettingsCodexSectionArgs = {
  appSettings: AppSettings;
  projects: WorkspaceInfo[];
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onRunDoctor: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexDoctorResult>;
  onRunCodexUpdate?: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexUpdateResult>;
};

export type SettingsCodexSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  defaultModels: ReturnType<typeof useSettingsDefaultModels>["models"];
  defaultModelsLoading: boolean;
  defaultModelsError: string | null;
  defaultModelsConnectedWorkspaceCount: number;
  onRefreshDefaultModels: () => void;
  codexArgsDraft: string;
  codexDirty: boolean;
  isSavingSettings: boolean;
  doctorState: {
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  };
  codexUpdateState: {
    status: "idle" | "running" | "done";
    result: CodexUpdateResult | null;
  };
  globalAgentsMeta: string;
  globalAgentsError: string | null;
  globalAgentsContent: string;
  globalAgentsLoading: boolean;
  globalAgentsRefreshDisabled: boolean;
  globalAgentsSaveDisabled: boolean;
  globalAgentsSaveLabel: string;
  globalConfigMeta: string;
  globalConfigError: string | null;
  globalConfigContent: string;
  globalConfigLoading: boolean;
  globalConfigRefreshDisabled: boolean;
  globalConfigSaveDisabled: boolean;
  globalConfigSaveLabel: string;
  enterpriseTenantDomainDraft: string;
  enterpriseApiKeyDraft: string;
  enterpriseAiUsage: EnterpriseAiUsageSnapshot | null;
  enterpriseAiLoading: boolean;
  enterpriseAiSaving: boolean;
  enterpriseAiError: string | null;
  onSetCodexArgsDraft: Dispatch<SetStateAction<string>>;
  onSetEnterpriseTenantDomainDraft: Dispatch<SetStateAction<string>>;
  onSetEnterpriseApiKeyDraft: Dispatch<SetStateAction<string>>;
  onSetGlobalAgentsContent: (value: string) => void;
  onSetGlobalConfigContent: (value: string) => void;
  onEnterpriseAiLogin: () => Promise<void>;
  onEnterpriseAiValidate: () => Promise<void>;
  onEnterpriseAiLogout: () => Promise<void>;
  onRefreshEnterpriseAiUsage: () => Promise<void>;
  onSaveCodexSettings: () => Promise<void>;
  onRunDoctor: () => Promise<void>;
  onRunCodexUpdate: () => Promise<void>;
  onRefreshGlobalAgents: () => void;
  onSaveGlobalAgents: () => void;
  onRefreshGlobalConfig: () => void;
  onSaveGlobalConfig: () => void;
};

export const useSettingsCodexSection = ({
  appSettings,
  projects,
  onUpdateAppSettings,
  onRunDoctor,
  onRunCodexUpdate,
}: UseSettingsCodexSectionArgs): SettingsCodexSectionProps => {
  const { t } = useI18n();
  const [codexArgsDraft, setCodexArgsDraft] = useState(appSettings.codexArgs ?? "");
  const [enterpriseTenantDomainDraft, setEnterpriseTenantDomainDraft] = useState(
    appSettings.enterpriseAi.tenantDomain ?? "",
  );
  const [enterpriseApiKeyDraft, setEnterpriseApiKeyDraft] = useState("");
  const [enterpriseAiUsageSnapshot, setEnterpriseAiUsageSnapshot] =
    useState<EnterpriseAiUsageSnapshot | null>(null);
  const [enterpriseAiLoading, setEnterpriseAiLoading] = useState(false);
  const [enterpriseAiSaving, setEnterpriseAiSaving] = useState(false);
  const [enterpriseAiError, setEnterpriseAiError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [doctorState, setDoctorState] = useState<{
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  }>({ status: "idle", result: null });
  const [codexUpdateState, setCodexUpdateState] = useState<{
    status: "idle" | "running" | "done";
    result: CodexUpdateResult | null;
  }>({ status: "idle", result: null });

  const {
    models: defaultModels,
    isLoading: defaultModelsLoading,
    error: defaultModelsError,
    connectedWorkspaceCount: defaultModelsConnectedWorkspaceCount,
    refresh: refreshDefaultModels,
  } = useSettingsDefaultModels(projects);

  const {
    content: globalAgentsContent,
    exists: globalAgentsExists,
    truncated: globalAgentsTruncated,
    isLoading: globalAgentsLoading,
    isSaving: globalAgentsSaving,
    error: globalAgentsError,
    isDirty: globalAgentsDirty,
    setContent: setGlobalAgentsContent,
    refresh: refreshGlobalAgents,
    save: saveGlobalAgents,
  } = useGlobalAgentsMd();

  const {
    content: globalConfigContent,
    exists: globalConfigExists,
    truncated: globalConfigTruncated,
    isLoading: globalConfigLoading,
    isSaving: globalConfigSaving,
    error: globalConfigError,
    isDirty: globalConfigDirty,
    setContent: setGlobalConfigContent,
    refresh: refreshGlobalConfig,
    save: saveGlobalConfig,
  } = useGlobalCodexConfigToml();

  const globalAgentsEditorMeta = buildEditorContentMeta({
    isLoading: globalAgentsLoading,
    isSaving: globalAgentsSaving,
    exists: globalAgentsExists,
    truncated: globalAgentsTruncated,
    isDirty: globalAgentsDirty,
    copy: {
      loading: t("settings.common.loading"),
      saving: t("settings.common.saving"),
      notFound: t("settings.editor.notFound"),
      truncated: t("settings.editor.truncated"),
      save: t("settings.common.save"),
      create: t("settings.common.create"),
    },
  });

  const globalConfigEditorMeta = buildEditorContentMeta({
    isLoading: globalConfigLoading,
    isSaving: globalConfigSaving,
    exists: globalConfigExists,
    truncated: globalConfigTruncated,
    isDirty: globalConfigDirty,
    copy: {
      loading: t("settings.common.loading"),
      saving: t("settings.common.saving"),
      notFound: t("settings.editor.notFound"),
      truncated: t("settings.editor.truncated"),
      save: t("settings.common.save"),
      create: t("settings.common.create"),
    },
  });

  useEffect(() => {
    setCodexArgsDraft(appSettings.codexArgs ?? "");
  }, [appSettings.codexArgs]);

  useEffect(() => {
    setEnterpriseTenantDomainDraft(appSettings.enterpriseAi.tenantDomain ?? "");
  }, [appSettings.enterpriseAi.tenantDomain]);

  const nextCodexArgs = normalizeCodexArgsInput(codexArgsDraft);
  const codexDirty =
    appSettings.codexBin !== null || nextCodexArgs !== (appSettings.codexArgs ?? null);

  const handleSaveCodexSettings = async () => {
    setIsSavingSettings(true);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        codexBin: null,
        codexArgs: nextCodexArgs,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRunDoctor = async () => {
    setDoctorState({ status: "running", result: null });
    try {
      const result = await onRunDoctor(null, nextCodexArgs);
      setDoctorState({ status: "done", result });
    } catch (error) {
      setDoctorState({
        status: "done",
        result: {
          ok: false,
          codexBin: null,
          version: null,
          appServerOk: false,
          details: error instanceof Error ? error.message : String(error),
          path: null,
          nodeOk: false,
          nodeVersion: null,
          nodeDetails: null,
        },
      });
    }
  };

  const handleRunCodexUpdate = async () => {
    setCodexUpdateState({ status: "running", result: null });
    try {
      if (!onRunCodexUpdate) {
        setCodexUpdateState({
          status: "done",
          result: {
            ok: false,
            method: "unknown",
            package: null,
            beforeVersion: null,
            afterVersion: null,
            upgraded: false,
            output: null,
            details: t("settings.codex.updateUnavailable"),
          },
        });
        return;
      }

      const result = await onRunCodexUpdate(null, nextCodexArgs);
      setCodexUpdateState({ status: "done", result });
    } catch (error) {
      setCodexUpdateState({
        status: "done",
        result: {
          ok: false,
          method: "unknown",
          package: null,
          beforeVersion: null,
          afterVersion: null,
          upgraded: false,
          output: null,
          details: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const handleEnterpriseAiLogin = async () => {
    const tenantDomain = enterpriseTenantDomainDraft.trim();
    const apiKey = enterpriseApiKeyDraft.trim();
    if (!tenantDomain) {
      setEnterpriseAiError(t("settings.codex.enterpriseTenantRequired"));
      return;
    }
    if (!apiKey) {
      setEnterpriseAiError(t("settings.codex.apiKeyRequired"));
      return;
    }
    setEnterpriseAiSaving(true);
    setEnterpriseAiError(null);
    try {
      const result = await enterpriseAiLogin(tenantDomain, apiKey);
      setEnterpriseApiKeyDraft("");
      setEnterpriseAiUsageSnapshot(result.usage);
      await onUpdateAppSettings(result.settings);
    } catch (error) {
      setEnterpriseAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnterpriseAiSaving(false);
    }
  };

  const handleEnterpriseAiValidate = useCallback(async () => {
    setEnterpriseAiLoading(true);
    setEnterpriseAiError(null);
    try {
      const result = await enterpriseAiValidate();
      setEnterpriseAiUsageSnapshot(result.usage);
      await onUpdateAppSettings(result.settings);
    } catch (error) {
      setEnterpriseAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnterpriseAiLoading(false);
    }
  }, [onUpdateAppSettings]);

  const handleRefreshEnterpriseAiUsage = useCallback(async () => {
    setEnterpriseAiLoading(true);
    setEnterpriseAiError(null);
    try {
      setEnterpriseAiUsageSnapshot(await enterpriseAiUsage());
    } catch (error) {
      setEnterpriseAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnterpriseAiLoading(false);
    }
  }, []);

  const handleEnterpriseAiLogout = async () => {
    setEnterpriseAiSaving(true);
    setEnterpriseAiError(null);
    try {
      const settings = await enterpriseAiLogout();
      setEnterpriseApiKeyDraft("");
      setEnterpriseAiUsageSnapshot(null);
      await onUpdateAppSettings(settings);
    } catch (error) {
      setEnterpriseAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnterpriseAiSaving(false);
    }
  };

  useEffect(() => {
    if (appSettings.enterpriseAi.tenantDomain) {
      void handleEnterpriseAiValidate();
    }
  }, [appSettings.enterpriseAi.tenantDomain, handleEnterpriseAiValidate]);

  return {
    appSettings,
    onUpdateAppSettings,
    defaultModels,
    defaultModelsLoading,
    defaultModelsError,
    defaultModelsConnectedWorkspaceCount,
    onRefreshDefaultModels: () => {
      void refreshDefaultModels();
    },
    codexArgsDraft,
    codexDirty,
    isSavingSettings,
    doctorState,
    codexUpdateState,
    globalAgentsMeta: globalAgentsEditorMeta.meta,
    globalAgentsError,
    globalAgentsContent,
    globalAgentsLoading,
    globalAgentsRefreshDisabled: globalAgentsEditorMeta.refreshDisabled,
    globalAgentsSaveDisabled: globalAgentsEditorMeta.saveDisabled,
    globalAgentsSaveLabel: globalAgentsEditorMeta.saveLabel,
    globalConfigMeta: globalConfigEditorMeta.meta,
    globalConfigError,
    globalConfigContent,
    globalConfigLoading,
    globalConfigRefreshDisabled: globalConfigEditorMeta.refreshDisabled,
    globalConfigSaveDisabled: globalConfigEditorMeta.saveDisabled,
    globalConfigSaveLabel: globalConfigEditorMeta.saveLabel,
    enterpriseTenantDomainDraft,
    enterpriseApiKeyDraft,
    enterpriseAiUsage: enterpriseAiUsageSnapshot,
    enterpriseAiLoading,
    enterpriseAiSaving,
    enterpriseAiError,
    onSetCodexArgsDraft: setCodexArgsDraft,
    onSetEnterpriseTenantDomainDraft: setEnterpriseTenantDomainDraft,
    onSetEnterpriseApiKeyDraft: setEnterpriseApiKeyDraft,
    onSetGlobalAgentsContent: setGlobalAgentsContent,
    onSetGlobalConfigContent: setGlobalConfigContent,
    onEnterpriseAiLogin: handleEnterpriseAiLogin,
    onEnterpriseAiValidate: handleEnterpriseAiValidate,
    onEnterpriseAiLogout: handleEnterpriseAiLogout,
    onRefreshEnterpriseAiUsage: handleRefreshEnterpriseAiUsage,
    onSaveCodexSettings: handleSaveCodexSettings,
    onRunDoctor: handleRunDoctor,
    onRunCodexUpdate: handleRunCodexUpdate,
    onRefreshGlobalAgents: () => {
      void refreshGlobalAgents();
    },
    onSaveGlobalAgents: () => {
      void saveGlobalAgents();
    },
    onRefreshGlobalConfig: () => {
      void refreshGlobalConfig();
    },
    onSaveGlobalConfig: () => {
      void saveGlobalConfig();
    },
  };
};
