import { describe, expect, it, vi } from "vitest";

vi.mock("@services/tauri", () => ({ readAppLogTail: vi.fn() }));

import { readAppLogTail } from "@services/tauri";

import { collectDiagnostics } from "./diagnostics";

const mockedReadAppLogTail = vi.mocked(readAppLogTail);

describe("collectDiagnostics", () => {
  it("includes the error and the recent log tail", async () => {
    mockedReadAppLogTail.mockResolvedValue("line-one\nline-two");

    const out = await collectDiagnostics(new Error("boom"));

    expect(out).toContain("Error: boom");
    expect(out).toContain("--- recent logs ---");
    expect(out).toContain("line-two");
  });

  it("degrades to a readable note when the log read fails", async () => {
    mockedReadAppLogTail.mockRejectedValue(new Error("nope"));

    const out = await collectDiagnostics();

    expect(out).toContain("could not read app log");
    expect(out).not.toContain("Error: "); // no error section when none passed
  });
});
