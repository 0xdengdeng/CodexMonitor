import type { ConversationItem } from "../types";
import { parseCollabToolCallItem } from "./threadItems.collab";
import { asNumber, asString, normalizeThreadTimestamp } from "./threadItems.shared";

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

function normalizeImageGenerationStatus(value: unknown) {
  const status = asString(value).trim();
  const normalized = status.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (normalized === "failed") {
    return "failed" as const;
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "success") {
    return "completed" as const;
  }
  return "in_progress" as const;
}

function getContentItems(item: Record<string, unknown>) {
  const raw = item.contentItems ?? item.content_items;
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

function parseImageGenerationMetadata(text: string) {
  if (!text.trim().startsWith("{")) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function firstContentText(items: Array<Record<string, unknown>>) {
  for (const entry of items) {
    const type = asString(entry.type);
    if (type === "inputText") {
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
    if (type === "inputImage") {
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
    model: asString(metadata.model) || "gpt-image-2",
    size: asString(args.size ?? metadata.size),
    assetId: asString(metadata.assetId ?? metadata.asset_id) || null,
    savedPath,
    imageSrc: imageUrl || savedPath,
    error,
    createdAt: getMessageCreatedAt(item),
  };
}

export function buildConversationItem(
  item: Record<string, unknown>,
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
  if (type === "imageGeneration") {
    const result = asString(item.result ?? "");
    const savedPath = asString(item.savedPath ?? item.saved_path ?? "");
    return {
      id,
      kind: "imageGeneration",
      status: normalizeImageGenerationStatus(item.status),
      prompt: asString(item.prompt ?? ""),
      revisedPrompt: asString(item.revisedPrompt ?? item.revised_prompt) || null,
      model: asString(item.model ?? ""),
      size: asString(item.size ?? ""),
      assetId: asString(item.assetId ?? item.asset_id) || null,
      savedPath: savedPath || null,
      imageSrc: result || savedPath || null,
      error: asString(item.error ?? "") || null,
      createdAt: getMessageCreatedAt(item),
    };
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
    return {
      id,
      kind: "message",
      role: "assistant",
      text: asString(item.text),
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
  return buildConversationItem(item);
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnCreatedAt = getTurnCreatedAt(turnRecord);
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const converted = buildConversationItemFromThreadItem(item, turnCreatedAt);
      if (converted) {
        items.push(converted);
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
