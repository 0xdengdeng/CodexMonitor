import type {
  AccountSnapshot,
  LocalUsageDay,
  LocalUsageSnapshot,
  RateLimitSnapshot,
} from "../../types";
import { formatRelativeTime } from "../../utils/time";
import { getUsageLabels } from "../app/utils/usageLabels";
import {
  buildWindowCaption,
  formatAccountTypeLabel,
  formatCompactNumber,
  formatCount,
  formatCreditsBalance,
  formatDayCount,
  formatDayLabel,
  formatDuration,
  formatDurationCompact,
  formatPlanType,
  isUsageDayActive,
} from "./homeFormatters";
import type { HomeStatCard, UsageMetric } from "./homeTypes";

type HomeUsageViewModel = {
  accountCards: HomeStatCard[];
  accountMeta: string | null;
  updatedLabel: string | null;
  usageCards: HomeStatCard[];
  usageDays: LocalUsageDay[];
  usageInsights: HomeStatCard[];
};

export type HomeUsageCopy = {
  activeDays: string;
  activeDaysInLast7: string;
  agentTime: string;
  apiKey: string;
  availableCredits: string;
  availableBalance: string;
  acrossRuns: string;
  averageActiveDay: string;
  averagePerRun: string;
  averageTokensPerDay: string;
  averageTimePerDay: string;
  cachedTokens: string;
  cacheHitRate: string;
  chatgptAccount: string;
  connectedAccount: string;
  credits: string;
  currentRange: string;
  currentWindow: string;
  day: string;
  days: string;
  dayWindow: string;
  daysWindow: string;
  inCurrentRange: string;
  inOutTokens: string;
  latestAvailableDay: string;
  last7Days: string;
  last30Days: string;
  last30Runs: string;
  longerWindow: string;
  longestStreak: string;
  noActiveDays: string;
  noActiveStreak: string;
  noActivity: string;
  noRuns: string;
  noUsageData: string;
  peakDay: string;
  plan: string;
  promptTokenPercent: string;
  rangeSeparator: string;
  remaining: string;
  resets: string;
  runs: string;
  runsInLast7: string;
  saved: string;
  sessionLeft: string;
  sessionUsage: string;
  tokens: string;
  total: string;
  unlimited: string;
  updated: string;
  used: string;
  weeklyLeft: string;
  weeklyUsage: string;
  windowHours: string;
  windowMinutes: string;
};

