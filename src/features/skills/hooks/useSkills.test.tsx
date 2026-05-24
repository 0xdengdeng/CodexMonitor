// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent, WorkspaceInfo } from "../../../types";
import { getSkillsList, setSkillEnabled } from "../../../services/tauri";
import { subscribeAppServerEvents } from "../../../services/events";
import { useSkills } from "./useSkills";

vi.mock("../../../services/tauri", () => ({
  getSkillsList: vi.fn(),
  setSkillEnabled: vi.fn(),
}));

vi.mock("../../../services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace One",
  path: "/tmp/workspace-one",
  connected: true,
  settings: { sidebarCollapsed: false },
};

let listener: ((event: AppServerEvent) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  listener = null;
  unlisten.mockReset();
  vi.mocked(getSkillsList).mockReset();
  vi.mocked(setSkillEnabled).mockReset();
  vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSkills", () => {
  it("uses a fallback connected workspace when no project is active", async () => {
    vi.mocked(getSkillsList).mockResolvedValueOnce({
      result: {
        skills: [
          {
            name: "imagegen",
            path: "/Users/me/.codex/skills/.system/imagegen/SKILL.md",
            scope: "system",
            enabled: true,
          },
        ],
      },
    });

    const { result } = renderHook(() =>
      useSkills({ activeWorkspace: null, fallbackWorkspace: workspace }),
    );

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledWith("workspace-1");
      expect(result.current.allSkills.map((skill) => skill.name)).toEqual(["imagegen"]);
    });
  });

  it("keeps disabled skills manageable but exposes only enabled skills for composer use", async () => {
    vi.mocked(getSkillsList).mockResolvedValueOnce({
      result: {
        data: [
          {
            skills: [
              {
                name: "enabled-skill",
                path: "/tmp/workspace-one/.agents/skills/enabled/SKILL.md",
                description: "Enabled skill.",
                scope: "repo",
                enabled: true,
              },
              {
                name: "disabled-skill",
                path: "/skills/disabled/SKILL.md",
                description: "Disabled skill.",
                scope: "user",
                enabled: false,
              },
            ],
          },
        ],
      },
    });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.allSkills.map((skill) => skill.name)).toEqual([
        "enabled-skill",
        "disabled-skill",
      ]);
      expect(result.current.skills.map((skill) => skill.name)).toEqual(["enabled-skill"]);
      expect(result.current.allSkills[1].enabled).toBe(false);
      expect(result.current.allSkills[1].scope).toBe("user");
    });
  });

  it("maps market metadata and uninstallability from the runtime response", async () => {
    vi.mocked(getSkillsList).mockResolvedValueOnce({
      result: {
        skills: [
          {
            name: "docs-writer",
            path: "/Users/me/Library/Application Support/com.agentdesk.app.dev/codex-home/skills/docs-writer/SKILL.md",
            scope: "user",
            enabled: true,
            marketId: "docs-writer",
            installedVersion: "0.2.0",
            marketSourcePath: "skills/docs-writer",
            installedAt: "2026-05-20T00:00:00Z",
            uninstallable: true,
          },
        ],
      },
    });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.allSkills[0]).toMatchObject({
        name: "docs-writer",
        marketId: "docs-writer",
        installedVersion: "0.2.0",
        marketSourcePath: "skills/docs-writer",
        installedAt: "2026-05-20T00:00:00Z",
        uninstallable: true,
      });
    });
  });

  it("writes project skill enablement by path and refreshes the catalog", async () => {
    vi.mocked(getSkillsList)
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "demo",
              path: "/tmp/workspace-one/.agents/skills/demo/SKILL.md",
              scope: "repo",
              enabled: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "demo",
              path: "/tmp/workspace-one/.agents/skills/demo/SKILL.md",
              scope: "repo",
              enabled: false,
            },
          ],
        },
      });
    vi.mocked(setSkillEnabled).mockResolvedValueOnce({ effectiveEnabled: false });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.allSkills[0]?.enabled).toBe(true);
    });

    await act(async () => {
      await result.current.setSkillEnabled(result.current.allSkills[0], false);
    });

    expect(setSkillEnabled).toHaveBeenCalledWith("workspace-1", {
      path: "/tmp/workspace-one/.agents/skills/demo/SKILL.md",
      name: null,
      enabled: false,
    });
    await waitFor(() => {
      expect(result.current.allSkills[0]?.enabled).toBe(false);
    });
  });

  it("writes global user skill enablement by name", async () => {
    vi.mocked(getSkillsList)
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "adapt",
              path: "/Users/me/.agents/skills/adapt/SKILL.md",
              scope: "user",
              enabled: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "adapt",
              path: "/Users/me/.agents/skills/adapt/SKILL.md",
              scope: "user",
              enabled: false,
            },
          ],
        },
      });
    vi.mocked(setSkillEnabled).mockResolvedValueOnce({ effectiveEnabled: false });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.allSkills[0]?.enabled).toBe(true);
    });

    await act(async () => {
      await result.current.setSkillEnabled(result.current.allSkills[0], false);
    });

    expect(setSkillEnabled).toHaveBeenCalledWith("workspace-1", {
      path: null,
      name: "adapt",
      enabled: false,
    });
  });

  it("writes bundled system skill enablement by name", async () => {
    vi.mocked(getSkillsList)
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "imagegen",
              path: "/Users/me/.codex/skills/.system/imagegen/SKILL.md",
              scope: "system",
              enabled: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "imagegen",
              path: "/Users/me/.codex/skills/.system/imagegen/SKILL.md",
              scope: "system",
              enabled: false,
            },
          ],
        },
      });
    vi.mocked(setSkillEnabled).mockResolvedValueOnce({ effectiveEnabled: false });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(result.current.allSkills[0]?.enabled).toBe(true);
    });

    await act(async () => {
      await result.current.setSkillEnabled(result.current.allSkills[0], false);
    });

    expect(setSkillEnabled).toHaveBeenCalledWith("workspace-1", {
      path: null,
      name: "imagegen",
      enabled: false,
    });
  });

  it("refreshes skills on canonical codex/event/skills_update_available notifications", async () => {
    vi.mocked(getSkillsList)
      .mockResolvedValueOnce({ result: { skills: [{ name: "first", path: "/skills/first" }] } })
      .mockResolvedValueOnce({
        result: {
          skills: [
            { name: "first", path: "/skills/first" },
            { name: "second", path: "/skills/second" },
          ],
        },
      });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledTimes(1);
      expect(result.current.skills.map((skill) => skill.name)).toEqual(["first"]);
    });

    act(() => {
      listener?.({
        workspace_id: "workspace-1",
        message: {
          method: "codex/event/skills_update_available",
        },
      });
    });

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledTimes(2);
      expect(result.current.skills.map((skill) => skill.name)).toEqual(["first", "second"]);
    });
  });

  it("queues a second refresh when a refresh is already in flight", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    vi.mocked(getSkillsList)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        result: {
          skills: [
            {
              name: "docs-writer",
              path: "/Users/me/Library/Application Support/com.agentdesk.app.dev/codex-home/skills/docs-writer/SKILL.md",
              scope: "user",
              enabled: true,
            },
          ],
        },
      });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      void result.current.refreshSkills();
    });

    expect(getSkillsList).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ result: { skills: [] } });
    });

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledTimes(2);
      expect(result.current.allSkills.map((skill) => skill.name)).toEqual([
        "docs-writer",
      ]);
    });
  });

  it("ignores non-canonical direct skills update methods", async () => {
    vi.mocked(getSkillsList)
      .mockResolvedValueOnce({ result: { skills: [{ name: "first", path: "/skills/first" }] } });

    const { result } = renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledTimes(1);
      expect(result.current.skills.map((skill) => skill.name)).toEqual(["first"]);
    });

    act(() => {
      listener?.({
        workspace_id: "workspace-1",
        message: { method: "skills/updateAvailable" },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSkillsList).toHaveBeenCalledTimes(1);
    expect(result.current.skills.map((skill) => skill.name)).toEqual(["first"]);
  });

  it("ignores skills update events from other workspaces", async () => {
    vi.mocked(getSkillsList).mockResolvedValue({
      result: { skills: [{ name: "first", path: "/skills/first" }] },
    });

    renderHook(() => useSkills({ activeWorkspace: workspace }));

    await waitFor(() => {
      expect(getSkillsList).toHaveBeenCalledTimes(1);
    });

    act(() => {
      listener?.({
        workspace_id: "workspace-2",
        message: {
          method: "codex/event/skills_update_available",
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSkillsList).toHaveBeenCalledTimes(1);
  });
});
