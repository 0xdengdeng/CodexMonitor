import { describe, expect, it } from "vitest";
import {
  buildConfig,
  buildUploadPlan,
  rewriteLatestManifestUrls,
} from "./publish-tos.mjs";

describe("publish-tos helpers", () => {
  it("uses Beijing TOS defaults and credential aliases", () => {
    const config = buildConfig({
      TOS_ACCESS_KEY: "ak",
      TOS_SECRET_KEY: "sk",
    });

    expect(config).toMatchObject({
      accessKeyId: "ak",
      accessKeySecret: "sk",
      bucket: "qihang-ai",
      endpoint: "tos-cn-beijing.volces.com",
      prefix: "codexmonitor",
      publicBaseUrl: "https://qihang-ai.tos-cn-beijing.volces.com",
      region: "cn-beijing",
      rewriteArtifactUrls: true,
      uploadReferencedArtifacts: true,
    });
  });

  it("allows publishing only the stable TOS manifest with existing artifact urls", () => {
    const config = buildConfig({
      TOS_ACCESS_KEY: "ak",
      TOS_SECRET_KEY: "sk",
      TOS_REWRITE_ARTIFACT_URLS: "false",
      TOS_UPLOAD_REFERENCED_ARTIFACTS: "false",
    });

    expect(config.rewriteArtifactUrls).toBe(false);
    expect(config.uploadReferencedArtifacts).toBe(false);
  });

  it("rewrites latest.json platform urls to the public TOS release path", () => {
    const manifest = {
      version: "0.7.69",
      platforms: {
        "darwin-aarch64": {
          url: "https://github.com/owner/repo/releases/download/v0.7.69/AgentDesk.app.tar.gz",
          signature: "sig",
        },
        "windows-x86_64": {
          url: "https://github.com/owner/repo/releases/download/v0.7.69/AgentDesk%20Setup.exe",
          signature: "win-sig",
        },
      },
    };

    const rewritten = rewriteLatestManifestUrls(manifest, {
      prefix: "codexmonitor",
      publicBaseUrl: "https://qihang-ai.tos-cn-beijing.volces.com/",
    });

    expect(rewritten.platforms["darwin-aarch64"].url).toBe(
      "https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/0.7.69/AgentDesk.app.tar.gz",
    );
    expect(rewritten.platforms["windows-x86_64"].url).toBe(
      "https://qihang-ai.tos-cn-beijing.volces.com/codexmonitor/releases/0.7.69/AgentDesk%20Setup.exe",
    );
    expect(rewritten.platforms["windows-x86_64"].signature).toBe("win-sig");
  });

  it("builds a flattened upload plan with latest.json at the stable key last", () => {
    const plan = buildUploadPlan({
      artifactsDir: "/tmp/release-artifacts",
      files: [
        "/tmp/release-artifacts/latest.json",
        "/tmp/release-artifacts/AgentDesk.app.tar.gz",
        "/tmp/release-artifacts/nested/AgentDesk.AppImage",
      ],
      prefix: "codexmonitor",
      referencedFilenames: new Set(["AgentDesk.app.tar.gz"]),
      version: "0.7.69",
    });

    expect(plan).toEqual([
      {
        filePath: "/tmp/release-artifacts/AgentDesk.app.tar.gz",
        key: "codexmonitor/releases/0.7.69/AgentDesk.app.tar.gz",
      },
      {
        filePath: "/tmp/release-artifacts/latest.json",
        key: "codexmonitor/latest.json",
      },
    ]);
  });
});
