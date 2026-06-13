import { describe, expect, it } from "vitest";

import { assertReleaseRuntimeSourceIsClean } from "./sync-codex-runtime-utils.mjs";

describe("sync codex runtime release guard", () => {
  it("rejects dirty Codex source when syncing a release runtime", () => {
    expect(() =>
      assertReleaseRuntimeSourceIsClean({
        release: true,
        explicitCodexBin: null,
        sourceDirty: true,
        allowDirtyRelease: false,
        codexRepo: "/tmp/Codex",
      }),
    ).toThrow(/Refusing to sync release Codex runtime from a dirty source tree/);
  });

  it("allows dirty Codex source for dev runtime syncs", () => {
    expect(() =>
      assertReleaseRuntimeSourceIsClean({
        release: false,
        explicitCodexBin: null,
        sourceDirty: true,
        allowDirtyRelease: false,
        codexRepo: "/tmp/Codex",
      }),
    ).not.toThrow();
  });

  it("allows explicit prebuilt runtime binaries in release mode", () => {
    expect(() =>
      assertReleaseRuntimeSourceIsClean({
        release: true,
        explicitCodexBin: "/tmp/codex-runtime",
        sourceDirty: true,
        allowDirtyRelease: false,
        codexRepo: "/tmp/Codex",
      }),
    ).not.toThrow();
  });
});
