import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Settings from "lucide-react/dist/esm/icons/settings";
import { useI18n } from "@/features/i18n/i18n";

type SidebarBottomRailProps = {
  sessionPercent: number | null;
  weeklyPercent: number | null;
  sessionResetLabel: string | null;
  weeklyResetLabel: string | null;
  creditsLabel: string | null;
  showWeekly: boolean;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  accountSignedIn: boolean;
  accountLabel: string | null;
  onOpenEnterpriseAiSettings: () => void;
};

type UsageRowProps = {
  label: string;
  percent: number | null;
  resetLabel: string | null;
};

function UsageRow({ label, percent, resetLabel }: UsageRowProps) {
  return (
    <div className="sidebar-usage-row">
      <div className="sidebar-usage-row-head">
        <span className="sidebar-usage-name">{label}</span>
        <span className="sidebar-usage-value">
          {percent === null ? "--" : `${percent}%`}
        </span>
      </div>
      <div className="sidebar-usage-bar" aria-hidden>
        <span className="sidebar-usage-bar-fill" style={{ width: `${percent ?? 0}%` }} />
      </div>
      {resetLabel && <div className="sidebar-usage-reset">{resetLabel}</div>}
    </div>
  );
}

export function SidebarBottomRail({
  sessionPercent,
  weeklyPercent,
  sessionResetLabel,
  weeklyResetLabel,
  creditsLabel,
  showWeekly,
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
        {accountSignedIn && creditsLabel && (
          <div className="sidebar-usage-credits">{creditsLabel}</div>
        )}
        <div className="sidebar-usage-list">
          <UsageRow
            label={t("sidebar.usage.session")}
            percent={sessionPercent}
            resetLabel={sessionResetLabel}
          />
          {showWeekly && (
            <UsageRow
              label={t("sidebar.usage.weekly")}
              percent={weeklyPercent}
              resetLabel={weeklyResetLabel}
            />
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
          {showDebugButton && (
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
