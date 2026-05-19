// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n/i18n";
import { CapabilitiesView } from "./CapabilitiesView";

afterEach(() => {
  cleanup();
});

describe("CapabilitiesView", () => {
  it("keeps capability sections from shrinking so the main pane can scroll", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/capabilities.css"),
      "utf8",
    );

    expect(css).toMatch(/\.capabilities-section\s*\{[^}]*flex-shrink:\s*0;/s);
  });

  it("uses a balanced search field in the capabilities panel", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/styles/capabilities.css"),
      "utf8",
    );

    expect(css).toMatch(/\.capabilities-search\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.capabilities-search\s*\{[^}]*height:\s*40px;/s);
    expect(css).toMatch(
      /\.capabilities-search input:focus\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/s,
    );
  });

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

  it("opens the skill market from an icon-only action outside the capabilities modal", () => {
    const { container } = render(
      <CapabilitiesView
        activeWorkspace={null}
        skills={[]}
        mcpServers={[]}
        skillMarketItems={[]}
        onClose={vi.fn()}
        onRefreshCapabilities={vi.fn()}
        onSetSkillEnabled={vi.fn()}
        onSetMcpServerEnabled={vi.fn()}
        onInstallSkill={vi.fn()}
        onUninstallSkill={vi.fn()}
      />,
    );

    const marketButton = screen.getByRole("button", { name: "Open skill market" });
    expect(marketButton.textContent).toBe("");

    fireEvent.click(marketButton);

    const marketDialog = screen.getByRole("dialog", { name: "Skill Market" });
    const capabilitiesWindow = container.querySelector(".capabilities-window");

    expect(marketDialog).toBeTruthy();
    expect(capabilitiesWindow).toBeTruthy();
    expect(capabilitiesWindow?.contains(marketDialog)).toBe(false);
  });

  it("shows uninstall only for user installed skills", async () => {
    const onUninstallSkill = vi.fn();

    render(
      <CapabilitiesView
        activeWorkspace={null}
        skills={[
          {
            name: "docs-writer",
            path: "/Users/me/Library/Application Support/com.agentdesk.app/codex-home/skills/docs-writer/SKILL.md",
            description: "Docs helper.",
            scope: "user",
            enabled: true,
          },
          {
            name: "imagegen",
            path: "/Users/me/Library/Application Support/com.agentdesk.app/codex-home/skills/.system/imagegen/SKILL.md",
            description: "Image helper.",
            scope: "system",
            enabled: true,
          },
        ]}
        mcpServers={[]}
        skillMarketItems={[]}
        onClose={vi.fn()}
        onRefreshCapabilities={vi.fn()}
        onSetSkillEnabled={vi.fn()}
        onSetMcpServerEnabled={vi.fn()}
        onInstallSkill={vi.fn()}
        onUninstallSkill={onUninstallSkill}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Uninstall docs-writer" }));
    });

    expect(onUninstallSkill).toHaveBeenCalledWith(
      expect.objectContaining({ name: "docs-writer" }),
    );
    expect(screen.queryByRole("button", { name: "Uninstall imagegen" })).toBeNull();
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
    expect(screen.getByText("Manage Skills and MCP for test-fold.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "MCP" })).toBeTruthy();
    expect(screen.getByText("imagegen")).toBeTruthy();
    expect(screen.getByText("Generate or edit images.")).toBeTruthy();
  });

  it("uses localized built-in skill descriptions", () => {
    render(
      <I18nProvider languagePreference="zh-CN">
        <CapabilitiesView
          activeWorkspace={null}
          skills={[
            {
              name: "imagegen",
              path: "/Users/me/.codex/skills/.system/imagegen/SKILL.md",
              description: "Generate or edit raster images.",
              scope: "system",
              enabled: true,
            },
            {
              name: "custom-skill",
              path: "/Users/me/.agents/skills/custom-skill/SKILL.md",
              description: "Custom local description.",
              scope: "user",
              enabled: true,
            },
          ]}
          mcpServers={[]}
          onClose={vi.fn()}
          onRefreshCapabilities={vi.fn()}
          onSetSkillEnabled={vi.fn()}
          onSetMcpServerEnabled={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("生成或编辑图片、插画、纹理、精灵图和产品 mockup。")).toBeTruthy();
    expect(screen.queryByText("Generate or edit raster images.")).toBeNull();
    expect(screen.getByText("Custom local description.")).toBeTruthy();
  });

  it("uses localized scope copy and search placeholder", () => {
    render(
      <I18nProvider languagePreference="zh-CN">
        <CapabilitiesView
          activeWorkspace={null}
          skills={[]}
          mcpServers={[]}
          onClose={vi.fn()}
          onRefreshCapabilities={vi.fn()}
          onSetSkillEnabled={vi.fn()}
          onSetMcpServerEnabled={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("管理全局可用的 Skills 和 MCP")).toBeTruthy();
    expect(screen.getByPlaceholderText("搜索全局能力")).toBeTruthy();
    expect(screen.queryByText("全局能力")).toBeNull();
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

  it("localizes MCP inventory status text", () => {
    render(
      <I18nProvider languagePreference="zh-CN">
        <CapabilitiesView
          activeWorkspace={null}
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
          onSetMcpServerEnabled={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("2 个工具 · 1 个资源 · 认证：不支持")).toBeTruthy();
    expect(screen.queryByText(/unsupported/)).toBeNull();
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
    expect(
      screen.getByText(
        "Skill changes apply to new sessions. Current sessions may keep the previous skill list.",
      ),
    ).toBeTruthy();
  });
});
