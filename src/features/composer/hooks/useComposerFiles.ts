import { pickFiles } from "../../../services/tauri";
import { useDraftAttachments } from "./useDraftAttachments";

type UseComposerFilesArgs = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
};

// Non-image file attachments. Unlike images these are passed to the agent as
// paths (it reads them on demand with its own tools), so there is no data-URL
// conversion — the picker and drop just collect local paths.
export function useComposerFiles({
  activeThreadId,
  activeWorkspaceId,
}: UseComposerFilesArgs) {
  const {
    active,
    attach,
    pickAndAttach,
    remove,
    clearActive,
    setForThread,
    removeForThread,
  } = useDraftAttachments({
    activeThreadId,
    activeWorkspaceId,
    pick: pickFiles,
  });

  return {
    activeFiles: active,
    attachFiles: attach,
    pickFiles: pickAndAttach,
    removeFile: remove,
    clearActiveFiles: clearActive,
    setFilesForThread: setForThread,
    removeFilesForThread: removeForThread,
  };
}
