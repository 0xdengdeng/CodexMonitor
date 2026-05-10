import { useCallback, useMemo, useRef, useState } from "react";
import type {
  GitHubPullRequest,
  GitHubPullRequestComment,
  GitHubPullRequestDiff,
  PullRequestReviewAction,
  PullRequestReviewIntent,
  PullRequestSelectionRange,
  SendMessageResult,
  WorkspaceInfo,
} from "@/types";
import { useI18n } from "@/features/i18n/i18n";
import { pushErrorToast } from "@services/toasts";
import { buildPullRequestReviewPrompt } from "@utils/pullRequestReviewPrompt";

const REVIEW_ACTIONS: Array<Omit<PullRequestReviewAction, "label"> & { labelKey: string }> = [
  { id: "pr-review-full", labelKey: "git.prReview.full", intent: "full" },
  { id: "pr-review-risks", labelKey: "git.prReview.risks", intent: "risks" },
  { id: "pr-review-tests", labelKey: "git.prReview.tests", intent: "tests" },
  { id: "pr-review-summary", labelKey: "git.prReview.summary", intent: "summary" },
];

type UsePullRequestReviewActionsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  reviewDeliveryMode: "inline" | "detached";
  pullRequest: GitHubPullRequest | null;
  pullRequestDiffs: GitHubPullRequestDiff[];
  pullRequestComments: GitHubPullRequestComment[];
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
  ) => Promise<void | SendMessageResult>;
};

type RunPullRequestReviewOptions = {
  intent: PullRequestReviewIntent;
  question?: string;
  selection?: PullRequestSelectionRange | null;
  images?: string[];
  activateThread?: boolean;
};

export function usePullRequestReviewActions({
  activeWorkspace,
  activeThreadId,
  reviewDeliveryMode,
  pullRequest,
  pullRequestDiffs,
  pullRequestComments,
  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessageToThread,
}: UsePullRequestReviewActionsOptions) {
  const { t } = useI18n();
  const [isLaunchingReview, setIsLaunchingReview] = useState(false);
  const [lastReviewThreadId, setLastReviewThreadId] = useState<string | null>(null);
  const launchInFlightRef = useRef(false);

  const runPullRequestReview = useCallback(
    async ({
      intent,
      question,
      selection = null,
      images = [],
      activateThread = false,
    }: RunPullRequestReviewOptions): Promise<string | null> => {
      if (!activeWorkspace || !pullRequest) {
        return null;
      }
      if (launchInFlightRef.current) {
        return null;
      }

      launchInFlightRef.current = true;
      setIsLaunchingReview(true);
      try {
        if (!activeWorkspace.connected) {
          await connectWorkspace(activeWorkspace);
        }

        const reuseActiveThread =
          reviewDeliveryMode === "inline" && Boolean(activeThreadId);
        const reviewThreadId = reuseActiveThread
          ? activeThreadId
          : await startThreadForWorkspace(activeWorkspace.id, {
            activate: activateThread,
          });
        if (!reviewThreadId) {
          throw new Error(t("git.prReview.startThreadFailed"));
        }

        const prompt = buildPullRequestReviewPrompt({
          pullRequest,
          diffs: pullRequestDiffs,
          comments: pullRequestComments,
          intent,
          question,
          selection,
        });

        await sendUserMessageToThread(activeWorkspace, reviewThreadId, prompt, images);
        setLastReviewThreadId(reviewThreadId);
        return reviewThreadId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushErrorToast({
          title: t("git.prReview.failed"),
          message,
        });
        return null;
      } finally {
        launchInFlightRef.current = false;
        setIsLaunchingReview(false);
      }
    },
    [
      activeWorkspace,
      activeThreadId,
      connectWorkspace,
      pullRequest,
      pullRequestComments,
      pullRequestDiffs,
      reviewDeliveryMode,
      sendUserMessageToThread,
      startThreadForWorkspace,
      t,
    ],
  );

  const reviewActions = useMemo<PullRequestReviewAction[]>(
    () =>
      REVIEW_ACTIONS.map(({ labelKey, ...action }) => ({
        ...action,
        label: t(labelKey),
      })),
    [t],
  );

  return {
    isLaunchingReview,
    lastReviewThreadId,
    reviewActions,
    runPullRequestReview,
  };
}
