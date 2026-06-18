import type { ConversationItem } from "../types";
import { imageGenerationIdsMatch } from "./threadItems.imageGeneration";
import { normalizeThreadTimestamp } from "./threadItems.shared";

function mergeUserInputQuestions(
  existing: Extract<ConversationItem, { kind: "userInput" }>["questions"],
  incoming: Extract<ConversationItem, { kind: "userInput" }>["questions"],
) {
  const existingById = new Map(existing.map((question) => [question.id, question]));
  const merged = incoming.map((question) => {
    const prior = existingById.get(question.id);
    if (!prior) {
      return question;
    }
    const incomingHasAnswers = question.answers.length > 0;
    return {
      ...prior,
      ...question,
      header: question.header.trim() ? question.header : prior.header,
      question: question.question.trim() ? question.question : prior.question,
      answers: incomingHasAnswers ? question.answers : prior.answers,
    };
  });
  const incomingIds = new Set(incoming.map((question) => question.id));
  const missingExisting = existing.filter((question) => !incomingIds.has(question.id));
  return [...merged, ...missingExisting];
}

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function mergeImageGenerationItem(
  existing: Extract<ConversationItem, { kind: "imageGeneration" }>,
  incoming: Extract<ConversationItem, { kind: "imageGeneration" }>,
): Extract<ConversationItem, { kind: "imageGeneration" }> {
  const incomingStatus =
    existing.status === "completed" && incoming.status === "in_progress"
      ? existing.status
      : incoming.status;
  const savedPath = hasText(incoming.savedPath)
    ? incoming.savedPath
    : existing.savedPath;
  // Pin the displayed source to the stable local artifact path once we have one.
  // Runtime raw events may include both saved_path metadata and a transient data URL;
  // keeping the local path avoids flipping <img src> on refresh.
  const imageSrc = hasText(savedPath)
    ? savedPath
    : hasText(incoming.imageSrc)
      ? incoming.imageSrc
      : existing.imageSrc;
  return {
    ...existing,
    ...incoming,
    status: incomingStatus,
    prompt: hasText(incoming.prompt) ? incoming.prompt : existing.prompt,
    revisedPrompt: hasText(incoming.revisedPrompt)
      ? incoming.revisedPrompt
      : existing.revisedPrompt,
    model: hasText(incoming.model) ? incoming.model : existing.model,
    size: hasText(incoming.size) ? incoming.size : existing.size,
    assetId: hasText(incoming.assetId) ? incoming.assetId : existing.assetId,
    savedPath,
    imageSrc,
    error:
      incoming.status === "completed"
        ? null
        : hasText(incoming.error)
          ? incoming.error
          : existing.error,
    createdAt: incoming.createdAt ?? existing.createdAt,
  };
}

export function upsertItem(list: ConversationItem[], item: ConversationItem) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    return [...list, item];
  }
  const existing = list[index];
  const next = [...list];

  if (existing.kind !== item.kind) {
    next[index] = item;
    return next;
  }

  if (existing.kind === "message" && item.kind === "message") {
    const existingText = existing.text ?? "";
    const incomingText = item.text ?? "";
    next[index] = {
      ...existing,
      ...item,
      text: incomingText.length >= existingText.length ? incomingText : existingText,
      createdAt: item.createdAt ?? existing.createdAt,
      images: item.images?.length ? item.images : existing.images,
    };
    return next;
  }

  if (existing.kind === "userInput" && item.kind === "userInput") {
    next[index] = {
      ...existing,
      ...item,
      questions: mergeUserInputQuestions(existing.questions, item.questions),
    };
    return next;
  }

  if (existing.kind === "reasoning" && item.kind === "reasoning") {
    const existingSummary = existing.summary ?? "";
    const incomingSummary = item.summary ?? "";
    const existingContent = existing.content ?? "";
    const incomingContent = item.content ?? "";
    next[index] = {
      ...existing,
      ...item,
      summary:
        incomingSummary.length >= existingSummary.length
          ? incomingSummary
          : existingSummary,
      content:
        incomingContent.length >= existingContent.length
          ? incomingContent
          : existingContent,
    };
    return next;
  }

  if (existing.kind === "tool" && item.kind === "tool") {
    const existingOutput = existing.output ?? "";
    const incomingOutput = item.output ?? "";
    const hasIncomingOutput = incomingOutput.trim().length > 0;
    const hasIncomingChanges = (item.changes?.length ?? 0) > 0;
    next[index] = {
      ...existing,
      ...item,
      title: item.title?.trim() ? item.title : existing.title,
      detail: item.detail?.trim() ? item.detail : existing.detail,
      status: item.status?.trim() ? item.status : existing.status,
      output: hasIncomingOutput ? incomingOutput : existingOutput,
      changes: hasIncomingChanges ? item.changes : existing.changes,
      durationMs:
        typeof item.durationMs === "number" ? item.durationMs : existing.durationMs,
    };
    return next;
  }

  if (existing.kind === "imageGeneration" && item.kind === "imageGeneration") {
    next[index] = mergeImageGenerationItem(existing, item);
    return next;
  }

  if (existing.kind === "diff" && item.kind === "diff") {
    const existingDiff = existing.diff ?? "";
    const incomingDiff = item.diff ?? "";
    next[index] = {
      ...existing,
      ...item,
      title: item.title?.trim() ? item.title : existing.title,
      status: item.status?.trim() ? item.status : existing.status,
      diff: incomingDiff.length >= existingDiff.length ? incomingDiff : existingDiff,
    };
    return next;
  }

  if (existing.kind === "review" && item.kind === "review") {
    const existingText = existing.text ?? "";
    const incomingText = item.text ?? "";
    next[index] = {
      ...existing,
      ...item,
      text: incomingText.length >= existingText.length ? incomingText : existingText,
    };
    return next;
  }

  next[index] = { ...existing, ...item };
  return next;
}

