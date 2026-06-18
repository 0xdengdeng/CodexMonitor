import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertReleaseRuntimeUsesSourceBuild, assertReleaseRuntimeSourceIsClean, assertResponsesApiInputStatusSerializationPresent, isTruthyEnv } from "./sync-codex-runtime-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcTauriDir = path.join(repoRoot, "src-tauri");
const binariesDir = path.join(srcTauriDir, "binaries");
const release = process.argv.includes("--release");
const skipBuild = process.argv.includes("--skip-build");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }

  return (result.stdout ?? "").trim();
}

function hostTriple() {
  const output = run("rustc", ["-vV"]);
  const match = output.match(/^host:\s+(.+)$/m);
  if (!match) {
    throw new Error("Unable to read Rust host target triple from `rustc -vV`.");
  }
  return match[1].trim();
}

function gitValue(cwd, args, fallback = null) {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return fallback;
  }
  return (result.stdout ?? "").trim() || fallback;
}

const explicitTargetTriple =
  process.env.AGENTDESK_CODEX_TARGET ||
  process.env.CODEX_MONITOR_CODEX_TARGET ||
  process.env.TAURI_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  null;
const targetTriple = explicitTargetTriple || hostTriple();
const codexRepo = path.resolve(
  process.env.AGENTDESK_CODEX_REPO ??
    process.env.CODEX_MONITOR_CODEX_REPO ??
    path.join(repoRoot, "..", "Codex"),
);
const codexRsDir = path.join(codexRepo, "codex-rs");
const profile = release ? "release" : "debug";
const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
const sidecarName =
  process.platform === "win32"
    ? `codex-runtime-${targetTriple}.exe`
    : `codex-runtime-${targetTriple}`;
const explicitCodexBin = process.env.AGENTDESK_CODEX_BIN ?? process.env.CODEX_MONITOR_CODEX_BIN;
const sourceBinary = explicitCodexBin
  ? path.resolve(explicitCodexBin)
  : path.join(
      codexRsDir,
      "target",
      explicitTargetTriple ? targetTriple : "",
      profile,
      binaryName,
    );
const targetBinary = path.join(binariesDir, sidecarName);
const sourceCommit = gitValue(codexRepo, ["rev-parse", "HEAD"]);
const sourceDirty = Boolean(gitValue(codexRepo, ["status", "--porcelain"]));
const allowDirtyRelease = isTruthyEnv(process.env.AGENTDESK_ALLOW_DIRTY_CODEX_RUNTIME_RELEASE);
const allowExplicitReleaseRuntime = isTruthyEnv(process.env.AGENTDESK_ALLOW_PREBUILT_CODEX_RUNTIME_RELEASE);

if (!explicitCodexBin && !fs.existsSync(codexRsDir)) {
  throw new Error(
    `Codex runtime source not found at ${codexRsDir}. Set AGENTDESK_CODEX_REPO to your Codex fork, or AGENTDESK_CODEX_BIN to a prebuilt binary.`,
  );
}

assertReleaseRuntimeSourceIsClean({
  release,
  explicitCodexBin,
  sourceDirty,
  allowDirtyRelease,
  codexRepo,
});

assertReleaseRuntimeUsesSourceBuild({
  release,
  explicitCodexBin,
  allowExplicitReleaseRuntime,
});

if (release && !explicitCodexBin) {
  const commonRsPath = path.join(codexRsDir, "codex-api", "src", "common.rs");
  const commonRsSource = fs.readFileSync(commonRsPath, "utf8");
  assertResponsesApiInputStatusSerializationPresent({
    commonRsSource,
    commonRsPath,
  });
}

if (!skipBuild && !explicitCodexBin) {
  const args = ["build", "-p", "codex-cli", "--bin", "codex"];
  if (release) {
    args.push("--release");
  }
  if (explicitTargetTriple) {
    args.push("--target", targetTriple);
  }

  console.log(`Building Codex runtime from ${codexRsDir} (${profile}, ${targetTriple})...`);
  run("cargo", args, { cwd: codexRsDir, stdio: "inherit" });
}

if (!fs.existsSync(sourceBinary)) {
  throw new Error(`Built Codex runtime not found at ${sourceBinary}.`);
}

fs.mkdirSync(binariesDir, { recursive: true });
fs.copyFileSync(sourceBinary, targetBinary);
if (process.platform !== "win32") {
  fs.chmodSync(targetBinary, 0o755);
}

const manifest = {
  sourceRepo: codexRepo,
  sourceCommit,
  sourceDirty,
  sourceBinary,
  targetBinary,
  targetTriple,
  profile,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(`${targetBinary}.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Synced bundled Codex runtime: ${path.relative(repoRoot, targetBinary)}`);

warnIfRuntimeProcessRunning();

// A running app/daemon keeps the PREVIOUS codex-runtime binary loaded until it
// is restarted, so a fresh sync silently has no effect on an already-running
// AgentDesk. Surface that loudly here instead of letting it run stale. Advisory
// only: skip quietly where `pgrep` is unavailable (Windows / minimal images) —
// this is a dev-ergonomics nudge, not a correctness gate.
function warnIfRuntimeProcessRunning() {
  if (process.platform === "win32") return;
  let result;
  try {
    result = spawnSync("pgrep", ["-f", "codex-runtime app-server"], { encoding: "utf8" });
  } catch {
    return; // pgrep not present; nothing to advise.
  }
  if (result.status === 0 && result.stdout.trim() !== "") {
    console.warn(
      "\n⚠️  A codex-runtime app-server is still running the PREVIOUS binary.\n" +
        "   Restart AgentDesk (or the daemon) to load the runtime you just synced —\n" +
        "   the running process holds the old binary in memory until then.\n",
    );
  }
}
