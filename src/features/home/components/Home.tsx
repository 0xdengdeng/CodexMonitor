import type {
  AccountSnapshot,
  LocalUsageSnapshot,
  RateLimitSnapshot,
} from "../../../types";
import { HomeActions } from "./HomeActions";
import { HomeLatestAgentsSection } from "./HomeLatestAgentsSection";
import { HomeUsageSection } from "./HomeUsageSection";
import { PRODUCT_NAME } from "@/config/brand";
import type {
  LatestAgentRun,
  UsageMetric,
  UsageWorkspaceOption,
} from "../homeTypes";

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
  usageShowRemaining,
  accountInfo,
  onSelectThread,
}: HomeProps) {
  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-kicker">{PRODUCT_NAME}</div>
        <div className="home-title">今天想让 AI 帮你开发什么？</div>
        <div className="home-subtitle">
          从需求、修复、代码审查开始，系统会帮你拆解任务，并在确认后修改项目。
        </div>
        <div className="home-quick-start" aria-label="快速开始">
          <button
            className="home-start-card home-start-card-primary"
            type="button"
            onClick={onAddWorkspace}
          >
            <span className="home-start-step">1</span>
            <span>
              <strong>新建任务</strong>
              <small>选择本地项目，描述你想完成的开发目标。</small>
            </span>
          </button>
          <button
            className="home-start-card"
            type="button"
            onClick={onAddWorkspaceFromUrl}
          >
            <span className="home-start-step">2</span>
            <span>
              <strong>导入项目</strong>
              <small>从 Git 地址拉取项目，交给 AI 处理。</small>
            </span>
          </button>
          <div className="home-start-card home-start-card-static">
            <span className="home-start-step">3</span>
            <span>
              <strong>确认修改</strong>
              <small>AI 会展示变更，你确认后再应用。</small>
            </span>
          </div>
        </div>
      </div>
      <HomeLatestAgentsSection
        latestAgentRuns={latestAgentRuns}
        isLoadingLatestAgents={isLoadingLatestAgents}
        onSelectThread={onSelectThread}
      />
      <HomeActions
        onAddWorkspace={onAddWorkspace}
        onAddWorkspaceFromUrl={onAddWorkspaceFromUrl}
      />
      <HomeUsageSection
        accountInfo={accountInfo}
        accountRateLimits={accountRateLimits}
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
