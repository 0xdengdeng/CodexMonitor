# Enterprise AI Login Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated login dialog for Qihang AI while keeping the existing Settings page as account management.

**Architecture:** The modal is a presentational feature component that calls the existing `enterpriseAiLogin` IPC wrapper and reports the login result upward. `MainApp` owns open/close state, updates app settings and usage after successful login, and routes signed-out sidebar account actions to the modal.

**Tech Stack:** React, Vite, existing design-system `ModalShell`, existing i18n map, Vitest.

---

### Task 1: Login Modal

**Files:**
- Create: `src/features/enterprise-ai/components/EnterpriseAiLoginModal.tsx`
- Create: `src/features/enterprise-ai/components/EnterpriseAiLoginModal.test.tsx`
- Modify: `src/features/i18n/i18n.tsx`
- Modify: `src/App.tsx`

- [x] Add a focused modal with tenant domain and API Key fields.
- [x] Validate empty fields locally before calling `enterpriseAiLogin`.
- [x] Emit the existing `EnterpriseAiLoginResult` to the parent after success.
- [x] Add tests for validation, submission, and success callback.

### Task 2: App Wiring

**Files:**
- Modify: `src/features/app/components/AppModals.tsx`
- Modify: `src/features/app/components/MainApp.tsx`

- [x] Lazy-load the login modal in the central modal host.
- [x] Add `MainApp` state for the standalone login modal.
- [x] Route signed-out account/login actions to the modal.
- [x] Preserve Settings as account management.

### Task 3: Verification

- [x] Run `npm run typecheck`.
- [x] Run focused modal and sidebar tests.
- [x] Commit the completed change.
