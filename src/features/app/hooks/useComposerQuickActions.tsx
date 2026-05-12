import { useMemo } from "react";
import GitFork from "lucide-react/dist/esm/icons/git-fork";
import ListCollapse from "lucide-react/dist/esm/icons/list-collapse";
import Plus from "lucide-react/dist/esm/icons/plus";

import { useI18n } from "@/features/i18n/i18n";
import type { ComposerQuickAction } from "@/features/composer/components/Composer";

type UseComposerQuickActionsOptions = {
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  startNewAgentDraft: (workspaceId: string) => void;
  startCompact: (text: string) => void | Promise<void>;
  startFork: (text: string) => void | Promise<void>;
};

export function useComposerQuickActions({
  activeWorkspaceId,
  activeThreadId,
  startNewAgentDraft,
  startCompact,
  startFork,
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
        id: "quick-fork",
        label: t("composer.quickAction.fork"),
        title: t("composer.quickAction.forkTitle"),
        icon: <GitFork size={12} />,
        onSelect: () => {
          void startFork("");
        },
      },
    ];
  }, [
    activeThreadId,
    activeWorkspaceId,
    startCompact,
    startFork,
    startNewAgentDraft,
    t,
  ]);
}
