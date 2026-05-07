import { useEffect, useRef } from "react";
import { ModalShell } from "../../design-system/components/modal/ModalShell";
import { useI18n } from "@/features/i18n/i18n";

type MobileRemoteWorkspacePromptProps = {
  value: string;
  error: string | null;
  recentPaths: string[];
  onChange: (value: string) => void;
  onRecentPathSelect: (path: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MobileRemoteWorkspacePrompt({
  value,
  error,
  recentPaths,
  onChange,
  onRecentPathSelect,
  onCancel,
  onConfirm,
}: MobileRemoteWorkspacePromptProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusTextareaAtEnd = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  useEffect(() => {
    focusTextareaAtEnd();
  }, []);

  return (
    <ModalShell
      ariaLabel={t("workspace.remotePaths.aria")}
      className="mobile-remote-workspace-modal"
      cardClassName="mobile-remote-workspace-modal-card"
      onBackdropClick={onCancel}
    >
      <div className="mobile-remote-workspace-modal-content">
        <div className="ds-modal-title">{t("workspace.remotePaths.title")}</div>
        <div className="ds-modal-subtitle">
          {t("workspace.remotePaths.subtitle")}
        </div>
        <label className="ds-modal-label" htmlFor="mobile-remote-workspace-paths">
          {t("workspace.remotePaths.paths")}
        </label>
        <textarea
          id="mobile-remote-workspace-paths"
          ref={textareaRef}
          className="ds-modal-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={"/home/vlad/dev/project-one\n/home/vlad/dev/project-two"}
          rows={4}
          wrap="off"
        />
        <div className="mobile-remote-workspace-modal-hint">
          {t("workspace.remotePaths.hint")}
        </div>
        {recentPaths.length > 0 && (
          <div className="mobile-remote-workspace-modal-recent">
            <div className="mobile-remote-workspace-modal-recent-title">
              {t("workspace.remotePaths.recent")}
            </div>
            <div className="mobile-remote-workspace-modal-recent-list">
              {recentPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="mobile-remote-workspace-modal-recent-item"
                  onClick={() => {
                    onRecentPathSelect(path);
                    requestAnimationFrame(() => {
                      focusTextareaAtEnd();
                    });
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <div className="ds-modal-error">{error}</div>}
        <div className="ds-modal-actions">
          <button className="ghost ds-modal-button" onClick={onCancel} type="button">
            {t("settings.common.cancel")}
          </button>
          <button className="primary ds-modal-button" onClick={onConfirm} type="button">
            {t("workspace.remotePaths.add")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
