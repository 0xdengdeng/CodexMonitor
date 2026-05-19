import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import Brain from "lucide-react/dist/esm/icons/brain";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Diff from "lucide-react/dist/esm/icons/diff";
import FileDiffIcon from "lucide-react/dist/esm/icons/file-diff";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Image from "lucide-react/dist/esm/icons/image";
import Quote from "lucide-react/dist/esm/icons/quote";
import Search from "lucide-react/dist/esm/icons/search";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import Users from "lucide-react/dist/esm/icons/users";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import X from "lucide-react/dist/esm/icons/x";
import { exportMarkdownFile } from "@services/tauri";
import { pushErrorToast } from "@services/toasts";
import type { ConversationItem } from "../../../types";
import type { ParsedFileLocation } from "../../../utils/fileLinks";
import { PierreDiffBlock } from "../../git/components/PierreDiffBlock";
import {
  MAX_COMMAND_OUTPUT_LINES,
  basename,
  buildToolSummary,
  exploreKindLabel,
  formatDurationMs,
  formatToolStatusLabel,
  normalizeMessageImageSrc,
  statusToneFromText,
  toolNameFromTitle,
  toolStatusTone,
  type MessageImage,
  type ParsedReasoning,
  type StatusTone,
  type ToolSummary,
} from "../utils/messageRenderUtils";
import { Markdown } from "./Markdown";
import { isStandaloneMarkdownTable } from "./Markdown";
import { useI18n } from "@/features/i18n/i18n";
import { normalizePublicImageModel } from "@/utils/imageModels";

type MarkdownFileLinkProps = {
  showMessageFilePath?: boolean;
  workspacePath?: string | null;
  onPreviewFileLink?: (
    event: MouseEvent,
    path: ParsedFileLocation,
  ) => boolean;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type WorkingIndicatorProps = {
  isThinking: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  hasItems: boolean;
  reasoningLabel?: string | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
};

type MessageRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "message" }>;
  isCopied: boolean;
  onCopy: (item: Extract<ConversationItem, { kind: "message" }>) => void;
  onQuote?: (item: Extract<ConversationItem, { kind: "message" }>, selectedText?: string) => void;
  codeBlockCopyUseModifier?: boolean;
};

type ReasoningRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "reasoning" }>;
  parsed: ParsedReasoning;
  isExpanded: boolean;
  onToggle: (id: string) => void;
};

type ReviewRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "review" }>;
};

type DiffRowProps = {
  item: Extract<ConversationItem, { kind: "diff" }>;
};

type UserInputRowProps = {
  item: Extract<ConversationItem, { kind: "userInput" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
};

type ToolRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "tool" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
};

type ImageGenerationRowProps = {
  item: Extract<ConversationItem, { kind: "imageGeneration" }>;
};

type ExploreRowProps = {
  item: Extract<ConversationItem, { kind: "explore" }>;
};

type CommandOutputProps = {
  output: string;
};

type ImagePreviewMetrics = {
  width: number;
  height: number;
};

function parseImagePreviewMetrics(size: string | null | undefined): ImagePreviewMetrics | null {
  const match = size?.trim().match(/^([1-9]\d*)x([1-9]\d*)$/i);
  if (!match) {
    return null;
  }
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function imagePreviewVariant(metrics: ImagePreviewMetrics) {
  const ratio = metrics.width / metrics.height;
  if (ratio >= 1.15) {
    return "landscape";
  }
  if (ratio <= 0.85) {
    return "portrait";
  }
  return "square";
}

const MessageImageGrid = memo(function MessageImageGrid({
  images,
  onOpen,
  hasText,
}: {
  images: MessageImage[];
  onOpen: (index: number) => void;
  hasText: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`message-image-grid${hasText ? " message-image-grid--with-text" : ""}`}
      role="list"
    >
      {images.map((image, index) => (
        <button
          key={`${image.src}-${index}`}
          type="button"
          className="message-image-thumb"
          onClick={() => onOpen(index)}
          aria-label={t("messages.openImage", { index: index + 1 })}
        >
          <img src={image.src} alt={image.label} loading="lazy" />
        </button>
      ))}
    </div>
  );
});

