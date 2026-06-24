import { useCallback, useMemo, useState } from "react";

type UseDraftAttachmentsArgs = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  pick: () => Promise<string[]>;
};

// Per-draft list of attachment paths, keyed by thread id (or a per-workspace
// draft key before a thread exists). Shared state machine behind both the image
// and file composer channels so they stay behaviorally identical.
export function useDraftAttachments({
  activeThreadId,
  activeWorkspaceId,
  pick,
}: UseDraftAttachmentsArgs) {
  const [byThread, setByThread] = useState<Record<string, string[]>>({});

  const draftKey = useMemo(
    () => activeThreadId ?? `draft-${activeWorkspaceId ?? "none"}`,
    [activeThreadId, activeWorkspaceId],
  );

  const active = byThread[draftKey] ?? [];

  const attach = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }
      setByThread((prev) => {
        const existing = prev[draftKey] ?? [];
        const merged = Array.from(new Set([...existing, ...paths]));
        return { ...prev, [draftKey]: merged };
      });
    },
    [draftKey],
  );

  const pickAndAttach = useCallback(async () => {
    const picked = await pick();
    if (picked.length === 0) {
      return;
    }
    attach(picked);
  }, [attach, pick]);

  const remove = useCallback(
    (path: string) => {
      setByThread((prev) => {
        const existing = prev[draftKey] ?? [];
        const next = existing.filter((entry) => entry !== path);
        if (next.length === 0) {
          const { [draftKey]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [draftKey]: next };
      });
    },
    [draftKey],
  );

  const clearActive = useCallback(() => {
    setByThread((prev) => {
      if (!(draftKey in prev)) {
        return prev;
      }
      const { [draftKey]: _, ...rest } = prev;
      return rest;
    });
  }, [draftKey]);

  const setForThread = useCallback((threadId: string, paths: string[]) => {
    setByThread((prev) => ({ ...prev, [threadId]: paths }));
  }, []);

  const removeForThread = useCallback((threadId: string) => {
    setByThread((prev) => {
      if (!(threadId in prev)) {
        return prev;
      }
      const { [threadId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    active,
    attach,
    pickAndAttach,
    remove,
    clearActive,
    setForThread,
    removeForThread,
  };
}