export function getThreadTimestamp(thread: Record<string, unknown>) {
  const raw =
    (thread.updatedAt ?? thread.updated_at ?? thread.createdAt ?? thread.created_at) ??
    0;
  return normalizeThreadTimestamp(raw);
}

export function getThreadCreatedTimestamp(thread: Record<string, unknown>) {
  const raw = (thread.createdAt ?? thread.created_at) ?? 0;
  return normalizeThreadTimestamp(raw);
}

export function previewThreadName(text: string, fallback: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
}

function chooseRicherItem(remote: ConversationItem, local: ConversationItem) {
  if (remote.kind !== local.kind) {
    return remote;
  }
  if (remote.kind === "message" && local.kind === "message") {
    const chosen = local.text.length > remote.text.length ? local : remote;
    return {
      ...chosen,
      createdAt: chosen.createdAt ?? remote.createdAt ?? local.createdAt,
    };
  }
  if (remote.kind === "userInput" && local.kind === "userInput") {
    const remoteScore = remote.questions.reduce(
      (total, question) =>
        total + question.question.length + question.answers.join("\n").length,
      0,
    );
    const localScore = local.questions.reduce(
      (total, question) =>
        total + question.question.length + question.answers.join("\n").length,
      0,
    );
    return localScore > remoteScore ? local : remote;
  }
  if (remote.kind === "reasoning" && local.kind === "reasoning") {
    const remoteLength = remote.summary.length + remote.content.length;
    const localLength = local.summary.length + local.content.length;
    return localLength > remoteLength ? local : remote;
  }
  if (remote.kind === "tool" && local.kind === "tool") {
    const remoteOutput = remote.output ?? "";
    const localOutput = local.output ?? "";
    const hasRemoteOutput = remoteOutput.trim().length > 0;
    const remoteStatus = remote.status?.trim();
    return {
      ...remote,
      status: remoteStatus ? remote.status : local.status,
      output: hasRemoteOutput ? remoteOutput : localOutput,
      changes: remote.changes ?? local.changes,
      collabSender: remote.collabSender ?? local.collabSender,
      collabReceiver: remote.collabReceiver ?? local.collabReceiver,
      collabReceivers:
        (remote.collabReceivers?.length ?? 0) > 0
          ? remote.collabReceivers
          : local.collabReceivers,
      collabStatuses:
        (remote.collabStatuses?.length ?? 0) > 0
          ? remote.collabStatuses
          : local.collabStatuses,
    };
  }
  if (remote.kind === "imageGeneration" && local.kind === "imageGeneration") {
    return mergeImageGenerationItem(local, remote);
  }
  if (remote.kind === "diff" && local.kind === "diff") {
    const useLocal = local.diff.length > remote.diff.length;
    const remoteStatus = remote.status?.trim();
    return {
      ...remote,
      diff: useLocal ? local.diff : remote.diff,
      status: remoteStatus ? remote.status : local.status,
    };
  }
  return remote;
}

export function mergeThreadItems(
  remoteItems: ConversationItem[],
  localItems: ConversationItem[],
  options?: {
    appendUnmatchedLocal?: boolean;
    appendUnmatchedLocalKinds?: ConversationItem["kind"][];
  },
) {
  if (!localItems.length) {
    return remoteItems;
  }
  const appendUnmatchedLocal = options?.appendUnmatchedLocal ?? true;
  const appendUnmatchedLocalKinds = new Set(options?.appendUnmatchedLocalKinds ?? []);
  const byId = new Map(remoteItems.map((item) => [item.id, item]));
  const localItemsById = new Map(localItems.map((item) => [item.id, item]));
  const findLocalItem = (remote: ConversationItem) => {
    const exact = localItemsById.get(remote.id);
    if (exact || remote.kind !== "imageGeneration") {
      return exact;
    }
    return localItems.find(
      (local) =>
        local.kind === "imageGeneration" &&
        imageGenerationIdsMatch(remote.id, local.id),
    );
  };
  const hasRemoteItem = (local: ConversationItem) => {
    if (byId.has(local.id)) {
      return true;
    }
    if (local.kind === "message") {
      return remoteItems.some(
        (remote) =>
          remote.kind === "message" &&
          remote.role === local.role &&
          remote.text.trim() === local.text.trim(),
      );
    }
    return (
      local.kind === "imageGeneration" &&
      remoteItems.some(
        (remote) =>
          remote.kind === "imageGeneration" &&
          imageGenerationIdsMatch(remote.id, local.id),
      )
    );
  };
  const merged = remoteItems.map((item) => {
    const local = findLocalItem(item);
    return local ? chooseRicherItem(item, local) : item;
  });
  if (appendUnmatchedLocal || appendUnmatchedLocalKinds.size > 0) {
    localItems.forEach((item) => {
      if (
        !hasRemoteItem(item) &&
        (appendUnmatchedLocal || appendUnmatchedLocalKinds.has(item.kind))
      ) {
        merged.push(item);
      }
    });
  }
  return merged;
}
