import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  describeFileTarget,
  formatParsedFileLocation,
  isFileLinkUrl,
  parseFileLinkUrl,
  parseInlineFileTarget,
  remarkFileLinks,
  resolveMessageFileHref,
  toFileLink,
} from "../utils/messageFileLinks";
import { resolveMountedWorkspacePath } from "../utils/mountedWorkspacePaths";
import type { ParsedFileLocation } from "../../../utils/fileLinks";
import { isAbsolutePath, joinWorkspacePath } from "../../../utils/platformPaths";
import { useI18n } from "@/features/i18n/i18n";

type MarkdownProps = {
  value: string;
  className?: string;
  codeBlock?: boolean;
  codeBlockStyle?: "default" | "message";
  codeBlockCopyUseModifier?: boolean;
  showFilePath?: boolean;
  workspacePath?: string | null;
  onPreviewFileLink?: (
    event: React.MouseEvent,
    path: ParsedFileLocation,
  ) => boolean;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type CodeBlockProps = {
  className?: string;
  value: string;
  copyUseModifier: boolean;
};

type PreProps = {
  node?: {
    tagName?: string;
    children?: Array<{
      tagName?: string;
      properties?: { className?: string[] | string };
      children?: Array<{ value?: string }>;
    }>;
  };
  children?: ReactNode;
  copyUseModifier: boolean;
};

type LinkBlockProps = {
  urls: string[];
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
const FAILED_PREVIEW_IMAGE_SOURCE_LIMIT = 200;
const failedPreviewImageSources = new Set<string>();

// Static across renders: a fresh array here would make react-markdown reprocess
// every render. Hoisted so the plugin list keeps a stable identity.
const REMARK_PLUGINS = [remarkGfm, remarkFileLinks];

type FileImagePreviewState = "loading" | "loaded" | "failed";

function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  if (!match) {
    return null;
  }
  return match[1];
}

function extractCodeFromPre(node?: PreProps["node"]) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  const className = codeNode?.properties?.className;
  const normalizedClassName = Array.isArray(className)
    ? className.join(" ")
    : className;
  const value =
    codeNode?.children?.map((child) => child.value ?? "").join("") ?? "";
  return {
    className: normalizedClassName,
    value: value.replace(/\n$/, ""),
  };
}

function normalizeUrlLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBullet = trimmed.replace(/^(?:[-*]|\d+\.)\s+/, "");
  if (!/^https?:\/\/\S+$/i.test(withoutBullet)) {
    return null;
  }
  return withoutBullet;
}

type StructuredReviewFinding = {
  file: string;
  category: string;
  finding: string;
  recommendation: string;
  severity: string;
};

function escapeTableCell(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br />")
    .trim();
}

function parseStructuredReviewFinding(line: string): StructuredReviewFinding | null {
  const parts = line.split(/\s+\|\s+/).map((part) => part.trim());
  if (parts.length !== 5) {
    return null;
  }
  const [file, rawCategory, finding, recommendation, rawSeverity] = parts;
  if (!file || !finding || !recommendation || !/^category=/i.test(rawCategory)) {
    return null;
  }
  const category = rawCategory.replace(/^category=/i, "").trim();
  const severity = rawSeverity.replace(/^severity=/i, "").trim();
  if (!category || !severity) {
    return null;
  }
  if (!/^(critical|high|medium|low|info|warning|error)$/i.test(severity)) {
    return null;
  }
  return {
    file,
    category,
    finding,
    recommendation,
    severity,
  };
}

function buildStructuredReviewTable(rows: StructuredReviewFinding[]) {
  const header = [
    "| File | Category | Finding | Recommendation | Severity |",
    "| --- | --- | --- | --- | --- |",
  ];
  const body = rows.map(
    ({ file, category, finding, recommendation, severity }) =>
      `| \`${escapeTableCell(file)}\` | ${escapeTableCell(category)} | ${escapeTableCell(
        finding,
      )} | ${escapeTableCell(recommendation)} | ${escapeTableCell(severity)} |`,
  );
  return [...header, ...body].join("\n");
}

function normalizeStructuredReviewTables(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let pendingRows: StructuredReviewFinding[] = [];
  const output: string[] = [];

  const flushPendingRows = () => {
    if (pendingRows.length === 0) {
      return;
    }
    if (output.length > 0 && output[output.length - 1].trim()) {
      output.push("");
    }
    output.push(buildStructuredReviewTable(pendingRows));
    output.push("");
    pendingRows = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      flushPendingRows();
      inFence = !inFence;
      output.push(line);
      continue;
    }
    const structuredRow = inFence ? null : parseStructuredReviewFinding(line);
    if (structuredRow) {
      pendingRows.push(structuredRow);
      continue;
    }
    if (!inFence && pendingRows.length > 0 && !line.trim()) {
      continue;
    }
    flushPendingRows();
    output.push(line);
  }

  flushPendingRows();
  return output.join("\n");
}

