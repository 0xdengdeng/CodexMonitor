#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorCodexDir = join(repoRoot, "vendor", "codex");
const codexRsDir = join(vendorCodexDir, "codex-rs");
const bundledDir = join(repoRoot, "src-tauri", "resources", "codex-bundled");
const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const profile = args.has("--debug") ? "debug" : "release";

function fail(message) {
  console.error(`[build-bundled-codex] ${message}`);
  process.exit(1);
}

function ensureDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(
      `${label} not found at ${path}. Add the product Codex fork submodule at vendor/codex first.`,
    );
  }
}

ensureDirectory(vendorCodexDir, "Codex fork submodule");
ensureDirectory(codexRsDir, "Codex Rust workspace");

if (!skipBuild) {
  const cargoArgs = ["build", "--bin", "codex"];
  if (profile === "release") {
    cargoArgs.push("--release");
  }
  const result = spawnSync("cargo", cargoArgs, {
    cwd: codexRsDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`cargo ${cargoArgs.join(" ")} failed`);
  }
}

const sourceBinary = join(codexRsDir, "target", profile, binaryName);
if (!existsSync(sourceBinary) || !statSync(sourceBinary).isFile()) {
  fail(
    `Built Codex binary not found at ${sourceBinary}. Run without --skip-build or check the fork build output.`,
  );
}

mkdirSync(bundledDir, { recursive: true });
const destination = join(bundledDir, binaryName);
copyFileSync(sourceBinary, destination);

console.log(
  JSON.stringify(
    {
      ok: true,
      source: sourceBinary,
      destination,
      profile,
    },
    null,
    2,
  ),
);
