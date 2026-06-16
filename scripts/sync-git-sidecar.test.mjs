import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = new URL("../", import.meta.url);
const scriptSource = join(repoRoot.pathname, "scripts/sync-git-sidecar.mjs");
const tempRoots = [];

function makeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function makeFakeGitDistribution(root) {
  const dist = join(root, "fake-git");
  const bin = join(dist, "bin");
  const gitCore = join(dist, "libexec/git-core");
  const templates = join(dist, "share/git-core/templates");
  mkdirSync(bin, { recursive: true });
  mkdirSync(gitCore, { recursive: true });
  mkdirSync(templates, { recursive: true });

  const git = join(bin, "git");
  const remoteHttp = join(gitCore, "git-remote-http");
  makeExecutable(git, "#!/bin/sh\necho 'git version fake'\n");
  makeExecutable(remoteHttp, "#!/bin/sh\nexit 0\n");

  symlinkSync(git, join(bin, "git-receive-pack"));
  symlinkSync(git, join(gitCore, "git-status"));
  symlinkSync(remoteHttp, join(gitCore, "git-remote-https"));

  return dist;
}

function runSyncGitSidecar(root, distribution) {
  const scriptsDir = join(root, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = join(scriptsDir, "sync-git-sidecar.mjs");
  cpSync(scriptSource, scriptPath);

  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      AGENTDESK_GIT_DIST: distribution,
      AGENTDESK_GIT_TARGET: "aarch64-apple-darwin",
    },
    encoding: "utf8",
  });
}

describe("sync-git-sidecar", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes Git builtin symlink aliases while materializing helper aliases", () => {
    const root = mkdtempSync(join(tmpdir(), "sync-git-sidecar-test-"));
    tempRoots.push(root);
    const distribution = makeFakeGitDistribution(root);

    const result = runSyncGitSidecar(root, distribution);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const synced = join(
      root,
      "src-tauri/resources/git/aarch64-apple-darwin",
    );
    expect(existsSync(join(synced, "bin/git-receive-pack"))).toBe(false);
    expect(existsSync(join(synced, "libexec/git-core/git-status"))).toBe(false);

    const remoteHttps = join(synced, "libexec/git-core/git-remote-https");
    expect(existsSync(remoteHttps)).toBe(true);
    expect(lstatSync(remoteHttps).isSymbolicLink()).toBe(false);
    expect(readFileSync(remoteHttps, "utf8")).toBe(
      readFileSync(join(synced, "libexec/git-core/git-remote-http"), "utf8"),
    );
  });
});
