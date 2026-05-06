# Web-First I18n And Theme Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first Web-first frontend slice visible in `npm run dev`: default light P2 enterprise-blue theme, an i18n foundation, and a persistent Chinese/English switch in the global topbar.

**Architecture:** Keep native calls behind existing settings persistence. Add a small frontend i18n module and a focused topbar language switcher. Store language preference in `AppSettings` so Web/Tauri behavior stays aligned.

**Tech Stack:** React 19, Vite, TypeScript, Vitest, CSS custom properties, Tauri Rust settings serialization.

---

## Chunk 1: Settings Defaults And Language Preference

### Task 1: Extend Settings Model

**Files:**
- Modify: `src/types.ts`
- Modify: `src/features/settings/hooks/useAppSettings.ts`
- Modify: `src/features/settings/hooks/useAppSettings.test.ts`
- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Write failing tests**
  - Update `useAppSettings.test.ts` to assert defaults use `theme: "light"` and `language: "zh-CN"`.
  - Add normalization assertions that invalid language falls back to `zh-CN`.

- [ ] **Step 2: Verify tests fail**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/features/settings/hooks/useAppSettings.test.ts`

- [ ] **Step 3: Implement minimal TypeScript settings changes**
  - Add `LanguagePreference = "zh-CN" | "en-US"`.
  - Add `language` to `AppSettings`.
  - Add default `language: "zh-CN"` and default `theme: "light"`.
  - Normalize language through an allow-list.

- [ ] **Step 4: Add Rust settings field**
  - Add `language` with serde rename/default to `src-tauri/src/types.rs`.
  - Add default value `zh-CN`.
  - Keep change small and avoid unrelated settings refactors.

- [ ] **Step 5: Verify targeted tests pass**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/features/settings/hooks/useAppSettings.test.ts`

## Chunk 2: I18n Foundation And Topbar Switch

### Task 2: Add Minimal I18n Module

**Files:**
- Create: `src/i18n/languages.ts`
- Create: `src/i18n/strings.ts`
- Create: `src/i18n/useTranslation.ts`
- Create: `src/i18n/useTranslation.test.tsx`

- [ ] **Step 1: Write failing tests**
  - Test Chinese and English lookup for topbar language labels.
  - Test fallback when a key is missing.

- [ ] **Step 2: Verify tests fail**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/i18n/useTranslation.test.tsx`

- [ ] **Step 3: Implement minimal i18n module**
  - Export language metadata for `zh-CN` and `en-US`.
  - Export `getTranslation(language, key)`.
  - Export `useTranslation(language)`.

- [ ] **Step 4: Verify targeted tests pass**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/i18n/useTranslation.test.tsx`

### Task 3: Add Global Topbar Language Switch

**Files:**
- Create: `src/features/app/components/LanguageSwitcher.tsx`
- Create: `src/features/app/components/LanguageSwitcher.test.tsx`
- Modify: `src/features/app/hooks/useMainAppShellProps.tsx`
- Modify: `src/features/app/components/MainApp.tsx`
- Modify: `src/styles/main.css`

- [ ] **Step 1: Write failing component test**
  - Render `LanguageSwitcher`.
  - Assert it shows current language.
  - Click it and assert `onChangeLanguage` receives the other language.

- [ ] **Step 2: Verify test fails**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/features/app/components/LanguageSwitcher.test.tsx`

- [ ] **Step 3: Implement switcher**
  - Use a compact segmented control with `中文` and `EN`.
  - Add accessible labels from i18n.
  - Keep it small enough for main topbar.

- [ ] **Step 4: Wire persistence**
  - Pass `language` and update handler from `MainApp` into shell props.
  - On switch, call `queueSaveSettings({ ...appSettings, language })`.
  - Preserve existing remote live indicator by rendering both nodes in topbar actions.

- [ ] **Step 5: Verify targeted tests pass**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/features/app/components/LanguageSwitcher.test.tsx`

## Chunk 3: Enterprise Blue Token Layer

### Task 4: Add Enterprise Token CSS

**Files:**
- Create: `src/styles/enterprise-theme.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add token CSS**
  - Add P2 light tokens and restrained dark tokens.
  - Override only shared variables already used by the app.
  - Avoid large component-specific styling.

- [ ] **Step 2: Import CSS**
  - Import after theme CSS so enterprise tokens win.

- [ ] **Step 3: Verify build health**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run typecheck`
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run test -- src/features/settings/hooks/useAppSettings.test.ts src/i18n/useTranslation.test.tsx src/features/app/components/LanguageSwitcher.test.tsx`

## Chunk 4: Run Web Dev Preview

### Task 5: Start Web Dev Server

**Files:**
- No source changes expected.

- [ ] **Step 1: Start Vite**
  - Run: `PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH" npm run dev -- --host 127.0.0.1`

- [ ] **Step 2: Report URL**
  - Provide the localhost URL for Web-first preview.
  - Note any desktop-only missing functionality as expected.
