import { describe, expect, it } from "vitest";
import { buildItemForDisplay } from "./threadItemEventHelpers";

describe("threadItemEventHelpers", () => {
  it("adds lifecycle status for snake_case image generation items", () => {
    expect(
      buildItemForDisplay(
        { type: "image_generation_call", id: "image-native-1" },
        true,
        "turn-1",
      ),
    ).toMatchObject({
      type: "image_generation_call",
      id: "turn-1:image-native-1",
      callId: "image-native-1",
      status: "inProgress",
    });
  });
});
