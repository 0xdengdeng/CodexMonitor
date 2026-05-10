import type {
  AccountSnapshot,
  EnterpriseAiUsageSnapshot,
  LocalUsageSnapshot,
  RateLimitSnapshot,
} from "../../../types";
import { HomeActions } from "./HomeActions";
import { HomeLatestAgentsSection } from "./HomeLatestAgentsSection";
import { HomeUsageSection } from "./HomeUsageSection";
import type {
  LatestAgentRun,
  UsageMetric,
  UsageWorkspaceOption,
} from "../homeTypes";
import { useI18n } from "@/features/i18n/i18n";

type HomeProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
  latestAgentRuns: LatestAgentRun[];
  isLoadingLatestAgents: boolean;
  localUsageSnapshot: LocalUsageSnapshot | null;
  isLoadingLocalUsage: boolean;
  localUsageError: string | null;
  onRefreshLocalUsage: () => void;
  usageMetric: UsageMetric;
  onUsageMetricChange: (metric: UsageMetric) => void;
  usageWorkspaceId: string | null;
  usageWorkspaceOptions: UsageWorkspaceOption[];
  onUsageWorkspaceChange: (workspaceId: string | null) => void;
  accountRateLimits: RateLimitSnapshot | null;
  enterpriseAiUsage: EnterpriseAiUsageSnapshot | null;
  usageShowRemaining: boolean;
  accountInfo: AccountSnapshot | null;
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

export function Home({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
  latestAgentRuns,
  isLoadingLatestAgents,
  localUsageSnapshot,
  isLoadingLocalUsage,
  localUsageError,
  onRefreshLocalUsage,
  usageMetric,
  onUsageMetricChange,
  usageWorkspaceId,
  usageWorkspaceOptions,
  onUsageWorkspaceChange,
  accountRateLimits,
  enterpriseAiUsage,
  usageShowRemaining,
  accountInfo,
  onSelectThread,
}: HomeProps) {
  const { t } = useI18n();
  const journeySteps = [
    t("home.journey.stepLogin"),
    t("home.journey.stepProject"),
    t("home.journey.stepNeed"),
    t("home.journey.stepConfirm"),
  ];

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <div className="home-kicker">{t("home.kicker")}</div>
          <h1 className="home-title">{t("home.title")}</h1>
          <p className="home-subtitle">{t("home.subtitle")}</p>
        </div>
        <div className="home-journey-card" aria-label={t("home.journey.aria")}>
          <div className="home-journey-title">{t("home.journey.title")}</div>
          <div className="home-journey-list">
            {journeySteps.map((step, index) => (
              <div className="home-journey-step" key={step}>
                <span className="home-journey-index">{index + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-workbench">
        <div className="home-command-panel">
          <div className="home-command-header">
            <div>
              <div className="home-section-title">{t("home.command.title")}</div>
              <div className="home-command-subtitle">{t("home.command.subtitle")}</div>
            </div>
            <div className="home-command-badge">{t("home.command.badge")}</div>
          </div>
          <div className="home-command-surface">
            <div className="home-command-field-label">{t("home.command.fieldLabel")}</div>
            <div className="home-command-placeholder">{t("home.command.placeholder")}</div>
            <div className="home-command-safety" aria-label={t("home.guard.aria")}>
              <span className="home-guard-indicator" aria-hidden />
              <span>
                <strong>{t("home.guard.title")}</strong>
                {t("home.guard.copy")}
              </span>
            </div>
            <div className="home-command-steps" aria-label={t("home.command.stepsAria")}>
              <span>{t("home.command.stepProject")}</span>
              <span>{t("home.command.stepPlan")}</span>
              <span>{t("home.command.stepApply")}</span>
            </div>
          </div>
          <HomeActions
            onAddWorkspace={onAddWorkspace}
            onAddWorkspaceFromUrl={onAddWorkspaceFromUrl}
          />
        </div>
        <HomeLatestAgentsSection
          latestAgentRuns={latestAgentRuns}
          isLoadingLatestAgents={isLoadingLatestAgents}
          onSelectThread={onSelectThread}
        />
      </section>
      <HomeUsageSection
        accountInfo={accountInfo}
        accountRateLimits={accountRateLimits}
        enterpriseAiUsage={enterpriseAiUsage}
        isLoadingLocalUsage={isLoadingLocalUsage}
        localUsageError={localUsageError}
        localUsageSnapshot={localUsageSnapshot}
        onRefreshLocalUsage={onRefreshLocalUsage}
        onUsageMetricChange={onUsageMetricChange}
        onUsageWorkspaceChange={onUsageWorkspaceChange}
        usageMetric={usageMetric}
        usageShowRemaining={usageShowRemaining}
        usageWorkspaceId={usageWorkspaceId}
        usageWorkspaceOptions={usageWorkspaceOptions}
      />
    </div>
  );
}
