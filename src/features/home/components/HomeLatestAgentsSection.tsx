import { formatRelativeTime } from "../../../utils/time";
import type { LatestAgentRun } from "../homeTypes";

type HomeLatestAgentsSectionProps = {
  isLoadingLatestAgents: boolean;
  latestAgentRuns: LatestAgentRun[];
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

export function HomeLatestAgentsSection({
  isLoadingLatestAgents,
  latestAgentRuns,
  onSelectThread,
}: HomeLatestAgentsSectionProps) {
  return (
    <div className="home-latest">
      <div className="home-latest-header">
        <div className="home-latest-label">最近 AI 任务</div>
      </div>
      {latestAgentRuns.length > 0 ? (
        <div className="home-latest-grid">
          {latestAgentRuns.map((run) => (
            <button
              className="home-latest-card home-latest-card-button"
              key={run.threadId}
              onClick={() => onSelectThread(run.workspaceId, run.threadId)}
              type="button"
            >
              <div className="home-latest-card-header">
                <div className="home-latest-project">
                  <span className="home-latest-project-name">{run.projectName}</span>
                  {run.groupName && (
                    <span className="home-latest-group">{run.groupName}</span>
                  )}
                </div>
                <div className="home-latest-time">
                  {formatRelativeTime(run.timestamp)}
                </div>
              </div>
              <div className="home-latest-message">
                {run.message.trim() || "AI 已回复。"}
              </div>
              {run.isProcessing && (
                <div className="home-latest-status">处理中</div>
              )}
            </button>
          ))}
        </div>
      ) : isLoadingLatestAgents ? (
        <div className="home-latest-grid home-latest-grid-loading" aria-label="Loading agents">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="home-latest-card home-latest-card-skeleton" key={index}>
              <div className="home-latest-card-header">
                <span className="home-latest-skeleton home-latest-skeleton-title" />
                <span className="home-latest-skeleton home-latest-skeleton-time" />
              </div>
              <span className="home-latest-skeleton home-latest-skeleton-line" />
              <span className="home-latest-skeleton home-latest-skeleton-line short" />
            </div>
          ))}
        </div>
      ) : (
        <div className="home-latest-empty">
          <div className="home-latest-empty-title">还没有 AI 任务记录</div>
          <div className="home-latest-empty-subtitle">
            导入项目并描述需求后，最近处理记录会出现在这里。
          </div>
        </div>
      )}
    </div>
  );
}
