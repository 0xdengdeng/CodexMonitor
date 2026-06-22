import { pickImageFiles } from "../../../services/tauri";
import { useDraftAttachments } from "./useDraftAttachments";

type UseComposerImagesArgs = {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
};

export function useComposerImages({
  activeThreadId,
  activeWorkspaceId,
}: UseComposerImagesArgs) {
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
    pick: pickImageFiles,
  });

  return {
    activeImages: active,
    attachImages: attach,
    pickImages: pickAndAttach,
    removeImage: remove,
    clearActiveImages: clearActive,
    setImagesForThread: setForThread,
    removeImagesForThread: removeForThread,
  };
}
