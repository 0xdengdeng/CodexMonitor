import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import X from "lucide-react/dist/esm/icons/x";
import {
  highlightLine,
  languageFromPath,
  monacoLanguageFromPath,
  renderPreviewKindFromPath,
  type RenderPreviewKind,
} from "../../../utils/syntax";
import { OpenAppMenu } from "../../app/components/OpenAppMenu";
import { ModalShell } from "../../design-system/components/modal/ModalShell";
import { PopoverSurface } from "../../design-system/components/popover/PopoverPrimitives";
import { Markdown } from "../../messages/components/Markdown";
import type { OpenAppTarget } from "../../../types";
import { useI18n } from "@/features/i18n/i18n";
import { MonacoFileEditor } from "./MonacoFileEditor";

type FilePreviewPopoverProps = {
  path: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
  previewKind?: "text" | "image";
  imageSrc?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  selection: { start: number; end: number } | null;
  onSelectLine: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseDown?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseEnter?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineMouseUp?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  onClearSelection: () => void;
  onAddSelection: (contentOverride?: string) => void;
  onSaveContent?: (content: string) => Promise<void>;
  onTextSelectionChange?: (selection: { start: number; end: number } | null) => void;
  canInsertText?: boolean;
  onClose: () => void;
  selectionHints?: string[];
  style?: CSSProperties;
  isLoading?: boolean;
  error?: string | null;
  variant?: "popover" | "modal";
};

type FilePreviewMode = "edit" | "rendered";

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function directoryPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) {
    return "";
  }
  return normalized.slice(0, lastSlash + 1);
}

function htmlPreviewSrcDoc(content: string, absolutePath: string) {
  const directory = directoryPath(absolutePath);
  if (!directory) {
    return content;
  }
  const baseHref = convertFileSrc(directory);
  const normalizedBaseHref = baseHref.endsWith("/") ? baseHref : `${baseHref}/`;
  return `<base href="${escapeHtmlAttribute(normalizedBaseHref)}">\n${content}`;
}

function RenderedFilePreview({
  absolutePath,
  content,
  kind,
  title,
}: {
  absolutePath: string;
  content: string;
  kind: RenderPreviewKind;
  title: string;
}) {
  if (kind === "html") {
    return (
      <iframe
        className="file-preview-rendered-html"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={htmlPreviewSrcDoc(content, absolutePath)}
        title={title}
      />
    );
  }

  return (
    <div className="file-preview-rendered-markdown">
      <Markdown
        value={content}
        className="markdown"
        workspacePath={directoryPath(absolutePath)}
      />
    </div>
  );
}

