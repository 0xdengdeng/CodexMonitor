// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildGitNodes, type GitLayoutNodesOptions } from "./buildGitNodes";

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
});
