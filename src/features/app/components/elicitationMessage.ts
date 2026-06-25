import type { I18nValues } from "@/features/i18n/i18n";

type Translate = (key: string, values?: I18nValues) => string;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves the human-readable line for an elicitation card.
 *
 * Codex synthesizes `params.message` ("Allow the playwright MCP server to run tool
 * \"browser_navigate\"?") in English and bakes the templates into the pinned runtime binary — we
 * don't fork it, so that string can't be localized at the source. But codex also ships the pieces
 * as structured data: the typed `serverName` plus `_meta.{codex_approval_kind,tool_title}` (keys
 * from core/src/mcp_tool_call.rs). For MCP tool-call approvals we rebuild the sentence from those
 * fields through i18n; the server identity is shown separately as a chip, so the message itself is
 * tool-focused. Anything that is not a recognized tool-call elicitation keeps codex's own
 * `message` verbatim (we never machine-translate its free-form English), falling back to the
 * generic permission line only when there is no message at all.
 */
export function buildElicitationMessage(
  params: Record<string, unknown>,
  t: Translate,
): string {
  const meta = asRecord(params._meta);
  if (trimmedString(meta?.codex_approval_kind) === "mcp_tool_call") {
    const tool = trimmedString(meta?.tool_title);
    return tool
      ? t("elicitation.mcpToolCall", { tool })
      : t("elicitation.mcpToolCallGeneric");
  }

  const message = trimmedString(params.message);
  return message || t("elicitation.fallback");
}
