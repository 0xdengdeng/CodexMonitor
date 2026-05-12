import { useMemo } from "react";
import ListCollapse from "lucide-react/dist/esm/icons/list-collapse";
import Plus from "lucide-react/dist/esm/icons/plus";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search";

import { useI18n } from "@/features/i18n/i18n";
import type { ComposerQuickAction } from "@/features/composer/components/Composer";

type UseComposerQuickActionsOptions = {
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  startNewAgentDraft: (workspaceId: string) => void;
  startCompact: (text: string) => void | Promise<void>;
  openReviewPrompt: () => void;
};

export function useComposerQuickActions({
  activeWorkspaceId,
  activeThreadId,
  startNewAgentDraft,
  startCompact,
  openReviewPrompt,
}: UseComposerQuickActionsOptions): ComposerQuickAction[] {
  const { t } = useI18n();
  return useMemo(() => {
    if (!activeWorkspaceId || !activeThreadId) {
      return [];
    }
    return [
      {
        id: "quick-new",
        label: t("composer.quickAction.new"),
        title: t("composer.quickAction.newTitle"),
        icon: <Plus size={12} />,
        onSelect: () => startNewAgentDraft(activeWorkspaceId),
      },
      {
        id: "quick-compact",
        label: t("composer.quickAction.compact"),
        title: t("composer.quickAction.compactTitle"),
        icon: <ListCollapse size={12} />,
        onSelect: () => {
          void startCompact("");
        },
      },
      {
        id: "quick-review",
        label: t("composer.quickAction.review"),
        title: t("composer.quickAction.reviewTitle"),
        icon: <ScanSearch size={12} />,
        onSelect: () => openReviewPrompt(),
      },
    ];
  }, [
    activeThreadId,
    activeWorkspaceId,
    openReviewPrompt,
    startCompact,
    startNewAgentDraft,
    t,
  ]);
}
