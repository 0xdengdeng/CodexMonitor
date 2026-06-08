import type { AppSettings } from "../../../types";

type ImageGenerationRuntime = {
  nativeImageGenerationEnabled: boolean;
  imageGenerationModel: string | null;
};

function hasManagedRuntime(runtime: AppSettings["managedRuntime"]) {
  return runtime.enabled && Boolean(runtime.baseUrl?.trim());
}

export function resolveImageGenerationRuntime(
  runtime: AppSettings["managedRuntime"],
): ImageGenerationRuntime {
  const imageGenerationModel = runtime.imageModel?.trim() || null;
  const nativeImageGenerationEnabled =
    runtime.nativeImageGeneration !== false && !hasManagedRuntime(runtime);

  return {
    nativeImageGenerationEnabled,
    imageGenerationModel,
  };
}
