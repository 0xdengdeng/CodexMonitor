import type { ReactNode } from "react";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import MessagesSquare from "lucide-react/dist/esm/icons/messages-square";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import { useI18n } from "@/features/i18n/i18n";

type TabletNavTab = "codex" | "git" | "log";

type TabletNavProps = {
  activeTab: TabletNavTab;
  onSelect: (tab: TabletNavTab) => void;
};

const tabs: { id: TabletNavTab; labelKey: string; icon: ReactNode }[] = [
  { id: "codex", labelKey: "nav.codex", icon: <MessagesSquare className="tablet-nav-icon" /> },
  { id: "git", labelKey: "nav.git", icon: <GitBranch className="tablet-nav-icon" /> },
  { id: "log", labelKey: "nav.log", icon: <TerminalSquare className="tablet-nav-icon" /> },
];

export function TabletNav({ activeTab, onSelect }: TabletNavProps) {
  const { t } = useI18n();
  return (
    <nav className="tablet-nav" aria-label={t("nav.workspace")}>
      <div className="tablet-nav-group">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tablet-nav-item ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => onSelect(tab.id)}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            {tab.icon}
            <span className="tablet-nav-label">{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
