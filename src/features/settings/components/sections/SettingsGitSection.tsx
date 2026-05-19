import type { AppSettings, GitRuntimeInfo, ModelOption } from "@/types";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { SelectMenu } from "@/features/design-system/components/select/SelectMenu";
import { useI18n } from "@/features/i18n/i18n";

type SettingsGitSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  models: ModelOption[];
  commitMessagePromptDraft: string;
  commitMessagePromptDirty: boolean;
  commitMessagePromptSaving: boolean;
  onSetCommitMessagePromptDraft: (value: string) => void;
  onSaveCommitMessagePrompt: () => Promise<void>;
  onResetCommitMessagePrompt: () => Promise<void>;
  gitRuntimeInfo: GitRuntimeInfo | null;
  gitRuntimeInfoLoading: boolean;
  gitRuntimeInfoError: string | null;
  onRefreshGitRuntimeInfo: () => Promise<void>;
};

function gitRuntimeSourceLabel(source: GitRuntimeInfo["source"], t: (key: string) => string) {
  if (source === "bundled") {
    return t("settings.git.runtime.source.bundled");
  }
  if (source === "PATH") {
    return t("settings.git.runtime.source.path");
  }
  if (source === "fallback") {
    return t("settings.git.runtime.source.fallback");
  }
  return t("common.unknown");
}

function normalizeGitRuntimePreference(
  value: AppSettings["gitRuntimePreference"] | undefined,
): AppSettings["gitRuntimePreference"] {
  if (value === "bundled" || value === "system") {
    return value;
  }
  return "auto";
}

export function SettingsGitSection({
  appSettings,
  onUpdateAppSettings,
  models,
  commitMessagePromptDraft,
  commitMessagePromptDirty,
  commitMessagePromptSaving,
  onSetCommitMessagePromptDraft,
  onSaveCommitMessagePrompt,
  onResetCommitMessagePrompt,
  gitRuntimeInfo,
  gitRuntimeInfoLoading,
  gitRuntimeInfoError,
  onRefreshGitRuntimeInfo,
}: SettingsGitSectionProps) {
  const { t } = useI18n();
  const sourceLabel = gitRuntimeInfo?.available
    ? gitRuntimeSourceLabel(gitRuntimeInfo.source, t)
    : t("settings.git.runtime.unavailable");
  return (
    <SettingsSection
      title={t("settings.git.title")}
      subtitle={t("settings.git.subtitle")}
    >
      <div className="settings-field">
        <div className="settings-field-label">{t("settings.git.runtime.title")}</div>
        <div className="settings-field-row">
          <div>
            <div className="settings-help">
              {gitRuntimeInfoLoading ? t("settings.git.runtime.loading") : sourceLabel}
            </div>
            {gitRuntimeInfo?.version && (
              <div className="settings-help">{gitRuntimeInfo.version}</div>
            )}
            {gitRuntimeInfo?.path && (
              <div className="settings-help" title={gitRuntimeInfo.path}>
                {gitRuntimeInfo.path}
              </div>
            )}
            {(gitRuntimeInfoError || gitRuntimeInfo?.error) && (
              <div className="settings-help settings-help-error">
                {gitRuntimeInfoError || gitRuntimeInfo?.error}
              </div>
            )}
          </div>
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => {
              void onRefreshGitRuntimeInfo();
            }}
            disabled={gitRuntimeInfoLoading}
          >
            {t("common.refresh")}
          </button>
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="git-runtime-preference-select">
          {t("settings.git.runtimePreference.title")}
        </label>
        <div className="settings-help">
          {t("settings.git.runtimePreference.help")}
        </div>
        <SelectMenu
          id="git-runtime-preference-select"
          className="settings-select"
          value={normalizeGitRuntimePreference(appSettings.gitRuntimePreference)}
          onValueChange={(nextValue) => {
            const gitRuntimePreference = nextValue as AppSettings["gitRuntimePreference"];
            void (async () => {
              await onUpdateAppSettings({
                ...appSettings,
                gitRuntimePreference,
              });
              await onRefreshGitRuntimeInfo();
            })();
          }}
          options={[
            { value: "auto", label: t("settings.git.runtimePreference.auto") },
            { value: "bundled", label: t("settings.git.runtimePreference.bundled") },
            { value: "system", label: t("settings.git.runtimePreference.system") },
          ]}
        />
      </div>
      <SettingsToggleRow
        title={t("settings.git.preload.title")}
        subtitle={t("settings.git.preload.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.preloadGitDiffs}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              preloadGitDiffs: !appSettings.preloadGitDiffs,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.git.ignoreWhitespace.title")}
        subtitle={t("settings.git.ignoreWhitespace.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.gitDiffIgnoreWhitespaceChanges}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              gitDiffIgnoreWhitespaceChanges: !appSettings.gitDiffIgnoreWhitespaceChanges,
            })
          }
        />
      </SettingsToggleRow>
      <div className="settings-field">
        <div className="settings-field-label">{t("settings.git.commitPrompt")}</div>
        <div className="settings-help">
          {t("settings.git.commitPromptHelp", { diffToken: "{diff}" })}
        </div>
        <textarea
          className="settings-agents-textarea"
          value={commitMessagePromptDraft}
          onChange={(event) => onSetCommitMessagePromptDraft(event.target.value)}
          spellCheck={false}
          disabled={commitMessagePromptSaving}
        />
        <div className="settings-field-actions">
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => {
              void onResetCommitMessagePrompt();
            }}
            disabled={commitMessagePromptSaving || !commitMessagePromptDirty}
          >
            {t("settings.common.reset")}
          </button>
          <button
            type="button"
            className="primary settings-button-compact"
            onClick={() => {
              void onSaveCommitMessagePrompt();
            }}
            disabled={commitMessagePromptSaving || !commitMessagePromptDirty}
          >
            {commitMessagePromptSaving
              ? t("settings.common.saving")
              : t("settings.common.save")}
          </button>
        </div>
      </div>
      {models.length > 0 && (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="commit-message-model-select">
            {t("settings.git.commitModel")}
          </label>
          <div className="settings-help">
            {t("settings.git.commitModelHelp")}
          </div>
          <SelectMenu
            id="commit-message-model-select"
            className="settings-select"
            value={appSettings.commitMessageModelId ?? ""}
            onValueChange={(nextValue) => {
              const value = nextValue || null;
              void onUpdateAppSettings({
                ...appSettings,
                commitMessageModelId: value,
              });
            }}
            options={[
              { value: "", label: t("settings.git.defaultModel") },
              ...models.map((model) => ({
                value: model.id,
                label: model.displayName?.trim() || model.model,
              })),
            ]}
          />
        </div>
      )}
    </SettingsSection>
  );
}