function stripTrailingMemoryCitation(value: string) {
  return value.replace(/\n*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*$/i, "").trim();
}

export function isStandaloneMarkdownTable(value: string) {
  const stripped = stripTrailingMemoryCitation(value);
  if (!stripped) {
    return false;
  }
  const normalized = normalizeStructuredReviewTables(normalizeListIndentation(stripped)).trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return false;
  }
  return lines.every((line) => /^\|.*\|\s*$/.test(line.trim()));
}

function extractUrlLines(value: string) {
  const lines = value.split(/\r?\n/);
  const urls = lines
    .map((line) => normalizeUrlLine(line))
    .filter((line): line is string => Boolean(line));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return null;
  }
  if (urls.length !== nonEmptyLines.length) {
    return null;
  }
  return urls;
}

function normalizeListIndentation(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let activeOrderedItem = false;
  let orderedBaseIndent = 4;
  let orderedIndentOffset: number | null = null;

  const countLeadingSpaces = (line: string) =>
    line.match(/^\s*/)?.[0].length ?? 0;
  const spaces = (count: number) => " ".repeat(Math.max(0, count));
  const normalized = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      inFence = !inFence;
      activeOrderedItem = false;
      orderedIndentOffset = null;
      return line;
    }
    if (inFence) {
      return line;
    }
    if (!line.trim()) {
      return line;
    }

    const orderedMatch = line.match(/^(\s*)\d+\.\s+/);
    if (orderedMatch) {
      const rawIndent = orderedMatch[1].length;
      const normalizedIndent =
        rawIndent > 0 && rawIndent < 4 ? 4 : rawIndent;
      activeOrderedItem = true;
      orderedBaseIndent = normalizedIndent + 4;
      orderedIndentOffset = null;
      if (normalizedIndent !== rawIndent) {
        return `${spaces(normalizedIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch) {
      const rawIndent = bulletMatch[1].length;
      let targetIndent = rawIndent;

      if (!activeOrderedItem && rawIndent > 0 && rawIndent < 4) {
        targetIndent = 4;
      }

      if (activeOrderedItem) {
        if (orderedIndentOffset === null && rawIndent < orderedBaseIndent) {
          orderedIndentOffset = orderedBaseIndent - rawIndent;
        }
        if (orderedIndentOffset !== null) {
          const adjustedIndent = rawIndent + orderedIndentOffset;
          if (adjustedIndent <= orderedBaseIndent + 12) {
            targetIndent = adjustedIndent;
          }
        }
      }

      if (targetIndent !== rawIndent) {
        return `${spaces(targetIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const leadingSpaces = countLeadingSpaces(line);
    if (activeOrderedItem && leadingSpaces < orderedBaseIndent) {
      activeOrderedItem = false;
      orderedIndentOffset = null;
    }
    return line;
  });
  return normalized.join("\n");
}

function LinkBlock({ urls }: LinkBlockProps) {
  return (
    <div className="markdown-linkblock">
      {urls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {url}
        </a>
      ))}
    </div>
  );
}

function isPreviewableImagePath(path: string) {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path;
  const ext = cleanPath.split(".").pop()?.toLowerCase() ?? "";
  return PREVIEWABLE_IMAGE_EXTENSIONS.has(ext);
}

function normalizePreviewPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function resolveWorkspaceImagePreviewPath(
  path: string,
  workspacePath?: string | null,
) {
  const workspace = workspacePath?.trim() ?? "";
  const trimmedPath = path.trim();
  if (!workspace || !trimmedPath) {
    return "";
  }
  const mountedWorkspacePath = resolveMountedWorkspacePath(trimmedPath, workspace);
  const resolvedPath =
    mountedWorkspacePath ??
    (isAbsolutePath(trimmedPath)
      ? trimmedPath
      : joinWorkspacePath(workspace, trimmedPath));
  const normalizedWorkspace = normalizePreviewPath(workspace);
  const normalizedResolved = normalizePreviewPath(resolvedPath);
  if (
    normalizedResolved === normalizedWorkspace ||
    normalizedResolved.startsWith(`${normalizedWorkspace}/`)
  ) {
    return resolvedPath;
  }
  return "";
}

