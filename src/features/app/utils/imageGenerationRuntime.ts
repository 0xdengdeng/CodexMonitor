import type { AppSettings } from "../../../types";

type ImageGenerationRuntime = {
  nativeImageGenerationEnabled: boolean;
  imageGenerationModel: string | null;
};

export function resolveImageGenerationRuntime(
  runtime: AppSettings["managedRuntime"],
): ImageGenerationRuntime {
  const imageGenerationModel = runtime.imageModel?.trim() || null;
  const nativeImageGenerationEnabled = runtime.nativeImageGeneration !== false;

  return {
    nativeImageGenerationEnabled,
    imageGenerationModel,
  };
}
