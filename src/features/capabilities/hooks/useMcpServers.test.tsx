// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import {
  listMcpServerStatus,
  readCodexConfig,
  setMcpServerEnabled,
} from "../../../services/tauri";
import { useMcpServers } from "./useMcpServers";

vi.mock("../../../services/tauri", () => ({
  listMcpServerStatus: vi.fn(),
  readCodexConfig: vi.fn(),
  setMcpServerEnabled: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace One",
  path: "/tmp/workspace-one",
  connected: true,
  settings: { sidebarCollapsed: false },
};

beforeEach(() => {
  vi.mocked(listMcpServerStatus).mockReset();
  vi.mocked(readCodexConfig).mockReset();
  vi.mocked(setMcpServerEnabled).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMcpServers", () => {
  it("uses a fallback connected workspace when no project is active", async () => {
    vi.mocked(readCodexConfig).mockResolvedValueOnce({
      result: {
        config: {
          mcp_servers: {
            github: { enabled: true },
          },
        },
        origins: {
          "mcp_servers.github": {
            name: { type: "user", file: "/Users/me/.codex/config.toml" },
            version: "sha256:1",
          },
        },
      },
    });
    vi.mocked(listMcpServerStatus).mockResolvedValueOnce({
      result: {
        data: [{ name: "github", tools: {}, resources: [], resourceTemplates: [] }],
      },
    });

    const { result } = renderHook(() =>
      useMcpServers({ activeWorkspace: null, fallbackWorkspace: workspace }),
    );

    await waitFor(() => {
      expect(readCodexConfig).toHaveBeenCalledWith("workspace-1", {
        includeLayers: true,
        cwd: "/tmp/workspace-one",
      });
      expect(result.current.mcpServers.map((server) => server.name)).toEqual(["github"]);
    });
  });

  it("merges MCP runtime status with config scope and enablement", async () => {
    vi.mocked(readCodexConfig).mockResolvedValueOnce({
      result: {
        config: {
          mcp_servers: {
            github: { enabled: true },
          },
        },
        origins: {
          "mcp_servers.github": {
            name: { type: "user", file: "/Users/me/.codex/config.toml" },
            version: "sha256:1",
          },
        },
      },
    });
    vi.mocked(listMcpServerStatus).mockResolvedValueOnce({
      result: {
        data: [
          {
            name: "github",
            tools: {
              mcp__github__search: {},
              mcp__github__repo: {},
            },
            resources: [{}],
            resourceTemplates: [],
            authStatus: "unsupported",
          },
        ],
      },
    });

    const { result } = renderHook(() => useMcpServers({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.mcpServers).toEqual([
        expect.objectContaining({
          name: "github",
          scope: "global",
          enabled: true,
          configurable: true,
          sourcePath: "/Users/me/.codex/config.toml",
          toolsCount: 2,
          resourcesCount: 1,
          resourceTemplatesCount: 0,
          authStatus: "unsupported",
        }),
      ]);
    });
    expect(readCodexConfig).toHaveBeenCalledWith("workspace-1", {
      includeLayers: true,
      cwd: "/tmp/workspace-one",
    });
  });

  it("writes MCP enablement and refreshes server status", async () => {
    vi.mocked(readCodexConfig)
      .mockResolvedValueOnce({
        result: {
          config: {
            mcp_servers: {
              github: { enabled: true },
            },
          },
          origins: {
            "mcp_servers.github": {
              name: { type: "user", file: "/Users/me/.codex/config.toml" },
              version: "sha256:1",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          config: {
            mcp_servers: {
              github: { enabled: false },
            },
          },
          origins: {
            "mcp_servers.github": {
              name: { type: "user", file: "/Users/me/.codex/config.toml" },
              version: "sha256:2",
            },
          },
        },
      });
    vi.mocked(listMcpServerStatus)
      .mockResolvedValueOnce({
        result: {
          data: [{ name: "github", tools: {}, resources: [], resourceTemplates: [] }],
        },
      })
      .mockResolvedValueOnce({
        result: {
          data: [{ name: "github", tools: {}, resources: [], resourceTemplates: [] }],
        },
      });
    vi.mocked(setMcpServerEnabled).mockResolvedValueOnce({});

    const { result } = renderHook(() => useMcpServers({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.mcpServers[0]?.enabled).toBe(true);
    });

    await act(async () => {
      await result.current.setMcpServerEnabled(result.current.mcpServers[0], false);
    });

    expect(setMcpServerEnabled).toHaveBeenCalledWith("workspace-1", {
      name: "github",
      enabled: false,
      sourcePath: "/Users/me/.codex/config.toml",
    });
    await waitFor(() => {
      expect(result.current.mcpServers[0]?.enabled).toBe(false);
    });
  });

  it("uses nested MCP config origins when enabled has not been set yet", async () => {
    vi.mocked(readCodexConfig).mockResolvedValueOnce({
      result: {
        config: {
          mcp_servers: {
            github: { command: "github-mcp" },
          },
        },
        origins: {
          "mcp_servers.github.command": {
            name: { type: "project", dotCodexFolder: "/tmp/workspace-one/.codex" },
            version: "sha256:1",
          },
        },
      },
    });
    vi.mocked(listMcpServerStatus).mockResolvedValueOnce({
      result: {
        data: [{ name: "github", tools: {}, resources: [], resourceTemplates: [] }],
      },
    });

    const { result } = renderHook(() => useMcpServers({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.mcpServers).toEqual([
        expect.objectContaining({
          name: "github",
          scope: "project",
          enabled: true,
          configurable: true,
          sourcePath: "/tmp/workspace-one/.codex/config.toml",
        }),
      ]);
    });
  });
});
