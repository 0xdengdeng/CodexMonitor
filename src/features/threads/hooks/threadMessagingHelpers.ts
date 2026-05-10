import type {
  AccessMode,
  AppMention,
  ComposerSendIntent,
  RateLimitSnapshot,
  ReviewTarget,
  ServiceTier,
} from "@/types";
import {
  translate,
  type I18nValues,
  type ResolvedInterfaceLanguage,
} from "@/features/i18n/i18n";
import { clampThreadName } from "@threads/utils/threadNaming";
import { formatRelativeTime } from "@utils/time";

export type SendMessageOptions = {
  skipPromptExpansion?: boolean;
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  appMentions?: AppMention[];
  sendIntent?: ComposerSendIntent;
};

type FastCommandAction = "toggle" | "on" | "off" | "status" | "invalid";
export type ThreadMessagingTranslate = (
  key: string,
  values?: I18nValues,
) => string;

const defaultTranslate: ThreadMessagingTranslate = (key, values) =>
  translate("en", key, values);

type ResolveSendMessageOptionsArgs = {
  options?: SendMessageOptions;
  defaults: {
    accessMode?: AccessMode;
    model?: string | null;
    effort?: string | null;
    serviceTier?: ServiceTier | null | undefined;
    collaborationMode?: Record<string, unknown> | null;
    steerEnabled: boolean;
    isProcessing: boolean;
    activeTurnId: string | null;
  };
};

export type ResolvedSendMessageOptions = {
  resolvedModel?: string | null;
  resolvedEffort?: string | null;
  resolvedServiceTier?: ServiceTier | null | undefined;
  sanitizedCollaborationMode: Record<string, unknown> | null;
  resolvedAccessMode?: AccessMode;
  appMentions: AppMention[];
  sendIntent: ComposerSendIntent;
  shouldSteer: boolean;
  requestMode: "start" | "steer";
};

export type TurnStartPayload = {
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  images?: string[];
  appMentions?: AppMention[];
};

export function buildReviewThreadTitle(
  target: ReviewTarget,
  t: ThreadMessagingTranslate = defaultTranslate,
): string | null {
  if (target.type === "commit") {
    const shortSha = target.sha.trim().slice(0, 7);
    const title = target.title?.trim() ?? "";
    if (shortSha && title) {
      return clampThreadName(
        t("threadMessaging.review.titleCommitWithTitle", {
          sha: shortSha,
          title,
        }),
      );
    }
    if (shortSha) {
      return clampThreadName(
        t("threadMessaging.review.titleCommit", { sha: shortSha }),
      );
    }
    return clampThreadName(t("threadMessaging.review.titleCommitFallback"));
  }
  if (target.type === "baseBranch") {
    return clampThreadName(
      t("threadMessaging.review.titleBranch", { branch: target.branch }),
    );
  }
  if (target.type === "uncommittedChanges") {
    return t("threadMessaging.review.titleWorkingTree");
  }
  return null;
}

export function isStaleSteerTurnError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("no active turn")) {
    return true;
  }
  return normalized.includes("active turn") && normalized.includes("not found");
}

export function parseFastCommand(text: string): FastCommandAction {
  const arg = text.replace(/^\/fast\b/i, "").trim().toLowerCase();
  if (!arg) {
    return "toggle";
  }
  if (arg === "on") {
    return "on";
  }
  if (arg === "off") {
    return "off";
  }
  if (arg === "status") {
    return "status";
  }
  return "invalid";
}