function resolvePreviewImageSrc(path: string) {
  if (!path) {
    return "";
  }
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("file://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

function rememberFailedPreviewImageSource(src: string) {
  if (!src) {
    return;
  }
  failedPreviewImageSources.add(src);
  if (failedPreviewImageSources.size <= FAILED_PREVIEW_IMAGE_SOURCE_LIMIT) {
    return;
  }
  const oldest = failedPreviewImageSources.values().next().value as string | undefined;
  if (oldest) {
    failedPreviewImageSources.delete(oldest);
  }
}

function FileImagePreview({
  alt,
  src,
  onClick,
}: {
  alt: string;
  src: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  const [state, setState] = useState<FileImagePreviewState>(() =>
    src && !failedPreviewImageSources.has(src) ? "loading" : "failed",
  );

  useEffect(() => {
    setState(src && !failedPreviewImageSources.has(src) ? "loading" : "failed");
  }, [src]);

  if (state === "failed" || !src) {
    return null;
  }
  return (
    <button
      type="button"
      className="message-file-image-preview"
      onClick={onClick}
      aria-label={alt}
      data-state={state}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setState("loaded")}
        onError={() => {
          rememberFailedPreviewImageSource(src);
          setState("failed");
        }}
      />
    </button>
  );
}

function FileReferenceLink({
  href,
  rawPath,
  showFilePath,
  workspacePath,
  onClick,
  onContextMenu,
}: {
  href: string;
  rawPath: ParsedFileLocation;
  showFilePath: boolean;
  workspacePath?: string | null;
  onClick: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onContextMenu: (event: React.MouseEvent, path: ParsedFileLocation) => void;
}) {
  const { fullPath, fileName, lineLabel, parentPath } = describeFileTarget(rawPath, workspacePath);
  const imagePreviewPath =
    rawPath.line === null && isPreviewableImagePath(rawPath.path)
      ? resolveWorkspaceImagePreviewPath(rawPath.path, workspacePath)
      : "";
  const imagePreviewSrc =
    imagePreviewPath ? resolvePreviewImageSrc(imagePreviewPath) : "";
  const handleImagePreviewClick = (event: React.MouseEvent) => {
    onClick(event, rawPath);
  };
  return (
    <span className="message-file-reference">
      <a
        href={href}
        className="message-file-link"
        title={fullPath}
        onClick={(event) => onClick(event, rawPath)}
        onContextMenu={(event) => onContextMenu(event, rawPath)}
      >
        <span className="message-file-link-name">{fileName}</span>
        {lineLabel ? <span className="message-file-link-line">L{lineLabel}</span> : null}
        {showFilePath && parentPath ? (
          <span className="message-file-link-path-popover" aria-hidden="true">
            {parentPath}
          </span>
        ) : null}
      </a>
      {imagePreviewSrc ? (
        <FileImagePreview
          alt={fileName}
          src={imagePreviewSrc}
          onClick={handleImagePreviewClick}
        />
      ) : null}
    </span>
  );
}

function CodeBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ?? t("messages.code");
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    try {
      const shouldFence = copyUseModifier ? event.altKey : true;
      const nextValue = shouldFence ? fencedValue : value;
      await navigator.clipboard.writeText(nextValue);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <button
          type="button"
          className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={t("messages.copyCodeBlock")}
          title={copied ? t("common.copied") : t("common.copy")}
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre>
        <code className={className}>{value}</code>
      </pre>
    </div>
  );
}

function PreBlock({ node, children, copyUseModifier }: PreProps) {
  const { className, value } = extractCodeFromPre(node);
  if (!className && !value && children) {
    return <pre>{children}</pre>;
  }
  const urlLines = extractUrlLines(value);
  if (urlLines) {
    return <LinkBlock urls={urlLines} />;
  }
  const isSingleLine = !value.includes("\n");
  if (isSingleLine) {
    return (
      <pre className="markdown-codeblock-single">
        <code className={className}>{value}</code>
      </pre>
    );
  }
  return (
    <CodeBlock
      className={className}
      value={value}
      copyUseModifier={copyUseModifier}
    />
  );
}

export function Markdown({
  value,
  className,
  codeBlock,
  codeBlockStyle = "default",
  codeBlockCopyUseModifier = false,
  showFilePath = true,
  workspacePath = null,
  onPreviewFileLink,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MarkdownProps) {
  const normalizedValue = codeBlock
    ? value
    : normalizeStructuredReviewTables(normalizeListIndentation(value));
  const content = codeBlock
    ? `\`\`\`\n${normalizedValue}\n\`\`\``
    : normalizedValue;
  // The `components` map below is used by react-markdown as a set of component
  // *types*. React remounts a subtree whenever the type identity at a position
  // changes, so rebuilding these arrow functions every render remounted every
  // inline file-image preview on each re-render — resetting it to "loading",
  // reloading the image (opacity 0→1) and re-evaluating its clamp()/vw height.
  // That is the bubble "闪/忽大忽小" flicker during streaming. Keeping the live
  // callbacks in a ref lets the handlers + `components` keep a stable identity
  // (immune to any upstream prop-identity churn) while still calling the latest
  // callback at event time.
  const callbacksRef = useRef({
    onPreviewFileLink,
    onOpenFileLink,
    onOpenFileLinkMenu,
    onOpenThreadLink,
    workspacePath,
  });
  callbacksRef.current = {
    onPreviewFileLink,
    onOpenFileLink,
    onOpenFileLinkMenu,
    onOpenThreadLink,
    workspacePath,
  };

  const handleFileLinkClick = useCallback(
    (event: React.MouseEvent, path: ParsedFileLocation) => {
      event.preventDefault();
      event.stopPropagation();
      if (callbacksRef.current.onPreviewFileLink?.(event, path)) {
        return;
      }
      callbacksRef.current.onOpenFileLink?.(path);
    },
    [],
  );
  const handleLocalLinkClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const handleFileLinkContextMenu = useCallback(
    (event: React.MouseEvent, path: ParsedFileLocation) => {
      event.preventDefault();
      event.stopPropagation();
      callbacksRef.current.onOpenFileLinkMenu?.(event, path);
    },
    [],
  );
  const resolveHrefFilePath = useCallback(
    (url: string) => resolveMessageFileHref(url, callbacksRef.current.workspacePath),
    [],
  );

  const urlTransform = useCallback(
    (url: string) => {
      const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
      // Keep file-like hrefs intact before scheme sanitization runs, otherwise
      // Windows absolute paths such as C:/repo/file.ts look like unknown schemes.
      if (resolveHrefFilePath(url)) {
        return url;
      }
      if (
        isFileLinkUrl(url) ||
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("mailto:") ||
        url.startsWith("#") ||
        url.startsWith("/") ||
        url.startsWith("./") ||
        url.startsWith("../")
      ) {
        return url;
      }
      if (!hasScheme) {
        return url;
      }
      return "";
    },
    [resolveHrefFilePath],
  );

  const components: Components = useMemo(() => {
    const map: Components = {
    table: ({ children }) => (
      <div className="markdown-table-wrap">
        <table className="markdown-table">{children}</table>
      </div>
    ),
    a: ({ href, children }) => {
      const url = (href ?? "").trim();
      const threadId = url.startsWith("thread://")
        ? url.slice("thread://".length).trim()
        : url.startsWith("/thread/")
          ? url.slice("/thread/".length).trim()
          : "";
      if (threadId) {
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              callbacksRef.current.onOpenThreadLink?.(threadId);
            }}
          >
            {children}
          </a>
        );
      }
      if (isFileLinkUrl(url)) {
        const path = parseFileLinkUrl(url);
        if (!path) {
          return (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <FileReferenceLink
            href={href ?? toFileLink(path)}
            rawPath={path}
            showFilePath={showFilePath}
            workspacePath={workspacePath}
            onClick={handleFileLinkClick}
            onContextMenu={handleFileLinkContextMenu}
          />
        );
      }
      const hrefFilePath = resolveHrefFilePath(url);
      if (hrefFilePath) {
        const formattedHrefFilePath = formatParsedFileLocation(hrefFilePath);
        const clickHandler = (event: React.MouseEvent) =>
          handleFileLinkClick(event, hrefFilePath);
        const contextMenuHandler = callbacksRef.current.onOpenFileLinkMenu
          ? (event: React.MouseEvent) => handleFileLinkContextMenu(event, hrefFilePath)
          : undefined;
        return (
          <a
            href={href ?? toFileLink(hrefFilePath)}
            title={formattedHrefFilePath}
            onClick={clickHandler}
            onContextMenu={contextMenuHandler}
          >
            {children}
          </a>
        );
      }
      const isExternal =
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("mailto:");

      if (!isExternal) {
        if (url.startsWith("#")) {
          return <a href={href}>{children}</a>;
        }
        return (
          <a href={href} onClick={handleLocalLinkClick}>
            {children}
          </a>
        );
      }

      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {children}
        </a>
      );
    },
    code: ({ className: codeClassName, children }) => {
      if (codeClassName) {
        return <code className={codeClassName}>{children}</code>;
      }
      const text = String(children ?? "").trim();
      const fileTarget = parseInlineFileTarget(text);
      if (!fileTarget) {
        return <code>{children}</code>;
      }
      const href = toFileLink(fileTarget);
      return (
        <FileReferenceLink
          href={href}
          rawPath={fileTarget}
          showFilePath={showFilePath}
          workspacePath={workspacePath}
          onClick={handleFileLinkClick}
          onContextMenu={handleFileLinkContextMenu}
        />
      );
    },
    };

    if (codeBlockStyle === "message") {
      map.pre = ({ node, children }) => (
        <PreBlock node={node as PreProps["node"]} copyUseModifier={codeBlockCopyUseModifier}>
          {children}
        </PreBlock>
      );
    }

    return map;
  }, [
    handleFileLinkClick,
    handleFileLinkContextMenu,
    handleLocalLinkClick,
    resolveHrefFilePath,
    showFilePath,
    workspacePath,
    codeBlockStyle,
    codeBlockCopyUseModifier,
  ]);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={urlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
