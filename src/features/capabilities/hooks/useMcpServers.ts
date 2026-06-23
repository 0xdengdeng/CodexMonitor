import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpServerOption, WorkspaceInfo } from "../../../types";
import {
  listMcpServerStatus,
  readCodexConfig,
  setMcpServerEnabled as writeMcpServerEnabled,
} from "../../../services/tauri";

type UseMcpServersOptions = {
  activeWorkspace: WorkspaceInfo | null;
  fallbackWorkspace?: WorkspaceInfo | null;
};

function unwrapResult(response: any) {
  return response?.result ?? response ?? {};
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function authStatusLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.status === "string" && record.status.trim()) {
      return record.status;
    }
    if (typeof record.type === "string" && record.type.trim()) {
      return record.type;
    }
  }
  return undefined;
}

function sourcePathForOrigin(originName: Record<string, any>) {
  if (typeof originName.file === "string") {
    return originName.file;
  }
  if (typeof originName.dotCodexFolder === "string") {
    return `${originName.dotCodexFolder.replace(/\/$/, "")}/config.toml`;
  }
  return undefined;
}

function scopeForOrigin(originName: Record<string, any>): McpServerOption["scope"] {
  switch (originName.type) {
    case "project":
      return "project";
    case "user":
      return "global";
    case "system":
      return "system";
    case "mdm":
    case "legacyManagedConfigTomlFromFile":
    case "legacyManagedConfigTomlFromMdm":
      return "managed";
    default:
      return "runtime";
  }
}

function configEntryForServer(config: Record<string, any>, name: string) {
  return objectRecord(objectRecord(config.mcp_servers)[name]);
}

function originForServer(origins: Record<string, any>, name: string) {
  const nestedOriginKey = Object.keys(origins).find((key) =>
    key.startsWith(`mcp_servers.${name}.`),
  );
  return objectRecord(
    origins[`mcp_servers.${name}`] ??
      origins[`mcp_servers.${name}.enabled`] ??
      (nestedOriginKey ? origins[nestedOriginKey] : undefined),
  );
}

function normalizeMcpServers(
  statusResponse: any,
  configResponse: any,
): McpServerOption[] {
  const statusResult = unwrapResult(statusResponse);
  const configResult = unwrapResult(configResponse);
  const data: any[] = Array.isArray(statusResult.data) ? statusResult.data : [];
  const config = objectRecord(configResult.config);
  const origins = objectRecord(configResult.origins);

  return data
    .map((server: any): McpServerOption | null => {
      const name = String(server?.name ?? "").trim();
      if (!name) {
        return null;
      }
      // Hide the AgentDesk-managed built-in browser MCP. Its server key is "playwright"
      // (Rust: browser_mcp_core::MANAGED_BROWSER_MCP_SERVER_NAME). It is surfaced as the
      // first-class "Browser" capability toggle in Settings, never as a user-editable server.
      if (name === "playwright") {
        return null;
      }
      const configEntry = configEntryForServer(config, name);
      const origin = originForServer(origins, name);
      const originName = objectRecord(origin.name);
      const scope = scopeForOrigin(originName);
      const sourcePath = sourcePathForOrigin(originName);
      const tools = objectRecord(server?.tools);
      const resources = Array.isArray(server?.resources) ? server.resources : [];
      const resourceTemplates = Array.isArray(server?.resourceTemplates)
        ? server.resourceTemplates
        : Array.isArray(server?.resource_templates)
          ? server.resource_templates
          : [];
      const authStatus = authStatusLabel(server?.authStatus ?? server?.auth_status);
      const hasConfigEntry = Object.keys(configEntry).length > 0;

      return {
        name,
        scope,
        enabled: configEntry.enabled !== false,
        configurable:
          hasConfigEntry && Boolean(sourcePath) && (scope === "global" || scope === "project"),
        sourcePath,
        toolsCount: Object.keys(tools).length,
        resourcesCount: resources.length,
        resourceTemplatesCount: resourceTemplates.length,
        authStatus,
      };
    })
    .filter((server): server is McpServerOption => Boolean(server));
}

export function useMcpServers({
  activeWorkspace,
  fallbackWorkspace = null,
}: UseMcpServersOptions) {
  const [mcpServers, setMcpServers] = useState<McpServerOption[]>([]);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const catalogWorkspace = activeWorkspace ?? fallbackWorkspace;
  const workspaceId = catalogWorkspace?.id ?? null;
  const isConnected = Boolean(catalogWorkspace?.connected);

  const refreshMcpServers = useCallback(async () => {
    if (!workspaceId || !isConnected || !catalogWorkspace) {
      setMcpServers([]);
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const [configResponse, statusResponse] = await Promise.all([
        readCodexConfig(workspaceId, {
          includeLayers: true,
          cwd: catalogWorkspace.path,
        }),
        listMcpServerStatus(workspaceId, null, null),
      ]);
      setMcpServers(normalizeMcpServers(statusResponse, configResponse));
      lastFetchedWorkspaceId.current = workspaceId;
    } finally {
      inFlight.current = false;
    }
  }, [catalogWorkspace, isConnected, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      setMcpServers([]);
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && mcpServers.length > 0) {
      return;
    }
    void refreshMcpServers();
  }, [isConnected, mcpServers.length, refreshMcpServers, workspaceId]);

  const setMcpServerEnabled = useCallback(
    async (server: McpServerOption, enabled: boolean) => {
      if (!workspaceId || !isConnected || !server.configurable) {
        return;
      }
      await writeMcpServerEnabled(workspaceId, {
        name: server.name,
        enabled,
        sourcePath: server.sourcePath,
      });
      await refreshMcpServers();
    },
    [isConnected, refreshMcpServers, workspaceId],
  );

  return useMemo(
    () => ({
      mcpServers,
      refreshMcpServers,
      setMcpServerEnabled,
    }),
    [mcpServers, refreshMcpServers, setMcpServerEnabled],
  );
}
