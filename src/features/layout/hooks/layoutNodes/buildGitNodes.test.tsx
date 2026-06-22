// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGitNodes, type GitLayoutNodesOptions } from "./buildGitNodes";

vi.mock("@services/tauri", () => ({
  deployApp: vi.fn(),
  deployStatus: vi.fn(),
  deployBuildLog: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("buildGitNodes", () => {
  it("renders the plan panel as a first-class right-panel tab", () => {
    const options = {
      filePanelMode: "plan",
      planPanelProps: {
        isProcessing: true,
        plan: {
          turnId: "turn-1",
          explanation: null,
          steps: [{ step: "Check context", status: "inProgress" }],
        },
      },
      gitDiffPanelProps: {
        onFilePanelModeChange: vi.fn(),
      },
      gitDiffViewerProps: {},
      diffViewProps: {
        centerMode: "chat",
        isPhone: false,
        splitChatDiffView: false,
        gitDiffViewStyle: "split",
      },
    } as unknown as GitLayoutNodesOptions;

    const nodes = buildGitNodes(options);

    render(<>{nodes.gitDiffPanelNode}</>);

    expect(screen.getByRole("tab", { name: "Plan" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Version" })).toBeTruthy();
    expect(screen.getByText("Check context")).toBeTruthy();
  });

  it("renders the deploy panel as a first-class right-panel tab", () => {
    const options = {
      filePanelMode: "deploy",
      deployPanelProps: {
        workspaceId: "w1",
        deployState: null,
        backendMode: "local",
      },
      gitDiffPanelProps: {
        onFilePanelModeChange: vi.fn(),
      },
      gitDiffViewerProps: {},
      diffViewProps: {
        centerMode: "chat",
        isPhone: false,
        splitChatDiffView: false,
        gitDiffViewStyle: "split",
      },
    } as unknown as GitLayoutNodesOptions;

    const nodes = buildGitNodes(options);

    render(<>{nodes.gitDiffPanelNode}</>);

    expect(screen.getByRole("tab", { name: "Deploy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
  });
});
