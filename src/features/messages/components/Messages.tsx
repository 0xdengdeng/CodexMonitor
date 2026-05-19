import { memo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import type { ParsedFileLocation } from "../../../utils/fileLinks";
import { PlanReadyFollowupMessage } from "../../app/components/PlanReadyFollowupMessage";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { FilePreviewPopover } from "../../files/components/FilePreviewPopover";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import { formatCount, parseReasoning } from "../utils/messageRenderUtils";
import { resolveMountedWorkspacePath } from "../utils/mountedWorkspacePaths";
import { isAbsolutePath, joinWorkspacePath } from "../../../utils/platformPaths";
import {
  DiffRow,
  ExploreRow,
  ImageGenerationRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  ToolRow,
  UserInputRow,
  WorkingIndicator,
} from "./MessageRows";
import { useMessagesViewState } from "./useMessagesViewState";
import { useI18n } from "@/features/i18n/i18n";

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  isLoadingMessages?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
  workspacePath?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById?: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId?: (id: string) => void;
  codeBlockCopyUseModifier?: boolean;
  showMessageFilePath?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => void;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onOpenThreadLink?: (threadId: string, workspaceId?: string | null) => void;
  onQuoteMessage?: (text: string) => void;
};

type MessageFilePreview = {
  rawPath: string;
  resolvedPath: string;
  imageSrc: string;
  style: React.CSSProperties;
};

const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function isPreviewableImagePath(path: string) {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path;
  const ext = cleanPath.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEWABLE_IMAGE_EXTENSIONS.has(ext);
}

function resolveMessageFilePath(path: string, workspacePath?: string | null) {
  const trimmed = path.trim();
  if (!workspacePath) {
    return trimmed;
  }
  const mountedWorkspacePath = resolveMountedWorkspacePath(trimmed, workspacePath);
  if (mountedWorkspacePath) {
    return mountedWorkspacePath;
  }
  if (isAbsolutePath(trimmed)) {
    return trimmed;
  }
  return joinWorkspacePath(workspacePath, trimmed);
}

function buildMessageFilePreviewStyle(target: HTMLElement): React.CSSProperties {
  const rect = target.getBoundingClientRect();
  const padding = 16;
  const width = Math.min(640, Math.max(320, window.innerWidth - padding * 2));
  const maxHeight = Math.min(520, Math.max(260, window.innerHeight - padding * 2));
  const left = Math.min(
    Math.max(padding, rect.left),
    Math.max(padding, window.innerWidth - width - padding),
  );
  const belowTop = rect.bottom + 12;
  const top =
    belowTop + maxHeight <= window.innerHeight - padding
      ? belowTop
      : Math.max(padding, rect.top - maxHeight - 12);

  return {
    position: "fixed",
    top,
    left,
    width,
    maxHeight,
    ["--file-preview-arrow-top" as string]: "24px",
  };
}

