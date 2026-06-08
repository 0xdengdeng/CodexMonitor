import type { ConversationItem } from "../types";
import { parseCollabToolCallItem } from "./threadItems.collab";
import { asNumber, asString, normalizeThreadTimestamp } from "./threadItems.shared";
import { normalizePublicImageModel } from "./imageModels";
import { upsertItem } from "./threadItems.listOps";

type ThreadItemConversionOptions = {
  imageGenerationModel?: string | null;
};

function extractImageInputValue(input: Record<string, unknown>) {
  const value =
    asString(input.url ?? "") ||
    asString(input.path ?? "") ||
    asString(input.value ?? "") ||
    asString(input.data ?? "") ||
    asString(input.source ?? "");
  return value.trim();
}

function parseUserInputs(inputs: Array<Record<string, unknown>>) {
  const textParts: string[] = [];
  const images: string[] = [];
  inputs.forEach((input) => {
    const type = asString(input.type);
    if (type === "text") {
      const text = asString(input.text);
      if (text) {
        textParts.push(text);
      }
      return;
    }
    if (type === "skill") {
      const name = asString(input.name);
      if (name) {
        textParts.push(`$${name}`);
      }
      return;
    }
    if (type === "image" || type === "localImage") {
      const value = extractImageInputValue(input);
      if (value) {
        images.push(value);
      }
    }
  });
  return { text: textParts.join(" ").trim(), images };
}

function getMessageCreatedAt(
  item: Record<string, unknown>,
  fallbackCreatedAt?: number,
) {
  const raw =
    item.createdAt ??
    item.created_at ??
    item.timestamp ??
    item.time ??
    item.completedAt ??
    item.completed_at;
  const timestamp = normalizeThreadTimestamp(raw);
  return timestamp > 0 ? timestamp : fallbackCreatedAt;
}

function getTurnCreatedAt(turn: Record<string, unknown>) {
  const raw =
    turn.startedAt ??
    turn.started_at ??
    turn.startTime ??
    turn.start_time ??
    turn.createdAt ??
    turn.created_at ??
    turn.timestamp;
  const timestamp = normalizeThreadTimestamp(raw);
  return timestamp > 0 ? timestamp : undefined;
}

function getTurnId(turn: Record<string, unknown>) {
  return asString(turn.id ?? turn.turnId ?? turn.turn_id).trim();
}

function isImageGenerationItemType(type: string) {
  return type === "imageGeneration" || type === "image_generation_call";
}

export function scopeImageGenerationItemForTurn(
  item: Record<string, unknown>,
  turnId?: string | null,
) {
  const type = asString(item.type);
  if (!isImageGenerationItemType(type)) {
    return item;
  }
  const normalizedTurnId = asString(turnId).trim();
  const id = asString(item.id).trim();
  if (!normalizedTurnId || !id || id.startsWith(`${normalizedTurnId}:`)) {
    return item;
  }
  const callId = asString(item.callId ?? item.call_id).trim() || id;
  return {
    ...item,
    id: `${normalizedTurnId}:${id}`,
    callId,
    call_id: callId,
  };
}

function normalizeImageGenerationStatus(value: unknown, hasGeneratedImage = false) {
  const status = asString(value).trim();
  const normalized = status.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (normalized === "failed") {
    return "failed" as const;
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "success") {
    return "completed" as const;
  }
  if (hasGeneratedImage) {
    return "completed" as const;
  }
  return "in_progress" as const;
}

function normalizeImageGenerationResultSrc(result: string) {
  const trimmed = result.trim();
  if (!trimmed) {
    return "";
  }
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("file://")
  ) {
    return trimmed;
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length > 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }
  return trimmed;
}