export function FilePreviewPopover({
  path,
  absolutePath,
  content,
  truncated,
  previewKind = "text",
  imageSrc = null,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  selection,
  onSelectLine,
  onLineMouseDown,
  onLineMouseEnter,
  onLineMouseUp,
  onClearSelection,
  onAddSelection,
  onSaveContent,
  onTextSelectionChange,
  canInsertText = true,
  onClose,
  selectionHints = [],
  style,
  isLoading = false,
  error = null,
  variant = "popover",
}: FilePreviewPopoverProps) {
  const { t } = useI18n();
  const isImagePreview = previewKind === "image";
  const isModal = variant === "modal";
  const canEditContent = isModal && !isImagePreview && !truncated && Boolean(onSaveContent);
  const [draftContent, setDraftContent] = useState(content);
  const [savedContent, setSavedContent] = useState(content);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [previewMode, setPreviewMode] = useState<FilePreviewMode>("edit");
  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  const lines = useMemo(
    () => (isImagePreview ? [] : content.split("\n")),
    [content, isImagePreview],
  );
  const hasUnsavedChanges = canEditContent && draftContent !== savedContent;
  const language = useMemo(() => languageFromPath(path), [path]);
  const monacoLanguage = useMemo(() => monacoLanguageFromPath(path), [path]);
  const renderedPreviewKind = useMemo(() => renderPreviewKindFromPath(path), [path]);
  const canRenderPreview = canEditContent && renderedPreviewKind !== null;
  const isRenderedPreview = canRenderPreview && previewMode === "rendered";
  const selectionLabel = selection
    ? t("files.preview.lines", {
        start: selection.start + 1,
        end: selection.end + 1,
      })
    : isImagePreview
      ? t("files.preview.image")
      : t("files.preview.noSelection");
  const highlightedLines = useMemo(
    () =>
      isImagePreview
        ? []
        : lines.map((line) => {
            const html = highlightLine(line, language);
            return html || "&nbsp;";
          }),
    [lines, language, isImagePreview],
  );
  useEffect(() => {
    onTextSelectionChangeRef.current = onTextSelectionChange;
  }, [onTextSelectionChange]);

  useEffect(() => {
    setDraftContent(content);
    setSavedContent(content);
    setSaveError(null);
    setShowUnsavedPrompt(false);
    setPreviewMode("edit");
    onTextSelectionChangeRef.current?.(null);
  }, [content, path]);

  const handlePreviewModeChange = useCallback(
    (nextMode: FilePreviewMode) => {
      setPreviewMode(nextMode);
      if (nextMode === "rendered") {
        onTextSelectionChangeRef.current?.(null);
      }
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!onSaveContent || isSaving) {
      return false;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveContent(draftContent);
      setSavedContent(draftContent);
      return true;
    } catch (saveFailure) {
      const message = saveFailure instanceof Error ? saveFailure.message : String(saveFailure);
      setSaveError(t("files.preview.saveFailed", { message }));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [draftContent, isSaving, onSaveContent, t]);

  const requestClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowUnsavedPrompt(true);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  const handleSaveAndClose = useCallback(async () => {
    const saved = await handleSave();
    if (saved) {
      onClose();
    }
  }, [handleSave, onClose]);

  useEffect(() => {
    if (!isModal) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, isModal, requestClose]);

  const contentNode = (
    <PopoverSurface
      className={`file-preview-popover${isModal ? " file-preview-popover--modal" : ""}`}
      style={isModal ? undefined : style}
    >
      <div className="file-preview-header">
        <div className="file-preview-title">
          <span className="file-preview-path">{path}</span>
          {hasUnsavedChanges && (
            <span className="file-preview-warning">{t("files.preview.unsaved")}</span>
          )}
          {truncated && (
            <span className="file-preview-warning">{t("files.preview.truncated")}</span>
          )}
        </div>
        <button
          type="button"
          className="icon-button file-preview-close"
          onClick={requestClose}
          aria-label={t("files.preview.close")}
          title={t("files.preview.close")}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      {isLoading ? (
        <div className="file-preview-status">{t("files.preview.loading")}</div>
      ) : error ? (
        <div className="file-preview-status file-preview-error">{error}</div>
      ) : isImagePreview ? (
        <div className="file-preview-body file-preview-body--image">
          <div className="file-preview-toolbar">
            <span className="file-preview-selection">{selectionLabel}</span>
            <div className="file-preview-actions">
              <OpenAppMenu
                path={absolutePath}
                openTargets={openTargets}
                selectedOpenAppId={selectedOpenAppId}
                onSelectOpenAppId={onSelectOpenAppId}
                iconById={openAppIconById}
              />
            </div>
          </div>
          {imageSrc ? (
            <div className="file-preview-image">
              <img src={imageSrc} alt={path} />
            </div>
          ) : (
            <div className="file-preview-status file-preview-error">
              {t("files.preview.imageUnavailable")}
            </div>
          )}
        </div>
      ) : (
        <div className="file-preview-body">
          <div className="file-preview-toolbar">
            <div className="file-preview-selection-group">
              <span className="file-preview-selection">{selectionLabel}</span>
              {selectionHints.length > 0 ? (
                <div className="file-preview-hints" aria-label={t("files.preview.selectionHints")}>
                  {selectionHints.map((hint) => (
                    <span key={hint} className="file-preview-hint">
                      {hint}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="file-preview-actions">
              {canRenderPreview ? (
                <div className="file-preview-mode-toggle" role="group">
                  <button
                    type="button"
                    className={`file-preview-mode-button${
                      !isRenderedPreview ? " is-active" : ""
                    }`}
                    aria-pressed={!isRenderedPreview}
                    onClick={() => handlePreviewModeChange("edit")}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className={`file-preview-mode-button${
                      isRenderedPreview ? " is-active" : ""
                    }`}
                    aria-pressed={isRenderedPreview}
                    onClick={() => handlePreviewModeChange("rendered")}
                  >
                    {t("files.preview.renderPreview")}
                  </button>
                </div>
              ) : null}
              <OpenAppMenu
                path={absolutePath}
                openTargets={openTargets}
                selectedOpenAppId={selectedOpenAppId}
                onSelectOpenAppId={onSelectOpenAppId}
                iconById={openAppIconById}
              />
              <button
                type="button"
                className="ghost file-preview-action"
                onClick={onClearSelection}
                disabled={!selection}
              >
                {t("common.clear")}
              </button>
              <button
                type="button"
                className="primary file-preview-action file-preview-action--add"
                onClick={() => onAddSelection(canEditContent ? draftContent : undefined)}
                disabled={!selection || !canInsertText}
              >
                {t("files.preview.addToChat")}
              </button>
              {canEditContent ? (
                <button
                  type="button"
                  className="primary file-preview-action file-preview-action--save"
                  onClick={() => {
                    void handleSave();
                  }}
                  disabled={!hasUnsavedChanges || isSaving}
                >
                  {isSaving ? t("files.preview.saving") : t("common.save")}
                </button>
              ) : null}
            </div>
          </div>
          {saveError ? (
            <div className="file-preview-status file-preview-error">{saveError}</div>
          ) : null}
          {isRenderedPreview && renderedPreviewKind ? (
            <RenderedFilePreview
              absolutePath={absolutePath}
              content={draftContent}
              kind={renderedPreviewKind}
              title={t("files.preview.renderedLabel")}
            />
          ) : canEditContent ? (
            <MonacoFileEditor
              ariaLabel={t("files.preview.editorLabel")}
              disabled={isSaving}
              language={monacoLanguage}
              onChange={setDraftContent}
              onSave={() => {
                void handleSave();
              }}
              onSelectionChange={onTextSelectionChange}
              path={path}
              value={draftContent}
            />
          ) : (
            <div className="file-preview-lines" role="list">
              {lines.map((_, index) => {
                const html = highlightedLines[index] ?? "&nbsp;";
                const isSelected =
                  selection &&
                  index >= selection.start &&
                  index <= selection.end;
                const isStart = isSelected && selection?.start === index;
                const isEnd = isSelected && selection?.end === index;
                return (
                  <button
                    key={`line-${index}`}
                    type="button"
                    className={`file-preview-line${
                      isSelected ? " is-selected" : ""
                    }${isStart ? " is-start" : ""}${isEnd ? " is-end" : ""}`}
                    onClick={(event) => onSelectLine(index, event)}
                    onMouseDown={(event) => onLineMouseDown?.(index, event)}
                    onMouseEnter={(event) => onLineMouseEnter?.(index, event)}
                    onMouseUp={(event) => onLineMouseUp?.(index, event)}
                  >
                    <span className="file-preview-line-number">{index + 1}</span>
                    <span
                      className="file-preview-line-text"
                      dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {showUnsavedPrompt ? (
        <div className="file-preview-unsaved-confirm" role="alert">
          <div className="file-preview-unsaved-title">
            {t("files.preview.saveBeforeClose")}
          </div>
          <div className="file-preview-unsaved-actions">
            <button
              type="button"
              className="ghost file-preview-action"
              onClick={() => setShowUnsavedPrompt(false)}
              disabled={isSaving}
            >
              {t("files.preview.keepEditing")}
            </button>
            <button
              type="button"
              className="ghost file-preview-action"
              onClick={onClose}
              disabled={isSaving}
            >
              {t("files.preview.discardChanges")}
            </button>
            <button
              type="button"
              className="primary file-preview-action file-preview-action--save"
              onClick={() => {
                void handleSaveAndClose();
              }}
              disabled={isSaving}
            >
              {isSaving ? t("files.preview.saving") : t("common.save")}
            </button>
          </div>
        </div>
      ) : null}
    </PopoverSurface>
  );

  if (isModal) {
    return (
      <ModalShell
        className="file-preview-modal"
        cardClassName="file-preview-modal-card"
        ariaLabel={t("files.preview.dialogLabel", { path })}
        onBackdropClick={requestClose}
      >
        {contentNode}
      </ModalShell>
    );
  }

  return contentNode;
}
