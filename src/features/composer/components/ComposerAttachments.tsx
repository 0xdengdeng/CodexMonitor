import { convertFileSrc } from "@tauri-apps/api/core";
import Image from "lucide-react/dist/esm/icons/image";
import FileText from "lucide-react/dist/esm/icons/file-text";
import X from "lucide-react/dist/esm/icons/x";
import { useI18n } from "@/features/i18n/i18n";

type ComposerAttachmentsProps = {
  attachments: string[];
  disabled: boolean;
  onRemoveAttachment?: (path: string) => void;
  // "image" renders a thumbnail preview; "file" renders a document icon + name
  // (file attachments are passed to the agent as paths, not previewable bytes).
  kind?: "image" | "file";
};

function fileTitle(
  path: string,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (path.startsWith("data:")) {
    return t("messages.pastedImage");
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return t("messages.tool.image");
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function attachmentPreviewSrc(path: string) {
  if (path.startsWith("data:")) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

export function ComposerAttachments({
  attachments,
  disabled,
  onRemoveAttachment,
  kind = "image",
}: ComposerAttachmentsProps) {
  const { t } = useI18n();

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="composer-attachments">
      {attachments.map((path) => {
        const title = fileTitle(path, t);
        const titleAttr = path.startsWith("data:") ? t("messages.pastedImage") : path;
        const previewSrc = kind === "image" ? attachmentPreviewSrc(path) : "";
        return (
          <div
            key={path}
            className="composer-attachment"
            title={titleAttr}
          >
            {previewSrc && (
              <span className="composer-attachment-preview" aria-hidden>
                <img src={previewSrc} alt="" />
              </span>
            )}
            {previewSrc ? (
              <span className="composer-attachment-thumb" aria-hidden>
                <img src={previewSrc} alt="" />
              </span>
            ) : (
              <span className="composer-icon" aria-hidden>
                {kind === "file" ? <FileText size={14} /> : <Image size={14} />}
              </span>
            )}
            <span className="composer-attachment-name">{title}</span>
            <button
              type="button"
              className="composer-attachment-remove"
              onClick={() => onRemoveAttachment?.(path)}
              aria-label={t("messages.removeAttachment", { title })}
              disabled={disabled}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
