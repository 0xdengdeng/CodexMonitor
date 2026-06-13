// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN,
  STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
  hasSeenFirstLaunchGuide,
  hasSeenUpdateDemoGuide,
  markFirstLaunchGuideSeen,
  markUpdateDemoGuideSeen,
  resolveFirstLaunchDemoGuide,
  resolveUpdateDemoGuide,
} from "./updateDemoGuides";

describe("updateDemoGuides", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("resolves the configured current-version guide", () => {
    const guide = resolveUpdateDemoGuide(__APP_VERSION__);

    expect(guide).toMatchObject({
      version: __APP_VERSION__,
      featureId: "release-control-console-demo",
      kind: "postUpdate",
      importance: "major",
      tryIt: {
        type: "workspace-home",
        focus: "workspace-home.composer",
      },
    });
    expect(guide?.steps.map((step) => step.id)).toEqual([
      "project-context",
      "task-context",
      "capability-center",
      "review-work",
    ]);
  });

  it("resolves the first-launch guide independently from release versions", () => {
    const guide = resolveFirstLaunchDemoGuide();

    expect(guide).toMatchObject({
      version: __APP_VERSION__,
      featureId: "first-launch-core-workflow",
      kind: "firstLaunch",
      importance: "major",
      tryIt: {
        type: "home",
        focus: "home.add-project",
      },
    });
    expect(guide?.steps).toHaveLength(3);
  });

  it("normalizes v-prefixed versions before lookup", () => {
    const guide = resolveUpdateDemoGuide(`v${__APP_VERSION__}`);

    expect(guide?.version).toBe(__APP_VERSION__);
  });

  it("returns null for unknown versions", () => {
    expect(resolveUpdateDemoGuide("0.0.0")).toBeNull();
  });

  it("tracks seen versions without duplicating entries", () => {
    expect(hasSeenUpdateDemoGuide(__APP_VERSION__)).toBe(false);

    markUpdateDemoGuideSeen(__APP_VERSION__);
    markUpdateDemoGuideSeen(`v${__APP_VERSION__}`);

    expect(hasSeenUpdateDemoGuide(__APP_VERSION__)).toBe(true);
    expect(
      JSON.parse(
        window.localStorage.getItem(STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS) ?? "[]",
      ),
    ).toEqual([__APP_VERSION__]);
  });

  it("ignores corrupt seen-version storage", () => {
    window.localStorage.setItem(STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS, "{bad");

    expect(hasSeenUpdateDemoGuide(__APP_VERSION__)).toBe(false);
  });

  it("tracks the first-launch guide separately from update demo versions", () => {
    expect(hasSeenFirstLaunchGuide()).toBe(false);

    markFirstLaunchGuideSeen();

    expect(hasSeenFirstLaunchGuide()).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN)).toBe(
      "true",
    );
    expect(
      window.localStorage.getItem(STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS),
    ).toBeNull();
  });
});
