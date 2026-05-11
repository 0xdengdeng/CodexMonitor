import type { AccountSnapshot, LocalUsageDay } from "../../types";

type HomeFormatterCopy = {
  apiKey: string;
  chatgptAccount: string;
  connectedAccount: string;
  day: string;
  days: string;
  dayWindow: string;
  daysWindow: string;
  noUsageData: string;
  rangeSeparator: string;
  windowHours: string;
  windowMinutes: string;
};

export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--";
  }
  if (value >= 1_000_000_000) {
    const scaled = value / 1_000_000_000;
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)}b`;
  }
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)}m`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled.toFixed(scaled >= 10 ? 0 : 1)}k`;
  }
  return String(value);
}

export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--";
  }
  return new Intl.NumberFormat().format(value);
}

export function formatDuration(valueMs: number | null | undefined) {
  if (valueMs === null || valueMs === undefined) {
    return "--";
  }
  const totalSeconds = Math.max(0, Math.round(valueMs / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m`;
  }
  return `${totalSeconds}s`;
}

export function formatDurationCompact(valueMs: number | null | undefined) {
  if (valueMs === null || valueMs === undefined) {
    return "--";
  }
  const totalMinutes = Math.max(0, Math.round(valueMs / 60000));
  if (totalMinutes >= 60) {
    const hours = totalMinutes / 60;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m`;
  }
  const seconds = Math.max(0, Math.round(valueMs / 1000));
  return `${seconds}s`;
}

export function formatDayLabel(
  value: string | null | undefined,
  language?: string | null,
) {
  if (!value) {
    return "--";
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const locale = language === "zh-CN" ? "zh-CN" : "en";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatWeekRange(
  days: LocalUsageDay[],
  copy: Pick<HomeFormatterCopy, "noUsageData" | "rangeSeparator"> = {
    noUsageData: "No usage data",
    rangeSeparator: "to",
  },
  language?: string | null,
) {
  if (days.length === 0) {
    return copy.noUsageData;
  }
  const first = days[0];
  const last = days[days.length - 1];
  const firstLabel = formatDayLabel(first?.day, language);
  const lastLabel = formatDayLabel(last?.day, language);
  return first?.day === last?.day
    ? firstLabel
    : `${firstLabel} ${copy.rangeSeparator} ${lastLabel}`;
}

export function isUsageDayActive(day: LocalUsageDay) {
  return day.totalTokens > 0 || day.agentTimeMs > 0 || day.agentRuns > 0;
}

export function formatPlanType(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatAccountTypeLabel(
  value: AccountSnapshot["type"] | null | undefined,
  copy: Pick<
    HomeFormatterCopy,
    "apiKey" | "chatgptAccount" | "connectedAccount"
  > = {
    apiKey: "API key",
    chatgptAccount: "ChatGPT account",
    connectedAccount: "Connected account",
  },
) {
  if (value === "chatgpt") {
    return copy.chatgptAccount;
  }
  if (value === "apikey") {
    return copy.apiKey;
  }
  return copy.connectedAccount;
}

export function formatWindowDuration(
  valueMins: number | null | undefined,
  copy: Pick<
    HomeFormatterCopy,
    "dayWindow" | "daysWindow" | "windowHours" | "windowMinutes"
  > = {
    dayWindow: "{count} day window",
    daysWindow: "{count} days window",
    windowHours: "{count}h window",
    windowMinutes: "{count}m window",
  },
) {
  if (typeof valueMins !== "number" || !Number.isFinite(valueMins) || valueMins <= 0) {
    return null;
  }
  if (valueMins >= 60 * 24) {
    const days = Math.round(valueMins / (60 * 24));
    return (days === 1 ? copy.dayWindow : copy.daysWindow).replace(
      "{count}",
      String(days),
    );
  }
  if (valueMins >= 60) {
    const hours = Math.round(valueMins / 60);
    return copy.windowHours.replace("{count}", String(hours));
  }
  return copy.windowMinutes.replace("{count}", String(Math.round(valueMins)));
}

export function buildWindowCaption(
  resetLabel: string | null,
  windowDurationMins: number | null | undefined,
  fallback: string,
  copy?: Parameters<typeof formatWindowDuration>[1],
) {
  const parts = [resetLabel, formatWindowDuration(windowDurationMins, copy)].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

export function formatCreditsBalance(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return trimmed;
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(numeric);
}

export function formatDayCount(
  value: number | null | undefined,
  copy: Pick<HomeFormatterCopy, "day" | "days"> = {
    day: "{count} day",
    days: "{count} days",
  },
) {
  if (value === null || value === undefined) {
    return "--";
  }
  return (value === 1 ? copy.day : copy.days).replace("{count}", String(value));
}
