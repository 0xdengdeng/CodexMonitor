import type { ModelOption } from "@/types";

/**
 * Returns the request model for the saved commit-message selection, or `null`
 * to let the backend fall back to the workspace default.
 *
 * This is a pure runtime guard — it never mutates the persisted setting.
 */
export function effectiveCommitMessageModelId(
  models: ModelOption[],
  savedModelId: string | null,
): string | null {
  if (savedModelId == null) return null;
  const byId = models.find((model) => model.id === savedModelId);
  if (byId) {
    return byId.model;
  }
  return models.some((model) => model.model === savedModelId) ? savedModelId : null;
}
