import { describe, expect, it, vi } from "vitest";

vi.mock("@services/tauri", () => ({
  readAppLogTail: vi.fn(),
  readDaemonLogTail: vi.fn(),
}));

import { readAppLogTail, readDaemonLogTail } from "@services/tauri";

import { collectDiagnostics } from "./diagnostics";

const mockedReadAppLogTail = vi.mocked(readAppLogTail);
const mockedReadDaemonLogTail = vi.mocked(readDaemonLogTail);

describe("collectDiagnostics", () => {
  it("includes the error plus the app and daemon log tails", async () => {
    mockedReadAppLogTail.mockResolvedValue("app-line-one\napp-line-two");
    mockedReadDaemonLogTail.mockResolvedValue("daemon-line");

    const out = await collectDiagnostics(new Error("boom"));

    expect(out).toContain("Error: boom");
    expect(out).toContain("--- recent app logs ---");
    expect(out).toContain("app-line-two");
    expect(out).toContain("--- recent daemon logs ---");
    expect(out).toContain("daemon-line");
  });

  it("renders a plain string context without a synthetic stack", async () => {
    mockedReadAppLogTail.mockResolvedValue("logs");
    mockedReadDaemonLogTail.mockResolvedValue("d");

    const out = await collectDiagnostics("Title: message");

    expect(out).toContain("Error: Title: message");
    // No stack section: a string context must not produce an "at " stack frame.
    expect(out).not.toContain("\n    at ");
  });

  it("degrades to readable notes when the logs cannot be read", async () => {
    mockedReadAppLogTail.mockRejectedValue(new Error("nope"));
    mockedReadDaemonLogTail.mockRejectedValue(new Error("missing"));

    const out = await collectDiagnostics();

    expect(out).toContain("could not read app log");
    expect(out).toContain("no daemon log");
    expect(out).not.toContain("Error: "); // no error section when none passed
  });
});
