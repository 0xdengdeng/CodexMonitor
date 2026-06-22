// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeployUiState } from "../hooks/useDeploy";

const deployMock = vi.fn();
const refreshStatusMock = vi.fn();
const loadBuildLogMock = vi.fn();
let mockState: DeployUiState;

vi.mock("../hooks/useDeploy", () => ({
  useDeploy: () => ({
    state: mockState,
    deploy: deployMock,
    refreshStatus: refreshStatusMock,
    loadBuildLog: loadBuildLogMock,
  }),
}));

import { DeployPanel } from "./DeployPanel";

const INITIAL: DeployUiState = {
  status: "idle",
  app: null,
  error: null,
  buildLog: null,
  buildLogLoading: false,
};

beforeEach(() => {
  mockState = { ...INITIAL };
  deployMock.mockReset();
  refreshStatusMock.mockReset();
  loadBuildLogMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("DeployPanel", () => {
  it("shows the remote-unsupported note and no deploy action in remote mode", () => {
    render(<DeployPanel workspaceId="w1" deployState={null} backendMode="remote" />);
    expect(screen.getByText("Deploy is only available in local mode.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();
    expect(refreshStatusMock).not.toHaveBeenCalled();
  });

  it("offers a first deploy for an unbound workspace without refreshing status", () => {
    render(<DeployPanel workspaceId="w1" deployState={null} backendMode="local" />);
    expect(screen.getByText("This workspace hasn't been deployed yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
    expect(refreshStatusMock).not.toHaveBeenCalled();
  });

  it("labels the action Redeploy and refreshes status for a bound workspace", () => {
    render(
      <DeployPanel
        workspaceId="w1"
        deployState={{ appId: "app-1", appName: "demo" }}
        backendMode="local"
      />,
    );
    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redeploy" })).toBeTruthy();
    expect(refreshStatusMock).toHaveBeenCalledTimes(1);
  });
});