const ImageLightbox = memo(function ImageLightbox({
  images,
  activeIndex,
  onClose,
}: {
  images: MessageImage[];
  activeIndex: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const activeImage = images[activeIndex];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!activeImage) {
    return null;
  }

  return createPortal(
    <div
      className="message-image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="message-image-lightbox-content"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="message-image-lightbox-close"
          onClick={onClose}
          aria-label={t("messages.closeImagePreview")}
        >
          <X size={16} aria-hidden />
        </button>
        <img src={activeImage.src} alt={activeImage.label} />
      </div>
    </div>,
    document.body,
  );
});

const CommandOutput = memo(function CommandOutput({ output }: CommandOutputProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const lines = useMemo(() => {
    if (!output) {
      return [];
    }
    return output.split(/\r?\n/);
  }, [output]);
  const lineWindow = useMemo(() => {
    if (lines.length <= MAX_COMMAND_OUTPUT_LINES) {
      return { offset: 0, lines };
    }
    const startIndex = lines.length - MAX_COMMAND_OUTPUT_LINES;
    return { offset: startIndex, lines: lines.slice(startIndex) };
  }, [lines]);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const threshold = 6;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setIsPinned(distanceFromBottom <= threshold);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !isPinned) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [lineWindow, isPinned]);

  if (lineWindow.lines.length === 0) {
    return null;
  }

  return (
    <div className="tool-inline-terminal" role="log" aria-live="polite">
      <div
        className="tool-inline-terminal-lines"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {lineWindow.lines.map((line, index) => (
          <div
            key={`${lineWindow.offset + index}-${line}`}
            className="tool-inline-terminal-line"
          >
            {line || " "}
          </div>
        ))}
      </div>
    </div>
  );
});

function toolIconForSummary(
  item: Extract<ConversationItem, { kind: "tool" }>,
  summary: ToolSummary,
) {
  if (item.toolType === "commandExecution") {
    return Terminal;
  }
  if (item.toolType === "fileChange") {
    return FileDiffIcon;
  }
  if (item.toolType === "webSearch") {
    return Search;
  }
  if (item.toolType === "imageView") {
    return Image;
  }
  if (item.toolType === "collabToolCall") {
    return Users;
  }

  const label = summary.label.toLowerCase();
  if (label === "read") {
    return FileText;
  }
  if (label === "searched" || label === "searching") {
    return Search;
  }

  const toolName = toolNameFromTitle(item.title).toLowerCase();
  const title = item.title.toLowerCase();
  if (toolName.includes("diff") || title.includes("diff")) {
    return Diff;
  }

  return Wrench;
}

function buildPlanExportFileName(itemId: string) {
  const normalized = itemId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!normalized) {
    return "plan.md";
  }
  return normalized.startsWith("plan-") ? `${normalized}.md` : `plan-${normalized}.md`;
}

