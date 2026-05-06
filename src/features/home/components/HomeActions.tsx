type HomeActionsProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
};

export function HomeActions({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
}: HomeActionsProps) {
  return (
    <div className="home-actions">
      <button
        className="home-button primary home-add-workspaces-button"
        onClick={onAddWorkspace}
        data-tauri-drag-region="false"
      >
        <span className="home-icon" aria-hidden>
          +
        </span>
        导入项目
      </button>
      <button
        className="home-button secondary home-add-workspace-from-url-button"
        onClick={onAddWorkspaceFromUrl}
        data-tauri-drag-region="false"
      >
        <span className="home-icon" aria-hidden>
          ⤓
        </span>
        从 Git 地址导入
      </button>
    </div>
  );
}
