import type { AppSettings } from "@/types";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { useI18n } from "@/features/i18n/i18n";

type ComposerPreset = AppSettings["composerEditorPreset"];

type SettingsComposerSectionProps = {
  appSettings: AppSettings;
  optionKeyLabel: string;
  followUpShortcutLabel: string;
  composerPresetLabels: Record<ComposerPreset, string>;
  onComposerPresetChange: (preset: ComposerPreset) => void;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

export function SettingsComposerSection({
  appSettings,
  optionKeyLabel,
  followUpShortcutLabel,
  composerPresetLabels,
  onComposerPresetChange,
  onUpdateAppSettings,
}: SettingsComposerSectionProps) {
  const { t } = useI18n();
  const steerUnavailable = !appSettings.steerEnabled;
  return (
    <SettingsSection
      title={t("settings.composer.title")}
      subtitle={t("settings.composer.subtitle")}
    >
      <div className="settings-field">
        <div className="settings-field-label">{t("settings.composer.followUp")}</div>
        <div className={`settings-segmented${appSettings.followUpMessageBehavior === "steer" ? " is-second-active" : ""}`} aria-label={t("settings.composer.followUp")}>
          <label
            className={`settings-segmented-option${
              appSettings.followUpMessageBehavior === "queue" ? " is-active" : ""
            }`}
          >
            <input
              className="settings-segmented-input"
              type="radio"
              name="follow-up-behavior"
              value="queue"
              checked={appSettings.followUpMessageBehavior === "queue"}
              onChange={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  followUpMessageBehavior: "queue",
                })
              }
            />
            <span className="settings-segmented-option-label">{t("settings.composer.queue")}</span>
          </label>
          <label
            className={`settings-segmented-option${
              appSettings.followUpMessageBehavior === "steer" ? " is-active" : ""
            }${steerUnavailable ? " is-disabled" : ""}`}
            title={steerUnavailable ? t("settings.composer.steerUnavailableTitle") : ""}
          >
            <input
              className="settings-segmented-input"
              type="radio"
              name="follow-up-behavior"
              value="steer"
              checked={appSettings.followUpMessageBehavior === "steer"}
              disabled={steerUnavailable}
              onChange={() => {
                if (steerUnavailable) {
                  return;
                }
                void onUpdateAppSettings({
                  ...appSettings,
                  followUpMessageBehavior: "steer",
                });
              }}
            />
            <span className="settings-segmented-option-label">{t("settings.composer.steer")}</span>
          </label>
        </div>
        <div className="settings-help">
          {t("settings.composer.followUpHelp", {
            shortcut: followUpShortcutLabel,
          })}
        </div>
        <SettingsToggleRow
          title={t("settings.composer.followUpHint.title")}
          subtitle={t("settings.composer.followUpHint.subtitle")}
        >
          <SettingsToggleSwitch
            pressed={appSettings.composerFollowUpHintEnabled}
            onClick={() =>
              void onUpdateAppSettings({
                ...appSettings,
                composerFollowUpHintEnabled: !appSettings.composerFollowUpHintEnabled,
              })
            }
          />
        </SettingsToggleRow>
        {steerUnavailable && (
          <div className="settings-help">
            {t("settings.composer.steerUnavailableHelp")}
          </div>
        )}
      </div>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{t("settings.composer.presets")}</div>
      <div className="settings-subsection-subtitle">
        {t("settings.composer.presetsSubtitle")}
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="composer-preset">
          {t("settings.composer.preset")}
        </label>
        <select
          id="composer-preset"
          className="settings-select"
          value={appSettings.composerEditorPreset}
          onChange={(event) =>
            onComposerPresetChange(event.target.value as ComposerPreset)
          }
        >
          {Object.entries(composerPresetLabels).map(([preset, label]) => (
            <option key={preset} value={preset}>
              {preset === "default"
                ? t("settings.composer.presetDefault")
                : preset === "helpful"
                  ? t("settings.composer.presetHelpful")
                  : preset === "smart"
                    ? t("settings.composer.presetSmart")
                    : label}
            </option>
          ))}
        </select>
        <div className="settings-help">
          {t("settings.composer.presetHelp")}
        </div>
      </div>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{t("settings.composer.codeFences")}</div>
      <SettingsToggleRow
        title={t("settings.composer.expandSpace.title")}
        subtitle={t("settings.composer.expandSpace.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceExpandOnSpace}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceExpandOnSpace: !appSettings.composerFenceExpandOnSpace,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.composer.expandEnter.title")}
        subtitle={t("settings.composer.expandEnter.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceExpandOnEnter}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceExpandOnEnter: !appSettings.composerFenceExpandOnEnter,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.composer.languageTags.title")}
        subtitle={t("settings.composer.languageTags.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceLanguageTags}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceLanguageTags: !appSettings.composerFenceLanguageTags,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.composer.wrapSelection.title")}
        subtitle={t("settings.composer.wrapSelection.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceWrapSelection}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceWrapSelection: !appSettings.composerFenceWrapSelection,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.composer.copyBlocks.title")}
        subtitle={t("settings.composer.copyBlocks.subtitle", {
          optionKey: optionKeyLabel,
        })}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerCodeBlockCopyUseModifier}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerCodeBlockCopyUseModifier:
                !appSettings.composerCodeBlockCopyUseModifier,
            })
          }
        />
      </SettingsToggleRow>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{t("settings.composer.pasting")}</div>
      <SettingsToggleRow
        title={t("settings.composer.autoWrapMultiline.title")}
        subtitle={t("settings.composer.autoWrapMultiline.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceAutoWrapPasteMultiline}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceAutoWrapPasteMultiline:
                !appSettings.composerFenceAutoWrapPasteMultiline,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={t("settings.composer.autoWrapCode.title")}
        subtitle={t("settings.composer.autoWrapCode.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceAutoWrapPasteCodeLike}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceAutoWrapPasteCodeLike:
                !appSettings.composerFenceAutoWrapPasteCodeLike,
            })
          }
        />
      </SettingsToggleRow>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{t("settings.composer.lists")}</div>
      <SettingsToggleRow
        title={t("settings.composer.continueLists.title")}
        subtitle={t("settings.composer.continueLists.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerListContinuation}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerListContinuation: !appSettings.composerListContinuation,
            })
          }
        />
      </SettingsToggleRow>
    </SettingsSection>
  );
}
