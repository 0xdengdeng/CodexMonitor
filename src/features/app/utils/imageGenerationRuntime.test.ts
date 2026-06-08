import { describe, expect, it } from "vitest";

import { resolveImageGenerationRuntime } from "./imageGenerationRuntime";
import type { AppSettings } from "../../../types";

function managedRuntime(
  overrides: Partial<AppSettings["managedRuntime"]> = {},
): AppSettings["managedRuntime"] {
  return {
    enabled: false,
    baseUrl: null,
    model: null,
    imageModel: null,
    nativeImageGeneration: true,
    ...overrides,
  };
}

describe("resolveImageGenerationRuntime", () => {
  it("uses the dynamic app image tool for managed runtime sessions", () => {
    expect(
      resolveImageGenerationRuntime(
        managedRuntime({
          enabled: true,
          baseUrl: "https://adg-uat.zhaozhunai.com/v1",
          imageModel: "doubao-seedream-4-0-250828",
          nativeImageGeneration: true,
        }),
      ),
    ).toEqual({
      nativeImageGenerationEnabled: false,
      imageGenerationModel: "doubao-seedream-4-0-250828",
    });
  });

  it("keeps native image generation for non-managed runtime sessions", () => {
    expect(resolveImageGenerationRuntime(managedRuntime())).toEqual({
      nativeImageGenerationEnabled: true,
      imageGenerationModel: null,
    });
  });

  it("respects explicit native image generation disablement", () => {
    expect(
      resolveImageGenerationRuntime(
        managedRuntime({
          nativeImageGeneration: false,
          imageModel: "gpt-image-2",
        }),
      ),
    ).toEqual({
      nativeImageGenerationEnabled: false,
      imageGenerationModel: "gpt-image-2",
    });
  });
});
