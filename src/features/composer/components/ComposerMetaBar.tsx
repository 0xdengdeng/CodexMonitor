import type { CSSProperties } from "react";
import { BrainCog, SlidersHorizontal, Zap } from "lucide-react";
import type { AccessMode, ServiceTier, ThreadTokenUsage } from "../../../types";
import type { CodexArgsOption } from "../../threads/utils/codexArgsProfiles";
import { useI18n } from "@/features/i18n/i18n";

type ComposerMetaBarProps = {
  disabled: boolean;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  models: { id: string; displayName: string; model: string }[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  selectedServiceTier: ServiceTier | null;
  reasoningSupported: boolean;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  codexArgsOptions?: CodexArgsOption[];
  selectedCodexArgsOverride?: string | null;
  onSelectCodexArgsOverride?: (value: string | null) => void;
  contextUsage?: ThreadTokenUsage | null;
};

function normalizeLabelValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function hasPositiveValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatTokenCount(value: number | null | undefined) {
  const safeValue =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.round(value))
      : 0;
  if (safeValue >= 1_000_000_000) {
    return formatTokenUnit(safeValue, 1_000_000_000, "b");
  }
  if (safeValue >= 1_000_000) {
    return formatTokenUnit(safeValue, 1_000_000, "m");
  }
  if (safeValue >= 1_000) {
    return formatTokenUnit(safeValue, 1_000, "k");
  }
  return String(safeValue);
}

function formatTokenUnit(value: number, divisor: number, suffix: string) {
  const scaled = Math.round((value / divisor) * 10) / 10;
  return `${Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}${suffix}`;
}

function getContextPressure(usedPercent: number | null) {
  if (usedPercent === null) {
    return "unknown";
  }
  if (usedPercent >= 95) {
    return "critical";
  }
  if (usedPercent >= 80) {
    return "high";
  }
  if (usedPercent >= 60) {
    return "medium";
  }
  return "low";
}

