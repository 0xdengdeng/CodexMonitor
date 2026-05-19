import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tauriDir = path.join(repoRoot, "src-tauri");
const binariesDir = path.join(tauriDir, "binaries");
const resourcesGitDir = path.join(tauriDir, "resources", "git");
const buildRoot = path.join(tauriDir, "target", "bundled-git");

const GIT_VERSION = process.env.AGENTDESK_GIT_VERSION || "2.54.0";
const GIT_SOURCE_URL =
  process.env.AGENTDESK_GIT_SOURCE_URL ||
  `https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.xz`;
const GIT_SOURCE_SHA256 =
  process.env.AGENTDESK_GIT_SOURCE_SHA256 ||
  "f689162364c10de79ef89aa8dbf48731eb057e34edbbd20aca510ce0154681a3";
const WRAPPER_MARKER = "AGENTDESK_BUNDLED_GIT_WRAPPER";
const DISTRIBUTION_LAYOUT_VERSION = "symlink-layout-v1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? "pipe",
    encoding: options.encoding ?? "utf8",
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

function targetTriple() {
  return (
    process.env.AGENTDESK_GIT_TARGET ||
    process.env.CODEX_MONITOR_GIT_TARGET ||
    process.env.TAURI_TARGET_TRIPLE ||
    process.env.CARGO_BUILD_TARGET ||
    hostTriple()
  );
}

