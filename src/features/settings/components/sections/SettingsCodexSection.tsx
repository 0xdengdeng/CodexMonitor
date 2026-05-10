import { useEffect, useMemo, useRef } from "react";
import Stethoscope from "lucide-react/dist/esm/icons/stethoscope";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  ModelOption,
  RuntimeApiKeyStatus,
} from "@/types";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { FileEditorCard } from "@/features/shared/components/FileEditorCard";
import { useI18n } from "@/features/i18n/i18n";

type SettingsCodexSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  defaultModels: ModelOption[];
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
  runtimeApiKeyStatus: RuntimeApiKeyStatus | null;
  runtimeApiKeyDraft: string;
  runtimeApiKeyLoading: boolean;
  runtimeApiKeySaving: boolean;
  runtimeApiKeyError: string | null;
  onSetCodexArgsDraft: Dispatch<SetStateAction<string>>;
  onSetRuntimeApiKeyDraft: Dispatch<SetStateAction<string>>;
  onSetGlobalAgentsContent: (value: string) => void;
  onSetGlobalConfigContent: (value: string) => void;
  onRefreshRuntimeApiKeyStatus: () => void;
  onSaveRuntimeApiKey: () => Promise<void>;
  onClearRuntimeApiKey: () => Promise<void>;
  onSaveCodexSettings: () => Promise<void>;
  onRunDoctor: () => Promise<void>;
  onRunCodexUpdate: () => Promise<void>;
  onRefreshGlobalAgents: () => void;
  onSaveGlobalAgents: () => void;
  onRefreshGlobalConfig: () => void;
  onSaveGlobalConfig: () => void;
};

const DEFAULT_REASONING_EFFORT = "medium";

const normalizeEffortValue = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
};

