import { describe, expect, it } from "vitest";
import { getAppDocumentTitle } from "./appTitle";

describe("getAppDocumentTitle", () => {
  it("marks development windows distinctly", () => {
    expect(getAppDocumentTitle(true)).toBe("启航AI智慧平台 Dev");
  });

  it("keeps the production title stable", () => {
    expect(getAppDocumentTitle(false)).toBe("启航AI智慧平台");
  });
});
