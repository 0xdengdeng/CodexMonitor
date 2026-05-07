import { useI18n } from "@/features/i18n/i18n";

type WorkspaceHomeGitInitBannerProps = {
  isLoading: boolean;
  onInitGitRepo: () => void | Promise<void>;
};

export function WorkspaceHomeGitInitBanner({
  isLoading,
  onInitGitRepo,
}: WorkspaceHomeGitInitBannerProps) {
  const { t } = useI18n();

  return (
    <div className="workspace-home-git-banner" role="region" aria-label={t("workspace.home.gitSetup")}>
      <div className="workspace-home-git-banner-title">
        {t("workspace.home.gitNotInitialized")}
      </div>
      <div className="workspace-home-git-banner-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void onInitGitRepo()}
          disabled={isLoading}
        >
          {isLoading ? t("workspace.home.initializing") : t("workspace.home.initializeGit")}
        </button>
      </div>
    </div>
  );
}
