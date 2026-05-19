import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEntry, SkillOption, WorkspaceInfo } from "../../../types";
import { getSkillsList, setSkillEnabled as writeSkillEnabled } from "../../../services/tauri";
import { subscribeAppServerEvents } from "../../../services/events";
import { isSkillsUpdateAvailableEvent } from "../../../utils/appServerEvents";

type UseSkillsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  fallbackWorkspace?: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
};

function shouldWriteSkillConfigByPath(
  skill: SkillOption,
  activeWorkspace: WorkspaceInfo | null,
) {
  const scope = skill.scope?.toLowerCase();
  return Boolean(
    scope === "repo" ||
      (activeWorkspace && skill.path.startsWith(`${activeWorkspace.path}/.agents/skills`)),
  );
}

export function useSkills({
  activeWorkspace,
  fallbackWorkspace = null,
  onDebug,
}: UseSkillsOptions) {
  const [allSkills, setAllSkills] = useState<SkillOption[]>([]);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const catalogWorkspace = activeWorkspace ?? fallbackWorkspace;
  const workspaceId = catalogWorkspace?.id ?? null;
  const isConnected = Boolean(catalogWorkspace?.connected);

  const refreshSkills = useCallback(async () => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    onDebug?.({
      id: `${Date.now()}-client-skills-list`,
      timestamp: Date.now(),
      source: "client",
      label: "skills/list",
      payload: { workspaceId },
    });
    try {
      const response = await getSkillsList(workspaceId);
      onDebug?.({
        id: `${Date.now()}-server-skills-list`,
        timestamp: Date.now(),
        source: "server",
        label: "skills/list response",
        payload: response,
      });
      const dataBuckets = response.result?.data ?? response.data ?? [];
      const rawSkills =
        response.result?.skills ??
        response.skills ??
        (Array.isArray(dataBuckets)
          ? dataBuckets.flatMap((bucket: any) => bucket?.skills ?? [])
          : []);
      const data: SkillOption[] = rawSkills.map((item: any) => ({
        name: String(item.name ?? ""),
        path: String(item.path ?? ""),
        description: item.description ? String(item.description) : undefined,
        scope: item.scope ? String(item.scope) : undefined,
        enabled: item.enabled !== false,
        effectiveEnabled: item.effectiveEnabled ?? item.enabled ?? true,
        sourcePath: item.sourcePath ? String(item.sourcePath) : undefined,
      }));
      setAllSkills(data);
      lastFetchedWorkspaceId.current = workspaceId;
    } catch (error) {
      onDebug?.({
        id: `${Date.now()}-client-skills-list-error`,
        timestamp: Date.now(),
        source: "error",
        label: "skills/list error",
        payload: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight.current = false;
    }
  }, [isConnected, onDebug, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && allSkills.length > 0) {
      return;
    }
    refreshSkills();
  }, [allSkills.length, isConnected, refreshSkills, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      return;
    }

    return subscribeAppServerEvents((event) => {
      if (event.workspace_id !== workspaceId) {
        return;
      }
      if (!isSkillsUpdateAvailableEvent(event)) {
        return;
      }

      onDebug?.({
        id: `${Date.now()}-server-skills-update-available`,
        timestamp: Date.now(),
        source: "server",
        label: "skills/update available",
        payload: event,
      });
      void refreshSkills();
    });
  }, [isConnected, onDebug, refreshSkills, workspaceId]);

  const skillOptions = useMemo(
    () => allSkills.filter((skill) => skill.name && skill.enabled !== false),
    [allSkills],
  );

  const manageableSkills = useMemo(
    () => allSkills.filter((skill) => skill.name),
    [allSkills],
  );

  const setSkillEnabled = useCallback(
    async (skill: SkillOption, enabled: boolean) => {
      if (!workspaceId || !isConnected) {
        return;
      }
      const writeByPath = shouldWriteSkillConfigByPath(skill, activeWorkspace) || !skill.name;
      await writeSkillEnabled(workspaceId, {
        path: writeByPath ? skill.path : null,
        name: writeByPath ? null : skill.name,
        enabled,
      });
      await refreshSkills();
    },
    [activeWorkspace, isConnected, refreshSkills, workspaceId],
  );

  return {
    skills: skillOptions,
    allSkills: manageableSkills,
    refreshSkills,
    setSkillEnabled,
  };
}
