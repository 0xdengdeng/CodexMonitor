import { normalizeReleaseVersion } from "./postUpdateRelease";
import type { I18nKey } from "@/features/i18n/i18n";

export const STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS =
  "codexmonitor.updateDemo.seenVersions";
export const STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN =
  "codexmonitor.firstLaunchGuide.seen";

export type UpdateDemoGuideImportance = "major" | "minor";
export type UpdateDemoGuideKind = "postUpdate" | "firstLaunch";

export type DemoFocusTarget =
  | "workspace-home.composer"
  | "workspace-home.attachment-button"
  | "workspace-home.image-generation"
  | "workspace-home.run-mode"
  | "settings.capabilities"
  | "settings.ai"
  | "settings.advanced"
  | "home.add-project";

export type UpdateDemoTarget = {
  type: "home" | "workspace-home" | "settings";
  focus?: DemoFocusTarget;
  settingsSection?: string;
};

export type UpdateDemoStep = {
  id: string;
  labelKey: I18nKey;
  captionTitleKey: I18nKey;
  captionBodyKey: I18nKey;
  startMs: number;
  endMs: number;
  focus: DemoFocusTarget;
};

export type UpdateDemoGuide = {
  version: string;
  featureId: string;
  kind: UpdateDemoGuideKind;
  importance: UpdateDemoGuideImportance;
  titleKey: I18nKey;
  subtitleKey: I18nKey;
  durationMs: number;
  steps: UpdateDemoStep[];
  tryIt: UpdateDemoTarget;
};

const updateDemoGuides: UpdateDemoGuide[] = [
  {
    version: normalizeReleaseVersion(__APP_VERSION__),
    featureId: "release-control-console-demo",
    kind: "postUpdate",
    importance: "major",
    titleKey: "updateDemo.releaseConsole.title",
    subtitleKey: "updateDemo.releaseConsole.subtitle",
    durationMs: 28000,
    tryIt: {
      type: "workspace-home",
      focus: "workspace-home.composer",
    },
    steps: [
      {
        id: "project-context",
        labelKey: "updateDemo.releaseConsole.stepProjectContext",
        captionTitleKey: "updateDemo.releaseConsole.projectContextTitle",
        captionBodyKey: "updateDemo.releaseConsole.projectContextBody",
        startMs: 0,
        endMs: 7000,
        focus: "workspace-home.composer",
      },
      {
        id: "task-context",
        labelKey: "updateDemo.releaseConsole.stepTaskContext",
        captionTitleKey: "updateDemo.releaseConsole.taskContextTitle",
        captionBodyKey: "updateDemo.releaseConsole.taskContextBody",
        startMs: 7000,
        endMs: 14000,
        focus: "workspace-home.attachment-button",
      },
      {
        id: "capability-center",
        labelKey: "updateDemo.releaseConsole.stepCapabilities",
        captionTitleKey: "updateDemo.releaseConsole.capabilitiesTitle",
        captionBodyKey: "updateDemo.releaseConsole.capabilitiesBody",
        startMs: 14000,
        endMs: 21000,
        focus: "settings.capabilities",
      },
      {
        id: "review-work",
        labelKey: "updateDemo.releaseConsole.stepReview",
        captionTitleKey: "updateDemo.releaseConsole.reviewTitle",
        captionBodyKey: "updateDemo.releaseConsole.reviewBody",
        startMs: 21000,
        endMs: 28000,
        focus: "workspace-home.run-mode",
      },
    ],
  },
];

const firstLaunchDemoGuide: UpdateDemoGuide = {
  version: normalizeReleaseVersion(__APP_VERSION__),
  featureId: "first-launch-core-workflow",
  kind: "firstLaunch",
  importance: "major",
  titleKey: "updateDemo.firstLaunch.title",
  subtitleKey: "updateDemo.firstLaunch.subtitle",
  durationMs: 24000,
  tryIt: {
    type: "home",
    focus: "home.add-project",
  },
  steps: [
    {
      id: "add-project",
      labelKey: "updateDemo.firstLaunch.stepAddProject",
      captionTitleKey: "updateDemo.firstLaunch.addProjectTitle",
      captionBodyKey: "updateDemo.firstLaunch.addProjectBody",
      startMs: 0,
      endMs: 7000,
      focus: "home.add-project",
    },
    {
      id: "start-thread",
      labelKey: "updateDemo.firstLaunch.stepStartThread",
      captionTitleKey: "updateDemo.firstLaunch.startThreadTitle",
      captionBodyKey: "updateDemo.firstLaunch.startThreadBody",
      startMs: 7000,
      endMs: 16000,
      focus: "workspace-home.composer",
    },
    {
      id: "generate-image",
      labelKey: "updateDemo.firstLaunch.stepGenerateImage",
      captionTitleKey: "updateDemo.firstLaunch.generateImageTitle",
      captionBodyKey: "updateDemo.firstLaunch.generateImageBody",
      startMs: 16000,
      endMs: 24000,
      focus: "workspace-home.image-generation",
    },
  ],
};

function getSeenVersions(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => (typeof value === "string" ? normalizeReleaseVersion(value) : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveSeenVersions(versions: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY_UPDATE_DEMO_SEEN_VERSIONS,
      JSON.stringify(versions),
    );
  } catch {
    // Best-effort persistence.
  }
}

export function hasSeenUpdateDemoGuide(version: string): boolean {
  const normalized = normalizeReleaseVersion(version);
  if (!normalized) {
    return false;
  }
  return getSeenVersions().includes(normalized);
}

export function markUpdateDemoGuideSeen(version: string): void {
  const normalized = normalizeReleaseVersion(version);
  if (!normalized) {
    return;
  }
  const seen = getSeenVersions();
  if (seen.includes(normalized)) {
    return;
  }
  saveSeenVersions([...seen, normalized]);
}

export function hasSeenFirstLaunchGuide(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return (
      window.localStorage.getItem(STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN) === "true"
    );
  } catch {
    return true;
  }
}

export function markFirstLaunchGuideSeen(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY_FIRST_LAUNCH_GUIDE_SEEN, "true");
  } catch {
    // Best-effort persistence.
  }
}

function isValidGuide(guide: UpdateDemoGuide): boolean {
  return (
    Boolean(guide.version) &&
    Boolean(guide.featureId) &&
    guide.durationMs > 0 &&
    guide.steps.length > 0 &&
    guide.steps.every((step) => step.startMs >= 0 && step.endMs > step.startMs)
  );
}

export function resolveUpdateDemoGuide(version: string): UpdateDemoGuide | null {
  const normalized = normalizeReleaseVersion(version);
  if (!normalized) {
    return null;
  }
  const guide =
    updateDemoGuides.find((candidate) => candidate.version === normalized) ?? null;
  if (!guide || !isValidGuide(guide)) {
    return null;
  }
  return guide;
}

export function resolveFirstLaunchDemoGuide(): UpdateDemoGuide | null {
  return isValidGuide(firstLaunchDemoGuide) ? firstLaunchDemoGuide : null;
}
