import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { useEffect, useState } from "react";
import type {
  AccountSnapshot,
  EnterpriseAiUsageSnapshot,
  LocalUsageSnapshot,
  RateLimitSnapshot,
} from "../../../types";
import {
  formatCount,
  formatDayLabel,
  formatDuration,
  formatWeekRange,
} from "../homeFormatters";
import type { HomeStatCard, UsageMetric, UsageWorkspaceOption } from "../homeTypes";
import { buildHomeUsageViewModel, type HomeUsageCopy } from "../homeUsageViewModel";
import { useI18n } from "@/features/i18n/i18n";

type HomeUsageSectionProps = {
  accountInfo: AccountSnapshot | null;
  accountRateLimits: RateLimitSnapshot | null;
  enterpriseAiUsage: EnterpriseAiUsageSnapshot | null;
  isLoadingLocalUsage: boolean;
  localUsageError: string | null;
  localUsageSnapshot: LocalUsageSnapshot | null;
  onRefreshLocalUsage: () => void;
  onUsageMetricChange: (metric: UsageMetric) => void;
  onUsageWorkspaceChange: (workspaceId: string | null) => void;
  usageMetric: UsageMetric;
  usageShowRemaining: boolean;
  usageWorkspaceId: string | null;
  usageWorkspaceOptions: UsageWorkspaceOption[];
};

function HomeUsageCard({ card }: { card: HomeStatCard }) {
  return (
    <div className={card.compact ? "home-usage-card is-compact" : "home-usage-card"}>
      <div className="home-usage-label">{card.label}</div>
      <div className="home-usage-value">
        <span className="home-usage-number">{card.value}</span>
        {card.suffix && <span className="home-usage-suffix">{card.suffix}</span>}
      </div>
      <div className="home-usage-caption">{card.caption}</div>
    </div>
  );
}

