import { useMemo, useState } from "react";
import Info from "lucide-react/dist/esm/icons/info";
import Layers from "lucide-react/dist/esm/icons/layers";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import Server from "lucide-react/dist/esm/icons/server";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Store from "lucide-react/dist/esm/icons/store";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import X from "lucide-react/dist/esm/icons/x";
import type {
  McpServerOption,
  SkillMarketInstallInput,
  SkillMarketItem,
  SkillOption,
  WorkspaceInfo,
} from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import {
  PanelNavItem,
  PanelNavList,
} from "@/features/design-system/components/panel/PanelPrimitives";
import { useI18n } from "@/features/i18n/i18n";
import { SkillMarketDialog } from "./SkillMarketDialog";

type CapabilityScope = "project" | "global";

export type CapabilitiesViewProps = {
  activeWorkspace: WorkspaceInfo | null;
  skills: SkillOption[];
  mcpServers: McpServerOption[];
  onClose: () => void;
  onRefreshCapabilities: () => Promise<void> | void;
  onRefreshSkillMarket?: () => Promise<void> | void;
  onSetSkillEnabled: (skill: SkillOption, enabled: boolean) => Promise<void> | void;
  onSetMcpServerEnabled: (
    server: McpServerOption,
    enabled: boolean,
  ) => Promise<void> | void;
  skillMarketItems?: SkillMarketItem[];
  onInstallSkill?: (input: SkillMarketInstallInput) => Promise<void> | void;
  onUninstallSkill?: (skill: SkillOption) => Promise<void> | void;
};

function skillId(skill: SkillOption) {
  return skill.path || skill.name;
}

function mcpServerId(server: McpServerOption) {
  return server.sourcePath ? `${server.sourcePath}:${server.name}` : server.name;
}

function isProjectSkill(skill: SkillOption, workspace: WorkspaceInfo | null) {
  if (skill.scope === "repo") {
    return true;
  }
  return Boolean(workspace && skill.path.startsWith(`${workspace.path}/.agents/skills`));
}

function isProjectMcpServer(server: McpServerOption) {
  return server.scope === "project";
}

function normalizedPath(path: string) {
  return path.replace(/\\/g, "/");
}

function isManagedCodexHomeSkillPath(path: string) {
  return normalizedPath(path).includes("/codex-home/skills/");
}

function skillScopeLabel(
  skill: SkillOption,
  workspace: WorkspaceInfo | null,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (isProjectSkill(skill, workspace)) {
    return t("capabilities.source.project");
  }
  if (skill.scope === "system" || skill.path.includes("/.system/")) {
    return t("capabilities.source.system");
  }
  return t("capabilities.source.global");
}

function localizedMessage(t: ReturnType<typeof useI18n>["t"], key: string) {
  const message = t(key);
  return message === key ? null : message;
}

function shouldUseLocalizedSkillDescription(skill: SkillOption) {
  return (
    skill.scope === "system" ||
    skill.path.includes("/.system/") ||
    skill.path.includes("/.codex/plugins/cache/")
  );
}

function canUninstallSkill(skill: SkillOption, workspace: WorkspaceInfo | null) {
  const scope = skill.scope?.toLowerCase();
  const path = normalizedPath(skill.path);
  if (scope === "system" || scope === "admin") {
    return false;
  }
  if (path.includes("/.system/") || path.includes("/.codex/plugins/cache/")) {
    return false;
  }
  if (typeof skill.uninstallable === "boolean") {
    return skill.uninstallable;
  }
  return Boolean(
    isProjectSkill(skill, workspace) ||
      skill.marketId ||
      skill.installedVersion ||
      skill.marketSourcePath ||
      isManagedCodexHomeSkillPath(skill.path),
  );
}

function skillDescription(skill: SkillOption, t: ReturnType<typeof useI18n>["t"]) {
  if (shouldUseLocalizedSkillDescription(skill)) {
    const localized = localizedMessage(t, `capabilities.skillDescription.${skill.name}`);
    if (localized) {
      return localized;
    }
  }
  return skill.description ?? t("capabilities.noDescription");
}

