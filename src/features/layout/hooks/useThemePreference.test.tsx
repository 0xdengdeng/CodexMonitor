/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemePreference } from "./useThemePreference";

describe("useThemePreference", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-switching");
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-switching");
  });

  it("temporarily disables transitions while applying an explicit theme", () => {
    renderHook(() => useThemePreference("dark"));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme-switching")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(document.documentElement.hasAttribute("data-theme-switching")).toBe(false);
  });

  it("clears the explicit theme for system mode without transitions", () => {
    document.documentElement.dataset.theme = "light";

    renderHook(() => useThemePreference("system"));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.getAttribute("data-theme-switching")).toBe("true");
  });
});