export function resolveSendMessageOptions({
  options,
  defaults,
}: ResolveSendMessageOptionsArgs): ResolvedSendMessageOptions {
  const resolvedModel =
    options?.model !== undefined ? options.model : defaults.model;
  const resolvedEffort =
    options?.effort !== undefined ? options.effort : defaults.effort;
  const resolvedServiceTier =
    options?.serviceTier !== undefined ? options.serviceTier : defaults.serviceTier;
  const resolvedCollaborationMode =
    options?.collaborationMode !== undefined
      ? options.collaborationMode
      : defaults.collaborationMode;
  const sanitizedCollaborationMode =
    resolvedCollaborationMode &&
    typeof resolvedCollaborationMode === "object" &&
    "settings" in resolvedCollaborationMode
      ? resolvedCollaborationMode
      : null;
  const resolvedAccessMode =
    options?.accessMode !== undefined ? options.accessMode : defaults.accessMode;
  const appMentions = options?.appMentions ?? [];
  const sendIntent = options?.sendIntent ?? "default";
  const canSteerCurrentTurn =
    defaults.isProcessing && defaults.steerEnabled && Boolean(defaults.activeTurnId);
  const shouldSteer =
    sendIntent === "steer"
      ? canSteerCurrentTurn
      : sendIntent === "queue"
        ? false
        : canSteerCurrentTurn;

  return {
    resolvedModel,
    resolvedEffort,
    resolvedServiceTier,
    sanitizedCollaborationMode,
    resolvedAccessMode,
    appMentions,
    sendIntent,
    shouldSteer,
    requestMode: shouldSteer ? "steer" : "start",
  };
}

export function buildTurnStartPayload({
  model,
  effort,
  serviceTier,
  collaborationMode,
  accessMode,
  images,
  appMentions,
}: {
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  images: string[];
  appMentions: AppMention[];
}): TurnStartPayload {
  const payload: TurnStartPayload = {
    model,
    effort,
    collaborationMode,
    accessMode,
    images,
  };
  if (serviceTier !== undefined) {
    payload.serviceTier = serviceTier;
  }
  if (appMentions.length > 0) {
    payload.appMentions = appMentions;
  }
  return payload;
}

