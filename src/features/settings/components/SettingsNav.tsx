import Bot from "lucide-react/dist/esm/icons/bot";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import Info from "lucide-react/dist/esm/icons/info";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import { PanelNavItem, PanelNavList } from "@/features/design-system/components/panel/PanelPrimitives";
import { useI18n } from "@/features/i18n/i18n";
import type { CodexSection } from "./settingsTypes";

type SettingsNavProps = {
  activeSection: CodexSection;
  onSelectSection: (section: CodexSection) => void;
  showDisclosure?: boolean;
};

export function SettingsNav({
  activeSection,
  onSelectSection,
  showDisclosure = false,
}: SettingsNavProps) {
  const { t } = useI18n();
  return (
    <aside className="settings-sidebar">
      <PanelNavList className="settings-nav-list">
        <PanelNavItem
          className="settings-nav"
          icon={<Bot aria-hidden />}
          active={activeSection === "ai"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("ai")}
        >
          {t("settings.nav.ai")}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<LayoutGrid aria-hidden />}
          active={activeSection === "projects"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("projects")}
        >
          {t("settings.nav.projects")}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<Info aria-hidden />}
          active={activeSection === "about"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("about")}
        >
          {t("settings.nav.about")}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<SlidersHorizontal aria-hidden />}
          active={activeSection === "advanced"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("advanced")}
        >
          {t("settings.nav.advanced")}
        </PanelNavItem>
      </PanelNavList>
    </aside>
  );
}
