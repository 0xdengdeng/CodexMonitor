// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveUpdateDemoGuide } from "../utils/updateDemoGuides";
import { useUpdateDemoPlayback } from "./useUpdateDemoPlayback";

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

describe("useUpdateDemoPlayback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("autoplays and advances the active step", () => {
    const guide = resolveUpdateDemoGuide(__APP_VERSION__);
    if (!guide) {
      throw new Error("Expected demo guide");
    }

    const { result } = renderHook(() => useUpdateDemoPlayback(guide));

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.activeStep.id).toBe("project-context");

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(result.current.activeStep.id).toBe("task-context");
    expect(result.current.progress).toBeGreaterThan(0);
  });

  it("pauses and replays the demo", () => {
    const guide = resolveUpdateDemoGuide(__APP_VERSION__);
    if (!guide) {
      throw new Error("Expected demo guide");
    }

    const { result } = renderHook(() => useUpdateDemoPlayback(guide));

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(result.current.activeStep.id).toBe("task-context");

    act(() => {
      result.current.pause();
      vi.advanceTimersByTime(9000);
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.activeStep.id).toBe("task-context");

    act(() => {
      result.current.replay();
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.activeStep.id).toBe("project-context");
    expect(result.current.progress).toBe(0);
  });

  it("seeks to a specific step from the timeline", () => {
    const guide = resolveUpdateDemoGuide(__APP_VERSION__);
    if (!guide) {
      throw new Error("Expected demo guide");
    }

    const { result } = renderHook(() => useUpdateDemoPlayback(guide));

    act(() => {
      result.current.seekToStep("review-work");
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.activeStep.id).toBe("review-work");
    expect(result.current.progress).toBeGreaterThan(60);
  });

  it("uses static mode when reduced motion is preferred", () => {
    mockMatchMedia(true);
    const guide = resolveUpdateDemoGuide(__APP_VERSION__);
    if (!guide) {
      throw new Error("Expected demo guide");
    }

    const { result } = renderHook(() => useUpdateDemoPlayback(guide));

    expect(result.current.prefersReducedMotion).toBe(true);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.usesStaticSteps).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(result.current.activeStep.id).toBe("project-context");
    expect(result.current.progress).toBe(0);
  });
});
