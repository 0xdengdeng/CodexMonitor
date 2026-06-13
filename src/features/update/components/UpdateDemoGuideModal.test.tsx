// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveFirstLaunchDemoGuide,
  resolveUpdateDemoGuide,
} from "../utils/updateDemoGuides";
import { UpdateDemoGuideModal } from "./UpdateDemoGuideModal";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const openUrlMock = vi.mocked(openUrl);
const releaseNotesUrl =
  "https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/0.7.70/release-notes.md";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function getGuide() {
  const guide = resolveUpdateDemoGuide(__APP_VERSION__);
  if (!guide) {
    throw new Error("Expected demo guide");
  }
  return guide;
}

function getFirstLaunchGuide() {
  const guide = resolveFirstLaunchDemoGuide();
  if (!guide) {
    throw new Error("Expected first-launch guide");
  }
  return guide;
}

function addGuideTarget(target: string) {
  const element = document.createElement("button");
  element.dataset.updateGuideTarget = target;
  element.getBoundingClientRect = vi.fn(() => ({
    x: 120,
    y: 180,
    left: 120,
    top: 180,
    right: 220,
    bottom: 220,
    width: 100,
    height: 40,
    toJSON: () => ({}),
  }));
  document.body.appendChild(element);
  return element;
}

describe("UpdateDemoGuideModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockMatchMedia(false);
    Object.defineProperty(window, "requestAnimationFrame", {
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      }),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the Codex-style intro before the in-place guide", () => {
    addGuideTarget("workspace-home.composer");

    render(
      <UpdateDemoGuideModal
        guide={getGuide()}
        releaseNotesUrl={releaseNotesUrl}
        onDismiss={vi.fn()}
        onTryIt={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", {
        name: "Qihang AI Platform is ready",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Qihang AI Platform is ready")).toBeTruthy();
    expect(screen.getByText("First official release")).toBeTruthy();
    expect(screen.getByText("Start with the current project")).toBeTruthy();
    expect(screen.getByText("Add screenshots or generated visuals")).toBeTruthy();
    expect(
      screen.getByText("Stay in review before shipping"),
    ).toBeTruthy();
    expect(document.querySelector(".update-demo-target-ring")).toBeNull();
    expect(screen.getByRole("button", { name: "Start guide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Maybe later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release notes" })).toBeTruthy();
  });

  it("enters the in-place workflow guide after the intro", () => {
    addGuideTarget("workspace-home.composer");

    render(
      <UpdateDemoGuideModal
        guide={getGuide()}
        releaseNotesUrl={releaseNotesUrl}
        onDismiss={vi.fn()}
        onTryIt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start guide" }));

    expect(
      screen.getByRole("dialog", {
        name: "Start with the current project",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("This is the actual control in your current interface."),
    ).toBeTruthy();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    expect(document.querySelector(".update-demo-target-ring")).toBeTruthy();
    expect(screen.queryByText("Workspace brief")).toBeNull();
    expect(screen.queryByText("Generated image")).toBeNull();
    expect(screen.getByRole("button", { name: "Describe the task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage capabilities" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
    expect(screen.getByRole("button", { name: "Maybe later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Release notes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try it" })).toBeTruthy();
  });

  it("renders first-launch copy without release notes action", () => {
    addGuideTarget("home.add-project");

    render(
      <UpdateDemoGuideModal
        guide={getFirstLaunchGuide()}
        releaseNotesUrl={null}
        onDismiss={vi.fn()}
        onTryIt={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", {
        name: "Run Codex work from one focused console",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.queryByText("First official release")).toBeNull();
    expect(screen.queryByRole("button", { name: "Release notes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start guide" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Start using Qihang AI Platform" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start guide" }));
    expect(
      screen.getByRole("button", { name: "Start using Qihang AI Platform" }),
    ).toBeTruthy();
  });

  it("shows fallback copy when the target component is not visible", () => {
    render(
      <UpdateDemoGuideModal
        guide={getGuide()}
        releaseNotesUrl={releaseNotesUrl}
        onDismiss={vi.fn()}
        onTryIt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start guide" }));

    expect(
      screen.getByText("Open the relevant screen to see this in place"),
    ).toBeTruthy();
    expect(document.querySelector(".update-demo-target-ring")).toBeNull();
  });


  it("handles skip, release notes, and try-it actions", () => {
    const onDismiss = vi.fn();
    const onTryIt = vi.fn();
    render(
      <UpdateDemoGuideModal
        guide={getGuide()}
        releaseNotesUrl={releaseNotesUrl}
        onDismiss={onDismiss}
        onTryIt={onTryIt}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Release notes" }));
    expect(openUrlMock).toHaveBeenCalledWith(releaseNotesUrl);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start guide" }));
    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    expect(onTryIt).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Maybe later" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders static steps when reduced motion is preferred", () => {
    mockMatchMedia(true);
    addGuideTarget("workspace-home.composer");

    render(
      <UpdateDemoGuideModal
        guide={getGuide()}
        releaseNotesUrl={releaseNotesUrl}
        onDismiss={vi.fn()}
        onTryIt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start guide" }));

    expect(screen.getByText("Reduced motion: static walkthrough")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
    expect(screen.getByRole("button", { name: /Start from a project/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Describe the task/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Manage capabilities/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review changes/ })).toBeTruthy();
  });
});