export function HomeUsageSection({
  accountInfo,
  accountRateLimits,
  enterpriseAiUsage,
  isLoadingLocalUsage,
  localUsageError,
  localUsageSnapshot,
  onRefreshLocalUsage,
  onUsageMetricChange,
  onUsageWorkspaceChange,
  usageMetric,
  usageShowRemaining,
  usageWorkspaceId,
  usageWorkspaceOptions,
}: HomeUsageSectionProps) {
  const { t, language } = useI18n();
  const [chartWeekOffset, setChartWeekOffset] = useState(0);
  const usageCopy: HomeUsageCopy = {
    activeDays: t("home.usage.card.activeDays"),
    activeDaysInLast7: t("home.usage.card.activeDaysInLast7"),
    agentTime: t("home.usage.agentTime"),
    apiKey: t("home.format.apiKey"),
    availableCredits: t("sidebar.usage.availableCredits"),
    availableBalance: t("home.usage.card.availableBalance"),
    acrossRuns: t("home.usage.card.acrossRuns"),
    averageActiveDay: t("home.usage.card.averageActiveDay"),
    averagePerRun: t("home.usage.card.averagePerRun"),
    averageTokensPerDay: t("home.usage.card.averageTokensPerDay"),
    averageTimePerDay: t("home.usage.card.averageTimePerDay"),
    cachedTokens: t("home.usage.card.cachedTokens"),
    cacheHitRate: t("home.usage.card.cacheHitRate"),
    chatgptAccount: t("home.format.chatgptAccount"),
    connectedAccount: t("home.format.connectedAccount"),
    credits: t("home.usage.card.credits"),
    currentRange: t("home.usage.card.currentRange"),
    currentWindow: t("home.usage.card.currentWindow"),
    day: t("home.usage.format.day"),
    days: t("home.usage.format.days"),
    dayWindow: t("home.usage.format.dayWindow"),
    daysWindow: t("home.usage.format.daysWindow"),
    inCurrentRange: t("home.usage.card.inCurrentRange"),
    inOutTokens: t("home.usage.card.inOutTokens"),
    latestAvailableDay: t("home.usage.card.latestAvailableDay"),
    last7Days: t("home.usage.card.last7Days"),
    last30Days: t("home.usage.card.last30Days"),
    last30Runs: t("home.usage.card.last30Runs"),
    longerWindow: t("home.usage.card.longerWindow"),
    longestStreak: t("home.usage.card.longestStreak"),
    noActiveDays: t("home.usage.card.noActiveDays"),
    noActiveStreak: t("home.usage.card.noActiveStreak"),
    noActivity: t("home.usage.card.noActivity"),
    noRuns: t("home.usage.card.noRuns"),
    noUsageData: t("home.usage.noUsageData"),
    peakDay: t("home.usage.card.peakDay"),
    plan: t("home.usage.card.plan"),
    promptTokenPercent: t("home.usage.card.promptTokenPercent"),
    rangeSeparator: t("home.usage.format.rangeSeparator"),
    remaining: t("sidebar.usage.remaining"),
    resets: t("sidebar.usage.resets"),
    runs: t("home.usage.card.runs"),
    runsInLast7: t("home.usage.card.runsInLast7"),
    saved: t("home.usage.card.saved"),
    sessionLeft: t("home.usage.card.sessionLeft"),
    sessionUsage: t("home.usage.card.sessionUsage"),
    tokens: t("home.usage.tokens"),
    total: t("home.usage.card.total"),
    unlimited: t("home.usage.card.unlimited"),
    updated: t("home.usage.updated"),
    used: t("sidebar.usage.used"),
    weeklyLeft: t("home.usage.card.weeklyLeft"),
    weeklyUsage: t("home.usage.card.weeklyUsage"),
    windowHours: t("home.usage.format.windowHours"),
    windowMinutes: t("home.usage.format.windowMinutes"),
  };
  const {
    accountCards,
    accountMeta,
    updatedLabel,
    usageCards,
    usageDays,
    usageInsights,
  } = buildHomeUsageViewModel({
    accountInfo,
    accountRateLimits,
    copy: usageCopy,
    localUsageSnapshot,
    usageMetric,
    usageShowRemaining,
    language,
  });

  const maxHistoricalWeekOffset = Math.max(0, Math.ceil(usageDays.length / 7) - 1);
  useEffect(() => {
    setChartWeekOffset((previous) => Math.min(previous, maxHistoricalWeekOffset));
  }, [maxHistoricalWeekOffset]);

  const chartWeekEnd = Math.max(0, usageDays.length - chartWeekOffset * 7);
  const chartWeekStart = Math.max(0, chartWeekEnd - 7);
  const chartDays = usageDays.slice(chartWeekStart, chartWeekEnd);
  const maxUsageValue = Math.max(
    1,
    ...chartDays.map((day) =>
      usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0,
    ),
  );
  const canShowOlderWeek = chartWeekOffset < maxHistoricalWeekOffset;
  const canShowNewerWeek = chartWeekOffset > 0;
  const chartRangeLabel = formatWeekRange(chartDays, usageCopy, language);
  const chartRangeAriaLabel =
    chartDays.length > 0
      ? t("home.usage.weekRangeAria", {
          start: chartDays[0]?.day,
          end: chartDays[chartDays.length - 1]?.day,
        })
      : t("home.usage.week");
  const showUsageSkeleton = isLoadingLocalUsage && !localUsageSnapshot;
  const showUsageEmpty = !isLoadingLocalUsage && !localUsageSnapshot;
  const enterpriseAccountCards: HomeStatCard[] = enterpriseAiUsage
    ? [
        {
          label: t("home.usage.enterpriseBalance"),
          value:
            enterpriseAiUsage.balance === null
              ? "--"
              : formatCount(Math.round(enterpriseAiUsage.balance)),
          suffix: t("home.usage.card.credits"),
          caption: t("home.usage.enterpriseAccount"),
        },
        {
          label: t("home.usage.enterpriseRequests"),
          value:
            enterpriseAiUsage.requests7d === null
              ? "--"
              : formatCount(enterpriseAiUsage.requests7d),
          caption: t("home.usage.enterpriseLast7Days"),
        },
        {
          label: t("home.usage.enterpriseTokens"),
          value:
            enterpriseAiUsage.tokens7d === null
              ? "--"
              : formatCount(enterpriseAiUsage.tokens7d),
          suffix: t("home.usage.tokens"),
          caption: t("home.usage.enterpriseLast7Days"),
        },
      ]
    : [];
  const renderedAccountCards = [...enterpriseAccountCards, ...accountCards];
  const renderedAccountMeta =
    enterpriseAiUsage?.tenantDomain ?? enterpriseAiUsage?.accountName ?? accountMeta;

  return (
    <div className="home-usage">
      <div className="home-section-header">
        <div className="home-section-title">{t("home.usage.title")}</div>
        <div className="home-section-meta-row">
          {updatedLabel && <div className="home-section-meta">{updatedLabel}</div>}
          <button
            type="button"
            className={
              isLoadingLocalUsage
                ? "home-usage-refresh is-loading"
                : "home-usage-refresh"
            }
            onClick={onRefreshLocalUsage}
            disabled={isLoadingLocalUsage}
            aria-label={t("home.usage.refresh")}
            title={t("home.usage.refresh")}
          >
            <RefreshCw
              className={
                isLoadingLocalUsage
                  ? "home-usage-refresh-icon spinning"
                  : "home-usage-refresh-icon"
              }
              aria-hidden
            />
          </button>
        </div>
      </div>
      <div className="home-usage-controls">
        <div className="home-usage-control-group">
          <span className="home-usage-control-label">{t("home.usage.workspace")}</span>
          <div className="home-usage-select-wrap">
            <select
              className="home-usage-select"
              value={usageWorkspaceId ?? ""}
              onChange={(event) => onUsageWorkspaceChange(event.target.value || null)}
              disabled={usageWorkspaceOptions.length === 0}
            >
              <option value="">{t("home.usage.allWorkspaces")}</option>
              {usageWorkspaceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="home-usage-control-group">
          <span className="home-usage-control-label">{t("home.usage.view")}</span>
          <div className="home-usage-toggle" role="group" aria-label={t("home.usage.viewAria")}>
            <button
              type="button"
              className={
                usageMetric === "tokens"
                  ? "home-usage-toggle-button is-active"
                  : "home-usage-toggle-button"
              }
              onClick={() => onUsageMetricChange("tokens")}
              aria-pressed={usageMetric === "tokens"}
            >
              {t("home.usage.tokens")}
            </button>
            <button
              type="button"
              className={
                usageMetric === "time"
                  ? "home-usage-toggle-button is-active"
                  : "home-usage-toggle-button"
              }
              onClick={() => onUsageMetricChange("time")}
              aria-pressed={usageMetric === "time"}
            >
              {t("home.usage.time")}
            </button>
          </div>
        </div>
      </div>
      {showUsageSkeleton ? (
        <div className="home-usage-skeleton">
          <div className="home-usage-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="home-usage-card" key={index}>
                <span className="home-latest-skeleton home-usage-skeleton-label" />
                <span className="home-latest-skeleton home-usage-skeleton-value" />
              </div>
            ))}
          </div>
          <div className="home-usage-chart-card">
            <span className="home-latest-skeleton home-usage-skeleton-chart" />
          </div>
        </div>
      ) : showUsageEmpty ? (
        <div className="home-usage-empty">
          <div className="home-usage-empty-title">{t("home.usage.emptyTitle")}</div>
          <div className="home-usage-empty-subtitle">
            {t("home.usage.emptySubtitle")}
          </div>
          {localUsageError && (
            <div className="home-usage-error">{localUsageError}</div>
          )}
        </div>
      ) : (
        <>
          <div className="home-usage-grid">
            {usageCards.map((card) => (
              <HomeUsageCard card={card} key={card.label} />
            ))}
          </div>
          <div className="home-usage-chart-card">
            <div className="home-usage-chart-nav">
              <div
                className="home-usage-chart-range"
                aria-label={chartRangeAriaLabel}
                aria-live="polite"
              >
                {chartRangeLabel}
              </div>
              <div className="home-usage-chart-actions">
                {canShowOlderWeek && (
                  <button
                    type="button"
                    className="home-usage-chart-button"
                    onClick={() => setChartWeekOffset((current) => current + 1)}
                    aria-label={t("home.usage.previousWeek")}
                    title={t("home.usage.previousWeek")}
                  >
                    <ChevronLeft aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="home-usage-chart-button"
                  onClick={() => setChartWeekOffset((current) => Math.max(0, current - 1))}
                  aria-label={t("home.usage.nextWeek")}
                  title={t("home.usage.nextWeek")}
                  disabled={!canShowNewerWeek}
                >
                  <ChevronRight aria-hidden />
                </button>
              </div>
            </div>
            <div className="home-usage-chart">
              {chartDays.map((day) => {
                const value =
                  usageMetric === "tokens" ? day.totalTokens : day.agentTimeMs ?? 0;
                const height = Math.max(6, Math.round((value / maxUsageValue) * 100));
                const tooltip =
                  usageMetric === "tokens"
                    ? t("home.usage.tooltip.tokens", {
                        day: formatDayLabel(day.day, language),
                        tokens: formatCount(day.totalTokens),
                      })
                    : `${formatDayLabel(day.day, language)} · ${formatDuration(day.agentTimeMs ?? 0)} ${t("home.usage.agentTime")}`;
                return (
                  <div className="home-usage-bar" key={day.day} data-value={tooltip}>
                    <span
                      className="home-usage-bar-fill"
                      style={{ height: `${height}%` }}
                    />
                    <span className="home-usage-bar-label">{formatDayLabel(day.day, language)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="home-usage-insights">
            {usageInsights.map((card) => (
              <HomeUsageCard card={card} key={card.label} />
            ))}
          </div>
          <div className="home-usage-models">
            <div className="home-usage-models-label">
              {t("home.usage.topModels")}
              {usageMetric === "time" && (
                <span className="home-usage-models-hint">{t("home.usage.tokens")}</span>
              )}
            </div>
            <div className="home-usage-models-list">
              {localUsageSnapshot?.topModels?.length ? (
                localUsageSnapshot.topModels.map((model) => (
                  <span
                    className="home-usage-model-chip"
                    key={model.model}
                    title={t("home.usage.modelTokens", {
                      model: model.model,
                      tokens: formatCount(model.tokens),
                    })}
                  >
                    {model.model}
                    <span className="home-usage-model-share">
                      {model.sharePercent.toFixed(1)}%
                    </span>
                  </span>
                ))
              ) : (
                <span className="home-usage-model-empty">{t("home.usage.noModels")}</span>
              )}
            </div>
            {localUsageError && <div className="home-usage-error">{localUsageError}</div>}
          </div>
        </>
      )}
      {renderedAccountCards.length > 0 && (
        <div className="home-account">
          <div className="home-section-header">
            <div className="home-section-title">{t("home.usage.accountLimits")}</div>
            {renderedAccountMeta && (
              <div className="home-section-meta-row">
                <div className="home-section-meta">{renderedAccountMeta}</div>
              </div>
            )}
          </div>
          <div className="home-usage-grid home-account-grid">
            {renderedAccountCards.map((card) => (
              <HomeUsageCard card={card} key={card.label} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