function coerceSavedModelSlug(value: string | null, models: ModelOption[]): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const bySlug = models.find((model) => model.model === trimmed);
  if (bySlug) {
    return bySlug.model;
  }
  const byId = models.find((model) => model.id === trimmed);
  return byId ? byId.model : null;
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
  runtimeApiKeyStatus,
  runtimeApiKeyDraft,
  runtimeApiKeyLoading,
  runtimeApiKeySaving,
  runtimeApiKeyError,
  onSetCodexArgsDraft,
  onSetRuntimeApiKeyDraft,
  onSetGlobalAgentsContent,
  onSetGlobalConfigContent,
  onRefreshRuntimeApiKeyStatus,
  onSaveRuntimeApiKey,
  onClearRuntimeApiKey,
  onSaveCodexSettings,
  onRunDoctor,
  onRunCodexUpdate,
  onRefreshGlobalAgents,
  onSaveGlobalAgents,
  onRefreshGlobalConfig,
  onSaveGlobalConfig,
}: SettingsCodexSectionProps) {
  const { t } = useI18n();
  const managedRuntime = appSettings.managedRuntime;
  const updateManagedRuntime = (
    patch: Partial<AppSettings["managedRuntime"]>,
  ) => {
    void onUpdateAppSettings({
      ...appSettings,
      managedRuntime: {
        ...managedRuntime,
        ...patch,
      },
    });
  };
  const latestModelSlug = defaultModels[0]?.model ?? null;
  const savedModelSlug = useMemo(
    () => coerceSavedModelSlug(appSettings.lastComposerModelId, defaultModels),
    [appSettings.lastComposerModelId, defaultModels],
  );
  const selectedModelSlug = savedModelSlug ?? latestModelSlug ?? "";
  const selectedModel = useMemo(
    () => defaultModels.find((model) => model.model === selectedModelSlug) ?? null,
    [defaultModels, selectedModelSlug],
  );
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

  const didNormalizeDefaultsRef = useRef(false);
  useEffect(() => {
    onRefreshRuntimeApiKeyStatus();
  }, [onRefreshRuntimeApiKeyStatus]);

  useEffect(() => {
    if (didNormalizeDefaultsRef.current) {
      return;
    }
    if (!defaultModels.length) {
      return;
    }
    const savedRawModel = (appSettings.lastComposerModelId ?? "").trim();
    const savedRawEffort = (appSettings.lastComposerReasoningEffort ?? "").trim();
    const shouldNormalizeModel = savedRawModel.length === 0 || savedModelSlug === null;
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
      lastComposerModelId: shouldNormalizeModel ? selectedModelSlug : appSettings.lastComposerModelId,
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
    savedModelSlug,
    selectedModelSlug,
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
            {t("settings.codex.runtimeTitle")}
          </div>
          <div className="settings-help">{t("settings.codex.runtimeHelp")}</div>
        </div>
        <SettingsToggleRow
          title={t("settings.codex.managedRuntimeTitle")}
          subtitle={t("settings.codex.managedRuntimeHelp")}
        >
          <SettingsToggleSwitch
            pressed={managedRuntime.enabled}
            onClick={() => updateManagedRuntime({ enabled: !managedRuntime.enabled })}
          />
        </SettingsToggleRow>
        {managedRuntime.enabled && (
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="managed-runtime-base-url">
              {t("settings.codex.managedRuntimeBaseUrl")}
            </label>
            <input
              id="managed-runtime-base-url"
              className="settings-input"
              value={managedRuntime.baseUrl ?? ""}
              placeholder="https://api.example.com/v1"
              onChange={(event) =>
                updateManagedRuntime({ baseUrl: event.target.value || null })
              }
            />
            <div className="settings-help">
              {t("settings.codex.managedRuntimeBaseUrlHelp")}
            </div>
            <label className="settings-field-label" htmlFor="managed-runtime-model">
              {t("settings.codex.managedRuntimeModel")}
            </label>
            <input
              id="managed-runtime-model"
              className="settings-input"
              value={managedRuntime.model ?? ""}
              placeholder="gpt-5.4"
              onChange={(event) =>
                updateManagedRuntime({ model: event.target.value || null })
              }
            />
            <div className="settings-help">
              {t("settings.codex.managedRuntimeModelHelp")}
            </div>
            <label className="settings-field-label" htmlFor="managed-runtime-api-key">
              {t("settings.codex.managedRuntimeApiKey")}
            </label>
            <div className="settings-field-row">
              <input
                id="managed-runtime-api-key"
                className="settings-input"
                type="password"
                autoComplete="off"
                value={runtimeApiKeyDraft}
                placeholder={
                  runtimeApiKeyStatus?.hasApiKey
                    ? t("settings.codex.apiKeyAlreadySaved")
                    : "sk-..."
                }
                onChange={(event) => onSetRuntimeApiKeyDraft(event.target.value)}
              />
              <button
                type="button"
                className="primary settings-button-compact"
                disabled={runtimeApiKeySaving || runtimeApiKeyDraft.trim().length === 0}
                onClick={() => {
                  void onSaveRuntimeApiKey();
                }}
              >
                {runtimeApiKeySaving
                  ? t("settings.common.saving")
                  : t("settings.common.save")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                disabled={runtimeApiKeySaving || !runtimeApiKeyStatus?.hasApiKey}
                onClick={() => {
                  void onClearRuntimeApiKey();
                }}
              >
                {t("settings.codex.clear")}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                disabled={runtimeApiKeyLoading}
                onClick={onRefreshRuntimeApiKeyStatus}
              >
                {runtimeApiKeyLoading
                  ? t("settings.common.loading")
                  : t("settings.codex.refresh")}
              </button>
            </div>
            <div className="settings-help">
              {runtimeApiKeyStatus?.hasApiKey
                ? t("settings.codex.apiKeySaved")
                : t("settings.codex.apiKeyMissing")}
            </div>
            {runtimeApiKeyError && (
              <div className="settings-agents-error">{runtimeApiKeyError}</div>
            )}
            <div className="settings-help">
              {t("settings.codex.managedRuntimeSecretHelp")}
            </div>
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
          <select
            id="default-model"
            className="settings-select"
            value={selectedModelSlug}
            disabled={!defaultModels.length || defaultModelsLoading}
            onChange={(event) =>
              void onUpdateAppSettings({
                ...appSettings,
                lastComposerModelId: event.target.value,
              })
            }
            aria-label={t("settings.codex.model")}
          >
            {defaultModels.map((model) => (
              <option key={model.model} value={model.model}>
                {model.displayName?.trim() || model.model}
              </option>
            ))}
          </select>
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
        <select
          id="default-effort"
          className="settings-select"
          value={selectedEffort}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              lastComposerReasoningEffort: event.target.value,
            })
          }
          aria-label={t("settings.codex.reasoningEffort")}
          disabled={!reasoningSupported}
        >
          {!reasoningSupported && (
            <option value="">{t("settings.codex.notSupported")}</option>
          )}
          {reasoningOptions.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={
          <label htmlFor="default-access">
            {t("settings.codex.accessMode")}
          </label>
        }
        subtitle={t("settings.codex.defaultOverrideHelp")}
      >
        <select
          id="default-access"
          className="settings-select"
          value={appSettings.defaultAccessMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              defaultAccessMode: event.target.value as AppSettings["defaultAccessMode"],
            })
          }
        >
          <option value="read-only">{t("settings.codex.accessReadOnly")}</option>
          <option value="current">{t("settings.codex.accessOnRequest")}</option>
          <option value="full-access">{t("settings.codex.accessFull")}</option>
        </select>
      </SettingsToggleRow>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="review-delivery">
          {t("settings.codex.reviewMode")}
        </label>
        <select
          id="review-delivery"
          className="settings-select"
          value={appSettings.reviewDeliveryMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              reviewDeliveryMode: event.target.value as AppSettings["reviewDeliveryMode"],
            })
          }
        >
          <option value="inline">{t("settings.codex.reviewInline")}</option>
          <option value="detached">{t("settings.codex.reviewDetached")}</option>
        </select>
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
