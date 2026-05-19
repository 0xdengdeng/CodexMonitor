// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillMarketItem } from "@/types";
import { SkillMarketDialog } from "./SkillMarketDialog";

afterEach(() => {
  cleanup();
});

const marketItems: SkillMarketItem[] = [
  {
    id: "docs-writer",
    name: "docs-writer",
    title: "Docs Writer",
    description: "Draft READMEs and release notes.",
    categories: ["writing", "productivity"],
    tags: ["docs", "readme"],
    publisher: "AgentDesk",
    verified: true,
    source: { type: "bundled" },
  },
  {
    id: "code-review-assistant",
    name: "code-review-assistant",
    title: "Code Review Assistant",
    description: "Review code changes for regressions.",
    categories: ["engineering"],
    tags: ["review"],
    publisher: "AgentDesk",
    verified: true,
    source: { type: "bundled" },
  },
];

describe("SkillMarketDialog", () => {
  it("renders a settings-style market with categories, cards, and detail", () => {
    const { container } = render(
      <SkillMarketDialog
        activeWorkspace={null}
        items={marketItems}
        installedSkillNames={[]}
        onClose={vi.fn()}
        onInstallSkill={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Skill Market" })).toBeTruthy();
    expect(container.querySelector(".skill-market-window.settings-window")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Writing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Engineering" })).toBeTruthy();
    expect(screen.getByText("Docs Writer")).toBeTruthy();
    expect(screen.getByText("Draft READMEs and release notes.")).toBeTruthy();
  });

  it("filters market cards by category and search", () => {
    render(
      <SkillMarketDialog
        activeWorkspace={null}
        items={marketItems}
        installedSkillNames={[]}
        onClose={vi.fn()}
        onInstallSkill={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Engineering" }));

    expect(screen.queryByText("Docs Writer")).toBeNull();
    expect(screen.getByText("Code Review Assistant")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search skills"), {
      target: { value: "docs" },
    });

    expect(screen.getByText("No matching skills.")).toBeTruthy();
  });

  it("disables the project target when no project is active", () => {
    render(
      <SkillMarketDialog
        activeWorkspace={null}
        items={marketItems}
        installedSkillNames={[]}
        onClose={vi.fn()}
        onInstallSkill={vi.fn()}
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Project" }).disabled).toBe(
      true,
    );
  });

  it("installs the selected skill into the chosen target", async () => {
    const onInstallSkill = vi.fn();

    render(
      <SkillMarketDialog
        activeWorkspace={{
          id: "ws-1",
          name: "test-fold",
          path: "/tmp/test-fold",
          connected: true,
          settings: { sidebarCollapsed: false },
        }}
        items={marketItems}
        installedSkillNames={[]}
        onClose={vi.fn()}
        onInstallSkill={onInstallSkill}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Project" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });

    expect(onInstallSkill).toHaveBeenCalledWith({
      itemId: "docs-writer",
      target: "project",
    });
  });
});
