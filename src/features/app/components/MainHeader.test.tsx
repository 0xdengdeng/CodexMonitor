/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { MainHeader } from "./MainHeader";

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "test-fold",
  path: "/tmp/test-fold",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("MainHeader", () => {
  it("keeps the top bar focused on in-app workflows by hiding the external editor launcher", () => {
    render(
      <MainHeader
        workspace={workspace}
        branchName="main"
        branches={[{ name: "main", lastCommit: 1 }]}
        onCheckoutBranch={vi.fn()}
        onCreateBranch={vi.fn()}
        onToggleTerminal={vi.fn()}
        isTerminalOpen={false}
        openTargets={[
          {
            id: "cursor",
            label: "Cursor",
            kind: "app",
            appName: "Cursor",
            args: [],
          },
        ]}
        openAppIconById={{}}
        selectedOpenAppId="cursor"
        onSelectOpenAppId={vi.fn()}
        showWorkspaceTools
      />,
    );

    expect(screen.queryByRole("button", { name: "Open in Cursor" })).toBeNull();
    expect(screen.queryByText("Cursor")).toBeNull();
  });
});
