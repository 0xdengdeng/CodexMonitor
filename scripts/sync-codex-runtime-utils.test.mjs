import { describe, expect, it } from "vitest";

import { assertReleaseRuntimeSourceIsClean, assertReleaseRuntimeUsesSourceBuild, assertResponsesApiInputStatusSerializationPresent } from "./sync-codex-runtime-utils.mjs";

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

  it("requires an override for explicit prebuilt runtime binaries in release mode", () => {
    expect(() =>
      assertReleaseRuntimeUsesSourceBuild({
        release: true,
        explicitCodexBin: "/tmp/codex-runtime",
        allowExplicitReleaseRuntime: false,
      }),
    ).toThrow(/Refusing to sync release Codex runtime from a prebuilt binary/);
    expect(() =>
      assertReleaseRuntimeUsesSourceBuild({
        release: true,
        explicitCodexBin: "/tmp/codex-runtime",
        allowExplicitReleaseRuntime: true,
      }),
    ).not.toThrow();
  });
});

describe("Responses API input status serialization guard", () => {
  it("requires completed status serialization for continuation history items", () => {
    expect(() =>
      assertResponsesApiInputStatusSerializationPresent({
        commonRsSource: `
          ResponseItem::FunctionCallOutput { call_id, output } => Self::FunctionCallOutput {
              call_id,
              output,
          },
        `,
        commonRsPath: "/tmp/Codex/codex-rs/codex-api/src/common.rs",
      }),
    ).toThrow(/Responses API input item status serialization/);
    expect(() =>
      assertResponsesApiInputStatusSerializationPresent({
        commonRsSource: `
          ResponseItem::Message { role, content, .. } => Self::Message {
              status: if role == "assistant" { Some("completed".to_string()) } else { None },
          },
          ResponseItem::Reasoning { .. } => Self::Reasoning { status: "completed".to_string() },
          ResponseItem::FunctionCall { .. } => Self::FunctionCall { status: "completed".to_string() },
          ResponseItem::FunctionCallOutput { .. } => Self::FunctionCallOutput {
              status: "completed".to_string(),
          },
        `,
        commonRsPath: "/tmp/Codex/codex-rs/codex-api/src/common.rs",
      }),
    ).not.toThrow();
  });
});
