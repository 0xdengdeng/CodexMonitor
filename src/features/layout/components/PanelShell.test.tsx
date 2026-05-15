// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelShell } from "./PanelShell";

describe("PanelShell", () => {
  it("keeps primary tabs separate from the contextual toolbar", () => {
    render(
      <PanelShell
        filePanelMode="git"
        onFilePanelModeChange={vi.fn()}
        headerRight={<button type="button">变更</button>}
      >
        <div>Panel body</div>
      </PanelShell>,
    );

    const tablist = screen.getByRole("tablist");
    const header = tablist.closest(".ds-panel-header");
    const toolbar = screen.getByRole("toolbar");

    expect(header).toBeTruthy();
    expect(toolbar).toBeTruthy();
    expect(header?.querySelector("button[aria-label='Version']")).toBeTruthy();
    expect(header?.querySelector("button:not([role='tab'])")).toBeNull();
    expect(toolbar.contains(screen.getByRole("button", { name: "变更" }))).toBe(true);
  });
});
