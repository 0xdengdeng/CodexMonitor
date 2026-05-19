// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/types";
import { SettingsGitSection } from "./SettingsGitSection";

const baseSettings = {
  gitRuntimePreference: "auto",
  preloadGitDiffs: false,
  gitDiffIgnoreWhitespaceChanges: false,
  commitMessageModelId: null,
} as AppSettings;

describe("SettingsGitSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the current git runtime source", () => {
    render(
      <SettingsGitSection
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn(async () => {})}
        models={[]}
        commitMessagePromptDraft=""
        commitMessagePromptDirty={false}
        commitMessagePromptSaving={false}
        onSetCommitMessagePromptDraft={vi.fn()}
        onSaveCommitMessagePrompt={vi.fn(async () => {})}
        onResetCommitMessagePrompt={vi.fn(async () => {})}
        gitRuntimeInfo={{
          available: true,
          source: "bundled",
          path: "/Applications/AgentDesk.app/Contents/MacOS/git",
          version: "git version 2.39.5",
          error: null,
        }}
        gitRuntimeInfoLoading={false}
        gitRuntimeInfoError={null}
        onRefreshGitRuntimeInfo={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText("Version Control")).toBeTruthy();
    expect(screen.getAllByText("Built-in Git").length).toBeGreaterThan(0);
    expect(screen.getByText("git version 2.39.5")).toBeTruthy();
  });

  it("persists the selected git runtime preference", async () => {
    const onUpdateAppSettings = vi.fn(async () => {});
    const { container } = render(
      <SettingsGitSection
        appSettings={baseSettings}
        onUpdateAppSettings={onUpdateAppSettings}
        models={[]}
        commitMessagePromptDraft=""
        commitMessagePromptDirty={false}
        commitMessagePromptSaving={false}
        onSetCommitMessagePromptDraft={vi.fn()}
        onSaveCommitMessagePrompt={vi.fn(async () => {})}
        onResetCommitMessagePrompt={vi.fn(async () => {})}
        gitRuntimeInfo={null}
        gitRuntimeInfoLoading={false}
        gitRuntimeInfoError={null}
        onRefreshGitRuntimeInfo={vi.fn(async () => {})}
      />,
    );

    const selector = screen.getByRole("combobox", { name: "Git runtime component" });
    expect(container.querySelector("select")).toBeNull();

    fireEvent.click(selector);
    fireEvent.click(screen.getByRole("option", { name: /System Git/ }));

    expect(onUpdateAppSettings).toHaveBeenCalledWith({
      ...baseSettings,
      gitRuntimePreference: "system",
    });
  });
});
