# Post-Update Demo Guide Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the post-update simulated demo guide modal for demo-worthy app updates.

**Architecture:** Keep release detection in the existing updater path, add a focused update-demo registry/storage/resolver layer under `src/features/update`, and render a modal via the existing app modal surface. The release-notes toast remains the fallback when a version has no demo guide or when the guide is dismissed.

**Tech Stack:** React 19, TypeScript, Vitest/jsdom, localStorage, existing `ModalShell`, existing updater hooks, existing i18n map.

---

## File Structure

- Create `src/features/update/utils/updateDemoGuides.ts`: local versioned demo registry, storage helpers, resolver, and public types.
- Create `src/features/update/utils/updateDemoGuides.test.ts`: resolver and seen-version TDD coverage.
- Create `src/features/update/hooks/useUpdateDemoPlayback.ts`: reduced-motion detection and play/pause/replay timeline state.
- Create `src/features/update/hooks/useUpdateDemoPlayback.test.tsx`: playback and reduced-motion TDD coverage.
- Create `src/features/update/components/UpdateDemoGuideModal.tsx`: modal UI, animated scene, static fallback, controls.
- Create `src/features/update/components/UpdateDemoGuideModal.test.tsx`: UI behavior coverage.
- Modify `src/features/update/hooks/useUpdater.ts`: expose `postUpdateDemoGuide`, dismissal, and try-it actions; suppress toast when demo is active.
- Modify `src/features/update/hooks/useUpdater.test.ts`: post-update demo integration tests.
- Modify `src/features/app/hooks/useUpdaterController.ts`: pass through demo state/actions.
- Modify `src/features/app/components/AppModals.tsx`: render `UpdateDemoGuideModal`.
- Modify `src/features/app/components/MainApp.tsx`: wire demo props and a minimal try-it navigation handler.
- Modify `src/features/layout/hooks/layoutNodes/types.ts`: suppress/update toast via current props only if needed.
- Modify `src/features/update/components/UpdateToast.tsx`: no behavior change unless needed.
- Modify `src/features/i18n/i18n.tsx`: add English/Chinese copy.
- Modify `src/App.tsx`: import demo CSS.
- Create `src/styles/update-demo-guide.css`: modal/reel styles with reduced-motion rules.

## Task 1: Demo Registry And Persistence

- [ ] Write failing resolver/storage tests in `src/features/update/utils/updateDemoGuides.test.ts`.
- [ ] Run `npm run test -- src/features/update/utils/updateDemoGuides.test.ts` and confirm failures are due to missing module/API.
- [ ] Implement `updateDemoGuides.ts` with registry lookup, version normalization, localStorage seen versions, and fail-closed validation.
- [ ] Run the focused test and confirm pass.

## Task 2: Updater Integration

- [ ] Add failing tests to `src/features/update/hooks/useUpdater.test.ts` for: configured current-version demo wins over release-notes toast; dismissing/trying clears pending marker and marks seen; seen version falls back to no demo.
- [ ] Run `npm run test -- src/features/update/hooks/useUpdater.test.ts` and confirm failures.
- [ ] Extend `useUpdater` to expose `postUpdateDemoGuide`, `dismissPostUpdateDemoGuide`, and `tryPostUpdateDemoGuide`.
- [ ] Run updater tests and confirm pass.

## Task 3: Playback Hook

- [ ] Write failing tests for `useUpdateDemoPlayback`: autoplay by default, pause/replay controls, static mode when `prefers-reduced-motion: reduce`.
- [ ] Run focused test and confirm failures.
- [ ] Implement the hook with interval-free timer state where practical and deterministic controls.
- [ ] Run focused test and confirm pass.

## Task 4: Modal Component

- [ ] Write failing component tests for rendering title/caption/controls, skip, release notes, try-it, and reduced-motion static fallback.
- [ ] Run focused test and confirm failures.
- [ ] Implement `UpdateDemoGuideModal.tsx` using `ModalShell`.
- [ ] Add `update-demo-guide.css` and import it from `src/App.tsx`.
- [ ] Run component tests and confirm pass.

## Task 5: App Wiring

- [ ] Add/adjust tests if existing app-level tests cover modal prop wiring; otherwise keep this as typed integration.
- [ ] Wire `useUpdaterController`, `MainApp`, and `AppModals` so the modal appears before update toast.
- [ ] Implement minimal `Try it` navigation: `home` selects Home; `settings` opens target section; `workspace-home` selects the active workspace when present, otherwise Home.
- [ ] Run targeted update/app tests touched by this task.

## Task 6: Verification

- [ ] Run `npm run test -- src/features/update`.
- [ ] Run `npm run test`.
- [ ] Run `npm run typecheck`.
- [ ] Inspect `git diff --stat` and `git status --short` to ensure unrelated Rust changes remain untouched.
