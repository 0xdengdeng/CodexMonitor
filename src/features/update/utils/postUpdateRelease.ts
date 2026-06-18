export const STORAGE_KEY_PENDING_POST_UPDATE_VERSION =
  "codexmonitor.pendingPostUpdateVersion";
// Channel-scoped release-notes root. __OTA_PREFIX__ is "codexmonitor" for the
// stable build and "codexmonitor/beta" for the test build (see vite.config.ts),
// so each channel fetches its own release notes.
const TOS_UPDATE_BASE_URL = `https://qihang-ai.tos-cn-beijing.volces.com/${__OTA_PREFIX__}`;

export type PostUpdateReleaseInfo = {
  body: string | null;
  htmlUrl: string;
  tag: string | null;
};

function normalizeStoredVersion(value: string): string {
  let normalized = value.trim();
  while (normalized.startsWith("v") || normalized.startsWith("V")) {
    normalized = normalized.slice(1);
  }
  return normalized.trim();
}

export function normalizeReleaseVersion(value: string): string {
  return normalizeStoredVersion(value);
}

export function buildReleaseTagUrl(version: string): string {
  const normalized = normalizeStoredVersion(version);
  const releaseVersion = normalized.length > 0 ? normalized : "latest";
  return `${TOS_UPDATE_BASE_URL}/releases/${encodeURIComponent(
    releaseVersion,
  )}/release-notes.md`;
}

export function savePendingPostUpdateVersion(version: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeStoredVersion(version);
  if (!normalized) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_PENDING_POST_UPDATE_VERSION,
      normalized,
    );
  } catch {
    // Best-effort persistence.
  }
}

export function loadPendingPostUpdateVersion(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION);
    if (!raw) {
      return null;
    }
    const normalized = normalizeStoredVersion(raw);
    return normalized || null;
  } catch {
    return null;
  }
}

export function clearPendingPostUpdateVersion(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY_PENDING_POST_UPDATE_VERSION);
  } catch {
    // Best-effort persistence.
  }
}

export async function fetchReleaseNotesForVersion(
  version: string,
): Promise<PostUpdateReleaseInfo> {
  const normalized = normalizeStoredVersion(version);
  if (!normalized) {
    throw new Error("Invalid release version.");
  }

  const htmlUrl = buildReleaseTagUrl(normalized);
  const response = await fetch(htmlUrl, {
    headers: {
      Accept: "text/markdown,text/plain,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Release notes request failed (${response.status}).`);
  }

  const body = (await response.text()).trim();
  return {
    body: body || null,
    htmlUrl,
    tag: normalized,
  };
}
