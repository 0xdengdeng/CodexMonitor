import type { CSSProperties } from "react";
import { BrainCog, SlidersHorizontal, Zap } from "lucide-react";
import type { AccessMode, ServiceTier, ThreadTokenUsage } from "../../../types";
import type { CodexArgsOption } from "../../threads/utils/codexArgsProfiles";
import { SelectMenu } from "../../design-system/components/select/SelectMenu";
import { useI18n } from "@/features/i18n/i18n";
import { buildReasoningEffortOptions } from "@/features/models/utils/reasoningLabels";

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
    selectedModel?.displayName || selectedModel?.model || "";
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
  const effectiveSelectedEffort = reasoningSupported ? selectedEffort : null;
  const reasoningSelectOptions = buildReasoningEffortOptions(
    reasoningOptions,
    effectiveSelectedEffort,
    t,
  );
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
  return (
    <div className="composer-bar">
      <div className="composer-meta">
        {collaborationModes.length > 0 && (
          canUsePlanToggle ? (
            <div className="composer-select-wrap composer-plan-toggle-wrap composer-meta-control">
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
            <div className="composer-select-wrap composer-meta-control">
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
              <SelectMenu
                className="composer-select composer-select--model composer-select--collab"
                aria-label={t("composer.collaborationMode")}
                value={selectedCollaborationModeId ?? ""}
                onValueChange={(nextValue) => onSelectCollaborationMode(nextValue || null)}
                disabled={disabled}
                options={collaborationModes.map((mode) => ({
                  value: mode.id,
                  label: formatCollaborationModeLabel(mode),
                }))}
                popoverClassName="composer-select-popover"
                popoverAlign="end"
                popoverPlacement="top"
              />
            </div>
          )
        )}
        <div className="composer-select-wrap composer-select-wrap--model composer-meta-control">
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
          <SelectMenu
            className="composer-select composer-select--model"
            aria-label={t("composer.model")}
            value={selectedModelId ?? ""}
            disabled={disabled || models.length === 0}
            style={modelSelectStyle}
            placeholder=""
            onValueChange={onSelectModel}
            options={models.map((model) => ({
              value: model.id,
              label: model.displayName || model.model,
            }))}
            popoverClassName="composer-select-popover composer-select-popover--model"
            popoverAlign="end"
            popoverPlacement="top"
          />
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
        <div className="composer-select-wrap composer-select-wrap--effort composer-meta-control">
          <span className="composer-icon composer-icon--effort" aria-hidden>
            <BrainCog size={14} strokeWidth={1.8} />
          </span>
          <SelectMenu
            className="composer-select composer-select--effort"
            aria-label={t("composer.thinkingMode")}
            value={effectiveSelectedEffort ?? ""}
            disabled={disabled || !reasoningSupported}
            onValueChange={onSelectEffort}
            options={
              reasoningSelectOptions.length === 0
                ? [{ value: "", label: t("composer.default"), disabled: true }]
                : reasoningSelectOptions
            }
            popoverClassName="composer-select-popover"
            popoverAlign="end"
            popoverPlacement="top"
          />
        </div>
        {codexArgsOptions.length > 1 && onSelectCodexArgsOverride && (
          <div className="composer-select-wrap composer-meta-control">
            <span className="composer-icon" aria-hidden>
              <SlidersHorizontal size={14} strokeWidth={1.8} />
            </span>
            <SelectMenu
              className="composer-select composer-select--approval"
              aria-label={t("composer.codexArgsProfile")}
              disabled={disabled}
              value={selectedCodexArgsOverride ?? ""}
              onValueChange={(nextValue) =>
                onSelectCodexArgsOverride(nextValue || null)
              }
              options={codexArgsOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              popoverClassName="composer-select-popover"
              popoverAlign="end"
              popoverPlacement="top"
            />
          </div>
        )}
        <div className="composer-select-wrap composer-meta-control">
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
          <SelectMenu
            className="composer-select composer-select--approval"
            aria-label={t("settings.codex.accessMode")}
            disabled={disabled}
            value={accessMode}
            onValueChange={(nextValue) => onSelectAccessMode(nextValue as AccessMode)}
            options={[
              { value: "read-only", label: t("settings.codex.accessReadOnly") },
              { value: "current", label: t("settings.codex.accessOnRequest") },
              { value: "full-access", label: t("settings.codex.accessFull") },
            ]}
            popoverClassName="composer-select-popover"
            popoverAlign="end"
            popoverPlacement="top"
          />
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