export function ComposerMetaBar({
  disabled,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  models,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  selectedServiceTier,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  codexArgsOptions = [],
  selectedCodexArgsOverride = null,
  onSelectCodexArgsOverride,
  contextUsage = null,
}: ComposerMetaBarProps) {
  const { t } = useI18n();
  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? null;
  const selectedModelLabel =
    selectedModel?.displayName || selectedModel?.model || t("composer.noModels");
  const modelSelectStyle = {
    "--composer-model-select-width": `${Math.max(selectedModelLabel.length + 2, 8)}ch`,
  } as CSSProperties;
  const contextWindow = contextUsage?.modelContextWindow ?? null;
  // Use `last.totalTokens` — current context window occupancy (resets after /compact).
  // `total.totalTokens` is cumulative session spend and would never decrease.
  const contextUsedTokens = contextUsage?.last.totalTokens ?? 0;
  const contextUsedPercent = hasPositiveValue(contextWindow)
    ? clampPercent((contextUsedTokens / contextWindow) * 100)
    : null;
  const contextUsedPercentRounded =
    contextUsedPercent === null ? null : Math.round(contextUsedPercent);
  const contextUsedLabel =
    contextUsedPercentRounded === null
      ? t("composer.contextUsageUnknown")
      : t("composer.contextUsage", { percent: contextUsedPercentRounded });
  const contextTokenLabel = hasPositiveValue(contextWindow)
    ? `${formatTokenCount(contextUsedTokens)} / ${formatTokenCount(contextWindow)}`
    : t("composer.contextTokenUnknown");
  const contextValueText =
    contextUsedPercentRounded === null
      ? t("composer.contextUsageUnknown")
      : t("composer.contextUsageAriaValue", {
          percent: contextUsedPercentRounded,
          used: formatTokenCount(contextUsedTokens),
          window: formatTokenCount(contextWindow),
        });
  const contextDetailsLabel = hasPositiveValue(contextWindow)
    ? t("composer.contextUsageDetails", {
        used: formatTokenCount(contextUsedTokens),
        window: formatTokenCount(contextWindow),
        input: formatTokenCount(contextUsage?.last.inputTokens),
        cached: formatTokenCount(contextUsage?.last.cachedInputTokens),
        output: formatTokenCount(contextUsage?.last.outputTokens),
        reasoning: formatTokenCount(contextUsage?.last.reasoningOutputTokens),
      })
    : t("composer.contextUsageUnknownDetail");
  const planMode =
    collaborationModes.find((mode) => mode.id === "plan") ?? null;
  const defaultMode =
    collaborationModes.find((mode) => mode.id === "default") ?? null;
  const canUsePlanToggle =
    Boolean(planMode) &&
    collaborationModes.every(
      (mode) => mode.id === "default" || mode.id === "plan",
    );
  const planSelected = selectedCollaborationModeId === (planMode?.id ?? "");
  const formatCollaborationModeLabel = (
    mode: { id: string; label: string } | null | undefined,
  ) => {
    if (!mode) {
      return "";
    }
    const normalizedId = normalizeLabelValue(mode.id);
    const normalizedLabel = normalizeLabelValue(mode.label);
    if (normalizedId === "plan" || normalizedLabel === "plan") {
      return t("composer.collaboration.plan");
    }
    if (
      normalizedId === "default" ||
      normalizedId === "code" ||
      normalizedLabel === "default" ||
      normalizedLabel === "code"
    ) {
      return t("composer.collaboration.default");
    }
    if (normalizedId === "review" || normalizedLabel === "review") {
      return t("composer.collaboration.review");
    }
    return mode.label || mode.id;
  };
  const formatReasoningEffortLabel = (effort: string) => {
    const normalizedEffort = normalizeLabelValue(effort).replace(/[\s_-]+/g, "");
    switch (normalizedEffort) {
      case "none":
        return t("composer.reasoning.none");
      case "minimal":
        return t("composer.reasoning.minimal");
      case "low":
        return t("composer.reasoning.low");
      case "medium":
        return t("composer.reasoning.medium");
      case "high":
        return t("composer.reasoning.high");
      case "xhigh":
      case "extrahigh":
        return t("composer.reasoning.xhigh");
      default:
        return effort;
    }
  };
  return (
    <div className="composer-bar">
      <div className="composer-meta">
        {collaborationModes.length > 0 && (
          canUsePlanToggle ? (
            <div className="composer-select-wrap composer-plan-toggle-wrap">
              <label className="composer-plan-toggle" aria-label={t("composer.planMode")}>
                <input
                  className="composer-plan-toggle-input"
                  type="checkbox"
                  checked={planSelected}
                  disabled={disabled}
                  onChange={(event) =>
                    onSelectCollaborationMode(
                      event.target.checked
                        ? planMode?.id ?? "plan"
                        : (defaultMode?.id ?? null),
                    )
                  }
                />
                <span className="composer-plan-toggle-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="composer-plan-toggle-label">
                  {formatCollaborationModeLabel(planMode) || t("composer.plan")}
                </span>
              </label>
            </div>
          ) : (
            <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
              <select
                className="composer-select composer-select--model composer-select--collab"
                aria-label={t("composer.collaborationMode")}
                value={selectedCollaborationModeId ?? ""}
                onChange={(event) =>
                  onSelectCollaborationMode(event.target.value || null)
                }
                disabled={disabled}
              >
                {collaborationModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {formatCollaborationModeLabel(mode)}
                  </option>
                ))}
              </select>
            </div>
          )
        )}
        <div className="composer-select-wrap composer-select-wrap--model">
          <span className="composer-icon composer-icon--model" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4v2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M8 7.5h8a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 15v-5A2.5 2.5 0 0 1 8 7.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="9.5" cy="12.5" r="1" fill="currentColor" />
              <circle cx="14.5" cy="12.5" r="1" fill="currentColor" />
              <path
                d="M9.5 15.5h5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M5.5 11H4M20 11h-1.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--model"
            aria-label={t("composer.model")}
            value={selectedModelId ?? ""}
            onChange={(event) => onSelectModel(event.target.value)}
            disabled={disabled}
            style={modelSelectStyle}
          >
            {models.length === 0 && <option value="">{t("composer.noModels")}</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName || model.model}
              </option>
            ))}
          </select>
          {selectedServiceTier === "fast" && (
            <span
              className="composer-fast-indicator"
              role="status"
              aria-label={t("composer.fastMode")}
              title={t("composer.fastMode")}
            >
              <Zap size={12} strokeWidth={1.8} />
            </span>
          )}
        </div>
        <div className="composer-select-wrap composer-select-wrap--effort">
          <span className="composer-icon composer-icon--effort" aria-hidden>
            <BrainCog size={14} strokeWidth={1.8} />
          </span>
          <select
            className="composer-select composer-select--effort"
            aria-label={t("composer.thinkingMode")}
            value={selectedEffort ?? ""}
            onChange={(event) => onSelectEffort(event.target.value)}
            disabled={disabled || !reasoningSupported}
          >
            {reasoningOptions.length === 0 && <option value="">{t("composer.default")}</option>}
            {reasoningOptions.map((effort) => (
              <option key={effort} value={effort}>
                {formatReasoningEffortLabel(effort)}
              </option>
            ))}
          </select>
        </div>
        {codexArgsOptions.length > 1 && onSelectCodexArgsOverride && (
          <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <SlidersHorizontal size={14} strokeWidth={1.8} />
            </span>
            <select
              className="composer-select composer-select--approval"
              aria-label={t("composer.codexArgsProfile")}
              disabled={disabled}
              value={selectedCodexArgsOverride ?? ""}
              onChange={(event) =>
                onSelectCodexArgsOverride(event.target.value || null)
              }
            >
              {codexArgsOptions.map((option) => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="composer-select-wrap">
          <span className="composer-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4l7 3v5c0 4.5-3 7.5-7 8-4-0.5-7-3.5-7-8V7l7-3z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 12.5l1.8 1.8 3.7-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--approval"
            aria-label={t("settings.codex.accessMode")}
            disabled={disabled}
            value={accessMode}
            onChange={(event) =>
              onSelectAccessMode(event.target.value as AccessMode)
            }
          >
            <option value="read-only">{t("settings.codex.accessReadOnly")}</option>
            <option value="current">{t("settings.codex.accessOnRequest")}</option>
            <option value="full-access">{t("settings.codex.accessFull")}</option>
          </select>
        </div>
      </div>
      <div className="composer-context">
        <div
          className="composer-context-meter"
          role="meter"
          aria-label={t("composer.contextUsageAriaLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={contextUsedPercentRounded ?? undefined}
          aria-valuetext={contextValueText}
          data-pressure={getContextPressure(contextUsedPercent)}
          data-tooltip={contextDetailsLabel}
          style={
            {
              "--context-used": contextUsedPercent ?? 0,
            } as CSSProperties
          }
        >
          <span className="composer-context-ring" aria-hidden>
            <span className="composer-context-value">
              {contextUsedPercentRounded ?? "–"}
            </span>
          </span>
          <span className="composer-context-copy">
            <span className="composer-context-label">{contextUsedLabel}</span>
            <span className="composer-context-tokens">{contextTokenLabel}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
