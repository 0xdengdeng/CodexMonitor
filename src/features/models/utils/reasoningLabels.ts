type Translate = (key: string) => string;

type ReasoningEffortOption = {
  value: string;
  label: string;
};

function normalizeReasoningEffortLabelKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function formatReasoningEffortLabel(effort: string, t: Translate) {
  switch (normalizeReasoningEffortLabelKey(effort)) {
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
}

export function buildReasoningEffortOptions(
  efforts: string[],
  selectedEffort: string | null | undefined,
  t: Translate,
): ReasoningEffortOption[] {
  const options = efforts.map((effort) => ({
    value: effort,
    label: formatReasoningEffortLabel(effort, t),
  }));
  const selected = selectedEffort?.trim();
  if (!selected || options.some((option) => option.value === selected)) {
    return options;
  }
  return [
    {
      value: selected,
      label: formatReasoningEffortLabel(selected, t),
    },
    ...options,
  ];
}
