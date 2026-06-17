import { useEffect, useMemo, useRef } from "react";
import Stethoscope from "lucide-react/dist/esm/icons/stethoscope";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  EnterpriseAiUsageSnapshot,
  ModelOption,
} from "@/types";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { SelectMenu } from "@/features/design-system/components/select/SelectMenu";
import { FileEditorCard } from "@/features/shared/components/FileEditorCard";
import { useI18n } from "@/features/i18n/i18n";
import { buildReasoningEffortOptions } from "@/features/models/utils/reasoningLabels";
import { normalizePublicImageModel } from "@/utils/imageModels";

type SettingsCodexSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  defaultModels: ModelOption[];
  defaultModelsLoading: boolean;
  defaultModelsError: string | null;
  defaultModelsConnectedWorkspaceCount: number;
  onRefreshDefaultModels: () => void;
  imageModels: ModelOption[];
  imageModelsLoading: boolean;
  imageModelsError: string | null;
  onRefreshImageModels: () => void;
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
  enterpriseApiKeyDraft: string;
  enterpriseAiUsage: EnterpriseAiUsageSnapshot | null;
  enterpriseAiLoading: boolean;
  enterpriseAiSaving: boolean;
  enterpriseAiError: string | null;
  developerModeEnabled: boolean;
  developerBaseUrlDraft: string;
  developerApiKeyDraft: string;
  developerRuntimeSaving: boolean;
  developerRuntimeError: string | null;
  onSetCodexArgsDraft: Dispatch<SetStateAction<string>>;
  onSetEnterpriseApiKeyDraft: Dispatch<SetStateAction<string>>;
  onSetDeveloperBaseUrlDraft: Dispatch<SetStateAction<string>>;
  onSetDeveloperApiKeyDraft: Dispatch<SetStateAction<string>>;
  onSetGlobalAgentsContent: (value: string) => void;
  onSetGlobalConfigContent: (value: string) => void;
  onEnterpriseAiLogin: () => Promise<void>;
  onEnterpriseAiValidate: () => Promise<void>;
  onEnterpriseAiLogout: () => Promise<void>;
  onRefreshEnterpriseAiUsage: () => Promise<void>;
  onSaveDeveloperRuntime: () => Promise<void>;
  onSaveCodexSettings: () => Promise<void>;
  onRunDoctor: () => Promise<void>;
  onRunCodexUpdate: () => Promise<void>;
  onRefreshGlobalAgents: () => void;
  onSaveGlobalAgents: () => void;
  onRefreshGlobalConfig: () => void;
  onSaveGlobalConfig: () => void;
};

const DEFAULT_REASONING_EFFORT = "medium";

const formatEnterpriseNumber = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
};

const normalizeEffortValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
};

function coerceSavedModelId(value: string | null, models: ModelOption[]): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const byId = models.find((model) => model.id === trimmed);
  if (byId) {
    return byId.id;
  }
  const bySlug = models.find((model) => model.model === trimmed);
  return bySlug ? bySlug.id : null;
}

const getReasoningSupport = (model: ModelOption | null): boolean => {
  if (!model) {
    return false;
  }
  return model.supportedReasoningEfforts.length > 0 || model.defaultReasoningEffort !== null;
};

const getReasoningOptions = (model: ModelOption | null): string[] => {
  if (!model) {
    return [];
  }
  const supported = model.supportedReasoningEfforts
    .map((effort) => normalizeEffortValue(effort.reasoningEffort))
    .filter((effort): effort is string => Boolean(effort));
  if (supported.length > 0) {
    return Array.from(new Set(supported));
  }
  const fallback = normalizeEffortValue(model.defaultReasoningEffort);
  return fallback ? [fallback] : [];
};

