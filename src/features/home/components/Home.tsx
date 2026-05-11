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

  return (
    <div className="home">
      <header className="home-top">
        <h1 className="home-top-title">{t("home.myProjects")}</h1>
        <HomeActions
          onAddWorkspace={onAddWorkspace}
          onAddWorkspaceFromUrl={onAddWorkspaceFromUrl}
        />
      </header>
      <HomeLatestAgentsSection
        latestAgentRuns={latestAgentRuns}
        isLoadingLatestAgents={isLoadingLatestAgents}
        onSelectThread={onSelectThread}
      />
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
