# Team Settings Episodes Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the episode switches and templates out of Team Settings > Info into a new "Episodes" tab.

**Architecture:** A new `team_episodes_tab` component, connected like `team_info_tab`, owns tasks/revisions/canvas
state and the two templates, reusing `TeamTasksSection` and `TeamEpisodeTemplatesSection` as they are. The modal
lists it after Info; `TeamSettings` renders it for `activeTab === 'episodes'`. Info drops those fields.

**Tech Stack:** React, Redux (`patchTeam`), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-team-settings-episodes-tab-design.md`

## Global Constraints

- Webapp only; no server or API change.
- Talk to the user in Turkish. Never run `make i18n-extract`; add i18n with `scratchpad/i18n_add.py`
  (`team_settings_modal.episodesTab` "Episodes" / tr "Bölümler"; `generic_icons.episodes` "Episodes Icon" / tr "Bölümler Simgesi").
- Checks from `webapp/channels`: `TZ=UTC timeout 280 npx jest src/components/team_settings src/components/team_settings_modal`, `npx tsc --noEmit -p .`, `npx eslint <changed files> | grep -v linebreak`.

## Review Focus

1. Unsaved changes on Episodes block switching to another tab, like Info.
2. Saving on Info no longer sends `tasks_enabled`/`revisions_enabled`/`canvas_enabled`, so it cannot undo a change saved on Episodes in the same modal session.
3. A rejected template still shows its error under the right field, and Cancel restores every Episodes field.
4. Turning tasks or revisions off hides the templates but keeps their text, as today.

---

### Task 1: Episodes tab

**Files:**
- Create: `webapp/channels/src/components/team_settings/team_episodes_tab/index.ts` (connect with `actions: {patchTeam}`; `OwnProps` same shape as Info's)
- Create: `webapp/channels/src/components/team_settings/team_episodes_tab/team_episodes_tab.tsx`
- Create: `webapp/channels/src/components/team_settings/team_episodes_tab/team_episodes_tab.test.tsx`
- Modify: `webapp/channels/src/components/team_settings/team_info_tab/team_info_tab.tsx`, `team_info_tab.test.tsx`
- Move: `team_tasks_section.tsx`, `team_episode_templates_section.tsx` into `team_episodes_tab/`

**Interfaces:**
- Produces: default export `EpisodesTab` with `OwnProps = {team; areThereUnsavedChanges; showTabSwitchError; setAreThereUnsavedChanges; setShowTabSwitchError}`.
- The panel root: `<div className='modal-info-tab-content user-settings' id='episodesSettings' aria-labelledby='episodesButton' role='tabpanel'>`.
- Patch on save: `{id, tasks_enabled, revisions_enabled, canvas_enabled}` plus `episode_folders`/`episode_tasks` only when changed; no save call when nothing changed.

- [ ] **Step 1: Write the failing tests** by moving these Info tests to `team_episodes_tab.test.tsx`, rendering `EpisodesTab`:
  `revision channels can be turned on only together with tasks`, `canvas channels can be toggled independently of tasks`,
  the `episode templates` describe (3 tests), `cancel restores the canvas toggle`. Add
  `'saving sends only the episode fields'` (toggle canvas, save → `patchTeam` called with exactly `{id, tasks_enabled, revisions_enabled, canvas_enabled}`),
  and to Info `'the Info tab has no episode settings'` (no `Tasks`/`Canvas` switches, no template fields; saving a renamed team sends no `tasks_enabled`).
- [ ] **Step 2: Run** `TZ=UTC npx jest src/components/team_settings`. Expected: the moved and new tests FAIL (module missing / Info still has the fields).
- [ ] **Step 3: Implement** the tab with the state, handlers, save/cancel and error mapping moved from Info; remove them from Info.
- [ ] **Step 4: Run** the Checks. Expected: all pass, no new lint errors.
- [ ] **Step 5: Commit** "Move the episode settings to their own Team Settings tab".

### Task 2: Show the tab

**Files:**
- Modify: `webapp/channels/src/components/team_settings_modal/team_settings_modal.tsx` (tab `{name: 'episodes', uiName: Episodes, icon: 'icon icon-video-outline', iconTitle}` after Info)
- Modify: `webapp/channels/src/components/team_settings/team_settings.tsx` (`case 'episodes'` renders `EpisodesTab` with the same props as Info)
- Modify: `webapp/channels/src/i18n/en.json`, `tr.json`
- Test: `webapp/channels/src/components/team_settings_modal/team_settings_modal.test.tsx`

- [ ] **Step 1: Write the failing test** `'the Episodes tab follows Info and opens the episode settings'`: the tab list starts `Info, Episodes`; clicking Episodes shows the Tasks switch.
- [ ] **Step 2: Run** the modal suite. Expected: FAIL.
- [ ] **Step 3: Implement** the tab entry, the switch case and the i18n strings.
- [ ] **Step 4: Run** the Checks. Expected: all pass.
- [ ] **Step 5: Commit** "Add the Episodes tab to Team Settings".

### Task 3: Live check

- [ ] **Step 1:** `npm run build`; open http://localhost:8066, Team Settings.
- [ ] **Step 2:** Check: Info no longer shows the switches/templates; Episodes shows them; change a template, try switching tabs (blocked), save, reopen (kept); Cancel restores.
- [ ] **Step 3:** Fix anything found with a failing test first; commit.
