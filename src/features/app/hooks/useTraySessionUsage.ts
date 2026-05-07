import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef } from "react";
import { setTraySessionUsage } from "@services/tauri";
import type { RateLimitSnapshot, TraySessionUsage } from "../../../types";
import {
  formatUsagePercentLabel,
  getUsageLabels,
  type UsageLabelsCopy,
} from "../utils/usageLabels";
import { useI18n } from "@/features/i18n/i18n";

const SYNC_DEBOUNCE_MS = 150;

type UseTraySessionUsageParams = {
  accountRateLimits: RateLimitSnapshot | null;
  showRemaining: boolean;
};

export function buildTraySessionUsage(
  accountRateLimits: RateLimitSnapshot | null,
  showRemaining: boolean,
  copy?: UsageLabelsCopy,
): TraySessionUsage | null {
  const {
    sessionPercent,
    weeklyPercent,
    sessionResetLabel,
    weeklyResetLabel,
  } = getUsageLabels(
    accountRateLimits,
    showRemaining,
    copy,
  );
  if (sessionPercent === null) {
    return null;
  }

  const usageLabel = formatUsagePercentLabel(sessionPercent, showRemaining, copy);
  const weeklyUsageLabel =
    typeof weeklyPercent === "number"
      ? formatUsagePercentLabel(weeklyPercent, showRemaining, copy)
      : null;

  return {
    sessionLabel:
      sessionResetLabel === null
        ? usageLabel
        : `${usageLabel} · ${sessionResetLabel}`,
    weeklyLabel:
      weeklyUsageLabel === null
        ? null
        : weeklyResetLabel === null
          ? weeklyUsageLabel
          : `${weeklyUsageLabel} · ${weeklyResetLabel}`,
  };
}

export function useTraySessionUsage({
  accountRateLimits,
  showRemaining,
}: UseTraySessionUsageParams) {
  const { t } = useI18n();
  const copy: UsageLabelsCopy = useMemo(
    () => ({
      availableCredits: t("sidebar.usage.availableCredits"),
      remaining: t("sidebar.usage.remaining"),
      resets: t("sidebar.usage.resets"),
      unlimited: t("home.usage.card.unlimited"),
      used: t("sidebar.usage.used"),
    }),
    [t],
  );
  const usage = useMemo(
    () => buildTraySessionUsage(accountRateLimits, showRemaining, copy),
    [accountRateLimits, copy, showRemaining],
  );
  const lastSyncedUsageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const serializedUsage = JSON.stringify(usage);
    if (lastSyncedUsageRef.current === serializedUsage) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const scheduleSync = () => {
      timeoutId = window.setTimeout(() => {
        void setTraySessionUsage(usage)
          .then(() => {
            if (!cancelled) {
              lastSyncedUsageRef.current = serializedUsage;
            }
          })
          .catch(() => {
            if (!cancelled) {
              // Retry until the desktop bridge or tray is ready for the same usage payload.
              scheduleSync();
            }
          });
      }, SYNC_DEBOUNCE_MS);
    };

    scheduleSync();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [usage]);
}