function normalizeReset(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function resetLabel(
  value?: number | null,
  language?: ResolvedInterfaceLanguage,
): string | null {
  const resetAt = normalizeReset(value);
  return resetAt ? formatRelativeTime(resetAt, language) : null;
}

function getCollaborationModeId(
  collaborationMode?: Record<string, unknown> | null,
): string {
  if (
    !collaborationMode ||
    typeof collaborationMode !== "object" ||
    !("settings" in collaborationMode) ||
    !collaborationMode.settings ||
    typeof collaborationMode.settings !== "object" ||
    !("id" in collaborationMode.settings)
  ) {
    return "";
  }
  return String(collaborationMode.settings.id ?? "");
}

export function buildStatusLines({
  model,
  serviceTier,
  effort,
  accessMode,
  collaborationMode,
  rateLimits,
  t = defaultTranslate,
  language = "en",
}: {
  model?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  effort?: string | null;
  accessMode?: AccessMode;
  collaborationMode?: Record<string, unknown> | null;
  rateLimits: RateLimitSnapshot | null;
  t?: ThreadMessagingTranslate;
  language?: ResolvedInterfaceLanguage;
}): string[] {
  const defaultValue = t("threadMessaging.status.default");
  const offValue = t("threadMessaging.status.off");
  const lines = [
    t("threadMessaging.status.title"),
    t("threadMessaging.status.model", { value: model ?? defaultValue }),
    t("threadMessaging.status.fastMode", {
      value:
        serviceTier === "fast"
          ? t("threadMessaging.state.on")
          : t("threadMessaging.state.off"),
    }),
    t("threadMessaging.status.reasoningEffort", {
      value: effort ?? defaultValue,
    }),
    t("threadMessaging.status.access", {
      value: accessMode ?? t("threadMessaging.status.current"),
    }),
    t("threadMessaging.status.collaboration", {
      value: getCollaborationModeId(collaborationMode) || offValue,
    }),
  ];

  const primaryUsed = rateLimits?.primary?.usedPercent;
  const secondaryUsed = rateLimits?.secondary?.usedPercent;

  if (typeof primaryUsed === "number") {
    const reset = resetLabel(rateLimits?.primary?.resetsAt, language);
    lines.push(
      t("threadMessaging.status.sessionUsage", {
        percent: Math.round(primaryUsed),
        reset: reset
          ? t("threadMessaging.status.resets", { time: reset })
          : "",
      }),
    );
  }
  if (typeof secondaryUsed === "number") {
    const reset = resetLabel(rateLimits?.secondary?.resetsAt, language);
    lines.push(
      t("threadMessaging.status.weeklyUsage", {
        percent: Math.round(secondaryUsed),
        reset: reset
          ? t("threadMessaging.status.resets", { time: reset })
          : "",
      }),
    );
  }

  const credits = rateLimits?.credits ?? null;
  if (credits?.hasCredits) {
    if (credits.unlimited) {
      lines.push(t("threadMessaging.status.creditsUnlimited"));
    } else if (credits.balance) {
      lines.push(t("threadMessaging.status.credits", { value: credits.balance }));
    }
  }

  return lines;
}

export function buildMcpStatusLines(
  data: Array<Record<string, unknown>>,
  t: ThreadMessagingTranslate = defaultTranslate,
): string[] {
  const lines: string[] = [t("threadMessaging.mcp.title")];
  if (data.length === 0) {
    lines.push(t("threadMessaging.mcp.empty"));
    return lines;
  }

  const servers = [...data].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
  for (const server of servers) {
    const name = String(server.name ?? t("threadMessaging.mcp.unknown"));
    const authStatus = server.authStatus ?? server.auth_status ?? null;
    const authLabel =
      typeof authStatus === "string"
        ? authStatus
        : authStatus && typeof authStatus === "object" && "status" in authStatus
          ? String((authStatus as { status?: unknown }).status ?? "")
          : "";
    lines.push(
      `- ${name}${
        authLabel ? ` (${t("threadMessaging.mcp.auth")}: ${authLabel})` : ""
      }`,
    );

    const toolsRecord =
      server.tools && typeof server.tools === "object"
        ? (server.tools as Record<string, unknown>)
        : {};
    const prefix = `mcp__${name}__`;
    const toolNames = Object.keys(toolsRecord)
      .map((toolName) =>
        toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName,
      )
      .sort((a, b) => a.localeCompare(b));
    lines.push(
      toolNames.length > 0
        ? `  ${t("threadMessaging.mcp.tools")}: ${toolNames.join(", ")}`
        : `  ${t("threadMessaging.mcp.tools")}: ${t("threadMessaging.mcp.none")}`,
    );

    const resources = Array.isArray(server.resources) ? server.resources.length : 0;
    const templates = Array.isArray(server.resourceTemplates)
      ? server.resourceTemplates.length
      : Array.isArray(server.resource_templates)
        ? server.resource_templates.length
        : 0;
    if (resources > 0 || templates > 0) {
      lines.push(
        `  ${t("threadMessaging.mcp.resources")}: ${resources}, ${t(
          "threadMessaging.mcp.templates",
        )}: ${templates}`,
      );
    }
  }

  return lines;
}

export function buildAppsLines(
  data: Array<Record<string, unknown>>,
  t: ThreadMessagingTranslate = defaultTranslate,
): string[] {
  const lines: string[] = [t("threadMessaging.apps.title")];
  if (data.length === 0) {
    lines.push(t("threadMessaging.apps.empty"));
    return lines;
  }

  const apps = [...data].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
  for (const app of apps) {
    const name = String(app.name ?? app.id ?? t("threadMessaging.apps.unknown"));
    const appId = String(app.id ?? "");
    const isAccessible = Boolean(app.isAccessible ?? app.is_accessible ?? false);
    const status = isAccessible
      ? t("threadMessaging.apps.connected")
      : t("threadMessaging.apps.installable");
    const description =
      typeof app.description === "string" && app.description.trim().length > 0
        ? app.description.trim()
        : "";
    lines.push(
      `- ${name}${appId ? ` (${appId})` : ""} — ${status}${description ? `: ${description}` : ""}`,
    );

    const installUrl =
      typeof app.installUrl === "string"
        ? app.installUrl
        : typeof app.install_url === "string"
          ? app.install_url
          : "";
    if (!isAccessible && installUrl) {
      lines.push(`  ${t("threadMessaging.apps.install")}: ${installUrl}`);
    }
  }

  return lines;
}
