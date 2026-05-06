import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  resolveInterfaceLanguage,
  translate,
} from "./i18n";

describe("i18n", () => {
  it("defaults to system language preference", () => {
    expect(DEFAULT_INTERFACE_LANGUAGE).toBe("system");
  });

  it("resolves system preference from navigator language", () => {
    expect(resolveInterfaceLanguage("system", "zh-CN")).toBe("zh-CN");
    expect(resolveInterfaceLanguage("system", "en-US")).toBe("en");
  });

  it("falls back to system language for unsupported explicit language values", () => {
    expect(resolveInterfaceLanguage("fr-FR", "zh-CN")).toBe("zh-CN");
  });

  it("returns translated UI strings with English fallback", () => {
    expect(translate("zh-CN", "settings.title")).toBe("设置");
    expect(translate("zh-CN", "missing.key")).toBe("missing.key");
  });
});