export function buildHomeUsageViewModel({
  accountInfo,
  accountRateLimits,
  copy,
  localUsageSnapshot,
  usageMetric,
  usageShowRemaining,
}: {
  accountInfo: AccountSnapshot | null;
  accountRateLimits: RateLimitSnapshot | null;
  copy: HomeUsageCopy;
  localUsageSnapshot: LocalUsageSnapshot | null;
  usageMetric: UsageMetric;
  usageShowRemaining: boolean;
}): HomeUsageViewModel {
  const usageTotals = localUsageSnapshot?.totals ?? null;
  const usageDays = localUsageSnapshot?.days ?? [];
  const latestUsageDay = usageDays[usageDays.length - 1] ?? null;
  const last7Days = usageDays.slice(-7);
  const last7Tokens = last7Days.reduce((total, day) => total + day.totalTokens, 0);
  const last7Input = last7Days.reduce((total, day) => total + day.inputTokens, 0);
  const last7Cached = last7Days.reduce(
    (total, day) => total + day.cachedInputTokens,
    0,
  );
  const last7AgentMs = last7Days.reduce(
    (total, day) => total + (day.agentTimeMs ?? 0),
    0,
  );
  const last30AgentMs = usageDays.reduce(
    (total, day) => total + (day.agentTimeMs ?? 0),
    0,
  );
  const averageDailyAgentMs =
    last7Days.length > 0 ? Math.round(last7AgentMs / last7Days.length) : 0;
  const last7AgentRuns = last7Days.reduce(
    (total, day) => total + (day.agentRuns ?? 0),
    0,
  );
  const last30AgentRuns = usageDays.reduce(
    (total, day) => total + (day.agentRuns ?? 0),
    0,
  );
  const averageTokensPerRun =
    last7AgentRuns > 0 ? Math.round(last7Tokens / last7AgentRuns) : null;
  const averageRunDurationMs =
    last7AgentRuns > 0 ? Math.round(last7AgentMs / last7AgentRuns) : null;
  const last7ActiveDays = last7Days.filter(isUsageDayActive).length;
  const last30ActiveDays = usageDays.filter(isUsageDayActive).length;
  const averageActiveDayAgentMs =
    last7ActiveDays > 0 ? Math.round(last7AgentMs / last7ActiveDays) : null;
  const peakAgentDay = usageDays.reduce<
    | { day: string; agentTimeMs: number }
    | null
  >((best, day) => {
    const value = day.agentTimeMs ?? 0;
    if (value <= 0) {
      return best;
    }
    if (!best || value > best.agentTimeMs) {
      return { day: day.day, agentTimeMs: value };
    }
    return best;
  }, null);

  let longestStreak = 0;
  let runningStreak = 0;
  for (const day of usageDays) {
    if (isUsageDayActive(day)) {
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  const usageCards: HomeStatCard[] =
    usageMetric === "tokens"
      ? [
          {
            label: copy.currentRange,
            value: formatCompactNumber(latestUsageDay?.totalTokens ?? 0),
            suffix: copy.tokens,
            caption: latestUsageDay
              ? copy.inOutTokens
                  .replace("{day}", formatDayLabel(latestUsageDay.day))
                  .replace("{input}", formatCount(latestUsageDay.inputTokens))
                  .replace("{output}", formatCount(latestUsageDay.outputTokens))
              : copy.latestAvailableDay,
          },
          {
            label: copy.last7Days,
            value: formatCompactNumber(usageTotals?.last7DaysTokens ?? last7Tokens),
            suffix: copy.tokens,
            caption: copy.averageTokensPerDay.replace(
              "{value}",
              formatCompactNumber(usageTotals?.averageDailyTokens),
            ),
          },
          {
            label: copy.last30Days,
            value: formatCompactNumber(usageTotals?.last30DaysTokens ?? last7Tokens),
            suffix: copy.tokens,
            caption: copy.total.replace(
              "{value}",
              formatCount(usageTotals?.last30DaysTokens ?? last7Tokens),
            ),
          },
          {
            label: copy.cacheHitRate,
            value: usageTotals
              ? `${usageTotals.cacheHitRatePercent.toFixed(1)}%`
              : "--",
            caption: copy.last7Days,
          },
          {
            label: copy.cachedTokens,
            value: formatCompactNumber(last7Cached),
            suffix: copy.saved,
            caption:
              last7Input > 0
                ? copy.promptTokenPercent.replace(
                    "{percent}",
                    ((last7Cached / last7Input) * 100).toFixed(1),
                  )
                : copy.last7Days,
          },
          {
            label: copy.averagePerRun,
            value:
              averageTokensPerRun === null
                ? "--"
                : formatCompactNumber(averageTokensPerRun),
            suffix: copy.tokens,
            caption:
              last7AgentRuns > 0
                ? copy.runsInLast7.replace("{count}", formatCount(last7AgentRuns))
                : copy.noRuns,
          },
          {
            label: copy.peakDay,
            value: formatDayLabel(usageTotals?.peakDay),
            caption: `${formatCompactNumber(usageTotals?.peakDayTokens)} ${copy.tokens}`,
          },
        ]
      : [
          {
            label: copy.last7Days,
            value: formatDurationCompact(last7AgentMs),
            suffix: copy.agentTime,
            caption: copy.averageTimePerDay.replace(
              "{value}",
              formatDurationCompact(averageDailyAgentMs),
            ),
          },
          {
            label: copy.last30Days,
            value: formatDurationCompact(last30AgentMs),
            suffix: copy.agentTime,
            caption: copy.total.replace("{value}", formatDuration(last30AgentMs)),
          },
          {
            label: copy.runs,
            value: formatCount(last7AgentRuns),
            caption: copy.last30Runs.replace("{count}", formatCount(last30AgentRuns)),
          },
          {
            label: copy.averagePerRun,
            value: formatDurationCompact(averageRunDurationMs),
            caption:
              last7AgentRuns > 0
                ? copy.acrossRuns.replace("{count}", formatCount(last7AgentRuns))
                : copy.noRuns,
          },
          {
            label: copy.averageActiveDay,
            value: formatDurationCompact(averageActiveDayAgentMs),
            caption:
              last7ActiveDays > 0
                ? copy.activeDaysInLast7.replace(
                    "{count}",
                    formatCount(last7ActiveDays),
                  )
                : copy.noActiveDays,
          },
          {
            label: copy.peakDay,
            value: formatDayLabel(peakAgentDay?.day ?? null),
            caption: `${formatDurationCompact(peakAgentDay?.agentTimeMs ?? 0)} ${copy.agentTime}`,
          },
        ];

  const usageInsights = [
    {
      label: copy.longestStreak,
      value:
        longestStreak > 0
          ? formatDayCount(longestStreak, {
              day: copy.day,
              days: copy.days,
            })
          : "--",
      caption:
        longestStreak > 0
          ? copy.currentWindow
          : copy.noActiveStreak,
      compact: true,
    },
    {
      label: copy.activeDays,
      value: last7Days.length > 0 ? `${last7ActiveDays} / ${last7Days.length}` : "--",
      caption:
        usageDays.length > 0
          ? copy.inCurrentRange
              .replace("{active}", String(last30ActiveDays))
              .replace("{total}", String(usageDays.length))
          : copy.noActivity,
      compact: true,
    },
  ] satisfies HomeStatCard[];

  const usagePercentLabels = getUsageLabels(accountRateLimits, usageShowRemaining, copy);
  const planLabel = formatPlanType(accountRateLimits?.planType ?? accountInfo?.planType);
  const creditsBalance = formatCreditsBalance(accountRateLimits?.credits?.balance);
  const accountCards: HomeStatCard[] = [];

  if (usagePercentLabels.sessionPercent !== null) {
    accountCards.push({
      label: usageShowRemaining ? copy.sessionLeft : copy.sessionUsage,
      value: `${usagePercentLabels.sessionPercent}%`,
      caption: buildWindowCaption(
        usagePercentLabels.sessionResetLabel,
        accountRateLimits?.primary?.windowDurationMins,
        copy.currentWindow,
        copy,
      ),
    });
  }

  if (usagePercentLabels.showWeekly && usagePercentLabels.weeklyPercent !== null) {
    accountCards.push({
      label: usageShowRemaining ? copy.weeklyLeft : copy.weeklyUsage,
      value: `${usagePercentLabels.weeklyPercent}%`,
      caption: buildWindowCaption(
        usagePercentLabels.weeklyResetLabel,
        accountRateLimits?.secondary?.windowDurationMins,
        copy.longerWindow,
        copy,
      ),
    });
  }

  if (accountRateLimits?.credits?.hasCredits) {
    accountCards.push(
      accountRateLimits.credits.unlimited
        ? {
            label: copy.credits,
            value: copy.unlimited,
            caption: copy.availableBalance,
          }
        : {
            label: copy.credits,
            value: creditsBalance ?? "--",
            suffix: creditsBalance ? copy.credits : null,
            caption: copy.availableBalance,
          },
    );
  }

  if (planLabel) {
    accountCards.push({
      label: copy.plan,
      value: planLabel,
      caption: formatAccountTypeLabel(accountInfo?.type, copy),
    });
  }

  return {
    accountCards,
    accountMeta: accountInfo?.email ?? null,
    updatedLabel: localUsageSnapshot
      ? copy.updated.replace(
          "{time}",
          formatRelativeTime(localUsageSnapshot.updatedAt),
        )
      : null,
    usageCards,
    usageDays,
    usageInsights,
  };
}