function mcpScopeLabel(server: McpServerOption, t: ReturnType<typeof useI18n>["t"]) {
  if (server.scope === "project") {
    return t("capabilities.source.project");
  }
  if (server.scope === "system") {
    return t("capabilities.source.system");
  }
  if (server.scope === "managed") {
    return t("capabilities.source.managed");
  }
  if (server.scope === "runtime") {
    return t("capabilities.source.runtime");
  }
  return t("capabilities.source.global");
}

function mcpAuthStatusLabel(status: string, t: ReturnType<typeof useI18n>["t"]) {
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return localizedMessage(t, `capabilities.mcp.authStatusValue.${normalized}`) ?? status;
}

function mcpInventoryLabel(server: McpServerOption, t: ReturnType<typeof useI18n>["t"]) {
  const parts = [
    t("capabilities.mcp.toolsCount", { count: server.toolsCount }),
    t("capabilities.mcp.resourcesCount", { count: server.resourcesCount }),
  ];
  if (server.resourceTemplatesCount > 0) {
    parts.push(
      t("capabilities.mcp.templatesCount", { count: server.resourceTemplatesCount }),
    );
  }
  if (server.authStatus) {
    parts.push(
      t("capabilities.mcp.authStatus", {
        status: mcpAuthStatusLabel(server.authStatus, t),
      }),
    );
  }
  return parts.join(" · ");
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function CapabilitiesView({
  activeWorkspace,
  skills,
  mcpServers,
  onClose,
  onRefreshCapabilities,
  onRefreshSkillMarket,
  onSetSkillEnabled,
  onSetMcpServerEnabled,
  skillMarketItems = [],
  onInstallSkill,
  onUninstallSkill,
}: CapabilitiesViewProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<CapabilityScope>(
    activeWorkspace ? "project" : "global",
  );
  const [query, setQuery] = useState("");
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);
  const [pendingUninstallSkillId, setPendingUninstallSkillId] = useState<string | null>(
    null,
  );
  const [pendingUninstallConfirmSkillId, setPendingUninstallConfirmSkillId] = useState<
    string | null
  >(null);
  const [pendingMcpServerId, setPendingMcpServerId] = useState<string | null>(null);
  const [skillSessionNoticeVisible, setSkillSessionNoticeVisible] = useState(false);
  const [skillActionError, setSkillActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [skillMarketOpen, setSkillMarketOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();

  const projectSkillCount = useMemo(
    () => skills.filter((skill) => isProjectSkill(skill, activeWorkspace)).length,
    [activeWorkspace, skills],
  );
  const globalSkillCount = skills.length - projectSkillCount;
  const projectMcpCount = useMemo(
    () => mcpServers.filter(isProjectMcpServer).length,
    [mcpServers],
  );
  const globalMcpCount = mcpServers.length - projectMcpCount;

  const scopedSkills = useMemo(() => {
    const candidates =
      scope === "project"
        ? skills.filter((skill) => isProjectSkill(skill, activeWorkspace))
        : skills.filter((skill) => !isProjectSkill(skill, activeWorkspace));
    if (!normalizedQuery) {
      return candidates;
    }
    return candidates.filter((skill) => {
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.path}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [activeWorkspace, normalizedQuery, scope, skills]);

  const scopedMcpServers = useMemo(() => {
    const candidates =
      scope === "project"
        ? mcpServers.filter(isProjectMcpServer)
        : mcpServers.filter((server) => !isProjectMcpServer(server));
    if (!normalizedQuery) {
      return candidates;
    }
    return candidates.filter((server) => {
      const haystack = `${server.name} ${server.authStatus ?? ""} ${
        server.sourcePath ?? ""
      }`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [mcpServers, normalizedQuery, scope]);

  const activeScopeDescription =
    scope === "project" && activeWorkspace
      ? t("capabilities.scopeDescription.project", { name: activeWorkspace.name })
      : t("capabilities.scopeDescription.global");
  const searchPlaceholder =
    scope === "project" && activeWorkspace
      ? t("capabilities.search.project")
      : t("capabilities.search.global");
  const disabledCount =
    scopedSkills.filter((skill) => skill.enabled === false).length +
    scopedMcpServers.filter((server) => server.enabled === false).length;
  const handleToggleSkill = async (skill: SkillOption) => {
    const id = skillId(skill);
    const enabled = skill.enabled !== false;
    setPendingSkillId(id);
    setSkillActionError(null);
    try {
      await onSetSkillEnabled(skill, !enabled);
      setSkillSessionNoticeVisible(true);
    } catch (error) {
      setSkillSessionNoticeVisible(false);
      setSkillActionError(errorMessage(error));
    } finally {
      setPendingSkillId((current) => (current === id ? null : current));
    }
  };
  const handleInstallSkill = async (input: SkillMarketInstallInput) => {
    setSkillActionError(null);
    try {
      await onInstallSkill?.(input);
      setSkillSessionNoticeVisible(true);
    } catch (error) {
      setSkillSessionNoticeVisible(false);
      setSkillActionError(errorMessage(error));
    }
  };
  const handleUninstallSkill = async (skill: SkillOption) => {
    const id = skillId(skill);
    setPendingUninstallSkillId(id);
    setSkillActionError(null);
    try {
      await onUninstallSkill?.(skill);
      setSkillSessionNoticeVisible(true);
      setPendingUninstallConfirmSkillId(null);
    } catch (error) {
      setSkillSessionNoticeVisible(false);
      setSkillActionError(errorMessage(error));
    } finally {
      setPendingUninstallSkillId((current) => (current === id ? null : current));
    }
  };
  const handleRequestUninstallSkill = (skill: SkillOption) => {
    setSkillActionError(null);
    setPendingUninstallConfirmSkillId(skillId(skill));
  };
  const handleCancelUninstallSkill = (skill: SkillOption) => {
    setPendingUninstallConfirmSkillId((current) =>
      current === skillId(skill) ? null : current,
    );
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([onRefreshCapabilities(), onRefreshSkillMarket?.()]);
    } finally {
      setRefreshing(false);
    }
  };
  const handleOpenSkillMarket = async () => {
    setSkillMarketOpen(true);
    await onRefreshSkillMarket?.();
  };
  const handleToggleMcpServer = async (server: McpServerOption) => {
    const id = mcpServerId(server);
    const enabled = server.enabled !== false;
    setPendingMcpServerId(id);
    try {
      await onSetMcpServerEnabled(server, !enabled);
    } finally {
      setPendingMcpServerId((current) => (current === id ? null : current));
    }
  };

  return (
    <>
      <ModalShell
        className="settings-overlay capabilities-overlay"
        cardClassName="settings-window capabilities-window"
        onBackdropClick={onClose}
        ariaLabelledBy="capabilities-title"
      >
        <div
          className="settings-titlebar capabilities-titlebar"
          data-update-guide-target="settings.capabilities"
        >
          <div className="settings-title" id="capabilities-title">
            {t("capabilities.title")}
          </div>
          <div className="capabilities-titlebar-actions">
            <button
              type="button"
              className="ghost icon-button"
              onClick={() => void handleOpenSkillMarket()}
              aria-label={t("capabilities.market.open")}
              title={t("capabilities.market.open")}
            >
              <Store aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              aria-label={t("capabilities.refresh")}
            >
              <RefreshCw
                className={refreshing ? "capabilities-refresh-icon spinning" : undefined}
                aria-hidden
              />
            </button>
            <button
              type="button"
              className="ghost icon-button settings-close"
              onClick={onClose}
              aria-label={t("capabilities.close")}
            >
              <X aria-hidden />
            </button>
          </div>
        </div>

        <div className="settings-body capabilities-body">
          <div className="settings-master capabilities-master">
            <aside className="settings-sidebar capabilities-sidebar">
              <PanelNavList className="settings-nav-list capabilities-nav-list">
                <PanelNavItem
                  className="settings-nav capabilities-nav-item"
                  icon={<Layers aria-hidden />}
                  active={scope === "project"}
                  onClick={() => setScope("project")}
                  disabled={!activeWorkspace}
                  aria-label={t("capabilities.currentProject")}
                >
                  <span>{t("capabilities.currentProject")}</span>
                  <strong>{projectSkillCount + projectMcpCount}</strong>
                </PanelNavItem>
                <PanelNavItem
                  className="settings-nav capabilities-nav-item"
                  icon={<Sparkles aria-hidden />}
                  active={scope === "global"}
                  onClick={() => setScope("global")}
                  aria-label={t("capabilities.global")}
                >
                  <span>{t("capabilities.global")}</span>
                  <strong>{globalSkillCount + globalMcpCount}</strong>
                </PanelNavItem>
              </PanelNavList>

              <div className="capabilities-overview" aria-label={t("capabilities.summary")}>
                <div>
                  <span>{t("capabilities.summary.skills")}</span>
                  <strong>{scopedSkills.length}</strong>
                </div>
                <div>
                  <span>{t("capabilities.summary.mcp")}</span>
                  <strong>{scopedMcpServers.length}</strong>
                </div>
                <div>
                  <span>{t("capabilities.summary.disabled")}</span>
                  <strong>{disabledCount}</strong>
                </div>
              </div>
            </aside>
          </div>

          <div className="settings-detail capabilities-detail">
            <main className="settings-content capabilities-main">
              <div className="capabilities-heading-row">
                <div>
                  <h2 className="settings-section-title capabilities-heading">
                    {t("capabilities.skills")}
                  </h2>
                  <p className="settings-section-subtitle capabilities-subtitle">
                    {activeScopeDescription}
                  </p>
                </div>
              </div>

              <label className="capabilities-search">
                <Search aria-hidden />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                />
              </label>

              {skillActionError ? (
                <div className="capabilities-session-note is-error" role="alert">
                  <Info aria-hidden />
                  <span>
                    {t("capabilities.skillActionError", { message: skillActionError })}
                  </span>
                </div>
              ) : skillSessionNoticeVisible ? (
                <div className="capabilities-session-note" role="status">
                  <Info aria-hidden />
                  <span>{t("capabilities.skillSessionNotice")}</span>
                </div>
              ) : null}

              <section className="capabilities-section">
                <div className="capabilities-section-head">
                  <span>{t("capabilities.items", { count: scopedSkills.length })}</span>
                </div>
                <div className="capabilities-list">
                  {scopedSkills.length > 0 ? (
                    scopedSkills.map((skill) => {
                      const isConfirmingUninstall =
                        pendingUninstallConfirmSkillId === skillId(skill);
                      const isUninstalling = pendingUninstallSkillId === skillId(skill);
                      return (
                      <article
                        key={`${skill.name}:${skill.path}`}
                        className={`capability-row${skill.enabled === false ? " is-disabled" : ""}`}
                      >
                        <div className="capability-row-main">
                          <div className="capability-row-title">
                            <strong>{skill.name}</strong>
                            <span className="capability-source">
                              {skillScopeLabel(skill, activeWorkspace, t)}
                            </span>
                            {skill.installedVersion ? (
                              <span className="capability-source">
                                v{skill.installedVersion}
                              </span>
                            ) : null}
                          </div>
                          <p>{skillDescription(skill, t)}</p>
                          <code>{skill.path}</code>
                        </div>
                        <div className="capability-row-control">
                          <span>
                            {skill.enabled === false
                              ? t("capabilities.status.disabled")
                              : t("capabilities.status.enabled")}
                          </span>
                          <button
                            type="button"
                            className={`capability-switch${skill.enabled === false ? "" : " is-on"}`}
                            aria-pressed={skill.enabled === false ? "false" : "true"}
                            aria-label={
                              skill.enabled === false
                                ? t("capabilities.disabledLabel", { name: skill.name })
                                : t("capabilities.enabledLabel", { name: skill.name })
                            }
                            onClick={() => void handleToggleSkill(skill)}
                            disabled={pendingSkillId === skillId(skill)}
                          >
                            <span />
                          </button>
                          {onUninstallSkill && canUninstallSkill(skill, activeWorkspace) ? (
                            <button
                              type="button"
                              className="ghost icon-button capability-row-action"
                              onClick={() => handleRequestUninstallSkill(skill)}
                              disabled={isUninstalling}
                              aria-label={t("capabilities.uninstallSkill", {
                                name: skill.name,
                              })}
                              title={t("capabilities.uninstallSkill", { name: skill.name })}
                            >
                              <Trash2 aria-hidden />
                            </button>
                          ) : null}
                        </div>
                        {isConfirmingUninstall ? (
                          <div className="capability-uninstall-confirm">
                            <div>
                              <strong>
                                {t("capabilities.uninstallConfirmTitle", {
                                  name: skill.name,
                                })}
                              </strong>
                              <span>{t("capabilities.uninstallConfirmDetail")}</span>
                            </div>
                            <div className="capability-uninstall-confirm-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => handleCancelUninstallSkill(skill)}
                                disabled={isUninstalling}
                                aria-label={t("capabilities.cancelUninstallSkill", {
                                  name: skill.name,
                                })}
                              >
                                {t("settings.common.cancel")}
                              </button>
                              <button
                                type="button"
                                className="ghost capability-uninstall-confirm-danger"
                                onClick={() => void handleUninstallSkill(skill)}
                                disabled={isUninstalling}
                                aria-label={t("capabilities.confirmUninstallSkill", {
                                  name: skill.name,
                                })}
                              >
                                {isUninstalling
                                  ? t("capabilities.uninstalling")
                                  : t("capabilities.uninstallConfirmAction")}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                      );
                    })
                  ) : (
                    <div className="capabilities-empty">{t("capabilities.noSkills")}</div>
                  )}
                </div>
              </section>

              <section className="capabilities-section capabilities-mcp-section">
                <div className="capabilities-section-head">
                  <h3>{t("capabilities.mcp")}</h3>
                  <span>{t("capabilities.items", { count: scopedMcpServers.length })}</span>
                </div>
                <div className="capabilities-list">
                  {scopedMcpServers.length > 0 ? (
                    scopedMcpServers.map((server) => (
                      <article
                        key={`${server.name}:${server.sourcePath ?? server.scope ?? "runtime"}`}
                        className={`capability-row${
                          server.enabled === false ? " is-disabled" : ""
                        }`}
                      >
                        <div className="capability-row-main">
                          <div className="capability-row-title">
                            <strong>{server.name}</strong>
                            <span className="capability-source">
                              {mcpScopeLabel(server, t)}
                            </span>
                          </div>
                          <p>{mcpInventoryLabel(server, t)}</p>
                          {server.sourcePath ? <code>{server.sourcePath}</code> : null}
                        </div>
                        <div className="capability-row-control">
                          <span>
                            {server.enabled === false
                              ? t("capabilities.status.disabled")
                              : t("capabilities.status.enabled")}
                          </span>
                          <button
                            type="button"
                            className={`capability-switch${
                              server.enabled === false ? "" : " is-on"
                            }`}
                            aria-pressed={server.enabled === false ? "false" : "true"}
                            aria-label={
                              server.enabled === false
                                ? t("capabilities.mcpDisabledLabel", { name: server.name })
                                : t("capabilities.mcpEnabledLabel", { name: server.name })
                            }
                            onClick={() => void handleToggleMcpServer(server)}
                            disabled={
                              !server.configurable || pendingMcpServerId === mcpServerId(server)
                            }
                          >
                            <span />
                          </button>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="capabilities-empty capabilities-empty-mcp">
                      <Server aria-hidden />
                      <span>{t("capabilities.mcpEmpty")}</span>
                    </div>
                  )}
                </div>
              </section>
            </main>
          </div>
        </div>
      </ModalShell>
      {skillMarketOpen ? (
        <SkillMarketDialog
          activeWorkspace={activeWorkspace}
          items={skillMarketItems}
          installedSkills={skills}
          onClose={() => setSkillMarketOpen(false)}
          onInstallSkill={handleInstallSkill}
        />
      ) : null}
    </>
  );
}
