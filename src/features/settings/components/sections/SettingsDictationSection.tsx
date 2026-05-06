import type { AppSettings, DictationModelStatus } from "@/types";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { useI18n } from "@/features/i18n/i18n";
import { formatDownloadSize } from "@utils/formatting";

type DictationModelOption = {
  id: string;
  label: string;
  size: string;
  note: string;
};

type SettingsDictationSectionProps = {
  appSettings: AppSettings;
  optionKeyLabel: string;
  metaKeyLabel: string;
  dictationModels: DictationModelOption[];
  selectedDictationModel: DictationModelOption;
  dictationModelStatus?: DictationModelStatus | null;
  dictationReady: boolean;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
};

export function SettingsDictationSection({
  appSettings,
  optionKeyLabel,
  metaKeyLabel,
  dictationModels,
  selectedDictationModel,
  dictationModelStatus,
  dictationReady,
  onUpdateAppSettings,
  onDownloadDictationModel,
  onCancelDictationDownload,
  onRemoveDictationModel,
}: SettingsDictationSectionProps) {
  const { t } = useI18n();
  const dictationProgress = dictationModelStatus?.progress ?? null;

  return (
    <SettingsSection
      title={t("settings.dictation.title")}
      subtitle={t("settings.dictation.subtitle")}
    >
      <SettingsToggleRow
        title={t("settings.dictation.enable.title")}
        subtitle={t("settings.dictation.enable.subtitle")}
      >
        <SettingsToggleSwitch
          pressed={appSettings.dictationEnabled}
          onClick={() => {
            const nextEnabled = !appSettings.dictationEnabled;
            void onUpdateAppSettings({
              ...appSettings,
              dictationEnabled: nextEnabled,
            });
            if (
              !nextEnabled &&
              dictationModelStatus?.state === "downloading" &&
              onCancelDictationDownload
            ) {
              onCancelDictationDownload();
            }
            if (
              nextEnabled &&
              dictationModelStatus?.state === "missing" &&
              onDownloadDictationModel
            ) {
              onDownloadDictationModel();
            }
          }}
        />
      </SettingsToggleRow>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="dictation-model">
          {t("settings.dictation.model")}
        </label>
        <select
          id="dictation-model"
          className="settings-select"
          value={appSettings.dictationModelId}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              dictationModelId: event.target.value,
            })
          }
        >
          {dictationModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} ({model.size})
            </option>
          ))}
        </select>
        <div className="settings-help">
          {t("settings.dictation.modelHelp", {
            note: selectedDictationModel.note,
            size: selectedDictationModel.size,
          })}
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="dictation-language">
          {t("settings.dictation.language")}
        </label>
        <select
          id="dictation-language"
          className="settings-select"
          value={appSettings.dictationPreferredLanguage ?? ""}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              dictationPreferredLanguage: event.target.value || null,
            })
          }
        >
          <option value="">{t("settings.dictation.autoDetect")}</option>
          <option value="en">{t("settings.dictation.english")}</option>
          <option value="es">{t("settings.dictation.spanish")}</option>
          <option value="fr">{t("settings.dictation.french")}</option>
          <option value="de">{t("settings.dictation.german")}</option>
          <option value="it">{t("settings.dictation.italian")}</option>
          <option value="pt">{t("settings.dictation.portuguese")}</option>
          <option value="nl">{t("settings.dictation.dutch")}</option>
          <option value="sv">{t("settings.dictation.swedish")}</option>
          <option value="no">{t("settings.dictation.norwegian")}</option>
          <option value="da">{t("settings.dictation.danish")}</option>
          <option value="fi">{t("settings.dictation.finnish")}</option>
          <option value="pl">{t("settings.dictation.polish")}</option>
          <option value="tr">{t("settings.dictation.turkish")}</option>
          <option value="ru">{t("settings.dictation.russian")}</option>
          <option value="uk">{t("settings.dictation.ukrainian")}</option>
          <option value="ja">{t("settings.dictation.japanese")}</option>
          <option value="ko">{t("settings.dictation.korean")}</option>
          <option value="zh">{t("settings.dictation.chinese")}</option>
        </select>
        <div className="settings-help">
          {t("settings.dictation.languageHelp")}
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="dictation-hold-key">
          {t("settings.dictation.holdKey")}
        </label>
        <select
          id="dictation-hold-key"
          className="settings-select"
          value={appSettings.dictationHoldKey ?? ""}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              dictationHoldKey: event.target.value,
            })
          }
        >
          <option value="">{t("settings.dictation.off")}</option>
          <option value="alt">{optionKeyLabel}</option>
          <option value="shift">Shift</option>
          <option value="control">Control</option>
          <option value="meta">{metaKeyLabel}</option>
        </select>
        <div className="settings-help">
          {t("settings.dictation.holdKeyHelp")}
        </div>
      </div>
      {dictationModelStatus && (
        <div className="settings-field">
          <div className="settings-field-label">
            {t("settings.dictation.modelStatus", {
              model: selectedDictationModel.label,
            })}
          </div>
          <div className="settings-help">
            {dictationModelStatus.state === "ready" && t("settings.dictation.ready")}
            {dictationModelStatus.state === "missing" && t("settings.dictation.missing")}
            {dictationModelStatus.state === "downloading" &&
              t("settings.dictation.downloading")}
            {dictationModelStatus.state === "error" &&
              (dictationModelStatus.error ?? t("settings.dictation.error"))}
          </div>
          {dictationProgress && (
            <div className="settings-download-progress">
              <div className="settings-download-bar">
                <div
                  className="settings-download-fill"
                  style={{
                    width: dictationProgress.totalBytes
                      ? `${Math.min(
                          100,
                          (dictationProgress.downloadedBytes / dictationProgress.totalBytes) * 100,
                        )}%`
                      : "0%",
                  }}
                />
              </div>
              <div className="settings-download-meta">
                {formatDownloadSize(dictationProgress.downloadedBytes)}
              </div>
            </div>
          )}
          <div className="settings-field-actions">
            {dictationModelStatus.state === "missing" && (
              <button
                type="button"
                className="primary"
                onClick={onDownloadDictationModel}
                disabled={!onDownloadDictationModel}
              >
                {t("settings.dictation.downloadModel")}
              </button>
            )}
            {dictationModelStatus.state === "downloading" && (
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={onCancelDictationDownload}
                disabled={!onCancelDictationDownload}
              >
                {t("settings.dictation.cancelDownload")}
              </button>
            )}
            {dictationReady && (
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={onRemoveDictationModel}
                disabled={!onRemoveDictationModel}
              >
                {t("settings.dictation.removeModel")}
              </button>
            )}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
