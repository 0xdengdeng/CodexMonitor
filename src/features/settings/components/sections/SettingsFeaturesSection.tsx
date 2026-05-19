import type { CodexFeature } from "@/types";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { SelectMenu } from "@/features/design-system/components/select/SelectMenu";
import type { SettingsFeaturesSectionProps } from "@settings/hooks/useSettingsFeaturesSection";
import { fileManagerName } from "@utils/platformPaths";
import { useI18n, type I18nKey } from "@/features/i18n/i18n";

const FEATURE_DESCRIPTION_FALLBACK_KEYS: Record<string, I18nKey> = {
  undo: "settings.features.fallback.undo",
  shell_tool: "settings.features.fallback.shellTool",
  unified_exec: "settings.features.fallback.unifiedExec",
  shell_snapshot: "settings.features.fallback.shellSnapshot",
  js_repl: "settings.features.fallback.jsRepl",
  js_repl_tools_only: "settings.features.fallback.jsReplToolsOnly",
  web_search_request: "settings.features.fallback.webSearchDeprecated",
  web_search_cached: "settings.features.fallback.webSearchDeprecated",
  search_tool: "settings.features.fallback.searchTool",
  runtime_metrics: "settings.features.fallback.runtimeMetrics",
  sqlite: "settings.features.fallback.sqlite",
  memory_tool: "settings.features.fallback.memoryTool",
  child_agents_md: "settings.features.fallback.childAgentsMd",
  apply_patch_freeform: "settings.features.fallback.applyPatchFreeform",
  use_linux_sandbox_bwrap: "settings.features.fallback.linuxSandbox",
  request_rule: "settings.features.fallback.requestRule",
  experimental_windows_sandbox: "settings.features.fallback.windowsSandboxRemoved",
  elevated_windows_sandbox: "settings.features.fallback.windowsSandboxRemoved",
  remote_models: "settings.features.fallback.remoteModels",
  powershell_utf8: "settings.features.fallback.powershellUtf8",
  enable_request_compression: "settings.features.fallback.requestCompression",
  apps: "settings.features.fallback.apps",
  apps_mcp_gateway: "settings.features.fallback.appsMcpGateway",
  skill_mcp_dependency_install: "settings.features.fallback.skillMcpDependencyInstall",
  skill_env_var_dependency_prompt: "settings.features.fallback.skillEnvVarDependencyPrompt",
  steer: "settings.features.fallback.steer",
  collaboration_modes: "settings.features.fallback.collaborationModes",
  personality: "settings.features.fallback.personality",
  responses_websockets: "settings.features.fallback.responsesWebsockets",
  responses_websockets_v2: "settings.features.fallback.responsesWebsocketsV2",
};

function formatFeatureLabel(feature: CodexFeature): string {
  const displayName = feature.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return feature.name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function featureSubtitle(
  feature: CodexFeature,
  t: (key: I18nKey, values?: Record<string, string | number | null | undefined>) => string,
): string {
  if (feature.description?.trim()) {
    return feature.description;
  }
  if (feature.announcement?.trim()) {
    return feature.announcement;
  }
  const fallbackKey = FEATURE_DESCRIPTION_FALLBACK_KEYS[feature.name];
  if (fallbackKey) {
    return t(fallbackKey);
  }
  if (feature.stage === "deprecated") {
    return t("settings.features.deprecated");
  }
  if (feature.stage === "removed") {
    return t("settings.features.removed");
  }
  return t("settings.features.featureKey", { name: feature.name });
}

export function SettingsFeaturesSection({
  appSettings,
  hasFeatureWorkspace,
  openConfigError,
  featureError,
  featuresLoading,
  featureUpdatingKey,
  stableFeatures,
  experimentalFeatures,
  hasDynamicFeatureRows,
  onOpenConfig,
  onToggleCodexFeature,
  onUpdateAppSettings,
}: SettingsFeaturesSectionProps) {
  const { t } = useI18n();

  return (
    <SettingsSection
      title={t("settings.features.title")}
      subtitle={t("settings.features.subtitle")}
    >
      <SettingsToggleRow
        title={t("settings.features.configFile")}
        subtitle={t("settings.features.openConfig", { fileManager: fileManagerName() })}
      >
        <button type="button" className="ghost" onClick={onOpenConfig}>
          {t("openApp.openIn", { app: fileManagerName() })}
        </button>
      </SettingsToggleRow>
      {openConfigError && <div className="settings-help">{openConfigError}</div>}
      <SettingsSubsection
        title={t("settings.features.stable")}
        subtitle={t("settings.features.stableSubtitle")}
      />
      <SettingsToggleRow
        title={t("settings.features.personality")}
        subtitle={t("settings.features.personalitySubtitle")}
      >
        <SelectMenu
          id="features-personality-select"
          className="settings-select"
          value={appSettings.personality}
          onValueChange={(nextValue) =>
            void onUpdateAppSettings({
              ...appSettings,
              personality: nextValue as (typeof appSettings)["personality"],
            })
          }
          aria-label={t("settings.features.personality")}
          options={[
            { value: "friendly", label: t("settings.features.friendly") },
            { value: "pragmatic", label: t("settings.features.pragmatic") },
          ]}
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.features.pauseQueued.title")}
        subtitle={t("settings.features.pauseQueued.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.pauseQueuedMessagesWhenResponseRequired}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              pauseQueuedMessagesWhenResponseRequired:
                !appSettings.pauseQueuedMessagesWhenResponseRequired,
            })
          }
        />
      </SettingsToggleRow>
      {stableFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature, t)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        stableFeatures.length === 0 && (
        <div className="settings-help">{t("settings.features.noStable")}</div>
      )}
      <SettingsSubsection
        title={t("settings.features.experimental")}
        subtitle={t("settings.features.experimentalSubtitle")}
      />
      {experimentalFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature, t)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        hasDynamicFeatureRows &&
        experimentalFeatures.length === 0 && (
          <div className="settings-help">
            {t("settings.features.noExperimental")}
          </div>
        )}
      {featuresLoading && (
        <div className="settings-help">{t("settings.features.loading")}</div>
      )}
      {!hasFeatureWorkspace && !featuresLoading && (
        <div className="settings-help">
          {t("settings.features.noWorkspace")}
        </div>
      )}
      {featureError && <div className="settings-help">{featureError}</div>}
    </SettingsSection>
  );
}