export const Messages = memo(function Messages({
  items,
  threadId,
  workspaceId = null,
  isThinking,
  isLoadingMessages = false,
  processingStartedAt = null,
  lastDurationMs = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
  workspacePath = null,
  openTargets,
  openAppIconById = {},
  selectedOpenAppId,
  onSelectOpenAppId,
  codeBlockCopyUseModifier = false,
  showMessageFilePath = true,
  userInputRequests = [],
  onUserInputSubmit,
  onPlanAccept,
  onPlanSubmitChanges,
  onOpenThreadLink,
  onQuoteMessage,
}: MessagesProps) {
  const { t } = useI18n();
  const [messageFilePreview, setMessageFilePreview] =
    useState<MessageFilePreview | null>(null);
  const activeUserInputRequestId =
    threadId && userInputRequests.length
      ? (userInputRequests.find(
          (request) =>
            request.params.thread_id === threadId &&
            (!workspaceId || request.workspace_id === workspaceId),
        )?.request_id ?? null)
      : null;
  const { openFileLink, showFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
  );
  const handleSelectOpenAppId = useCallback(
    (id: string) => {
      onSelectOpenAppId?.(id);
    },
    [onSelectOpenAppId],
  );
  const handlePreviewFileLink = useCallback(
    (event: React.MouseEvent, fileLocation: ParsedFileLocation) => {
      if (!isPreviewableImagePath(fileLocation.path)) {
        return false;
      }
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const resolvedPath = resolveMessageFilePath(fileLocation.path, workspacePath);
      let imageSrc: string;
      try {
        imageSrc = convertFileSrc(resolvedPath);
      } catch {
        imageSrc = resolvedPath;
      }
      setMessageFilePreview({
        rawPath: fileLocation.path,
        resolvedPath,
        imageSrc,
        style: buildMessageFilePreviewStyle(target),
      });
      return true;
    },
    [workspacePath],
  );
  const handleOpenThreadLink = useCallback(
    (threadId: string) => {
      onOpenThreadLink?.(threadId, workspaceId ?? null);
    },
    [onOpenThreadLink, workspaceId],
  );

  const hasActiveUserInputRequest = activeUserInputRequestId !== null;
  const hasVisibleUserInputRequest = hasActiveUserInputRequest && Boolean(onUserInputSubmit);
  const userInputNode =
    hasActiveUserInputRequest && onUserInputSubmit ? (
      <RequestUserInputMessage
        requests={userInputRequests}
        activeThreadId={threadId}
        activeWorkspaceId={workspaceId}
        onSubmit={onUserInputSubmit}
      />
    ) : null;
  const {
    bottomRef,
    containerRef,
    updateAutoScroll,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    copiedMessageId,
    handleCopyMessage,
    handleQuoteMessage,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    planFollowup,
    dismissPlanFollowup,
  } = useMessagesViewState({
    items,
    threadId,
    isThinking,
    activeUserInputRequestId,
    hasVisibleUserInputRequest,
    onPlanAccept,
    onPlanSubmitChanges,
    onQuoteMessage,
  });

  const planFollowupNode =
    planFollowup.shouldShow && onPlanAccept && onPlanSubmitChanges ? (
      <PlanReadyFollowupMessage
        onAccept={() => {
          dismissPlanFollowup();
          onPlanAccept();
        }}
        onSubmitChanges={(changes) => {
          dismissPlanFollowup();
          onPlanSubmitChanges(changes);
        }}
      />
    ) : null;

  const renderItem = (item: ConversationItem) => {
    if (item.kind === "message") {
      const isCopied = copiedMessageId === item.id;
      return (
        <MessageRow
          key={item.id}
          item={item}
          isCopied={isCopied}
          onCopy={handleCopyMessage}
          onQuote={onQuoteMessage ? handleQuoteMessage : undefined}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onPreviewFileLink={handlePreviewFileLink}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "reasoning") {
      const isExpanded = expandedItems.has(item.id);
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      return (
        <ReasoningRow
          key={item.id}
          item={item}
          parsed={parsed}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onPreviewFileLink={handlePreviewFileLink}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "review") {
      return (
        <ReviewRow
          key={item.id}
          item={item}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onPreviewFileLink={handlePreviewFileLink}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
        />
      );
    }
    if (item.kind === "userInput") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <UserInputRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={item.id} item={item} />;
    }
    if (item.kind === "tool") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <ToolRow
          key={item.id}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          showMessageFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onPreviewFileLink={handlePreviewFileLink}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          onOpenThreadLink={handleOpenThreadLink}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (item.kind === "imageGeneration") {
      return <ImageGenerationRow key={item.id} item={item} />;
    }
    if (item.kind === "explore") {
      return <ExploreRow key={item.id} item={item} />;
    }
    return null;
  };

  return (
    <>
      <div
        className="messages messages-full"
        ref={containerRef}
        onScroll={updateAutoScroll}
      >
        <div className="messages-inner">
          {groupedItems.map((entry) => {
            if (entry.kind === "toolGroup") {
              const { group } = entry;
              const isCollapsed = collapsedToolGroups.has(group.id);
              const summaryParts = [
                formatCount(
                  group.toolCount,
                  t("messages.toolCall"),
                  t("messages.toolCalls"),
                ),
              ];
              if (group.messageCount > 0) {
                summaryParts.push(
                  formatCount(
                    group.messageCount,
                    t("messages.message"),
                    t("messages.messages"),
                  ),
                );
              }
              const summaryText = summaryParts.join(", ");
              const groupBodyId = `tool-group-${group.id}`;
              const ChevronIcon = isCollapsed ? ChevronDown : ChevronUp;
              return (
                <div
                  key={`tool-group-${group.id}`}
                  className={`tool-group ${isCollapsed ? "tool-group-collapsed" : ""}`}
                >
                  <div className="tool-group-header">
                    <button
                      type="button"
                      className="tool-group-toggle"
                      onClick={() => toggleToolGroup(group.id)}
                      aria-expanded={!isCollapsed}
                      aria-controls={groupBodyId}
                      aria-label={
                        isCollapsed
                          ? t("messages.expandToolCalls")
                          : t("messages.collapseToolCalls")
                      }
                    >
                      <span className="tool-group-chevron" aria-hidden>
                        <ChevronIcon size={14} />
                      </span>
                      <span className="tool-group-summary">{summaryText}</span>
                    </button>
                  </div>
                  {!isCollapsed && (
                    <div className="tool-group-body" id={groupBodyId}>
                      {group.items.map(renderItem)}
                    </div>
                  )}
                </div>
              );
            }
            return renderItem(entry.item);
          })}
          {planFollowupNode}
          {userInputNode}
          <WorkingIndicator
            isThinking={isThinking}
            processingStartedAt={processingStartedAt}
            lastDurationMs={lastDurationMs}
            hasItems={items.length > 0}
            reasoningLabel={latestReasoningLabel}
            showPollingFetchStatus={showPollingFetchStatus}
            pollingIntervalMs={pollingIntervalMs}
          />
          {!items.length && !userInputNode && !isThinking && !isLoadingMessages && (
            <div className="empty messages-empty">
              {threadId
                ? t("messages.emptyThread")
                : t("messages.emptyNewAgent")}
            </div>
          )}
          {!items.length && !userInputNode && !isThinking && isLoadingMessages && (
            <div className="empty messages-empty">
              <div className="messages-loading-indicator" role="status" aria-live="polite">
                <span className="working-spinner" aria-hidden />
                <span className="messages-loading-label">{t("common.loadingEllipsis")}</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {messageFilePreview
        ? createPortal(
            <FilePreviewPopover
              path={messageFilePreview.rawPath}
              absolutePath={messageFilePreview.resolvedPath}
              content=""
              truncated={false}
              previewKind="image"
              imageSrc={messageFilePreview.imageSrc}
              openTargets={openTargets}
              openAppIconById={openAppIconById}
              selectedOpenAppId={selectedOpenAppId}
              onSelectOpenAppId={handleSelectOpenAppId}
              selection={null}
              onSelectLine={() => undefined}
              onClearSelection={() => undefined}
              onAddSelection={() => undefined}
              canInsertText={false}
              onClose={() => setMessageFilePreview(null)}
              style={messageFilePreview.style}
            />,
            document.body,
          )
        : null}
    </>
  );
});
