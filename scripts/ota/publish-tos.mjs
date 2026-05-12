#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TosClient } from "@volcengine/tos-sdk";

const DEFAULT_BUCKET = "qihang-ai";
const DEFAULT_ENDPOINT = "tos-cn-beijing.volces.com";
const DEFAULT_PREFIX = "codexmonitor";
const DEFAULT_PUBLIC_BASE_URL = `https://${DEFAULT_BUCKET}.${DEFAULT_ENDPOINT}`;
const DEFAULT_REGION = "cn-beijing";

const CONTENT_TYPES = new Map([
  [".appimage", "application/octet-stream"],
  [".dmg", "application/x-apple-diskimage"],
  [".exe", "application/vnd.microsoft.portable-executable"],
  [".json", "application/json"],
  [".md", "text/markdown; charset=utf-8"],
  [".msi", "application/octet-stream"],
  [".rpm", "application/x-rpm"],
  [".sig", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".zip", "application/zip"],
]);

function cleanSegment(value) {
  return String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
}

function cleanBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/g, "");
}

function cleanEndpoint(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/g, "");
}

function requireValue(value, name) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

export function buildConfig(env = process.env) {
  const accessKeyId = env.TOS_ACCESS_KEY_ID ?? env.TOS_ACCESS_KEY;
  const accessKeySecret = env.TOS_SECRET_ACCESS_KEY ?? env.TOS_SECRET_KEY;
  const bucket = env.TOS_BUCKET ?? DEFAULT_BUCKET;
  const endpoint = env.TOS_ENDPOINT ?? DEFAULT_ENDPOINT;
  const prefix = env.OTA_PREFIX ?? DEFAULT_PREFIX;
  const publicBaseUrl = env.TOS_PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL;
  const region = env.TOS_REGION ?? DEFAULT_REGION;

  return {
    accessKeyId: requireValue(accessKeyId, "TOS_ACCESS_KEY_ID or TOS_ACCESS_KEY"),
    accessKeySecret: requireValue(
      accessKeySecret,
      "TOS_SECRET_ACCESS_KEY or TOS_SECRET_KEY",
    ),
    artifactsDir: env.OTA_ARTIFACTS_DIR ?? "release-artifacts",
    bucket: requireValue(bucket, "TOS_BUCKET"),
    endpoint: cleanEndpoint(requireValue(endpoint, "TOS_ENDPOINT")),
    prefix: cleanSegment(prefix) || DEFAULT_PREFIX,
    publicBaseUrl: cleanBaseUrl(
      requireValue(publicBaseUrl, "TOS_PUBLIC_BASE_URL"),
    ),
    region: requireValue(region, "TOS_REGION"),
  };
}

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(path.posix.basename(parsed.pathname));
  } catch {
    return decodeURIComponent(path.posix.basename(String(url)));
  }
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function rewriteLatestManifestUrls(manifest, options) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("latest.json must contain a JSON object.");
  }
  const version = String(manifest.version ?? "").trim();
  if (!version) {
    throw new Error("latest.json must include a version.");
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== "object") {
    throw new Error("latest.json must include platforms.");
  }

  const publicBaseUrl = cleanBaseUrl(options.publicBaseUrl);
  const prefix = cleanSegment(options.prefix);
  const rewrittenPlatforms = {};

  for (const [platform, metadata] of Object.entries(platforms)) {
    if (!metadata || typeof metadata !== "object") {
      throw new Error(`Invalid latest.json metadata for ${platform}.`);
    }
    const filename = filenameFromUrl(metadata.url);
    if (!filename) {
      throw new Error(`Missing artifact filename for ${platform}.`);
    }
    rewrittenPlatforms[platform] = {
      ...metadata,
      url: `${publicBaseUrl}/${prefix}/releases/${encodePathSegment(
        version,
      )}/${encodePathSegment(filename)}`,
    };
  }

  return {
    ...manifest,
    platforms: rewrittenPlatforms,
  };
}

export function buildUploadPlan({ artifactsDir, files, prefix, version }) {
  const normalizedArtifactsDir = path.resolve(artifactsDir);
  const latestPath = path.resolve(normalizedArtifactsDir, "latest.json");
  const releasePrefix = `${cleanSegment(prefix)}/releases/${cleanSegment(version)}`;
  const sortedFiles = [...files].sort((a, b) => {
    if (path.resolve(a) === latestPath) {
      return -1;
    }
    if (path.resolve(b) === latestPath) {
      return 1;
    }
    return path.basename(a).localeCompare(path.basename(b));
  });
  const seenFilenames = new Set();

  return sortedFiles.map((filePath) => {
    const resolvedPath = path.resolve(filePath);
    if (resolvedPath === latestPath) {
      return {
        filePath,
        key: `${cleanSegment(prefix)}/latest.json`,
      };
    }

    const filename = path.basename(filePath);
    if (seenFilenames.has(filename)) {
      throw new Error(`Duplicate release artifact filename: ${filename}`);
    }
    seenFilenames.add(filename);
    return {
      filePath,
      key: `${releasePrefix}/${filename}`,
    };
  });
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function contentTypeFor(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  if (basename.endsWith(".tar.gz")) {
    return "application/gzip";
  }
  if (basename.endsWith(".appimage")) {
    return CONTENT_TYPES.get(".appimage");
  }
  return CONTENT_TYPES.get(path.extname(basename)) ?? "application/octet-stream";
}

async function writeTosLatestManifest(config) {
  const latestPath = path.join(config.artifactsDir, "latest.json");
  const manifest = JSON.parse(await fs.readFile(latestPath, "utf8"));
  const rewritten = rewriteLatestManifestUrls(manifest, config);
  await fs.writeFile(latestPath, `${JSON.stringify(rewritten, null, 2)}\n`);
  return rewritten;
}

async function uploadFile(client, config, item) {
  await client.putObjectFromFile({
    bucket: config.bucket,
    contentType: contentTypeFor(item.filePath),
    filePath: item.filePath,
    key: item.key,
  });
}

export async function publishToTos(config = buildConfig()) {
  const artifactsDir = path.resolve(config.artifactsDir);
  const manifest = await writeTosLatestManifest({ ...config, artifactsDir });
  const files = await listFiles(artifactsDir);
  const plan = buildUploadPlan({
    artifactsDir,
    files,
    prefix: config.prefix,
    version: manifest.version,
  });
  const client = new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: config.endpoint,
    region: config.region,
  });

  for (const item of plan) {
    console.log(`Uploading ${item.filePath} -> tos://${config.bucket}/${item.key}`);
    await uploadFile(client, config, item);
  }

  console.log(
    `Published updater manifest: ${config.publicBaseUrl}/${config.prefix}/latest.json`,
  );
  return {
    manifest,
    plan,
  };
}

async function main() {
  try {
    await publishToTos();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
  // TosClient keeps HTTP agent keep-alive sockets open after uploads finish,
  // which holds the event loop and prevents Node from exiting cleanly. Force
  // exit after main() resolves so CI doesn't hang post-upload.
  process.exit(process.exitCode ?? 0);
}
