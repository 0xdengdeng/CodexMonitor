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

export function assertReleaseRuntimeUsesSourceBuild({ release, explicitCodexBin, allowExplicitReleaseRuntime }) {
  if (!release || !explicitCodexBin || allowExplicitReleaseRuntime) return;

  throw new Error(
    `Refusing to sync release Codex runtime from a prebuilt binary.\nPrebuilt runtime: ${explicitCodexBin}\nRelease and beta builds must compile the bundled runtime from ../Codex so protocol fixes are included.\nSet AGENTDESK_ALLOW_PREBUILT_CODEX_RUNTIME_RELEASE=1 only for an intentional, audited runtime override.`,
  );
}

function hasCompletedStatusForVariant(source, variantName) {
  const variantIndex = source.indexOf(`ResponseItem::${variantName}`);
  if (variantIndex === -1) return false;
  const nextVariantIndex = source.indexOf("ResponseItem::", variantIndex + 1);
  const block = source.slice(variantIndex, nextVariantIndex === -1 ? source.length : nextVariantIndex);
  return block.includes('status: "completed".to_string()');
}

export function assertResponsesApiInputStatusSerializationPresent({ commonRsSource, commonRsPath }) {
  const checks = {
    "assistant message":
    commonRsSource.includes('role == "assistant"') &&
    commonRsSource.includes('Some("completed".to_string())') &&
      commonRsSource.includes("Self::Message"),
    reasoning: hasCompletedStatusForVariant(commonRsSource, "Reasoning"),
    function_call: hasCompletedStatusForVariant(commonRsSource, "FunctionCall"),
    function_call_output: hasCompletedStatusForVariant(commonRsSource, "FunctionCallOutput"),
  };
  const missingVariants = Object.entries(checks)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (missingVariants.length === 0) return;

  throw new Error(`Responses API input item status serialization is missing from the Codex runtime source.\nChecked: ${commonRsPath}\nMissing completed status support for: ${missingVariants.join(", ")}\nRelease and beta builds would send invalid continuation history to strict Responses API providers.`);
}
