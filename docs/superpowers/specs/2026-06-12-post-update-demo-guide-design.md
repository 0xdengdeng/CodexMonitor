# Post-Update Demo Guide Design

## Goal

CodexMonitor should show a short, video-like product demo after selected feature updates. The demo is not a recorded video file. It is an in-app animated reconstruction of the relevant UI, driven by a small versioned configuration, with clear controls to pause, replay, skip, read release notes, or try the feature in the real app.

The experience helps returning users understand meaningful workflow changes without turning the home screen into a marketing page or forcing a long onboarding tour.

## Product Decision

Use the **in-product simulated demo reel** pattern.

The selected pattern shows a compact modal after the app relaunches from an update. The modal contains:

- A version-aware "What's new" header.
- One animated UI scene that demonstrates the changed workflow.
- A short timeline with 2-4 steps.
- Controls: Pause, Replay, Skip, Release notes, and Try it.
- A reduced-motion fallback that shows the same steps as static frames.

This replaces the idea of a text-only post-update toast for demo-worthy releases. Bugfix-only and low-importance releases continue using the existing release-notes toast behavior.

## Current State

The app already has a post-update path:

- `useUpdater` saves a pending post-update version before relaunch.
- After restart, `useUpdater` loads the pending version, fetches GitHub release notes, and exposes `postUpdateNotice`.
- `UpdateToast` displays loading, ready, and fallback release-note states.
- The post-update marker is cleared when the notice is dismissed.

This design extends that path. It does not replace update download/install behavior.

## Users And Moment

Audience:

- Existing users who just installed a new version.
- Users who already understand the basic project/thread model.
- Power users who may skip demos quickly but still need to notice major workflow changes.

Moment:

- First app launch after a successful update.
- Only when the current version has a configured demo-worthy change.
- Not on every launch and not for every patch release.

Success criteria:

- Users can understand what changed within roughly 20-30 seconds.
- Users have one clear next action: try the feature where it lives.
- Dismissed demos do not return for the same version.
- Motion-sensitive users receive an equivalent static explanation.

## UX Behavior

### Default Flow

1. App restarts after update.
2. `useUpdater` detects the pending version and release-note URL as it does today.
3. The app checks whether that version has an `UpdateDemoGuide` config.
4. If a demo exists and has not been dismissed, show the demo modal.
5. The demo starts playing automatically unless the user prefers reduced motion.
6. The user can pause, replay, skip, open release notes, or try the feature.
7. `Try it` closes the modal, clears the pending marker, navigates to the target surface, and shows a one-time contextual highlight when feasible.

### Reduced-Motion Flow

When `prefers-reduced-motion: reduce` matches:

- Do not autoplay moving scenes.
- Show the same demo steps as static frames.
- Keep `Replay` available only if it replays static step progression or is hidden.
- Preserve `Try it`, `Release notes`, and `Skip`.

### Dismissal Rules

- `Skip`, close, Escape, and `Try it` all mark the demo as seen for the current version.
- Opening release notes does not dismiss the modal by itself.
- The release-notes fallback remains available if demo config is missing or invalid.
- Dismissal should be stored separately from the pending update marker so future manual "What's new" entry points can re-open the content if added later.

## Content Model

Use a manual, local registry first. This keeps quality high and avoids accidentally promoting routine bug fixes as feature demos.

```ts
type UpdateDemoGuide = {
  version: string;
  featureId: string;
  importance: "major" | "minor";
  titleKey: string;
  subtitleKey: string;
  durationMs: number;
  releaseNotesUrl?: string;
  steps: UpdateDemoStep[];
  tryIt: UpdateDemoTarget;
};

type UpdateDemoStep = {
  id: string;
  labelKey: string;
  captionTitleKey: string;
  captionBodyKey: string;
  startMs: number;
  endMs: number;
  focus: DemoFocusTarget;
};

type DemoFocusTarget =
  | "workspace-home.composer"
  | "workspace-home.attachment-button"
  | "workspace-home.run-mode"
  | "settings.ai"
  | "settings.advanced"
  | "home.add-project";

type UpdateDemoTarget = {
  type: "home" | "workspace-home" | "settings";
  focus?: DemoFocusTarget;
  settingsSection?: string;
};
```

Rules:

- One primary demo per version for the first implementation.
- Keep copy in `src/features/i18n/i18n.tsx`; registry entries reference keys.
- If future releases need multiple demos, show one primary demo and add the rest to release notes or a later "What's new" center.
- Invalid configs fail closed to the existing release-notes toast.