export function SettingsCodexSection({
  appSettings,
  onUpdateAppSettings,
  defaultModels,
  defaultModelsLoading,
  defaultModelsError,
  defaultModelsConnectedWorkspaceCount,
  onRefreshDefaultModels,
  imageModels,
  imageModelsLoading,
  imageModelsError,
  onRefreshImageModels,
  codexArgsDraft,
  codexDirty,
  isSavingSettings,
  doctorState,
  codexUpdateState,
  globalAgentsMeta,
  globalAgentsError,
  globalAgentsContent,
  globalAgentsLoading,
  globalAgentsRefreshDisabled,
  globalAgentsSaveDisabled,
  globalAgentsSaveLabel,
  globalConfigMeta,
  globalConfigError,
  globalConfigContent,
  globalConfigLoading,
  globalConfigRefreshDisabled,
  globalConfigSaveDisabled,
  globalConfigSaveLabel,
  enterpriseApiKeyDraft,
  enterpriseAiUsage,
  enterpriseAiLoading,
  enterpriseAiSaving,
  enterpriseAiError,
  developerModeEnabled,
  developerBaseUrlDraft,
  developerApiKeyDraft,
  developerRuntimeSaving,
  developerRuntimeError,
  onSetCodexArgsDraft,
  onSetEnterpriseApiKeyDraft,
  onSetDeveloperBaseUrlDraft,
  onSetDeveloperApiKeyDraft,
  onSetGlobalAgentsContent,
  onSetGlobalConfigContent,
  onEnterpriseAiLogin,
  onEnterpriseAiValidate,
  onEnterpriseAiLogout,
  onRefreshEnterpriseAiUsage,
  onSaveDeveloperRuntime,
  onSaveCodexSettings,
  onRunDoctor,
  onRunCodexUpdate,
  onRefreshGlobalAgents,
  onSaveGlobalAgents,
  onRefreshGlobalConfig,
  onSaveGlobalConfig,
}: SettingsCodexSectionProps) {
  const { t } = useI18n();
  const enterpriseAi = appSettings.enterpriseAi;
  const isEnterpriseConnected = enterpriseAi.status === "connected";
  const latestModelId = defaultModels[0]?.id ?? null;
  const savedModelId = useMemo(
    () => coerceSavedModelId(appSettings.lastComposerModelId, defaultModels),
    [appSettings.lastComposerModelId, defaultModels],
  );
  const selectedModelId = savedModelId ?? latestModelId ?? "";
  const selectedModel = useMemo(
    () => defaultModels.find((model) => model.id === selectedModelId) ?? null,
    [defaultModels, selectedModelId],
  );
  const savedImageModelId = useMemo(
    () => {
      const saved = normalizePublicImageModel(appSettings.managedRuntime.imageModel);
      return imageModels.find((model) => model.model === saved)?.model ?? null;
    },
    [appSettings.managedRuntime.imageModel, imageModels],
  );
  const configuredImageModelId = normalizePublicImageModel(
    appSettings.managedRuntime.imageModel,
  );
  const selectedImageModelId =
    savedImageModelId ??
    imageModels[0]?.model ??
    configuredImageModelId;
  const reasoningSupported = useMemo(
    () => getReasoningSupport(selectedModel),
    [selectedModel],
  );
  const reasoningOptions = useMemo(
    () => getReasoningOptions(selectedModel),
    [selectedModel],
  );
  const savedEffort = useMemo(
    () => normalizeEffortValue(appSettings.lastComposerReasoningEffort),
    [appSettings.lastComposerReasoningEffort],
  );
  const selectedEffort = useMemo(() => {
    if (!reasoningSupported) {
      return "";
    }
    if (savedEffort && reasoningOptions.includes(savedEffort)) {
      return savedEffort;
    }
    if (reasoningOptions.includes(DEFAULT_REASONING_EFFORT)) {
      return DEFAULT_REASONING_EFFORT;
    }
    const fallback = normalizeEffortValue(selectedModel?.defaultReasoningEffort);
    if (fallback && reasoningOptions.includes(fallback)) {
      return fallback;
    }
    return reasoningOptions[0] ?? "";
  }, [reasoningOptions, reasoningSupported, savedEffort, selectedModel]);
  const reasoningSelectOptions = buildReasoningEffortOptions(
    reasoningOptions,
    selectedEffort,
    t,
  );

  const didNormalizeDefaultsRef = useRef(false);

  useEffect(() => {
    if (didNormalizeDefaultsRef.current) {
      return;
    }
    if (!defaultModels.length) {
      return;
    }
    const savedRawModel = (appSettings.lastComposerModelId ?? "").trim();
    const savedRawEffort = (appSettings.lastComposerReasoningEffort ?? "").trim();
    const shouldNormalizeModel = savedRawModel.length === 0 || savedModelId === null;
    const shouldNormalizeEffort =
      reasoningSupported &&
      (savedRawEffort.length === 0 ||
        savedEffort === null ||
        !reasoningOptions.includes(savedEffort));
    if (!shouldNormalizeModel && !shouldNormalizeEffort) {
      didNormalizeDefaultsRef.current = true;
      return;
    }

    const next: AppSettings = {
      ...appSettings,
      lastComposerModelId: shouldNormalizeModel ? selectedModelId : appSettings.lastComposerModelId,
      lastComposerReasoningEffort: shouldNormalizeEffort
        ? selectedEffort
        : appSettings.lastComposerReasoningEffort,
    };
    didNormalizeDefaultsRef.current = true;
    void onUpdateAppSettings(next);
  }, [
    appSettings,
    defaultModels.length,
    onUpdateAppSettings,
    reasoningOptions,
    reasoningSupported,
    savedEffort,
    savedModelId,
    selectedModelId,
    selectedEffort,
  ]);

  return (
    <SettingsSection
      title={t("settings.codex.title")}
      subtitle={t("settings.codex.subtitle")}
    >
      <div className="settings-field">
        <div className="settings-runtime-card">
          <div className="settings-runtime-title">
            {t("settings.codex.enterpriseTitle")}
          </div>
          <div className="settings-help">{t("settings.codex.enterpriseHelp")}</div>
        </div>
        <SettingsToggleRow
          title={isEnterpriseConnected ? t("settings.codex.enterpriseConnected") : t("settings.codex.enterpriseDisconnected")}
          subtitle={
            isEnterpriseConnected
              ? t("settings.codex.enterpriseConnectedHelp", {
                  tenant: enterpriseAi.tenantDomain ?? "--",
                  key: enterpriseAi.keyLast4 ? `****${enterpriseAi.keyLast4}` : "--",
                })
              : t("settings.codex.enterpriseDisconnectedHelp")
          }
        >
          <SettingsToggleSwitch pressed={isEnterpriseConnected} onClick={onEnterpriseAiValidate} />
        </SettingsToggleRow>
        <label className="settings-field-label" htmlFor="enterprise-ai-api-key">
          {t("settings.codex.managedRuntimeApiKey")}
        </label>
        <div className="settings-field-row">
          <input
            id="enterprise-ai-api-key"
            className="settings-input"
            type="password"
            autoComplete="off"
            value={enterpriseApiKeyDraft}
            placeholder={
              enterpriseAi.keyLast4
                ? t("settings.codex.enterpriseApiKeySaved", {
                    key: `****${enterpriseAi.keyLast4}`,
                  })
                : "sk-..."
            }
            onChange={(event) => onSetEnterpriseApiKeyDraft(event.target.value)}
          />
          <button
            type="button"
            className="primary settings-button-compact"
            disabled={enterpriseAiSaving}
            onClick={() => {
              void onEnterpriseAiLogin();
            }}
          >
            {enterpriseAiSaving
              ? t("settings.codex.enterpriseLoggingIn")
              : t("settings.codex.enterpriseLoginAction")}
          </button>
          <button
            type="button"
            className="ghost settings-button-compact"
            disabled={enterpriseAiLoading || !isEnterpriseConnected}
            onClick={() => {
              void onEnterpriseAiValidate();
            }}
          >
            {enterpriseAiLoading ? t("settings.common.loading") : t("settings.codex.refresh")}
          </button>
          <button
            type="button"
            className="ghost settings-button-compact"
            disabled={enterpriseAiSaving || !isEnterpriseConnected}
            onClick={() => {
              void onEnterpriseAiLogout();
            }}
          >
            {t("settings.codex.enterpriseLogout")}
          </button>
        </div>
        {enterpriseAi.status === "invalid" && enterpriseAi.lastError && (
          <div className="settings-agents-error">{enterpriseAi.lastError}</div>
        )}
        {enterpriseAiError && <div className="settings-agents-error">{enterpriseAiError}</div>}
        {isEnterpriseConnected && (
          <div className="settings-runtime-card">
            <div className="settings-runtime-title">
              {t("settings.codex.enterpriseUsageTitle")}
            </div>
            <div className="settings-help">
              {t("settings.codex.enterpriseUsageHelp", {
                requests: formatEnterpriseNumber(enterpriseAiUsage?.requests7d),
                tokens: formatEnterpriseNumber(enterpriseAiUsage?.tokens7d),
                balance: formatEnterpriseNumber(enterpriseAiUsage?.balance),
              })}
            </div>
            <button
              type="button"
              className="ghost settings-button-compact"
              disabled={enterpriseAiLoading}
              onClick={() => {
                void onRefreshEnterpriseAiUsage();
              }}
            >
              {enterpriseAiLoading ? t("settings.common.loading") : t("settings.codex.enterpriseRefreshUsage")}
            </button>
          </div>
        )}
        {developerModeEnabled && (
          <div className="settings-runtime-card settings-developer-runtime-card">
            <div className="settings-runtime-title">
              {t("settings.codex.developerModeTitle")}
            </div>
            <div className="settings-help">{t("settings.codex.developerModeHelp")}</div>
            <label className="settings-field-label" htmlFor="developer-runtime-base-url">
              {t("settings.codex.developerBaseUrl")}
            </label>
            <input
              id="developer-runtime-base-url"
              className="settings-input"
              value={developerBaseUrlDraft}
              placeholder={t("settings.codex.developerBaseUrlPlaceholder")}
              onChange={(event) => onSetDeveloperBaseUrlDraft(event.target.value)}
            />
            <label className="settings-field-label" htmlFor="developer-runtime-api-key">
              {t("settings.codex.managedRuntimeApiKey")}
            </label>
            <div className="settings-field-row">
              <input
                id="developer-runtime-api-key"
                className="settings-input"
                type="password"
                autoComplete="off"
                value={developerApiKeyDraft}
                placeholder={t("settings.codex.developerApiKeyPlaceholder")}
                onChange={(event) => onSetDeveloperApiKeyDraft(event.target.value)}
              />
              <button
                type="button"
                className="primary settings-button-compact"
                disabled={developerRuntimeSaving}
                onClick={() => {
                  void onSaveDeveloperRuntime();
                }}
              >
                {developerRuntimeSaving
                  ? t("settings.common.saving")
                  : t("settings.codex.developerSave")}
              </button>
            </div>
            <div className="settings-help">{t("settings.codex.developerSecretHelp")}</div>
            {developerRuntimeError && (
              <div className="settings-agents-error">{developerRuntimeError}</div>
            )}
          </div>
        )}
        <label className="settings-field-label" htmlFor="codex-args">
          {t("settings.codex.defaultArgs")}
        </label>
        <div className="settings-field-row">
          <input
            id="codex-args"
            className="settings-input"
            value={codexArgsDraft}
            placeholder="--profile personal"
            onChange={(event) => onSetCodexArgsDraft(event.target.value)}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => onSetCodexArgsDraft("")}
          >
            {t("settings.codex.clear")}
          </button>
        </div>
        <div className="settings-help">{t("settings.codex.argsHelp")}</div>
        <div className="settings-help">{t("settings.codex.sharedServerHelp")}</div>
        <div className="settings-help">{t("settings.codex.unsupportedFlagsHelp")}</div>
        <div className="settings-field-actions">
          {codexDirty && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                void onSaveCodexSettings();
              }}
              disabled={isSavingSettings}
            >
              {isSavingSettings ? t("settings.common.saving") : t("settings.common.save")}
            </button>
          )}
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => {
              void onRunDoctor();
            }}
            disabled={doctorState.status === "running"}
          >
            <Stethoscope aria-hidden />
            {doctorState.status === "running"
              ? t("settings.codex.running")
              : t("settings.codex.runDoctor")}
          </button>
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => {
              void onRunCodexUpdate();
            }}
            disabled={codexUpdateState.status === "running"}
            title={t("settings.codex.updateTitle")}
          >
            <Stethoscope aria-hidden />
            {codexUpdateState.status === "running"
              ? t("settings.codex.updating")
              : t("settings.codex.update")}
          </button>
        </div>

        {doctorState.result && (
          <div className={`settings-doctor ${doctorState.result.ok ? "ok" : "error"}`}>
            <div className="settings-doctor-title">
              {doctorState.result.ok
                ? t("settings.codex.doctorOk")
                : t("settings.codex.doctorIssue")}
            </div>
            <div className="settings-doctor-body">
              <div>
                {t("settings.codex.version", {
                  value: doctorState.result.version ?? t("settings.common.unknown"),
                })}
              </div>
              <div>
                {t("settings.codex.appServer", {
                  value: doctorState.result.appServerOk
                    ? t("settings.codex.ok")
                    : t("settings.codex.failed"),
                })}
              </div>
              <div>
                {t("settings.codex.node", {
                  value: doctorState.result.nodeOk
                    ? `${t("settings.codex.ok")} (${
                        doctorState.result.nodeVersion ?? t("settings.common.unknown")
                      })`
                    : t("settings.codex.missing"),
                })}
              </div>
              {doctorState.result.details && <div>{doctorState.result.details}</div>}
              {doctorState.result.nodeDetails && <div>{doctorState.result.nodeDetails}</div>}
              {doctorState.result.path && (
                <div className="settings-doctor-path">PATH: {doctorState.result.path}</div>
              )}
            </div>
          </div>
        )}

        {codexUpdateState.result && (
          <div
            className={`settings-doctor ${codexUpdateState.result.ok ? "ok" : "error"}`}
          >
            <div className="settings-doctor-title">
              {codexUpdateState.result.ok
                ? codexUpdateState.result.upgraded
                  ? t("settings.codex.updated")
                  : t("settings.codex.upToDate")
                : t("settings.codex.updateFailed")}
            </div>
            <div className="settings-doctor-body">
              <div>
                {t("settings.codex.method", { value: codexUpdateState.result.method })}
              </div>
              {codexUpdateState.result.package && (
                <div>
                  {t("settings.codex.package", {
                    value: codexUpdateState.result.package,
                  })}
                </div>
              )}
              <div>
                {t("settings.codex.version", {
                  value:
                    codexUpdateState.result.afterVersion ??
                    codexUpdateState.result.beforeVersion ??
                    t("settings.common.unknown"),
                })}
              </div>
              {codexUpdateState.result.details && <div>{codexUpdateState.result.details}</div>}
              {codexUpdateState.result.output && (
                <details>
                  <summary>{t("settings.codex.output")}</summary>
                  <pre>{codexUpdateState.result.output}</pre>
                </details>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="settings-divider" />
      <div className="settings-field-label settings-field-label--section">
        {t("settings.codex.defaultParameters")}
      </div>

      <SettingsToggleRow
        title={
          <label htmlFor="default-model">
            {t("settings.codex.model")}
          </label>
        }
        subtitle={
          defaultModelsConnectedWorkspaceCount === 0
            ? t("settings.codex.modelNoWorkspace")
            : defaultModelsLoading
              ? t("settings.codex.modelLoading")
              : defaultModelsError
                ? t("settings.codex.modelLoadFailed", { error: defaultModelsError })
                : t("settings.codex.modelHelp")
        }
      >
        <div className="settings-field-row">
          <SelectMenu
            id="default-model"
            className="settings-select"
            value={selectedModelId}
            disabled={!defaultModels.length || defaultModelsLoading}
            onValueChange={(nextValue) =>
              void onUpdateAppSettings({
                ...appSettings,
                lastComposerModelId: nextValue,
              })
            }
            aria-label={t("settings.codex.model")}
            options={defaultModels.map((model) => ({
              value: model.id,
              label: model.displayName?.trim() || model.model,
            }))}
            placeholder={selectedModelId}
          />
          <button
            type="button"
            className="ghost"
            onClick={onRefreshDefaultModels}
            disabled={defaultModelsLoading || defaultModelsConnectedWorkspaceCount === 0}
          >
            {t("settings.codex.refresh")}
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={
          <label htmlFor="default-image-model">
            {t("settings.codex.imageModel")}
          </label>
        }
        subtitle={
          imageModelsLoading
            ? t("settings.codex.imageModelLoading")
            : imageModelsError
              ? t("settings.codex.imageModelLoadFailed", { error: imageModelsError })
              : imageModels.length === 0
                ? t("settings.codex.imageModelFallback")
                : t("settings.codex.imageModelHelp")
        }
      >
        <div className="settings-field-row">
          <SelectMenu
            id="default-image-model"
            className="settings-select"
            value={selectedImageModelId}
            disabled={imageModels.length === 0}
            onValueChange={(nextValue) =>
              void onUpdateAppSettings({
                ...appSettings,
                managedRuntime: {
                  ...appSettings.managedRuntime,
                  imageModel: normalizePublicImageModel(nextValue),
                },
              })
            }
            aria-label={t("settings.codex.imageModel")}
            options={imageModels.map((model) => ({
              value: normalizePublicImageModel(model.model),
              label: model.displayName?.trim() || model.model,
            }))}
            placeholder={selectedImageModelId || t("settings.codex.imageModelUnavailable")}
          />
          <button
            type="button"
            className="ghost"
            onClick={onRefreshImageModels}
            disabled={imageModelsLoading}
          >
            {t("settings.codex.refresh")}
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={t("settings.codex.useGatewayImageTool")}
        subtitle={t("settings.codex.useGatewayImageToolHelp")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.managedRuntime.nativeImageGeneration === false}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              managedRuntime: {
                ...appSettings.managedRuntime,
                nativeImageGeneration:
                  appSettings.managedRuntime.nativeImageGeneration === false,
              },
            })
          }
          aria-label={t("settings.codex.useGatewayImageTool")}
        />
      </SettingsToggleRow>

      <SettingsToggleRow
        title={
          <label htmlFor="default-effort">
            {t("settings.codex.reasoningEffort")}
          </label>
        }
        subtitle={
          reasoningSupported
            ? t("settings.codex.reasoningHelp")
            : t("settings.codex.reasoningUnsupported")
        }
      >
        <SelectMenu
          id="default-effort"
          className="settings-select"
          value={selectedEffort}
          onValueChange={(nextValue) =>
            void onUpdateAppSettings({
              ...appSettings,
              lastComposerReasoningEffort: nextValue,
            })
          }
          aria-label={t("settings.codex.reasoningEffort")}
          disabled={!reasoningSupported}
          options={
            !reasoningSupported
              ? [{ value: "", label: t("settings.codex.notSupported"), disabled: true }]
              : reasoningSelectOptions
          }
        />
      </SettingsToggleRow>

      <SettingsToggleRow
        title={
          <label htmlFor="default-access">
            {t("settings.codex.accessMode")}
          </label>
        }
        subtitle={t("settings.codex.defaultOverrideHelp")}
      >
        <SelectMenu
          id="default-access"
          className="settings-select"
          value={appSettings.defaultAccessMode}
          onValueChange={(nextValue) =>
            void onUpdateAppSettings({
              ...appSettings,
              defaultAccessMode: nextValue as AppSettings["defaultAccessMode"],
            })
          }
          options={[
            { value: "read-only", label: t("settings.codex.accessReadOnly") },
            { value: "current", label: t("settings.codex.accessOnRequest") },
            { value: "full-access", label: t("settings.codex.accessFull") },
          ]}
        />
      </SettingsToggleRow>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="review-delivery">
          {t("settings.codex.reviewMode")}
        </label>
        <SelectMenu
          id="review-delivery"
          className="settings-select"
          value={appSettings.reviewDeliveryMode}
          onValueChange={(nextValue) =>
            void onUpdateAppSettings({
              ...appSettings,
              reviewDeliveryMode: nextValue as AppSettings["reviewDeliveryMode"],
            })
          }
          options={[
            { value: "inline", label: t("settings.codex.reviewInline") },
            { value: "detached", label: t("settings.codex.reviewDetached") },
          ]}
        />
        <div className="settings-help">
          {t("settings.codex.reviewHelp")}
        </div>
      </div>

      <FileEditorCard
        title={t("settings.codex.globalAgents")}
        meta={globalAgentsMeta}
        error={globalAgentsError}
        value={globalAgentsContent}
        placeholder={t("settings.codex.globalAgentsPlaceholder")}
        disabled={globalAgentsLoading}
        refreshDisabled={globalAgentsRefreshDisabled}
        saveDisabled={globalAgentsSaveDisabled}
        saveLabel={globalAgentsSaveLabel}
        onChange={onSetGlobalAgentsContent}
        onRefresh={onRefreshGlobalAgents}
        onSave={onSaveGlobalAgents}
        helpText={
          <>
            {t("settings.codex.storedAt", {
              path: t("settings.codex.globalAgentsPath"),
            })}
          </>
        }
        classNames={{
          container: "settings-field settings-agents",
          header: "settings-agents-header",
          title: "settings-field-label",
          actions: "settings-agents-actions",
          meta: "settings-help settings-help-inline",
          iconButton: "ghost settings-icon-button",
          error: "settings-agents-error",
          textarea: "settings-agents-textarea",
          help: "settings-help",
        }}
      />

      <FileEditorCard
        title={t("settings.codex.globalConfig")}
        meta={globalConfigMeta}
        error={globalConfigError}
        value={globalConfigContent}
        placeholder={t("settings.codex.globalConfigPlaceholder")}
        disabled={globalConfigLoading}
        refreshDisabled={globalConfigRefreshDisabled}
        saveDisabled={globalConfigSaveDisabled}
        saveLabel={globalConfigSaveLabel}
        onChange={onSetGlobalConfigContent}
        onRefresh={onRefreshGlobalConfig}
        onSave={onSaveGlobalConfig}
        helpText={
          <>
            {t("settings.codex.storedAt", {
              path: t("settings.codex.globalConfigPath"),
            })}
          </>
        }
        classNames={{
          container: "settings-field settings-agents",
          header: "settings-agents-header",
          title: "settings-field-label",
          actions: "settings-agents-actions",
          meta: "settings-help settings-help-inline",
          iconButton: "ghost settings-icon-button",
          error: "settings-agents-error",
          textarea: "settings-agents-textarea",
          help: "settings-help",
        }}
      />
    </SettingsSection>
  );
}
