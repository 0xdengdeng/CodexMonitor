// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPlatformSession,
  loadPlatformSession,
  savePlatformSession,
} from "./platformSession";

describe("platformSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves a tenant domain with a masked API key", () => {
    const session = savePlatformSession({
      tenantDomain: " acme ",
      apiKey: "sk-platform-secret-123456",
    });

    expect(session).toEqual({
      tenantDomain: "acme",
      keyPreview: "sk-p...3456",
      signedInAt: expect.any(Number),
    });
    expect(window.localStorage.getItem("enterprise-platform-session")).toContain(
      "acme",
    );
    expect(window.localStorage.getItem("enterprise-platform-session")).not.toContain(
      "sk-platform-secret-123456",
    );
  });

  it("loads and clears a saved session", () => {
    savePlatformSession({
      tenantDomain: "demo",
      apiKey: "token-abcdef",
    });

    expect(loadPlatformSession()?.tenantDomain).toBe("demo");

    clearPlatformSession();

    expect(loadPlatformSession()).toBeNull();
  });
});
