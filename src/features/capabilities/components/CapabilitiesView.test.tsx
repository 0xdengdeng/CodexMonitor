// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitiesView } from "./CapabilitiesView";

afterEach(() => {
  cleanup();
});

describe("CapabilitiesView", () => {
  it("uses the same modal frame structure as settings", () => {
    const { container } = render(
      <CapabilitiesView
        activeWorkspace={null}
        skills={[]}
        mcpServers={[]}
        onClose={vi.fn()}
        onRefreshCapabilities={vi.fn()}
        onSetSkillEnabled={vi.fn()}
        onSetMcpServerEnabled={vi.fn()}
      />,
    );

    expect(container.querySelector(".capabilities-window.settings-window")).toBeTruthy();
    expect(container.querySelector(".settings-titlebar")).toBeTruthy();
    expect(container.querySelector(".settings-body")).toBeTruthy();
    expect(container.querySelector(".settings-sidebar")).toBeTruthy();
    expect(container.querySelector(".settings-content")).toBeTruthy();
  });

  it("shows current project and global ability scopes with skills and MCP groups", () => {
    render(
      <CapabilitiesView
        activeWorkspace={{
          id: "ws-1",
          name: "test-fold",
          path: "/tmp/test-fold",
          connected: true,
          settings: { sidebarCollapsed: false },
        }}
        skills={[
          {
            name: "imagegen",
            path: "/tmp/test-fold/.agents/skills/imagegen/SKILL.md",
            description: "Generate or edit images.",
            scope: "repo",
            enabled: true,
          },
        ]}
        onClose={vi.fn()}
        onRefreshCapabilities={vi.fn()}
        onSetSkillEnabled={vi.fn()}
        mcpServers={[]}
        onSetMcpServerEnabled={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Capabilities" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Current Project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Global" })).toBeTruthy();
    expect(screen.getAllByText("test-fold").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "MCP" })).toBeTruthy();
    expect(screen.getByText("imagegen")).toBeTruthy();
    expect(screen.getByText("Generate or edit images.")).toBeTruthy();
  });

  it("shows MCP servers with inventory and enablement controls", async () => {
    const onSetMcpServerEnabled = vi.fn();

    render(
      <CapabilitiesView
        activeWorkspace={{
          id: "ws-1",
          name: "test-fold",
          path: "/tmp/test-fold",
          connected: true,
          settings: { sidebarCollapsed: false },
        }}
        skills={[]}
        mcpServers={[
          {
            name: "github",
            scope: "global",
            enabled: true,
            configurable: true,
            toolsCount: 2,
            resourcesCount: 1,
            resourceTemplatesCount: 0,
            authStatus: "unsupported",
          },
        ]}
        onClose={vi.fn()}
        onRefreshCapabilities={vi.fn()}
        onSetSkillEnabled={vi.fn()}
        onSetMcpServerEnabled={onSetMcpServerEnabled}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Global" }));

    expect(screen.getByText("github")).toBeTruthy();
    expect(screen.getByText("2 tools · 1 resource · auth: unsupported")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "github MCP is enabled" }));
    });

    expect(onSetMcpServerEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ name: "github" }),
      false,
    );
  });

  it("requests enablement changes from the row switch", async () => {
    const onSetSkillEnabled = vi.fn();

    render(
      <CapabilitiesView
        activeWorkspace={{
          id: "ws-1",
          name: "test-fold",
          path: "/tmp/test-fold",
          connected: true,
          settings: { sidebarCollapsed: false },
        }}
        skills={[
          {
            name: "imagegen",
            path: "/tmp/test-fold/.agents/skills/imagegen/SKILL.md",
            description: "Generate or edit images.",
            scope: "repo",
            enabled: true,
          },
        ]}
        onClose={vi.fn()}
        onRefreshCapabilities={vi.fn()}
        onSetSkillEnabled={onSetSkillEnabled}
        mcpServers={[]}
        onSetMcpServerEnabled={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "imagegen is enabled" }));
    });

    expect(onSetSkillEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ name: "imagegen" }),
      false,
    );
  });
});