function gitBinaryName() {
  return process.platform === "win32" ? "git.exe" : "git";
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function download(url, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  run("curl", ["-L", "--fail", "--retry", "3", "-o", targetPath, url], {
    stdio: "inherit",
  });
}

function copyDirectory(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

function verifyGitDistribution(distributionDir) {
  const gitBin = path.join(distributionDir, "bin", gitBinaryName());
  const gitExecPath = path.join(distributionDir, "libexec", "git-core");
  const templatesDir = path.join(distributionDir, "share", "git-core", "templates");
  if (!fs.existsSync(gitBin)) {
    throw new Error(`Bundled Git binary was not created at ${gitBin}`);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(gitBin, 0o755);
  }
  if (!fs.existsSync(gitExecPath)) {
    throw new Error(`Bundled Git exec path was not created at ${gitExecPath}`);
  }
  if (!fs.existsSync(templatesDir)) {
    throw new Error(`Bundled Git templates were not created at ${templatesDir}`);
  }
  return run(gitBin, ["--version"], {
    env: {
      GIT_EXEC_PATH: gitExecPath,
      GIT_TEMPLATE_DIR: templatesDir,
      PATH: [path.join(distributionDir, "bin"), gitExecPath, process.env.PATH ?? ""].join(
        path.delimiter,
      ),
    },
  });
}

function writeLauncher(targetBinary, triple) {
  if (process.platform === "win32") {
    throw new Error(
      "Bundled Git launcher generation for Windows is not implemented yet. Set AGENTDESK_GIT_DIST to a prepared Git distribution and add a native launcher before building Windows packages.",
    );
  }

  const launcher = `#!/bin/sh
# ${WRAPPER_MARKER}
set -eu

target_triple="${triple}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

try_exec() {
  dist_dir="$1"
  shift
  if [ -x "$dist_dir/bin/git" ]; then
    export GIT_EXEC_PATH="$dist_dir/libexec/git-core"
    export GIT_TEMPLATE_DIR="$dist_dir/share/git-core/templates"
    export PATH="$dist_dir/bin:$dist_dir/libexec/git-core:\${PATH:-/usr/bin:/bin}"
    exec "$dist_dir/bin/git" "$@"
  fi
}

if [ -n "\${AGENTDESK_BUNDLED_GIT_DIR:-}" ]; then
  try_exec "$AGENTDESK_BUNDLED_GIT_DIR" "$@"
fi

try_exec "$script_dir/../Resources/resources/git/$target_triple" "$@"
try_exec "$script_dir/resources/git/$target_triple" "$@"
try_exec "$script_dir/../resources/git/$target_triple" "$@"
try_exec "$script_dir/../../resources/git/$target_triple" "$@"

echo "Bundled Git distribution not found for $target_triple." >&2
echo "Tried app resources and src-tauri/resources/git/$target_triple." >&2
exit 127
`;

  fs.mkdirSync(path.dirname(targetBinary), { recursive: true });
  fs.writeFileSync(targetBinary, launcher);
  fs.chmodSync(targetBinary, 0o755);
}

function existingManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function isAlreadySynced(manifestPath, targetBinary, distributionDir, triple) {
  const manifest = existingManifest(manifestPath);
  if (
    manifest?.version !== GIT_VERSION ||
    manifest?.targetTriple !== triple ||
    manifest?.mode !== "source-build" ||
    manifest?.layoutVersion !== DISTRIBUTION_LAYOUT_VERSION
  ) {
    return false;
  }
  if (!fs.existsSync(targetBinary) || !fs.existsSync(distributionDir)) {
    return false;
  }
  try {
    verifyGitDistribution(distributionDir);
    return true;
  } catch {
    return false;
  }
}

function buildFromSource(distributionDir, triple) {
  if (process.platform === "win32") {
    throw new Error(
      "Building bundled Git from source is not supported on Windows in this script yet.",
    );
  }

  const archivePath = path.join(buildRoot, `git-${GIT_VERSION}.tar.xz`);
  const sourceDir = path.join(buildRoot, `git-${GIT_VERSION}`);
  const installDir = path.join(buildRoot, `install-${triple}`);

  if (!fs.existsSync(archivePath)) {
    console.log(`Downloading Git ${GIT_VERSION} source...`);
    download(GIT_SOURCE_URL, archivePath);
  }
  const actualSha = sha256(archivePath);
  if (actualSha !== GIT_SOURCE_SHA256) {
    throw new Error(
      `Git source checksum mismatch for ${archivePath}. Expected ${GIT_SOURCE_SHA256}, got ${actualSha}.`,
    );
  }

  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(installDir, { recursive: true, force: true });
  run("tar", ["-xf", archivePath, "-C", buildRoot], { stdio: "inherit" });

  const jobs = String(os.cpus().length || 4);
  const makeVars = [
    `prefix=${installDir}`,
    "NO_GETTEXT=1",
    "NO_TCLTK=1",
    "NO_PERL=1",
    "NO_PYTHON=1",
    "INSTALL_SYMLINKS=1",
    "NO_REGEX=NeedsStartEnd",
  ];
  run("make", [`-j${jobs}`, ...makeVars, "all"], {
    cwd: sourceDir,
    stdio: "inherit",
  });
  run("make", [...makeVars, "install"], {
    cwd: sourceDir,
    stdio: "inherit",
  });

  copyDirectory(installDir, distributionDir);
}

function syncGit() {
  const triple = targetTriple();
  const sidecarName = process.platform === "win32" ? `git-${triple}.exe` : `git-${triple}`;
  const targetBinary = path.join(binariesDir, sidecarName);
  const manifestPath = `${targetBinary}.json`;
  const distributionDir = path.join(resourcesGitDir, triple);
  const explicitDistribution =
    process.env.AGENTDESK_GIT_DIST || process.env.CODEX_MONITOR_GIT_DIST || null;

  if (!explicitDistribution && isAlreadySynced(manifestPath, targetBinary, distributionDir, triple)) {
    const version = verifyGitDistribution(distributionDir);
    console.log(`Bundled Git already synced: ${path.relative(repoRoot, distributionDir)} (${version})`);
    return;
  }

  fs.mkdirSync(buildRoot, { recursive: true });
  fs.mkdirSync(resourcesGitDir, { recursive: true });

  const mode = explicitDistribution ? "provided-distribution" : "source-build";
  if (explicitDistribution) {
    copyDirectory(path.resolve(explicitDistribution), distributionDir);
  } else {
    buildFromSource(distributionDir, triple);
  }

  const version = verifyGitDistribution(distributionDir);
  writeLauncher(targetBinary, triple);
  const launcherVersion = run(targetBinary, ["--version"], {
    env: { AGENTDESK_BUNDLED_GIT_DIR: distributionDir },
  });
  if (launcherVersion !== version) {
    throw new Error(`Bundled Git launcher verification mismatch: ${launcherVersion} != ${version}`);
  }

  const manifest = {
    mode,
    layoutVersion: DISTRIBUTION_LAYOUT_VERSION,
    targetBinary,
    distributionDir,
    targetTriple: triple,
    version: GIT_VERSION,
    gitVersionOutput: version,
    sourceUrl: explicitDistribution ? null : GIT_SOURCE_URL,
    sourceSha256: explicitDistribution ? null : GIT_SOURCE_SHA256,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `Synced bundled Git: ${path.relative(repoRoot, targetBinary)} -> ${path.relative(
      repoRoot,
      distributionDir,
    )} (${version})`,
  );
}

syncGit();
