import { SettingsCodexSection } from "./SettingsCodexSection";
import { SettingsProjectsSection } from "./SettingsProjectsSection";
import { SettingsAboutSection } from "./SettingsAboutSection";
import { SettingsGitSection } from "./SettingsGitSection";
import { SettingsServerSection } from "./SettingsServerSection";
import { SettingsDeploySection } from "./SettingsDeploySection";
import type { CodexSection } from "@settings/components/settingsTypes";
import type { SettingsViewOrchestration } from "@settings/hooks/useSettingsViewOrchestration";

type SettingsSectionContainersProps = {
  activeSection: CodexSection;
  orchestration: SettingsViewOrchestration;
};

export function SettingsSectionContainers({
  activeSection,
  orchestration,
}: SettingsSectionContainersProps) {
  if (activeSection === "ai") {
    return <SettingsCodexSection {...orchestration.codexSectionProps} />;
  }
  if (activeSection === "projects") {
    return <SettingsProjectsSection {...orchestration.projectsSectionProps} />;
  }
  if (activeSection === "version") {
    return <SettingsGitSection {...orchestration.gitSectionProps} />;
  }
  if (activeSection === "about") {
    return <SettingsAboutSection {...orchestration.aboutSectionProps} />;
  }
  if (activeSection === "advanced") {
    return <SettingsServerSection {...orchestration.serverSectionProps} />;
  }
  if (activeSection === "deploy") {
    return <SettingsDeploySection {...orchestration.deploySectionProps} />;
  }
  return null;
}
