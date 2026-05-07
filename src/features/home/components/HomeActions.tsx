import Download from "lucide-react/dist/esm/icons/download";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import { useI18n } from "@/features/i18n/i18n";

type HomeActionsProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
};

export function HomeActions({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
}: HomeActionsProps) {
  const { t } = useI18n();

  return (
    <div className="home-actions">
      <button
        className="home-button primary home-add-workspaces-button"
        onClick={onAddWorkspace}
        data-tauri-drag-region="false"
      >
        <span className="home-icon" aria-hidden>
          <FolderPlus />
        </span>
        {t("home.actions.addWorkspace")}
      </button>
      <button
        className="home-button secondary home-add-workspace-from-url-button"
        onClick={onAddWorkspaceFromUrl}
        data-tauri-drag-region="false"
      >
        <span className="home-icon" aria-hidden>
          <Download />
        </span>
        {t("home.actions.addWorkspaceFromUrl")}
      </button>
    </div>
  );
}
