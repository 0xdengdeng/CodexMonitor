import { describe, expect, it } from "vitest";
import { parseModelListResponse } from "./modelListResponse";

describe("parseModelListResponse", () => {
  it("uses displayName when present", () => {
    const response = {
      result: {
        data: [
          { id: "m1", model: "gpt-5.3-codex-spark", displayName: "GPT-5.3-Codex-Spark" },
        ],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("GPT-5.3-Codex-Spark");
  });

  it("uses the raw model slug when displayName is missing", () => {
    const response = {
      result: {
        data: [{ id: "m1", model: "gpt-5.3-codex" }],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("gpt-5.3-codex");
  });

  it("uses the raw model slug when displayName is an empty string", () => {
    const response = {
      result: {
        data: [{ id: "m1", model: "gpt-5.1-codex-mini", displayName: "" }],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("gpt-5.1-codex-mini");
  });

  it("preserves displayName when it equals the model slug", () => {
    const response = {
      result: {
        data: [{ id: "m1", model: "gpt-5.3-codex", displayName: "gpt-5.3-codex" }],
      },
    };
    const [model] = parseModelListResponse(response);
    expect(model.displayName).toBe("gpt-5.3-codex");
  });

  it("preserves displayName when it differs from the slug", () => {
    const response = {
      result: {
        data: [
          { id: "m1", model: "gpt-5.3-codex-spark", displayName: "GPT-5.3-Codex-Spark" },
          { id: "m2", model: "gpt-5.2-codex", displayName: "gpt-5.2-codex" },
        ],
      },
    };
    const models = parseModelListResponse(response);
    expect(models[0].displayName).toBe("GPT-5.3-Codex-Spark");
    expect(models[1].displayName).toBe("gpt-5.2-codex");
  });

  it("maps ADG public aliases from top-level data", () => {
    const response = {
      object: "list",
      data: [
        {
          id: "adg-pro",
          object: "model",
          owned_by: "adg",
          display_name: "ADG Pro",
        },
      ],
    };

    const [model] = parseModelListResponse(response);

    expect(model).toMatchObject({
      id: "adg-pro",
      model: "adg-pro",
      displayName: "ADG Pro",
    });
  });

  it("maps runtime model catalog entries from top-level models", () => {
    const response = {
      fetched_at: "2026-06-10T03:13:21.815954Z",
      data: [{ id: "gpt-5.5", object: "model" }],
      models: [
        {
          slug: "gpt-5.5",
          display_name: "GPT-5.5",
          supported_reasoning_levels: [
            { effort: "low", description: "Fast" },
            { effort: "medium", description: "Balanced" },
            { effort: "high", description: "Deep" },
          ],
          default_reasoning_level: "medium",
        },
      ],
    };

    const [model] = parseModelListResponse(response);

    expect(model).toMatchObject({
      id: "gpt-5.5",
      model: "gpt-5.5",
      displayName: "GPT-5.5",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "medium", description: "Balanced" },
        { reasoningEffort: "high", description: "Deep" },
      ],
      defaultReasoningEffort: "medium",
    });
  });

  it("prefers runtime model catalog metadata from JSON-RPC result models", () => {
    const response = {
      result: {
        data: [{ id: "gpt-5.4", object: "model" }],
        models: [
          {
            slug: "gpt-5.4",
            display_name: "GPT-5.4",
            supported_reasoning_levels: [
              { effort: "low", description: "Fast" },
              { effort: "xhigh", description: "Extra deep" },
            ],
            default_reasoning_level: "xhigh",
          },
        ],
      },
    };

    const [model] = parseModelListResponse(response);

    expect(model).toMatchObject({
      id: "gpt-5.4",
      model: "gpt-5.4",
      displayName: "GPT-5.4",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "xhigh", description: "Extra deep" },
      ],
      defaultReasoningEffort: "xhigh",
    });
  });

  it("maps ADG image model metadata from app image catalog", () => {
    const response = {
      object: "list",
      data: [
        {
          id: "gpt-image-2",
          object: "model",
          type: "image",
          display_name: "ADG Image",
          capabilities: { image: true },
          supported_endpoints: ["/v1/images/generations", "/v1/images/edits"],
        },
      ],
    };

    const [model] = parseModelListResponse(response);

    expect(model).toMatchObject({
      id: "gpt-image-2",
      model: "gpt-image-2",
      displayName: "ADG Image",
      type: "image",
      capabilities: { image: true },
      supportedEndpoints: ["/v1/images/generations", "/v1/images/edits"],
    });
  });

  it("uses the id when the ADG image catalog returns a null model field", () => {
    const response = {
      object: "list",
      data: [{ id: "gpt-image-2", model: null, object: "model" }],
    };

    const [model] = parseModelListResponse(response);

    expect(model).toMatchObject({
      id: "gpt-image-2",
      model: "gpt-image-2",
      displayName: "gpt-image-2",
    });
  });
});
