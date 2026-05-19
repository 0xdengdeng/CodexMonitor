import { useCallback, useMemo, useState } from "react";
import type { WorkspaceInfo } from "../../../types";

type UseCapabilitiesDialogOptions = {
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
};

export function selectCapabilitiesRuntimeWorkspace(
  activeWorkspace: WorkspaceInfo | null,
  workspaces: WorkspaceInfo[],
) {
  return (
    activeWorkspace ??
    workspaces.find((workspace) => workspace.connected) ??
    workspaces[0] ??
    null
  );
}

export function useCapabilitiesDialog({
  activeWorkspace,
  workspaces,
  connectWorkspace,
}: UseCapabilitiesDialogOptions) {
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);

  const capabilitiesRuntimeWorkspace = useMemo(
    () => selectCapabilitiesRuntimeWorkspace(activeWorkspace, workspaces),
    [activeWorkspace, workspaces],
  );

  const openCapabilities = useCallback(async () => {
    const runtimeWorkspace = selectCapabilitiesRuntimeWorkspace(activeWorkspace, workspaces);
    try {
      if (runtimeWorkspace && !runtimeWorkspace.connected) {
        await connectWorkspace(runtimeWorkspace);
      }
    } catch {
      // Opening the management surface should not depend on a background
      // workspace connection succeeding; connectWorkspace already records diagnostics.
    } finally {
      setCapabilitiesOpen(true);
    }
  }, [activeWorkspace, connectWorkspace, workspaces]);

  const closeCapabilities = useCallback(() => {
    setCapabilitiesOpen(false);
  }, []);

  return {
    capabilitiesOpen,
    capabilitiesRuntimeWorkspace,
    openCapabilities,
    closeCapabilities,
  };
}
