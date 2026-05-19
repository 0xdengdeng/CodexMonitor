# Skill Market Design

## Goal

Add a beginner-friendly Skill installation experience to the Capabilities panel.
Users should be able to discover and install Skills without understanding GitHub,
`CODEX_HOME`, or the `SKILL.md` directory layout.

This design covers Skills only. MCP installation will be designed separately.

## Product Direction

Use an app-store style market.

The install flow opens from the Skills section of the Capabilities dialog. The
market uses a three-column layout:

1. Left column: categories and advanced installation entries.
2. Middle column: searchable Skill cards.
3. Right column: selected Skill details and install target.

This keeps the default flow simple while leaving advanced paths available for
users who already understand local folders or GitHub links.

## Entry Points

- Add an install button to the Skills section header in the Capabilities panel.
- The button opens the Skill Market dialog.
- Each installed user/project Skill row may expose uninstall from a row menu.
- Built-in `.system` Skills do not show uninstall actions.

## Skill Market UI

### Left Column

Show categories:

- All
- Writing and Content
- Code and Engineering
- Design and Images
- Data and Spreadsheets
- Productivity

Show advanced installation entries below categories:

- Import local folder
- Install from link
- Create new Skill

Advanced entries are secondary. They should not be visually dominant.

### Middle Column

Show:

- Search input: "Search skills, for example docs, code review, images"
- Filter chips:
  - Recommended
  - Official picks
  - Installed
  - Available for project
- Skill cards with:
  - Display name
  - Short description
  - Publisher/source badge
  - Category
  - Installed state
  - Install action

Cards should use compact app UI styling consistent with Settings and
Capabilities, not marketing-style hero cards.

### Right Column

Show selected Skill detail:

- Name
- Source badge
- Description
- Category/tags
- What it helps with
- Install target selector:
  - Global: available in all projects
  - Current project: available only in the active workspace
- Install button
- Effect note: "Skill changes apply to new sessions. Current sessions may keep
  the previous skill list."

If there is no active workspace, the project target is disabled.

## Install Targets

Global install target:

```text
<app managed CODEX_HOME>/skills/<skill-name>/SKILL.md
```

For the development app this currently resolves under:

```text
/Users/xiaodeng/Library/Application Support/com.agentdesk.app.dev/codex-home/skills
```

Project install target:

```text
<workspace>/.agents/skills/<skill-name>/SKILL.md
```

The app must not install global Skills into the user's machine-level
`~/.codex/skills` or `~/.agents/skills`.

## Catalog Model

The market should read a catalog of Skill entries. The UI should not expose
GitHub concepts in the default path.

Recommended catalog fields:

```ts
type SkillMarketItem = {
  id: string;
  name: string;
  title: string;
  description: string;
  categories: string[];
  tags: string[];
  publisher: string;
  verified: boolean;
  source: {
    type: "github" | "archive";
    url?: string;
    repo?: string;
    path?: string;
    ref?: string;
  };
};
```

The first implementation can ship with a bundled catalog and keep the data shape
ready for a remote catalog later. A bundled fallback avoids an empty market when
network access fails.

## Install Behavior

Install should:

1. Resolve the requested market item.
2. Download or copy the Skill source.
3. Validate that the source contains `SKILL.md`.
4. Validate the target directory name as a safe slug.
5. Refuse to overwrite an existing Skill unless a future update flow explicitly
   supports replacement.
6. Copy files into the selected target.
7. Refresh the Skills list with `skills/list`.
8. Show the new-session effect note.

Installed state should be determined by the selected target path and the current
Skills list.

## Uninstall Behavior

Uninstall is available only for user-installed global Skills and project Skills.

Uninstall should:

1. Confirm the action.
2. Delete the owning Skill directory.
3. Best-effort remove stale path-based disable rules for that Skill.
4. Refresh the Skills list.
5. Show the new-session effect note.

The app must reject uninstall for:

- Built-in `.system` Skills
- Plugin-provided Skills
- Admin/system Skills
- Paths outside the managed global Skills directory or active workspace
  `.agents/skills`

## Backend Shape

Add shared backend logic first, then expose it through app and daemon surfaces.

Suggested shared module:

```text
src-tauri/src/shared/skills_market_core.rs
```

Suggested commands:

- `skill_market_list`
- `skill_market_install`
- `skill_uninstall`

Suggested frontend service wrappers:

- `listSkillMarketItems`
- `installSkillFromMarket`
- `uninstallSkill`

The backend must own path validation, target resolution, download/copy, and
delete safety checks. The frontend should not construct arbitrary filesystem
write targets.

## Error Handling

Show clear, localized errors for:

- Catalog failed to load
- Skill already installed
- Missing `SKILL.md`
- Invalid Skill name
- Download failed
- Target unavailable because no project is selected
- Uninstall rejected because the Skill is built-in or outside safe roots

The UI should keep the market open after failures so users can retry or choose a
different target.

## Testing

Frontend tests:

- Market opens from Capabilities.
- Categories, search, and selection update the visible cards/detail.
- Project target is disabled without an active workspace.
- Installed cards render installed state.
- Install and uninstall actions call service wrappers with the expected target.
- New-session notice appears after install/uninstall.

Backend tests:

- Global target resolves to managed `CODEX_HOME/skills`.
- Project target resolves to `<workspace>/.agents/skills`.
- Unsafe names and path traversal are rejected.
- Built-in/system Skill uninstall is rejected.
- Local source without `SKILL.md` is rejected.
- Existing target refuses overwrite.
- Successful install refreshes into discoverable Skill layout.

## Out Of Scope

- MCP market and MCP installation.
- Skill update/version management.
- Ratings, reviews, screenshots, and marketplace accounts.
- Automatic recommendation based on project contents.
- Running installed Skill code during installation.
