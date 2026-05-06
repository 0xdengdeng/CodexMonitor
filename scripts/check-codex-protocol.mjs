#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorCodexDir = join(repoRoot, "vendor", "codex");
const protocolDir = join(
  vendorCodexDir,
  "codex-rs",
  "app-server-protocol",
  "src",
  "protocol",
);

function fail(message) {
  console.error(`[check-codex-protocol] ${message}`);
  process.exit(1);
}

function ensureDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(
      `${label} not found at ${path}. Add/update the product Codex fork submodule before checking protocol drift.`,
    );
  }
}

function walkFiles(path) {
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".rs") ? [entryPath] : [];
  });
}

function extractMethodStrings(source) {
  const methods = new Set();
  const stringLiteralPattern = /"([a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)+)"/g;
  for (const match of source.matchAll(stringLiteralPattern)) {
    methods.add(match[1]);
  }
  return [...methods].sort();
}

ensureDirectory(vendorCodexDir, "Codex fork submodule");
ensureDirectory(protocolDir, "Codex app-server protocol directory");

const files = walkFiles(protocolDir);
const methods = new Set();
for (const file of files) {
  for (const method of extractMethodStrings(readFileSync(file, "utf8"))) {
    methods.add(method);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      protocolDir,
      filesScanned: files.length,
      methodCount: methods.size,
      methods: [...methods].sort(),
    },
    null,
    2,
  ),
);
