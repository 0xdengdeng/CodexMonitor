import { useEffect, useState } from "react";
import type { AppSettings } from "@/types";
import {
  getAppBuildType,
  isMobileRuntime,
  type AppBuildType,
} from "@services/tauri";
import { useUpdater } from "@/features/update/hooks/useUpdater";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { SelectMenu } from "@/features/design-system/components/select/SelectMenu";
import { useI18n } from "@/features/i18n/i18n";

type SettingsAboutSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onToggleAutomaticAppUpdateChecks?: () => void;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function SettingsAboutSection({
  appSettings,
  onUpdateAppSettings,
  onToggleAutomaticAppUpdateChecks,
}: SettingsAboutSectionProps) {
  const { t } = useI18n();
  const [appBuildType, setAppBuildType] = useState<AppBuildType | "unknown">("unknown");
  const [updaterEnabled, setUpdaterEnabled] = useState(false);
  const { state: updaterState, checkForUpdates, startUpdate } = useUpdater({
    enabled: updaterEnabled,
    autoCheckOnMount: false,
  });

  useEffect(() => {
    let active = true;
    const loadBuildType = async () => {
      try {
        const value = await getAppBuildType();
        if (active) {
          setAppBuildType(value);
        }
      } catch {
        if (active) {
          setAppBuildType("unknown");
        }
      }
    };
    void loadBuildType();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const detectRuntime = async () => {
      try {
        const mobileRuntime = await isMobileRuntime();
        if (active) {
          setUpdaterEnabled(!mobileRuntime);
        }
      } catch {
        if (active) {
          // In non-Tauri previews we still want local desktop-like behavior.
          setUpdaterEnabled(true);
        }
      }
    };
    void detectRuntime();
    return () => {
      active = false;
    };
  }, []);

  const buildDateValue = __APP_BUILD_DATE__.trim();
  const parsedBuildDate = Date.parse(buildDateValue);
  const buildDateLabel = Number.isNaN(parsedBuildDate)
    ? buildDateValue || t("settings.common.unknown")
    : new Date(parsedBuildDate).toLocaleString();

  return (
    <SettingsSection title={t("settings.about.title")} subtitle={t("settings.about.subtitle")}>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="theme-select">
          {t("settings.display.theme")}
        </label>
        <SelectMenu
          id="theme-select"
          className="settings-select"
          value={appSettings.theme}
          onValueChange={(nextValue) =>
            void onUpdateAppSettings({
              ...appSettings,
              theme: nextValue as AppSettings["theme"],
            })
          }
          options={[
            { value: "system", label: t("settings.display.theme.system") },
            { value: "light", label: t("settings.display.theme.light") },
            { value: "dark", label: t("settings.display.theme.dark") },
            { value: "dim", label: t("settings.display.theme.dim") },
          ]}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="interface-language-select">
          {t("settings.display.interfaceLanguage.label")}
        </label>
        <SelectMenu
          id="interface-language-select"
          className="settings-select"
          value={appSettings.interfaceLanguage}
          onValueChange={(nextValue) =>
            void onUpdateAppSettings({
              ...appSettings,
              interfaceLanguage: nextValue as AppSettings["interfaceLanguage"],
            })
          }
          options={[
            { value: "system", label: t("settings.display.interfaceLanguage.system") },
            { value: "zh-Hans", label: t("settings.display.interfaceLanguage.chinese") },
            { value: "en", label: t("settings.display.interfaceLanguage.english") },
          ]}
        />
      </div>
      <div className="settings-field">
        <div className="settings-help">
          {t("settings.about.version", { value: __APP_VERSION__ })}
        </div>
        <div className="settings-help">
          {t("settings.about.buildType", { value: appBuildType })}
        </div>
        <div className="settings-help">
          {t("settings.about.branch", {
            value: __APP_GIT_BRANCH__ || t("settings.common.unknown"),
          })}
        </div>
        <div className="settings-help">
          {t("settings.about.commit", {
            value: __APP_COMMIT_HASH__ || t("settings.common.unknown"),
          })}
        </div>
        <div className="settings-help">
          {t("settings.about.buildDate", { value: buildDateLabel })}
        </div>
      </div>
      <div className="settings-field">
        <div className="settings-label">{t("settings.about.updates")}</div>
        <SettingsToggleRow
          title={t("settings.about.autoUpdates.title")}
          subtitle={t("settings.about.autoUpdates.subtitle")}
        >
          <SettingsToggleSwitch
            pressed={appSettings.automaticAppUpdateChecksEnabled}
            onClick={() => {
              onToggleAutomaticAppUpdateChecks?.();
            }}
          />
        </SettingsToggleRow>
        <div className="settings-help">
          {t("settings.about.currentVersion", { value: __APP_VERSION__ })}
        </div>
        {!updaterEnabled && (
          <div className="settings-help">
            {t("settings.about.runtimeUnavailable")}
          </div>
        )}

        {updaterState.stage === "error" && (
          <div className="settings-help ds-text-danger">
            {t("settings.about.updateFailed", { error: updaterState.error })}
          </div>
        )}

        {updaterState.stage === "downloading" ||
        updaterState.stage === "installing" ||
        updaterState.stage === "restarting" ? (
          <div className="settings-help">
            {updaterState.stage === "downloading" ? (
              <>
                {t("settings.about.downloading", {
                  progress: updaterState.progress?.totalBytes
                  ? `${Math.round((updaterState.progress.downloadedBytes / updaterState.progress.totalBytes) * 100)}%`
                  : formatBytes(updaterState.progress?.downloadedBytes ?? 0),
                })}
              </>
            ) : updaterState.stage === "installing" ? (
              t("settings.about.installing")
            ) : (
              t("settings.about.restarting")
            )}
          </div>
        ) : updaterState.stage === "available" ? (
          <div className="settings-help">
            {t("settings.about.available", { version: updaterState.version })}
          </div>
        ) : updaterState.stage === "latest" ? (
          <div className="settings-help">{t("settings.about.latest")}</div>
        ) : null}

        <div className="settings-controls">
          {updaterState.stage === "available" ? (
            <button
              type="button"
              className="primary"
              disabled={!updaterEnabled}
              onClick={() => void startUpdate()}
            >
              {t("settings.about.downloadInstall")}
            </button>
          ) : (
            <button
              type="button"
              className="ghost"
              disabled={
                !updaterEnabled ||
                updaterState.stage === "checking" ||
                updaterState.stage === "downloading" ||
                updaterState.stage === "installing" ||
                updaterState.stage === "restarting"
              }
              onClick={() => void checkForUpdates({ announceNoUpdate: true })}
            >
              {updaterState.stage === "checking"
                ? t("settings.about.checking")
                : t("settings.about.checkForUpdates")}
            </button>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
