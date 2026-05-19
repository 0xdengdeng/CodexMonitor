// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSettingsModalState } from "./useSettingsModalState";

describe("useSettingsModalState", () => {
  it("can open the version management settings section directly", () => {
    const { result } = renderHook(() => useSettingsModalState());

    act(() => {
      result.current.openSettings("version");
    });

    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsSection).toBe("version");
  });
});