export const WorkingIndicator = memo(function WorkingIndicator({
  isThinking,
  processingStartedAt = null,
  lastDurationMs = null,
  hasItems,
  reasoningLabel = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
}: WorkingIndicatorProps) {
  const { t } = useI18n();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pollCountdownSeconds, setPollCountdownSeconds] = useState(() =>
    Math.max(1, Math.ceil(pollingIntervalMs / 1000)),
  );

  useEffect(() => {
    if (!isThinking || !processingStartedAt) {
      setElapsedMs(0);
      return undefined;
    }
    setElapsedMs(Date.now() - processingStartedAt);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - processingStartedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isThinking, processingStartedAt]);

  useEffect(() => {
    if (!showPollingFetchStatus || isThinking) {
      return undefined;
    }
    const intervalSeconds = Math.max(1, Math.ceil(pollingIntervalMs / 1000));
    setPollCountdownSeconds(intervalSeconds);
    const timer = window.setInterval(() => {
      setPollCountdownSeconds((previous) =>
        previous <= 1 ? intervalSeconds : previous - 1,
      );
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isThinking, pollingIntervalMs, showPollingFetchStatus]);

  return (
    <>
      {isThinking && (
        <div className="working">
          <span className="working-spinner" aria-hidden />
          <div className="working-timer">
            <span className="working-timer-clock">{formatDurationMs(elapsedMs)}</span>
          </div>
          <span className="working-text">{reasoningLabel || t("messages.working")}</span>
        </div>
      )}
      {!isThinking && lastDurationMs !== null && hasItems && (
        <div className="turn-complete" aria-live="polite">
          <span className="turn-complete-line" aria-hidden />
          <span className="turn-complete-label">
            {showPollingFetchStatus
              ? t("messages.pollingFetch", { seconds: pollCountdownSeconds })
              : t("messages.doneIn", { duration: formatDurationMs(lastDurationMs) })}
          </span>
          <span className="turn-complete-line" aria-hidden />
        </div>
      )}
    </>
  );
});

function formatMessageCreatedAt(timestamp: number, language: string) {
  try {
    return new Intl.DateTimeFormat(language === "zh-CN" ? "zh-CN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return "";
  }
}

export const MessageRow = memo(function MessageRow({
  item,
  isCopied,
  onCopy,
  onQuote,
  codeBlockCopyUseModifier,
  showMessageFilePath,
  workspacePath,
  onPreviewFileLink,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MessageRowProps) {
  const { language, t } = useI18n();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const selectionSnapshotRef = useRef<string | null>(null);
  const hasText = item.text.trim().length > 0;
  const messageTime = useMemo(() => {
    if (!item.createdAt) {
      return "";
    }
    return formatMessageCreatedAt(item.createdAt, language);
  }, [item.createdAt, language]);
  const imageItems = useMemo(() => {
    if (!item.images || item.images.length === 0) {
      return [];
    }
    return item.images
      .map((image, index) => {
        const src = normalizeMessageImageSrc(image);
        if (!src) {
          return null;
        }
        return { src, label: t("messages.imageAlt", { index: index + 1 }) };
      })
      .filter(Boolean) as MessageImage[];
  }, [item.images]);
  const isTableOnlyAssistantMessage =
    item.role === "assistant" &&
    hasText &&
    imageItems.length === 0 &&
    isStandaloneMarkdownTable(item.text);

  const getSelectedMessageText = useCallback(() => {
    const bubble = bubbleRef.current;
    const selection = window.getSelection();
    if (!bubble || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!bubble.contains(range.commonAncestorContainer)) {
      return null;
    }

    const isWithinMessageControls = (node: Node | null) => {
      if (!node) {
        return false;
      }
      const element = node instanceof Element ? node : node.parentElement;
      return Boolean(element?.closest(".message-quote-button, .message-copy-button"));
    };

    if (isWithinMessageControls(selection.anchorNode) || isWithinMessageControls(selection.focusNode)) {
      return null;
    }
    return selectedText;
  }, []);

  const handleQuote = useCallback(() => {
    if (!onQuote) {
      return;
    }
    const selectedText = getSelectedMessageText() ?? selectionSnapshotRef.current ?? undefined;
    selectionSnapshotRef.current = null;
    onQuote(item, selectedText);
  }, [getSelectedMessageText, item, onQuote]);

  return (
    <div className={`message ${item.role}`}>
      <div className="message-stack">
        <div
          ref={bubbleRef}
          className={`bubble message-bubble${isTableOnlyAssistantMessage ? " message-bubble-table-only" : ""}`}
        >
          {imageItems.length > 0 && (
            <MessageImageGrid
              images={imageItems}
              onOpen={setLightboxIndex}
              hasText={hasText}
            />
          )}
          {hasText && (
            <Markdown
              value={item.text}
              className="markdown"
              codeBlockStyle="message"
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              showFilePath={showMessageFilePath}
              workspacePath={workspacePath}
              onPreviewFileLink={onPreviewFileLink}
              onOpenFileLink={onOpenFileLink}
              onOpenFileLinkMenu={onOpenFileLinkMenu}
              onOpenThreadLink={onOpenThreadLink}
            />
          )}
          {lightboxIndex !== null && imageItems.length > 0 && (
            <ImageLightbox
              images={imageItems}
              activeIndex={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
            />
          )}
        </div>
        <div className="message-meta">
          <div className="message-actions">
            <button
              type="button"
              className={`ghost message-action-button message-copy-button${isCopied ? " is-copied" : ""}`}
              onClick={() => onCopy(item)}
              aria-label={t("messages.copyMessage")}
              title={t("messages.copyMessage")}
            >
              {isCopied ? (
                <Check size={14} strokeWidth={2} aria-hidden />
              ) : (
                <Copy size={14} strokeWidth={2} aria-hidden />
              )}
            </button>
            {onQuote && hasText && (
              <button
                type="button"
                className="ghost message-action-button message-quote-button"
                onMouseDown={() => {
                  selectionSnapshotRef.current = getSelectedMessageText();
                }}
                onTouchStart={() => {
                  selectionSnapshotRef.current = getSelectedMessageText();
                }}
                onClick={handleQuote}
                aria-label={t("messages.quote")}
                title={t("messages.quote")}
              >
                <Quote size={14} strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
          {messageTime && item.createdAt && (
            <time
              className="message-time"
              dateTime={new Date(item.createdAt).toISOString()}
            >
              {messageTime}
            </time>
          )}
        </div>
      </div>
    </div>
  );
});

export const ReasoningRow = memo(function ReasoningRow({
  item,
  parsed,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onPreviewFileLink,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: ReasoningRowProps) {
  const { t } = useI18n();
  const { bodyText, hasBody } = parsed;
  const summaryTitle =
    parsed.summaryTitle === "Reasoning"
      ? t("messages.reasoning")
      : parsed.summaryTitle;
  const reasoningTone: StatusTone = hasBody ? "completed" : "processing";
  return (
    <div className="tool-inline reasoning-inline">
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label={t("messages.toggleReasoning")}
      />
      <div className="tool-inline-content">
        <button
          type="button"
          className="tool-inline-summary tool-inline-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          <Brain
            className={`tool-inline-icon ${reasoningTone}`}
            size={14}
            aria-hidden
          />
          <span className="tool-inline-value">{summaryTitle}</span>
        </button>
        {hasBody && (
          <Markdown
            value={bodyText}
            className={`reasoning-inline-detail markdown ${
              isExpanded ? "" : "tool-inline-clamp"
            }`}
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onPreviewFileLink={onPreviewFileLink}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
      </div>
    </div>
  );
});

export const ReviewRow = memo(function ReviewRow({
  item,
  showMessageFilePath,
  workspacePath,
  onPreviewFileLink,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: ReviewRowProps) {
  const { t } = useI18n();
  const title =
    item.state === "started"
      ? t("messages.reviewStarted")
      : t("messages.reviewCompleted");
  return (
    <div className="item-card review">
      <div className="review-header">
        <span className="review-title">{title}</span>
        <span
          className={`review-badge ${item.state === "started" ? "active" : "done"}`}
        >
          {t("messages.review")}
        </span>
      </div>
      {item.text && (
        <Markdown
          value={item.text}
          className="item-text markdown"
          showFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onPreviewFileLink={onPreviewFileLink}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      )}
    </div>
  );
});

export const DiffRow = memo(function DiffRow({ item }: DiffRowProps) {
  return (
    <div className="item-card diff">
      <div className="diff-header">
        <span className="diff-title">{item.title}</span>
        {item.status && <span className="item-status">{item.status}</span>}
      </div>
      <div className="diff-viewer-output">
        <PierreDiffBlock diff={item.diff} displayPath={item.title} />
      </div>
    </div>
  );
});

export const UserInputRow = memo(function UserInputRow({
  item,
  isExpanded,
  onToggle,
}: UserInputRowProps) {
  const { t } = useI18n();
  const first = item.questions[0];
  const previewQuestion =
    first?.question?.trim() || first?.header?.trim() || t("messages.inputRequested");
  const firstAnswer = first?.answers[0]?.trim() || t("messages.noAnswer");
  const previewAnswer =
    first && first.answers.length > 1
      ? `${firstAnswer} +${first.answers.length - 1}`
      : firstAnswer;
  const extraQuestions = Math.max(0, item.questions.length - 1);

  return (
    <div className={`tool-inline user-input-inline ${isExpanded ? "tool-inline-expanded" : ""}`}>
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label={t("messages.toggleAnsweredInput")}
      />
      <div className="tool-inline-content">
        <button
          type="button"
          className="tool-inline-summary tool-inline-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          <Check className="tool-inline-icon completed" size={14} aria-hidden />
          <span className="tool-inline-label">{t("messages.answered")}:</span>
          <span className="tool-inline-value user-input-inline-preview">
            {previewQuestion}: {previewAnswer}
            {extraQuestions > 0
              ? t("messages.moreCount", { count: extraQuestions })
              : ""}
          </span>
        </button>
        {isExpanded && (
          <div className="user-input-inline-details">
            {item.questions.map((question, index) => {
              const title =
                question.question ||
                question.header ||
                t("messages.question", { index: index + 1 });
              return (
                <div
                  key={`${question.id}-${index}`}
                  className="user-input-inline-entry"
                >
                  <div className="user-input-inline-question">{title}</div>
                  {question.answers.length > 0 ? (
                    <div className="user-input-inline-answers">
                      {question.answers.map((answer, answerIndex) => (
                        <div
                          key={`${question.id}-answer-${answerIndex}`}
                          className="user-input-inline-answer"
                        >
                          {answer}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="user-input-inline-empty-answer">
                      {t("messages.noAnswer")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export const ToolRow = memo(function ToolRow({
  item,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onPreviewFileLink,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onRequestAutoScroll,
}: ToolRowProps) {
  const { t } = useI18n();
  const isFileChange = item.toolType === "fileChange";
  const isCommand = item.toolType === "commandExecution";
  const isPlan = item.toolType === "plan";
  const commandText = isCommand
    ? item.title.replace(/^Command:\s*/i, "").trim()
    : "";
  const summary = buildToolSummary(item, commandText, {
    command: t("messages.tool.command"),
    commandFallback: t("messages.tool.commandFallback"),
    contextCompaction: t("messages.tool.contextCompaction"),
    contextCompactionDetail: t("messages.tool.contextCompactionDetail"),
    hook: t("messages.tool.hook"),
    image: t("messages.tool.image"),
    plan: t("plan.title"),
    planGenerating: t("plan.generating"),
    read: t("messages.tool.read"),
    searched: t("messages.tool.searched"),
    searching: t("messages.tool.searching"),
    theWeb: t("messages.tool.theWeb"),
    tool: t("messages.tool.tool"),
  });
  const changeNames = (item.changes ?? [])
    .map((change) => basename(change.path))
    .filter(Boolean);
  const hasChanges = changeNames.length > 0;
  const tone = toolStatusTone(item, hasChanges);
  const ToolIcon = toolIconForSummary(item, summary);
  const summaryLabel = isFileChange
      ? changeNames.length > 1
      ? t("messages.filesEdited")
      : t("messages.fileEdited")
    : isCommand
      ? ""
      : summary.label;
  const statusCopy = {
    completed: t("messages.status.completed"),
    failed: t("messages.status.failed"),
    processing: t("messages.status.processing"),
  };
  const inlineStatus = formatToolStatusLabel(item, statusCopy);
  const detailTone = isPlan ? statusToneFromText(summary.detail) : "unknown";
  const summaryDetail =
    detailTone === "completed"
      ? statusCopy.completed
      : detailTone === "failed"
        ? statusCopy.failed
        : detailTone === "processing"
          ? statusCopy.processing
          : summary.detail;
  const summaryValue = isFileChange
    ? changeNames.length > 1
      ? `${changeNames[0]} +${changeNames.length - 1}`
      : changeNames[0] || t("messages.changes")
    : summary.value;
  const shouldFadeCommand =
    isCommand && !isExpanded && (summaryValue?.length ?? 0) > 80;
  const showToolOutput = isExpanded && (!isFileChange || !hasChanges);
  const normalizedStatus = (item.status ?? "").toLowerCase();
  const isCommandRunning = isCommand && /in[_\s-]*progress|running|started/.test(normalizedStatus);
  const commandDurationMs =
    typeof item.durationMs === "number" ? item.durationMs : null;
  const isLongRunning = commandDurationMs !== null && commandDurationMs >= 1200;
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const [isExportingPlan, setIsExportingPlan] = useState(false);

  useEffect(() => {
    if (!isCommandRunning) {
      setShowLiveOutput(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShowLiveOutput(true);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCommandRunning]);

  const showCommandOutput =
    isCommand &&
    summary.output &&
    (isExpanded || (isCommandRunning && showLiveOutput) || isLongRunning);

  useEffect(() => {
    if (showCommandOutput && isCommandRunning && showLiveOutput) {
      onRequestAutoScroll?.();
    }
  }, [isCommandRunning, onRequestAutoScroll, showCommandOutput, showLiveOutput]);

  const handlePlanExport = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const output = (summary.output ?? "").trim();
      if (!output) {
        return;
      }
      setIsExportingPlan(true);
      try {
        await exportMarkdownFile(
          output,
          buildPlanExportFileName(item.id),
          t("common.exportMarkdownTitle"),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("messages.planExportUnable");
        pushErrorToast({
          title: t("messages.planExportFailed"),
          message,
        });
      } finally {
        setIsExportingPlan(false);
      }
    },
    [item.id, summary.output, t],
  );

  return (
    <div className={`tool-inline tool-inline-row ${isExpanded ? "tool-inline-expanded" : ""}`}>
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label={t("messages.toggleToolDetails")}
      />
      <div className="tool-inline-content">
        <button
          type="button"
          className="tool-inline-summary tool-inline-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          <ToolIcon className={`tool-inline-icon ${tone}`} size={14} aria-hidden />
          {summaryLabel && (
            <span className="tool-inline-label">{summaryLabel}:</span>
          )}
          {summaryValue && (
            <span
              className={`tool-inline-value ${isCommand ? "tool-inline-command" : ""} ${
                isCommand && isExpanded ? "tool-inline-command-full" : ""
              }`}
            >
              {isCommand ? (
                <span
                  className={`tool-inline-command-text ${
                    shouldFadeCommand ? "tool-inline-command-fade" : ""
                  }`}
                >
                  {summaryValue}
                </span>
              ) : (
                summaryValue
              )}
            </span>
          )}
          {inlineStatus && (
            <span className="tool-inline-status">{inlineStatus}</span>
          )}
        </button>
        {isExpanded && summaryDetail && !isFileChange && (
          <div className="tool-inline-detail">{summaryDetail}</div>
        )}
        {isExpanded && isCommand && item.detail && (
          <div className="tool-inline-detail tool-inline-muted">
            cwd: {item.detail}
          </div>
        )}
        {isExpanded && isFileChange && hasChanges && (
          <div className="tool-inline-change-list">
            {item.changes?.map((change, index) => (
              <div
                key={`${change.path}-${index}`}
                className="tool-inline-change"
              >
                <div className="tool-inline-change-header">
                  {change.kind && (
                    <span className="tool-inline-change-kind">
                      {change.kind.toUpperCase()}
                    </span>
                  )}
                  <span className="tool-inline-change-path">
                    {basename(change.path)}
                  </span>
                </div>
                {change.diff && (
                  <div className="diff-viewer-output">
                    <PierreDiffBlock diff={change.diff} displayPath={change.path} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {isExpanded && isFileChange && !hasChanges && item.detail && (
          <Markdown
            value={item.detail}
            className="item-text markdown"
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onPreviewFileLink={onPreviewFileLink}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
        {showCommandOutput && <CommandOutput output={summary.output ?? ""} />}
        {showToolOutput && summary.output && !isCommand && (
          <Markdown
            value={summary.output}
            className="tool-inline-output markdown"
            codeBlock={item.toolType !== "plan"}
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onPreviewFileLink={onPreviewFileLink}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
        {showToolOutput && isPlan && (summary.output ?? "").trim() && (
          <div className="tool-inline-actions">
            <button
              type="button"
              className="ghost tool-inline-action"
              onClick={handlePlanExport}
              disabled={isExportingPlan}
            >
              {isExportingPlan ? t("messages.exporting") : t("messages.exportMarkdown")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export const ImageGenerationRow = memo(function ImageGenerationRow({
  item,
}: ImageGenerationRowProps) {
  const { language, t } = useI18n();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [naturalMetrics, setNaturalMetrics] = useState<ImagePreviewMetrics | null>(
    null,
  );
  const imageGenerationTime = useMemo(() => {
    if (!item.createdAt) {
      return "";
    }
    return formatMessageCreatedAt(item.createdAt, language);
  }, [item.createdAt, language]);
  const imageSrc = item.imageSrc ? normalizeMessageImageSrc(item.imageSrc) : "";
  const requestedMetrics = useMemo(
    () => parseImagePreviewMetrics(item.size),
    [item.size],
  );
  const previewMetrics = requestedMetrics ?? naturalMetrics;
  const previewVariant = previewMetrics
    ? imagePreviewVariant(previewMetrics)
    : "thumbnail";
  const previewStyle: CSSProperties | undefined = previewMetrics
    ? {
        aspectRatio: `${previewMetrics.width} / ${previewMetrics.height}`,
      }
    : undefined;
  const skeletonMetrics = requestedMetrics ?? { width: 1, height: 1 };
  const skeletonVariant = requestedMetrics
    ? imagePreviewVariant(requestedMetrics)
    : "square";
  const skeletonStyle: CSSProperties = {
    aspectRatio: `${skeletonMetrics.width} / ${skeletonMetrics.height}`,
  };
  const tone =
    item.status === "failed"
      ? "failed"
      : item.status === "completed"
        ? "completed"
        : "processing";
  const title =
    item.status === "failed"
      ? t("messages.imageGenerationFailed")
      : item.status === "completed"
        ? t("messages.imageGenerated")
        : t("messages.imageGenerating");
  const image: MessageImage | null = imageSrc
    ? { src: imageSrc, label: t("messages.generatedImageAlt") }
    : null;
  const displayModel = item.model ? normalizePublicImageModel(item.model) : "";

  const copyPrompt = useCallback(() => {
    if (!item.prompt) {
      return;
    }
    void navigator.clipboard?.writeText(item.prompt).catch(() => undefined);
  }, [item.prompt]);

  const handlePreviewImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (requestedMetrics) {
        return;
      }
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (naturalWidth > 0 && naturalHeight > 0) {
        setNaturalMetrics({ width: naturalWidth, height: naturalHeight });
      }
    },
    [requestedMetrics],
  );

  useEffect(() => {
    setNaturalMetrics(null);
  }, [imageSrc, item.size]);

  return (
    <div className={`image-generation-card image-generation-card--${tone}`}>
      <div className="image-generation-header">
        <div className="image-generation-title">
          {item.status === "in_progress" ? (
            <span className="working-spinner" aria-hidden />
          ) : (
            <Image size={16} aria-hidden />
          )}
          <span>{title}</span>
        </div>
        <div className="image-generation-meta">
          {displayModel && <span>{displayModel}</span>}
          {item.size && <span>{item.size}</span>}
          {imageGenerationTime && item.createdAt && (
            <time
              className="message-time image-generation-time"
              dateTime={new Date(item.createdAt).toISOString()}
            >
              {imageGenerationTime}
            </time>
          )}
        </div>
      </div>
      {image && item.status === "completed" && (
        <button
          type="button"
          className={`image-generation-preview image-generation-preview--${previewVariant}`}
          style={previewStyle}
          onClick={() => setLightboxOpen(true)}
          aria-label={t("messages.openGeneratedImage")}
        >
          <img
            src={image.src}
            alt={image.label}
            loading="lazy"
            onLoad={handlePreviewImageLoad}
          />
        </button>
      )}
      {item.status === "in_progress" && !image && (
        <div
          className={`image-generation-preview image-generation-preview--skeleton image-generation-preview--${skeletonVariant}`}
          style={skeletonStyle}
          role="img"
          aria-label={t("messages.imageGenerationPreviewLoading")}
        >
          <span className="image-generation-skeleton-glow" aria-hidden />
          <span className="image-generation-skeleton-grid" aria-hidden />
        </div>
      )}
      {item.error && <div className="image-generation-error">{item.error}</div>}
      {item.prompt && (
        <div className="image-generation-prompt-controls">
          <button
            type="button"
            className="ghost image-generation-prompt-toggle"
            onClick={() => setPromptVisible((value) => !value)}
            aria-expanded={promptVisible}
          >
            {promptVisible
              ? t("messages.hideImagePrompt")
              : t("messages.showImagePrompt")}
          </button>
          {promptVisible && (
            <div className="image-generation-prompt">
              <span>{item.prompt}</span>
              <button
                type="button"
                className="ghost message-action-button"
                onClick={copyPrompt}
                aria-label={t("messages.copyPrompt")}
                title={t("messages.copyPrompt")}
              >
                <Copy size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
      {lightboxOpen && image && (
        <ImageLightbox
          images={[image]}
          activeIndex={0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
});

export const ExploreRow = memo(function ExploreRow({ item }: ExploreRowProps) {
  const { t } = useI18n();
  const title =
    item.status === "exploring"
      ? t("messages.exploring")
      : t("messages.explored");
  return (
    <div className="tool-inline explore-inline">
      <div className="tool-inline-bar-toggle" aria-hidden />
      <div className="tool-inline-content">
        <div className="explore-inline-header">
          <Terminal
            className={`tool-inline-icon ${
              item.status === "exploring" ? "processing" : "completed"
            }`}
            size={14}
            aria-hidden
          />
          <span className="explore-inline-title">{title}</span>
        </div>
        <div className="explore-inline-list">
          {item.entries.map((entry, index) => (
            <div key={`${entry.kind}-${entry.label}-${index}`} className="explore-inline-item">
              <span className="explore-inline-kind">
                {t(`messages.exploreKind.${entry.kind}`, {
                  fallback: exploreKindLabel(entry.kind),
                })}
              </span>
              <span className="explore-inline-label">{entry.label}</span>
              {entry.detail && entry.detail !== entry.label && (
                <span className="explore-inline-detail">{entry.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
