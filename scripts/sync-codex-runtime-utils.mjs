export function isTruthyEnv(value) {
  return /^(1|true|yes)$/i.test(String(value ?? "").trim());
}

export function assertReleaseRuntimeSourceIsClean({
  release,
  explicitCodexBin,
  sourceDirty,
  allowDirtyRelease,
  codexRepo,
}) {
  if (!release || explicitCodexBin || !sourceDirty || allowDirtyRelease) {
    return;
  }

  throw new Error(
    [
      "Refusing to sync release Codex runtime from a dirty source tree.",
      `Codex repo: ${codexRepo}`,
      "Commit or stash ../Codex changes first, or set AGENTDESK_ALLOW_DIRTY_CODEX_RUNTIME_RELEASE=1 for an intentional local-only build.",
    ].join("\n"),
  );
}
