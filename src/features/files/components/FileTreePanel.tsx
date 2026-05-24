import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Plus from "lucide-react/dist/esm/icons/plus";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import File from "lucide-react/dist/esm/icons/file";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import { PanelShell } from "../../layout/components/PanelShell";
import {
  PanelMeta,
  PanelSearchField,
} from "../../design-system/components/panel/PanelPrimitives";
import { readWorkspaceFile, writeWorkspaceFile } from "../../../services/tauri";
import type { OpenAppTarget } from "../../../types";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { languageFromPath } from "../../../utils/syntax";
import { fileManagerName, joinWorkspacePath } from "../../../utils/platformPaths";
import { getFileTypeIconUrl } from "../../../utils/fileTypeIcons";
import { FilePreviewPopover } from "./FilePreviewPopover";
import { useI18n } from "@/features/i18n/i18n";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
};

type FileTreePanelProps = {
  workspaceId: string;
  workspacePath: string;
  files: string[];
  modifiedFiles: string[];
  isLoading: boolean;
  openFileRequest?: {
    id: number;
    path: string;
  } | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onInsertText?: (text: string) => void;
  canInsertText: boolean;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  onRefreshFiles: () => Promise<void>;
};

type FileTreeBuildNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Map<string, FileTreeBuildNode>;
};

type FileEntry = {
  path: string;
  lower: string;
  segments: string[];
};

type FileTreeRowEntry = {
  node: FileTreeNode;
  depth: number;
  isFolder: boolean;
  isExpanded: boolean;
};

const FILE_TREE_ROW_HEIGHT = 28;

function buildTree(entries: FileEntry[]): { nodes: FileTreeNode[]; folderPaths: Set<string> } {
  const root = new Map<string, FileTreeBuildNode>();
  const addNode = (
    map: Map<string, FileTreeBuildNode>,
    name: string,
    path: string,
    type: "file" | "folder",
  ) => {
    const existing = map.get(name);
    if (existing) {
      if (type === "folder") {
        existing.type = "folder";
      }
      return existing;
    }
    const node: FileTreeBuildNode = {
      name,
      path,
      type,
      children: new Map(),
    };
    map.set(name, node);
    return node;
  };

  entries.forEach(({ segments }) => {
    if (!segments.length) {
      return;
    }
    let currentMap = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const node = addNode(currentMap, segment, nextPath, isFile ? "file" : "folder");
      if (!isFile) {
        currentMap = node.children;
        currentPath = nextPath;
      }
    });
  });

  const folderPaths = new Set<string>();

  const toArray = (map: Map<string, FileTreeBuildNode>): FileTreeNode[] => {
    const nodes = Array.from(map.values()).map((node) => {
      if (node.type === "folder") {
        folderPaths.add(node.path);
      }
      return {
        name: node.name,
        path: node.path,
        type: node.type,
        children: node.type === "folder" ? toArray(node.children) : [],
      };
    });
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return nodes;
  };

  return { nodes: toArray(root), folderPaths };
}

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

function isImagePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return imageExtensions.has(ext);
}

function normalizeFileTreeRequestPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function ancestorFolderPaths(path: string) {
  const segments = normalizeFileTreeRequestPath(path).split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function FileTreePanel({
  workspaceId,
  workspacePath,
  files,
  modifiedFiles,
  isLoading,
  openFileRequest = null,
  filePanelMode,
  onFilePanelModeChange,
  onInsertText,
  canInsertText,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  onRefreshFiles,
}: FileTreePanelProps) {
  const { t } = useI18n();
  const [filterMode, setFilterMode] = useState<"all" | "modified">("all");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [previewRevision, setPreviewRevision] = useState<string>("");
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const dragAnchorLineRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const hasManualToggle = useRef(false);
  const showLoading = isLoading && files.length === 0;
  const listRef = useRef<HTMLDivElement | null>(null);
  const debouncedQuery = useDebouncedValue(query, 150);
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const modifiedPathSet = useMemo(() => new Set(modifiedFiles), [modifiedFiles]);
  const fileEntries = useMemo(
    () =>
      files.map((path) => ({
        path,
        lower: path.toLowerCase(),
        segments: path.split("/").filter(Boolean),
      })),
    [files],
  );
  const sourceEntries = useMemo(
    () =>
      filterMode === "modified"
        ? fileEntries.filter((entry) => modifiedPathSet.has(entry.path))
        : fileEntries,
    [fileEntries, filterMode, modifiedPathSet],
  );
  const previewKind = useMemo(
    () => (previewPath && isImagePath(previewPath) ? "image" : "text"),
    [previewPath],
  );

  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return sourceEntries;
    }
    return sourceEntries.filter((entry) => entry.lower.includes(normalizedQuery));
  }, [sourceEntries, normalizedQuery]);

  const { nodes, folderPaths } = useMemo(
    () => buildTree(visibleEntries),
    [visibleEntries],
  );

  const visibleFolderPaths = folderPaths;
  const hasFolders = visibleFolderPaths.size > 0;
  const allVisibleExpanded =
    hasFolders && Array.from(visibleFolderPaths).every((path) => expandedFolders.has(path));

  useEffect(() => {
    setExpandedFolders((prev) => {
      if (normalizedQuery || filterMode === "modified") {
        return new Set(folderPaths);
      }
      const next = new Set<string>();
      prev.forEach((path) => {
        if (folderPaths.has(path)) {
          next.add(path);
        }
      });
      if (next.size === 0 && !hasManualToggle.current) {
        nodes.forEach((node) => {
          if (node.type === "folder") {
            next.add(node.path);
          }
        });
      }
      return next;
    });
  }, [filterMode, folderPaths, nodes, normalizedQuery]);

  useEffect(() => {
    setPreviewPath(null);
    setPreviewSelection(null);
    setPreviewContent("");
    setPreviewRevision("");
    setPreviewTruncated(false);
    setPreviewError(null);
    setPreviewLoading(false);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
  }, [workspaceId]);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
    setPreviewSelection(null);
    setPreviewContent("");
    setPreviewRevision("");
    setPreviewTruncated(false);
    setPreviewError(null);
    setPreviewLoading(false);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
  }, []);

  const toggleAllFolders = () => {
    if (!hasFolders) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (allVisibleExpanded) {
        visibleFolderPaths.forEach((path) => next.delete(path));
      } else {
        visibleFolderPaths.forEach((path) => next.add(path));
      }
      return next;
    });
    hasManualToggle.current = true;
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const resolvePath = useCallback(
    (relativePath: string) => {
      return joinWorkspacePath(workspacePath, relativePath);
    },
    [workspacePath],
  );

  const previewImageSrc = useMemo(() => {
    if (!previewPath || previewKind !== "image") {
      return null;
    }
    try {
      return convertFileSrc(resolvePath(previewPath));
    } catch {
      return null;
    }
  }, [previewPath, previewKind, resolvePath]);

  const openPreview = useCallback((path: string) => {
    setPreviewPath(path);
    setPreviewSelection(null);
    setPreviewContent("");
    setPreviewRevision("");
    setPreviewTruncated(false);
    setPreviewError(null);
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
    dragMovedRef.current = false;
  }, []);

  useEffect(() => {
    const requestPath = openFileRequest?.path
      ? normalizeFileTreeRequestPath(openFileRequest.path)
      : "";
    if (!requestPath) {
      return;
    }
    const ancestors = ancestorFolderPaths(requestPath);
    if (ancestors.length) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        ancestors.forEach((path) => next.add(path));
        return next;
      });
    }
    openPreview(requestPath);
  }, [openFileRequest, openPreview]);

  useEffect(() => {
    if (!previewPath) {
      return;
    }
    let cancelled = false;
    if (previewKind === "image") {
      setPreviewContent("");
      setPreviewRevision("");
      setPreviewTruncated(false);
      setPreviewError(null);
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    setPreviewError(null);
    readWorkspaceFile(workspaceId, previewPath)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPreviewContent(response.content ?? "");
        setPreviewRevision(response.revision ?? "");
        setPreviewTruncated(Boolean(response.truncated));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewKind, previewPath, workspaceId]);

  const flatNodes = useMemo(() => {
    const rows: FileTreeRowEntry[] = [];
    const walk = (node: FileTreeNode, depth: number) => {
      const isFolder = node.type === "folder";
      const isExpanded = isFolder && expandedFolders.has(node.path);
      rows.push({ node, depth, isFolder, isExpanded });
      if (isFolder && isExpanded) {
        node.children.forEach((child) => walk(child, depth + 1));
      }
    };
    nodes.forEach((node) => walk(node, 0));
    return rows;
  }, [nodes, expandedFolders]);

  const rowVirtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => FILE_TREE_ROW_HEIGHT,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (!isDragSelecting) {
      return;
    }
    const handleMouseUp = () => {
      setIsDragSelecting(false);
      dragAnchorLineRef.current = null;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isDragSelecting]);

  const selectRangeFromAnchor = useCallback((anchor: number, index: number) => {
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);
    setPreviewSelection({ start, end });
  }, []);

  const handleSelectLine = useCallback(
    (index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      if (event.shiftKey && previewSelection) {
        const anchor = previewSelection.start;
        selectRangeFromAnchor(anchor, index);
        return;
      }
      setPreviewSelection({ start: index, end: index });
    },
    [previewSelection, selectRangeFromAnchor],
  );

  const handleLineMouseDown = useCallback(
    (index: number, event: MouseEvent<HTMLButtonElement>) => {
      if (previewKind !== "text" || event.button !== 0) {
        return;
      }
      event.preventDefault();
      setIsDragSelecting(true);
      const anchor =
        event.shiftKey && previewSelection ? previewSelection.start : index;
      dragAnchorLineRef.current = anchor;
      dragMovedRef.current = false;
      selectRangeFromAnchor(anchor, index);
    },
    [previewKind, previewSelection, selectRangeFromAnchor],
  );

  const handleLineMouseEnter = useCallback(
    (index: number, _event: MouseEvent<HTMLButtonElement>) => {
      if (!isDragSelecting) {
        return;
      }
      const anchor = dragAnchorLineRef.current;
      if (anchor === null) {
        return;
      }
      if (anchor !== index) {
        dragMovedRef.current = true;
      }
      selectRangeFromAnchor(anchor, index);
    },
    [isDragSelecting, selectRangeFromAnchor],
  );

  const handleLineMouseUp = useCallback(() => {
    if (!isDragSelecting) {
      return;
    }
    setIsDragSelecting(false);
    dragAnchorLineRef.current = null;
  }, [isDragSelecting]);

  const selectionHints = useMemo(
    () =>
      previewKind === "text"
        ? [
            t("files.preview.multiSelectGesture"),
            t("files.preview.multiSelectPurpose"),
          ]
        : [],
    [previewKind, t],
  );

  const handleAddSelection = useCallback((contentOverride?: string) => {
    if (
      !canInsertText ||
      previewKind !== "text" ||
      !previewPath ||
      !previewSelection ||
      !onInsertText
    ) {
      return;
    }
    const lines = (contentOverride ?? previewContent).split("\n");
    const selected = lines.slice(previewSelection.start, previewSelection.end + 1);
    const language = languageFromPath(previewPath);
    const fence = language ? `\`\`\`${language}` : "```";
    const start = previewSelection.start + 1;
    const end = previewSelection.end + 1;
    const rangeLabel = start === end ? `L${start}` : `L${start}-L${end}`;
    const snippet = `${previewPath}:${rangeLabel}\n${fence}\n${selected.join("\n")}\n\`\`\``;
    onInsertText(snippet);
    closePreview();
  }, [
    canInsertText,
    previewContent,
    previewKind,
    previewPath,
    previewSelection,
    onInsertText,
    closePreview,
  ]);

  const handlePreviewTextSelectionChange = useCallback(
    (selection: { start: number; end: number } | null) => {
      setPreviewSelection(selection);
    },
    [],
  );

  const handleSavePreviewContent = useCallback(
    async (nextContent: string) => {
      if (!previewPath) {
        throw new Error("No file selected");
      }
      if (!previewRevision) {
        throw new Error("Missing file revision; reload before saving");
      }
      await writeWorkspaceFile(workspaceId, previewPath, nextContent, previewRevision);
      const response = await readWorkspaceFile(workspaceId, previewPath);
      setPreviewContent(response.content ?? "");
      setPreviewRevision(response.revision ?? "");
      setPreviewTruncated(Boolean(response.truncated));
      setPreviewSelection(null);
      await onRefreshFiles();
    },
    [onRefreshFiles, previewPath, previewRevision, workspaceId],
  );

  const showMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, relativePath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = await Menu.new({
        items: [
          await MenuItem.new({
            text: t("files.preview.addToChat"),
            enabled: canInsertText,
            action: async () => {
              if (!canInsertText) {
                return;
              }
              onInsertText?.(relativePath);
            },
          }),
          await MenuItem.new({
            text: t("platform.revealInFileManager", { app: fileManagerName() }),
            action: async () => {
              await revealItemInDir(resolvePath(relativePath));
            },
          }),
        ],
      });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [canInsertText, onInsertText, resolvePath, t],
  );

  const renderRow = (entry: FileTreeRowEntry) => {
    const { node, depth, isFolder, isExpanded } = entry;
    const fileTypeIconUrl = isFolder ? null : getFileTypeIconUrl(node.path);
    return (
      <div className="file-tree-row-wrap">
        <button
          type="button"
          className={`file-tree-row${isFolder ? " is-folder" : " is-file"}`}
          style={{ paddingLeft: `${depth * 10}px` }}
          onClick={() => {
            if (isFolder) {
              toggleFolder(node.path);
              return;
            }
            openPreview(node.path);
          }}
          onContextMenu={(event) => {
            void showMenu(event, node.path);
          }}
        >
          {isFolder ? (
            <span className={`file-tree-chevron${isExpanded ? " is-open" : ""}`}>
              ›
            </span>
          ) : (
            <span className="file-tree-spacer" aria-hidden />
          )}
          <span className="file-tree-icon" aria-hidden>
            {isFolder ? (
              <Folder size={12} />
            ) : fileTypeIconUrl ? (
              <img
                className="file-tree-icon-image"
                src={fileTypeIconUrl}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <File size={12} />
            )}
          </span>
          <span className="file-tree-name">{node.name}</span>
        </button>
        {!isFolder && (
          <button
            type="button"
            className="ghost icon-button file-tree-action"
            onClick={(event) => {
              event.stopPropagation();
              if (!canInsertText) {
                return;
              }
              onInsertText?.(node.path);
            }}
            disabled={!canInsertText}
            aria-label={t("files.tree.mentionFile", { name: node.name })}
            title={t("files.tree.mentionInChat")}
          >
            <Plus size={10} aria-hidden />
          </button>
        )}
      </div>
    );
  };

  return (
    <PanelShell
      filePanelMode={filePanelMode}
      onFilePanelModeChange={onFilePanelModeChange}
      className="file-tree-panel"
      headerClassName="git-panel-header"
      headerRight={
        <PanelMeta className="file-tree-meta">
          <div className="file-tree-count">
            {visibleEntries.length
              ? normalizedQuery
                ? t(
                    visibleEntries.length === 1
                      ? "files.tree.match"
                      : "files.tree.matches",
                    { count: visibleEntries.length },
                  )
                : filterMode === "modified"
                  ? t("files.tree.modifiedCount", { count: visibleEntries.length })
                  : t(
                      visibleEntries.length === 1
                        ? "files.tree.file"
                        : "files.tree.files",
                      { count: visibleEntries.length },
                    )
              : showLoading
                ? t("files.tree.loading")
                : filterMode === "modified"
                  ? t("files.tree.noModifiedShort")
                  : t("files.tree.noFilesShort")}
          </div>
          <div className="file-tree-toolbar-actions">
            <button
              type="button"
              className={`ghost icon-button file-tree-refresh${isLoading ? " is-loading" : ""}`}
              onClick={() => {
                void onRefreshFiles();
              }}
              aria-label={t("files.tree.refresh")}
              title={t("files.tree.refresh")}
            >
              <RefreshCw aria-hidden />
            </button>
            {hasFolders ? (
              <button
                type="button"
                className="ghost icon-button file-tree-toggle"
                onClick={toggleAllFolders}
                aria-label={
                  allVisibleExpanded
                    ? t("files.tree.collapseAll")
                    : t("files.tree.expandAll")
                }
                title={
                  allVisibleExpanded
                    ? t("files.tree.collapseAll")
                    : t("files.tree.expandAll")
                }
              >
                <ChevronsUpDown aria-hidden />
              </button>
            ) : null}
          </div>
        </PanelMeta>
      }
      search={
        <PanelSearchField
          className="file-tree-search"
          inputClassName="file-tree-search-input"
          placeholder={t("files.tree.filterPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("files.tree.filterPlaceholder")}
          icon={<Search aria-hidden />}
          trailing={
            <button
              type="button"
              className={`ghost icon-button file-tree-search-filter${filterMode === "modified" ? " is-active" : ""}`}
              onClick={() => {
                setFilterMode((prev) => (prev === "all" ? "modified" : "all"));
              }}
              aria-pressed={filterMode === "modified"}
              aria-label={
                filterMode === "modified"
                  ? t("files.tree.showAll")
                  : t("files.tree.showModified")
              }
              title={
                filterMode === "modified"
                  ? t("files.tree.showAll")
                  : t("files.tree.showModified")
              }
            >
              <GitBranch size={14} aria-hidden />
            </button>
          }
        />
      }
    >
      <div
        className="file-tree-list"
        ref={listRef}
        style={{ ["--file-tree-row-height" as string]: `${FILE_TREE_ROW_HEIGHT}px` }}
      >
        {showLoading ? (
          <div className="file-tree-skeleton">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                className="file-tree-skeleton-row"
                key={`file-tree-skeleton-${index}`}
                style={{ width: `${68 + index * 3}%` }}
              />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <div className="file-tree-empty">
            {normalizedQuery
              ? filterMode === "modified"
                ? t("files.tree.noModifiedMatches")
                : t("files.tree.noMatches")
              : filterMode === "modified"
                ? t("files.tree.noModified")
                : t("files.tree.noFiles")}
          </div>
        ) : (
          <div
            className="file-tree-virtual"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {virtualRows.map((virtualRow) => {
              const entry = flatNodes[virtualRow.index];
              if (!entry) {
                return null;
              }
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {renderRow(entry)}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {previewPath
        ? createPortal(
            <FilePreviewPopover
              path={previewPath}
              absolutePath={resolvePath(previewPath)}
              content={previewContent}
              truncated={previewTruncated}
              previewKind={previewKind}
              imageSrc={previewImageSrc}
              openTargets={openTargets}
              openAppIconById={openAppIconById}
              selectedOpenAppId={selectedOpenAppId}
              onSelectOpenAppId={onSelectOpenAppId}
              selection={previewSelection}
              onSelectLine={handleSelectLine}
              onLineMouseDown={handleLineMouseDown}
              onLineMouseEnter={handleLineMouseEnter}
              onLineMouseUp={handleLineMouseUp}
              onClearSelection={() => setPreviewSelection(null)}
              onAddSelection={handleAddSelection}
              onSaveContent={
                previewKind === "text" && !previewTruncated
                  ? handleSavePreviewContent
                  : undefined
              }
              onTextSelectionChange={handlePreviewTextSelectionChange}
              canInsertText={canInsertText}
              onClose={closePreview}
              selectionHints={selectionHints}
              variant="modal"
              isLoading={previewLoading}
              error={previewError}
            />,
            document.body,
          )
        : null}
    </PanelShell>
  );
}