## UI Structure

Primary component:

- `UpdateDemoGuideModal`

Supporting pieces:

- `UpdateDemoReel`: the animated scene and timeline.
- `UpdateDemoControls`: pause, replay, skip, release notes, try it.
- `UpdateDemoStaticSteps`: reduced-motion/static fallback.
- `useUpdateDemoGuide`: resolves config, dismissed state, playback state, and actions.

Use existing design system primitives:

- Use `ModalShell` for the modal shell and accessibility structure.
- Reuse existing button, toast, and color token conventions where available.
- Do not create a second modal shell style.

The visual direction should stay utilitarian and product-native:

- Light, crisp UI reconstruction of the actual app surface.
- No full-screen marketing hero.
- No large decorative gradients or ornamental backgrounds.
- Animation exists to explain the workflow, not to show off.

## Integration Points

Update flow:

- Extend `useUpdater` or `useUpdaterController` to resolve a `postUpdateDemoGuide`.
- Keep existing `postUpdateNotice` as the fallback release-notes path.
- `UpdateToast` should not render when the demo modal is active.

Layout:

- Render the modal through the same top-level layout/modal path used by other app modals.
- Keep the existing toast viewport for normal update states.

Navigation:

- `Try it` should call a typed handler from app orchestration.
- For `home`, select Home.
- For `workspace-home`, use the active workspace if available; otherwise select Home and show the add-project related target if the feature depends on a project.
- For `settings`, open the requested settings section.

Highlight:

- The first implementation can support a minimal focus highlight for known targets.
- If the target is not mounted or no workspace exists, fail gracefully by navigating to the closest relevant surface without showing a broken highlight.
- Highlights are one-time and do not block interaction.

## Accessibility

Requirements:

- Modal has an accessible name and description.
- Keyboard users can reach every control.
- Escape closes and marks the demo as seen.
- Autoplaying motion longer than five seconds has a pause mechanism.
- Respect `prefers-reduced-motion`.
- Captions and step text contain the essential information; visual motion is not the only explanation.

External guidance:

- W3C WCAG 2.2 "Pause, Stop, Hide" explains that automatically moving content needs a way to pause, stop, or hide it.
- MDN documents `prefers-reduced-motion` as the media query for reducing animations for users who request it at the OS level.

## Persistence

Suggested localStorage keys:

```text
codexmonitor.updateDemo.seenVersions
codexmonitor.updateDemo.lastDismissedFeature
```

The pending post-update version key remains owned by the existing updater path. The demo should clear or consume it only after the user dismisses, tries, or the release-note fallback is dismissed.

## Out Of Scope

- Shipping recorded video files.
- A full "What's new center" or update history page.
- Remote CMS-driven announcement campaigns.
- User segmentation beyond version and local app state.
- Multi-demo playlists in the first implementation.
- Analytics instrumentation, unless a later task adds an app-wide analytics policy.

## Testing Plan

Focused tests:

- Registry resolver returns a guide only for matching versions with valid config.
- Seen-version storage suppresses repeated display for the same version.
- Demo guide wins over release-notes toast when configured.
- Existing release-note toast still appears when no guide exists.
- `Skip`, close, Escape, and `Try it` mark the guide as seen.
- `Release notes` opens the URL without dismissing.
- Reduced-motion mode renders static steps and disables autoplay.
- `Try it` calls the correct navigation handler for home, workspace-home, and settings targets.

Manual smoke checks:

- Launch with a mocked pending version that has a guide.
- Launch with a pending version that has no guide.
- Toggle OS/browser reduced motion and verify static fallback.
- Verify keyboard tab order and Escape behavior.

## Rollout

Phase 1:

- Add the local registry and modal for one configured demo.
- Integrate with the existing post-update notice flow.
- Preserve existing release notes as fallback.

Phase 2:

- Add contextual one-time highlights for the most important targets.
- Add a manual "What's new" entry point if product wants replay outside the post-update moment.

Phase 3:

- Consider remote config only if release cadence makes local registry maintenance painful.

## References

- W3C WCAG 2.2 Understanding SC 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- MDN, Using media queries for accessibility: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility
- Flows feature announcement examples and best practices: https://flows.sh/examples/feature-announcement
- AnnounceKit feature announcement guide: https://announcekit.app/blog/new-feature-announcement-with-examples/