function getContentItems(item: Record<string, unknown>) {
  const raw = item.contentItems ?? item.content_items;
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function parseJsonRecord(text: string) {
  if (!text.trim().startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseImageGenerationMetadata(text: string) {
  return parseJsonRecord(text) ?? {};
}

function resolveImageGenerationModel(
  model: unknown,
  options?: ThreadItemConversionOptions,
) {
  const configuredModel = normalizePublicImageModel(
    asString(options?.imageGenerationModel),
  );
  if (configuredModel) {
    return configuredModel;
  }
  return normalizePublicImageModel(asString(model));
}

function firstContentText(items: Array<Record<string, unknown>>) {
  for (const entry of items) {
    const type = asString(entry.type);
    if (type === "inputText" || type === "input_text") {
      const text = asString(entry.text);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function firstContentImageUrl(items: Array<Record<string, unknown>>) {
  for (const entry of items) {
    const type = asString(entry.type);
    if (type === "inputImage" || type === "input_image") {
      const url = asString(entry.imageUrl ?? entry.image_url);
      if (url) {
        return url;
      }
    }
  }
  return "";
}

function buildImageGenerationFromDynamicToolCall(
  item: Record<string, unknown>,
): ConversationItem | null {
  const namespaceRaw = item.namespace;
  const namespace =
    typeof namespaceRaw === "string" && namespaceRaw.trim().length > 0
      ? namespaceRaw.trim()
      : null;
  const tool = asString(item.tool).trim();
  if (namespace !== "codex_monitor" || tool !== "generate_image") {
    return null;
  }
  const id = asString(item.id);
  if (!id) {
    return null;
  }
  const args =
    item.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments)
      ? (item.arguments as Record<string, unknown>)
      : {};
  const contentItems = getContentItems(item);
  const imageUrl = firstContentImageUrl(contentItems);
  const text = firstContentText(contentItems);
  const metadata = parseImageGenerationMetadata(text);
  const success = item.success;
  const status =
    success === false ? "failed" : normalizeImageGenerationStatus(item.status);
  const error =
    status === "failed"
      ? asString(metadata.error ?? metadata.message ?? text) || "图片生成失败。"
      : null;
  const savedPath =
    asString(metadata.savedPath ?? metadata.saved_path ?? metadata.localPath ?? metadata.local_path) ||
    imageUrl ||
    null;
  return {
    id,
    kind: "imageGeneration",
    status,
    prompt: asString(args.prompt),
    revisedPrompt: asString(metadata.revisedPrompt ?? metadata.revised_prompt) || null,
    model: normalizePublicImageModel(asString(metadata.model)),
    size: asString(args.size ?? metadata.size),
    assetId: asString(metadata.assetId ?? metadata.asset_id) || null,
    savedPath,
    imageSrc: imageUrl || savedPath,
    error,
    createdAt: getMessageCreatedAt(item),
  };
}

function buildImageGenerationItem(
  item: Record<string, unknown>,
  options?: ThreadItemConversionOptions,
): ConversationItem {
  const id = asString(item.id);
  const result = asString(item.result ?? "");
  const savedPath = asString(item.savedPath ?? item.saved_path ?? "");
  const resultSrc = normalizeImageGenerationResultSrc(result);
  const imageSrc = savedPath || resultSrc;
  return {
    id,
    kind: "imageGeneration",
    status: normalizeImageGenerationStatus(item.status, Boolean(imageSrc)),
    prompt: asString(item.prompt ?? ""),
    revisedPrompt: asString(item.revisedPrompt ?? item.revised_prompt) || null,
    model: resolveImageGenerationModel(item.model, options),
    size: asString(item.size ?? ""),
    assetId: asString(item.assetId ?? item.asset_id) || null,
    savedPath: savedPath || null,
    imageSrc: imageSrc || null,
    error: asString(item.error ?? "") || null,
    createdAt: getMessageCreatedAt(item),
  };
}

function normalizeDynamicToolArguments(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const text = asString(value).trim();
  return text ? parseJsonRecord(text) ?? {} : {};
}

function normalizeDynamicToolOutputContentItem(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = asString(value.type);
  if (type === "inputText" || type === "input_text") {
    const text = asString(value.text);
    return text ? { type: "inputText", text } : null;
  }
  if (type === "inputImage" || type === "input_image") {
    const imageUrl = asString(value.imageUrl ?? value.image_url);
    return imageUrl ? { type: "inputImage", imageUrl } : null;
  }
  return null;
}

function normalizeDynamicToolOutputContentItems(output: unknown) {
  if (Array.isArray(output)) {
    return output
      .map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? normalizeDynamicToolOutputContentItem(entry as Record<string, unknown>)
          : null,
      )
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const text = asString(output);
  return text ? [{ type: "inputText", text }] : [];
}

function getRawFunctionCallId(item: Record<string, unknown>) {
  return asString(item.call_id ?? item.callId ?? item.id);
}

function isDynamicFunctionCall(item: Record<string, unknown>) {
  const type = asString(item.type);
  const namespace = asString(item.namespace);
  const tool = asString(item.name ?? item.tool);
  return type === "function_call" && namespace === "codex_monitor" && Boolean(tool);
}

function buildDynamicToolCallFromRawFunctionOutput(
  item: Record<string, unknown>,
  callsById: Map<string, Record<string, unknown>>,
  fallbackCreatedAt?: number,
) {
  if (asString(item.type) !== "function_call_output") {
    return null;
  }
  const callId = getRawFunctionCallId(item);
  const call = callId ? callsById.get(callId) : undefined;
  if (!call) {
    return null;
  }
  const contentItems = normalizeDynamicToolOutputContentItems(item.output);
  const metadata = parseImageGenerationMetadata(firstContentText(contentItems));
  const success = !asString(metadata.error ?? metadata.message);
  return {
    type: "dynamicToolCall",
    id: callId,
    namespace: asString(call.namespace),
    tool: asString(call.name ?? call.tool),
    status: success ? "completed" : "failed",
    arguments: normalizeDynamicToolArguments(call.arguments),
    contentItems,
    success,
    createdAt: getMessageCreatedAt(item, getMessageCreatedAt(call, fallbackCreatedAt)),
  };
}

export function buildConversationItem(
  item: Record<string, unknown>,
  options?: ThreadItemConversionOptions,
): ConversationItem | null {
  const type = asString(item.type);
  const id = asString(item.id);
  if (!id || !type) {
    return null;
  }
  if (type === "agentMessage") {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text,
      createdAt: getMessageCreatedAt(item),
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "reasoning") {
    const summary = asString(item.summary ?? "");
    const content = Array.isArray(item.content)
      ? item.content.map((entry) => asString(entry)).join("\n")
      : asString(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  if (type === "plan") {
    return {
      id,
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: asString(item.status ?? ""),
      status: asString(item.status ?? ""),
      output: asString(item.text ?? ""),
    };
  }
  if (type === "commandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.map((part) => asString(part)).join(" ")
      : asString(item.command ?? "");
    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
    return {
      id,
      kind: "tool",
      toolType: type,
      title: command ? `Command: ${command}` : "Command",
      detail: asString(item.cwd ?? ""),
      status: asString(item.status ?? ""),
      output: asString(item.aggregatedOutput ?? ""),
      durationMs,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const normalizedChanges = changes
      .map((change) => {
        const path = asString(change?.path ?? "");
        const kind = change?.kind as Record<string, unknown> | string | undefined;
        const kindType =
          typeof kind === "string"
            ? kind
            : typeof kind === "object" && kind
              ? asString((kind as Record<string, unknown>).type ?? "")
              : "";
        const normalizedKind = kindType ? kindType.toLowerCase() : "";
        const diff = asString(change?.diff ?? "");
        return { path, kind: normalizedKind || undefined, diff: diff || undefined };
      })
      .filter((change) => change.path);
    const formattedChanges = normalizedChanges
      .map((change) => {
        const prefix =
          change.kind === "add"
            ? "A"
            : change.kind === "delete"
              ? "D"
              : change.kind
                ? "M"
                : "";
        return [prefix, change.path].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const paths = formattedChanges.join(", ");
    const diffOutput = normalizedChanges
      .map((change) => change.diff ?? "")
      .filter(Boolean)
      .join("\n\n");
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "File changes",
      detail: paths || "Pending changes",
      status: asString(item.status ?? ""),
      output: diffOutput,
      changes: normalizedChanges,
    };
  }
  if (type === "mcpToolCall") {
    const server = asString(item.server ?? "");
    const tool = asString(item.tool ?? "");
    const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    return {
      id,
      kind: "tool",
      toolType: type,
      title: `Tool: ${server}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(item.status ?? ""),
      output: asString(item.result ?? item.error ?? ""),
    };
  }
  if (type === "dynamicToolCall") {
    const imageGeneration = buildImageGenerationFromDynamicToolCall(item);
    if (imageGeneration) {
      return imageGeneration;
    }
    const namespace = asString(item.namespace ?? "");
    const tool = asString(item.tool ?? "");
    const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    const contentItems = getContentItems(item);
    const output = firstContentText(contentItems) || asString(item.error ?? "");
    return {
      id,
      kind: "tool",
      toolType: type,
      title: `Tool: ${namespace}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(item.status ?? ""),
      output,
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    return parseCollabToolCallItem(item);
  }
  if (type === "webSearch") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Web search",
      detail: asString(item.query ?? ""),
      status: status || "completed",
      output: "",
    };
  }
  if (type === "imageView") {
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Image view",
      detail: asString(item.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (type === "imageGeneration" || type === "image_generation_call") {
    return buildImageGenerationItem(item, options);
  }
  if (type === "contextCompaction") {
    const status = asString(item.status ?? "").trim();
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Context compaction",
      detail: "Compacting conversation context to fit token limits.",
      status: status || "completed",
      output: "",
    };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return {
      id,
      kind: "review",
      state: type === "enteredReviewMode" ? "started" : "completed",
      text: asString(item.review ?? ""),
    };
  }
  return null;
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
  fallbackCreatedAt?: number,
  options?: ThreadItemConversionOptions,
): ConversationItem | null {
  const type = asString(item.type);
  const id = asString(item.id);
  if (!id || !type) {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const { text, images } = parseUserInputs(content as Array<Record<string, unknown>>);
    return {
      id,
      kind: "message",
      role: "user",
      text,
      createdAt: getMessageCreatedAt(item, fallbackCreatedAt),
      images: images.length > 0 ? images : undefined,
    };
  }
  if (type === "agentMessage") {
    const text = asString(item.text);
    if (text.trim().length === 0) {
      return null;
    }
    return {
      id,
      kind: "message",
      role: "assistant",
      text,
      createdAt: getMessageCreatedAt(item, fallbackCreatedAt),
    };
  }
  if (type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.map((entry) => asString(entry)).join("\n")
      : asString(item.summary ?? "");
    const content = Array.isArray(item.content)
      ? item.content.map((entry) => asString(entry)).join("\n")
      : asString(item.content ?? "");
    return { id, kind: "reasoning", summary, content };
  }
  return buildConversationItem(item, options);
}

export function buildItemsFromThread(
  thread: Record<string, unknown>,
  options?: ThreadItemConversionOptions,
) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let items: ConversationItem[] = [];
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnId = getTurnId(turnRecord);
    const turnCreatedAt = getTurnCreatedAt(turnRecord);
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    const dynamicFunctionCallsById = new Map<string, Record<string, unknown>>();
    turnItems.forEach((item) => {
      if (!isDynamicFunctionCall(item)) {
        return;
      }
      const callId = getRawFunctionCallId(item);
      if (callId) {
        dynamicFunctionCallsById.set(callId, item);
      }
    });
    turnItems.forEach((item) => {
      const normalizedItem =
        buildDynamicToolCallFromRawFunctionOutput(
          item,
          dynamicFunctionCallsById,
          turnCreatedAt,
        ) ?? item;
      const displayItem = scopeImageGenerationItemForTurn(normalizedItem, turnId);
      const converted = buildConversationItemFromThreadItem(
        displayItem,
        turnCreatedAt,
        options,
      );
      if (converted) {
        items = upsertItem(items, converted);
      }
    });
  });
  return items;
}

export function isReviewingFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let reviewing = false;
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const type = asString(item?.type ?? "");
      if (type === "enteredReviewMode") {
        reviewing = true;
      } else if (type === "exitedReviewMode") {
        reviewing = false;
      }
    });
  });
  return reviewing;
}
