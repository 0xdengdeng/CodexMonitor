import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, formatRelativeTimeShort } from "./time";

describe("relative time formatting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the existing compact English labels by default", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(formatRelativeTimeShort(1_000_000)).toBe("now");
    expect(formatRelativeTimeShort(1_000_000 - 2 * 60_000)).toBe("2m");
    expect(formatRelativeTime(1_000_000 - 30_000)).toBe("30s ago");
  });

  it("formats compact relative labels for Chinese UI", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(formatRelativeTimeShort(1_000_000)).toBe("now");
    expect(formatRelativeTimeShort(1_000_000, "zh-CN")).toBe("刚刚");
    expect(formatRelativeTimeShort(1_000_000 - 2 * 60_000, "zh-CN")).toBe(
      "2分",
    );
    expect(formatRelativeTime(1_000_000 - 30_000, "zh-CN")).toBe("30秒前");
  });
});
