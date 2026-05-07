import type { RateLimitSnapshot } from "../../../types";
import { formatRelativeTime } from "../../../utils/time";

type UsageLabels = {
  sessionPercent: number | null;
  weeklyPercent: number | null;
  sessionResetLabel: string | null;
  weeklyResetLabel: string | null;
  creditsLabel: string | null;
  showWeekly: boolean;
};

export type UsageLabelsCopy = {
  availableCredits: string;
  remaining: string;
  resets: string;
  unlimited: string;
  used: string;
};

const defaultUsageLabelsCopy: UsageLabelsCopy = {
  availableCredits: "Available credits: {value}",
  remaining: "{percent}% remaining",
  resets: "Resets {time}",
  unlimited: "Unlimited",
  used: "{percent}% used",
};

const clampPercent = (value: number) =>
  Math.min(Math.max(Math.round(value), 0), 100);

function formatResetLabel(
  resetsAt: number | null | undefined,
  copy: UsageLabelsCopy,
) {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) {
    return null;
  }
  const resetMs = resetsAt > 1_000_000_000_000 ? resetsAt : resetsAt * 1000;
  const relative = formatRelativeTime(resetMs).replace(/^in\s+/i, "");
  return copy.resets.replace("{time}", relative);
}

function formatCreditsLabel(
  accountRateLimits: RateLimitSnapshot | null,
  copy: UsageLabelsCopy,
) {
  const credits = accountRateLimits?.credits ?? null;
  if (!credits?.hasCredits) {
    return null;
  }
  if (credits.unlimited) {
    return copy.availableCredits.replace("{value}", copy.unlimited);
  }
  const balance = credits.balance?.trim() ?? "";
  if (!balance) {
    return null;
  }
  const intValue = Number.parseInt(balance, 10);
  if (Number.isFinite(intValue) && intValue > 0) {
    return copy.availableCredits.replace("{value}", String(intValue));
  }
  const floatValue = Number.parseFloat(balance);
  if (Number.isFinite(floatValue) && floatValue > 0) {
    const rounded = Math.round(floatValue);
    return rounded > 0
      ? copy.availableCredits.replace("{value}", String(rounded))
      : null;
  }
  return null;
}

export function getUsageLabels(
  accountRateLimits: RateLimitSnapshot | null,
  showRemaining: boolean,
  copy: UsageLabelsCopy = defaultUsageLabelsCopy,
): UsageLabels {
  const usagePercent = accountRateLimits?.primary?.usedPercent;
  const globalUsagePercent = accountRateLimits?.secondary?.usedPercent;
  const sessionPercent =
    typeof usagePercent === "number"
      ? showRemaining
        ? 100 - clampPercent(usagePercent)
        : clampPercent(usagePercent)
      : null;
  const weeklyPercent =
    typeof globalUsagePercent === "number"
      ? showRemaining
        ? 100 - clampPercent(globalUsagePercent)
        : clampPercent(globalUsagePercent)
      : null;

  return {
    sessionPercent,
    weeklyPercent,
    sessionResetLabel: formatResetLabel(accountRateLimits?.primary?.resetsAt, copy),
    weeklyResetLabel: formatResetLabel(accountRateLimits?.secondary?.resetsAt, copy),
    creditsLabel: formatCreditsLabel(accountRateLimits, copy),
    showWeekly: Boolean(accountRateLimits?.secondary),
  };
}

export function formatUsagePercentLabel(
  percent: number,
  showRemaining: boolean,
  copy: UsageLabelsCopy = defaultUsageLabelsCopy,
) {
  return (showRemaining ? copy.remaining : copy.used).replace(
    "{percent}",
    String(percent),
  );
}
