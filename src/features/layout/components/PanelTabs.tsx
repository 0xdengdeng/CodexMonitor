import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "@/features/i18n/i18n";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";

export type PanelTabId = "plan" | "git" | "files" | "prompts";

type PanelTab = {
  id: PanelTabId;
  label: string;
  icon: ReactNode;
};

type PanelTabsProps = {
  active: PanelTabId;
  onSelect: (id: PanelTabId) => void;
  tabs?: PanelTab[];
};

export function PanelTabs({ active, onSelect, tabs }: PanelTabsProps) {
  const { t } = useI18n();
  const localizedTabs = useMemo<PanelTab[]>(
    () =>
      tabs ?? [
        { id: "plan", label: t("panelTabs.plan"), icon: <ListChecks aria-hidden /> },
        { id: "git", label: t("panelTabs.git"), icon: <GitBranch aria-hidden /> },
        { id: "files", label: t("panelTabs.files"), icon: <Folder aria-hidden /> },
        { id: "prompts", label: t("panelTabs.prompts"), icon: <ScrollText aria-hidden /> },
      ],
    [tabs, t],
  );
  tabs = localizedTabs;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const focusableIndex = activeIndex >= 0 ? activeIndex : 0;

  const selectByIndex = (index: number, options?: { focus?: boolean }) => {
    if (tabs.length === 0) {
      return;
    }
    const normalized = (index + tabs.length) % tabs.length;
    onSelect(tabs[normalized].id);
    if (options?.focus) {
      tabRefs.current[normalized]?.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length <= 1) {
      return;
    }
    const currentIndex = activeIndex >= 0 ? activeIndex : index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectByIndex(currentIndex + 1, { focus: true });
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectByIndex(currentIndex - 1, { focus: true });
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectByIndex(0, { focus: true });
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      selectByIndex(tabs.length - 1, { focus: true });
    }
  };

  return (
    <div className="panel-tabs" role="tablist" aria-label={t("panelTabs.panel")} aria-orientation="horizontal">
      {tabs.map((tab, index) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`panel-tab${isActive ? " is-active" : ""}`}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            aria-selected={isActive}
            tabIndex={index === focusableIndex ? 0 : -1}
            aria-label={tab.label}
            title={tab.label}
          >
            <span className="panel-tab-icon" aria-hidden>
              {tab.icon}
            </span>
            <span className="panel-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
