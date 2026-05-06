import { describe, expect, it } from "vitest";
import { getTranslation } from "./useTranslation";

describe("getTranslation", () => {
  it("returns Chinese strings", () => {
    expect(getTranslation("zh-CN", "app.language.switcherLabel")).toBe(
      "切换语言",
    );
    expect(getTranslation("zh-CN", "app.language.english")).toBe("EN");
  });

  it("returns English strings", () => {
    expect(getTranslation("en-US", "app.language.switcherLabel")).toBe(
      "Switch language",
    );
    expect(getTranslation("en-US", "app.language.chinese")).toBe("中文");
  });

  it("falls back to the translation key when a string is missing", () => {
    expect(getTranslation("zh-CN", "missing.translation.key")).toBe(
      "missing.translation.key",
    );
  });
});
