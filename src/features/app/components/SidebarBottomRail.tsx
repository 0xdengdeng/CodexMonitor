import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Settings from "lucide-react/dist/esm/icons/settings";
import { FEATURE_VISIBILITY } from "@/features/app/config/featureVisibility";
import { useI18n } from "@/features/i18n/i18n";

type SidebarBottomRailProps = {
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  accountSignedIn: boolean;
  accountLabel: string | null;
  onOpenEnterpriseAiSettings: () => void;
};

export function SidebarBottomRail({
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  accountSignedIn,
  accountLabel,
  onOpenEnterpriseAiSettings,
}: SidebarBottomRailProps) {
  const { t } = useI18n();
  const signedInAccountLabel =
    accountLabel?.trim() || t("sidebar.account.enterpriseSignedIn");
  const usageAccountLabel = t("sidebar.usage.account", {
    account: signedInAccountLabel,
  });

  return (
    <div className="sidebar-bottom-rail">
      <div className="sidebar-usage-panel">
        <div className="sidebar-usage-header">
          <div className="sidebar-usage-kicker">{t("sidebar.usage.title")}</div>
          {!accountSignedIn ? (
            <button
              type="button"
              className="ghost sidebar-usage-login"
              onClick={onOpenEnterpriseAiSettings}
            >
              {t("sidebar.account.enterpriseSignInShort")}
            </button>
          ) : (
            <button
              type="button"
              className="ghost sidebar-usage-account"
              onClick={onOpenEnterpriseAiSettings}
              title={usageAccountLabel}
            >
              {usageAccountLabel}
            </button>
          )}
        </div>
      </div>
      <div className="sidebar-bottom-actions">
        <div className="sidebar-utility-actions">
          <button
            className="ghost sidebar-labeled-button sidebar-utility-button"
            type="button"
            onClick={onOpenSettings}
            aria-label={t("sidebar.settings.open")}
          >
            <span className="sidebar-labeled-button-icon" aria-hidden>
              <Settings size={14} aria-hidden />
            </span>
            <span>{t("sidebar.settings.label")}</span>
          </button>
          {FEATURE_VISIBILITY.debugButton && showDebugButton && (
            <button
              className="ghost sidebar-labeled-button sidebar-utility-button"
              type="button"
              onClick={onOpenDebug}
              aria-label={t("sidebar.debug.open")}
            >
              <span className="sidebar-labeled-button-icon" aria-hidden>
                <ScrollText size={14} aria-hidden />
              </span>
              <span>{t("sidebar.debug.label")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
