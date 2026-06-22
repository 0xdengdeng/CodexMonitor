import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useI18n } from "@/features/i18n/i18n";
import type { SettingsDeploySectionProps } from "@settings/hooks/useSettingsDeploySection";

export function SettingsDeploySection({
  remoteUnsupported,
  tokenConfigured,
  tokenDraft,
  saving,
  error,
  onTokenDraftChange,
  onSaveToken,
  onClearToken,
}: SettingsDeploySectionProps) {
  const { t } = useI18n();

  if (remoteUnsupported) {
    return (
      <SettingsSection
        title={t("settings.deploy.title")}
        subtitle={t("settings.deploy.subtitle")}
      >
        <div className="settings-field">
          <div className="settings-help">{t("deploy.remoteUnsupported")}</div>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t("settings.deploy.title")}
      subtitle={t("settings.deploy.subtitle")}
    >
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="deploy-token">
          {t("settings.deploy.tokenLabel")}
        </label>
        <div className="settings-field-row">
          <input
            id="deploy-token"
            type="password"
            className="settings-input settings-input--compact"
            value={tokenDraft}
            placeholder={t("settings.deploy.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onTokenDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onSaveToken();
              }
            }}
            disabled={saving}
            aria-label={t("settings.deploy.tokenLabel")}
          />
          <button
            type="button"
            className="button settings-button-compact"
            onClick={() => void onSaveToken()}
            disabled={saving}
          >
            {saving ? t("settings.deploy.saving") : t("settings.deploy.save")}
          </button>
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => void onClearToken()}
            disabled={saving || !tokenConfigured}
          >
            {t("settings.deploy.clear")}
          </button>
        </div>
        <div className="settings-help">
          {tokenConfigured
            ? t("settings.deploy.tokenConfigured")
            : t("settings.deploy.tokenNotConfigured")}
        </div>
        {error && <div className="settings-help settings-help-error">{error}</div>}
        <div className="settings-help">{t("settings.deploy.help")}</div>
      </div>
    </SettingsSection>
  );
}
