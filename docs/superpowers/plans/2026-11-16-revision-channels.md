# Revision Channels as Real Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn revision channels into ordinary chat channels created from Add Channels, with a Messages | Revisions tab bar, behind a per-team toggle.

**Architecture:** A `TaskSection` gains `ChannelId`; the section linked to a channel holds the video and its revisions (tasks), so all existing video/revision/notification code is reused. The webapp wraps the channel view's center in `RevisionTabs`, which shows tabs only for linked channels.

**Tech Stack:** Go (server, Postgres), React/Redux (webapp), jest, api4 Docker tests.

**Spec:** `docs/superpowers/specs/2026-11-16-revision-channels-design.md`

## Global Constraints

- Revision feature is on only when `team.tasks_enabled && team.revisions_enabled`.
- Creating a revision channel needs `manage_team_tasks`.
- Migration 246 is unreleased: extend it, don't add 247; apply the new columns to the dev DB by hand.
- CRLF files keep CRLF (Python edit scripts with `newline=''`; gofmt via `tr -d '\r' | gofmt | sed 's/$/\r/'`).
- Server `en.json` sorted with descriptions; `tr.json` keeps order, new keys appended. Webapp i18n via formatjs extract, every new string gets a description.
- No commits (user's rule).

## Review Focus

- A channel from another team, an archived channel, or one already linked must be refused as a link target (400).
- Turning revisions off must hide the tab and the menu item, and the server must refuse new video uploads (403).
- Video upload failing after channel creation must leave neither the channel nor the section behind.
- Opening `?revision=<id>` on a linked channel opens the Revisions tab with that revision selected.
- Channels with no linked section must render exactly as before (no tab bar).

---

### Task 1: Server — team toggle, section channel link, notification link

**Files:**
- Modify: `server/public/model/team.go`, `server/public/model/task.go`, `server/public/model/team_test.go` (if Patch is tested there)
- Modify: `server/channels/db/migrations/postgres/000246_add_task_revisions.{up,down}.sql`
- Modify: `server/channels/store/sqlstore/team_store.go`, `server/channels/store/sqlstore/task_store.go`
- Modify: `server/channels/app/task.go`, `server/channels/api4/task.go`
- Modify: `server/i18n/en.json`, `server/i18n/tr.json`
- Test: `server/channels/api4/task_test.go`

**Interfaces:**
- Produces: `Team.RevisionsEnabled bool \`json:"revisions_enabled"\``, `TeamPatch.RevisionsEnabled *bool`; `TaskSection.ChannelId string \`json:"channel_id"\`` (set only on create, not in `TaskSectionPatch`); `func (a *App) RequireRevisionsEnabled(teamID string) *model.AppError` (403 `app.task.revisions_disabled.app_error`).

- [ ] **Step 1: Tests in `task_test.go`** — extend "revision channel video and revision times" and add "revision channel links a channel":
  - section created with `channel_id = th.BasicChannel.Id` returns that `channel_id`; with revisions off → 403; with `th.CreateChannelWithClientAndTeam` on another team → 400; a second section on the same channel → 400; an archived channel → 400.
  - video upload with `revisions_enabled=false` → 403.
  - assigning a task in the linked section DMs a link containing `/channels/` + `th.BasicChannel.Name` + `?revision=` + task id.
- [ ] **Step 2: Run** `go test ./channels/api4 -run TestTasks` (Docker command) — expect the new cases to fail.
- [ ] **Step 3: Implement**
  - migration 246 up adds `Teams.RevisionsEnabled boolean NOT NULL DEFAULT false` and `TaskSections.ChannelId VARCHAR(26) NOT NULL DEFAULT ''`; down drops them. Run the two `ALTER ... IF NOT EXISTS` on `mattermost_dev`.
  - team store: add `RevisionsEnabled` beside `TasksEnabled` (select columns, insert, update). Task store: `ChannelId` in section columns and insert (not in update).
  - `CreateTaskSection`: when `ChannelId != ""` → `RequireRevisionsEnabled`, channel exists, `channel.TeamId == section.TeamId`, `DeleteAt == 0`, no other section of the team has that `ChannelId`; otherwise 400 `app.task.invalid_channel.app_error`.
  - api4 `createTaskSection`: when `channel_id` set, require `read_channel` on it.
  - `SetTaskSectionVideo` calls `RequireRevisionsEnabled`.
  - `postTaskAssignedMessage`: if the task's section has `ChannelId`, link is `{site}/{team}/channels/{channel.Name}?revision={task.Id}`; else unchanged.
  - i18n: `app.task.revisions_disabled.app_error`, `app.task.invalid_channel.app_error` (en with descriptions; tr appended).
- [ ] **Step 4: Run** TestTasks — all pass; `go vet` on touched packages clean.

### Task 2: Webapp — types, client, toggle in team settings

**Files:**
- Modify: `webapp/platform/types/src/teams.ts`, `webapp/platform/types/src/tasks.ts`
- Modify: `webapp/channels/src/components/team_settings/team_info_tab/team_info_tab.tsx`, `team_tasks_section.tsx`
- Test: `webapp/channels/src/components/team_settings/team_info_tab/team_info_tab.test.tsx`

**Interfaces:**
- Produces: `Team.revisions_enabled: boolean`, `TaskSection.channel_id: string`.

- [ ] **Step 1: Test** — with tasks checked, a "Enable revision channels" checkbox appears; checking it and saving calls `patchTeam` with `revisions_enabled: true`; with tasks unchecked the revision checkbox is absent.
- [ ] **Step 2: Run** the test — fails.
- [ ] **Step 3: Implement** — `TeamTasksSection` gets `revisionsEnabled` / `handleRevisionsEnabledChange` props and renders a second `CheckboxSettingItem` only when `tasksEnabled`; `team_info_tab` holds the state, includes it in the dirty check, reset and `patchTeam`. Update fixtures that build `TaskSection`/`Team`.
- [ ] **Step 4: Run** test + `npx tsc -b` — pass.

### Task 3: Webapp — revisions panel in the channel

**Files:**
- Modify: `webapp/channels/src/components/tasks/revisions.tsx` (single section, no channel select, no upload button)
- Create: `webapp/channels/src/components/tasks/revision_tabs.tsx`
- Modify: `webapp/channels/src/components/channel_view/channel_view.tsx` (wrap `{center}` in `<RevisionTabs channelId=...>`)
- Modify: `webapp/channels/src/components/tasks/tasks.tsx` (drop the Revisions view), `tasks.scss`
- Test: `revisions.test.tsx` (adapt), create `revision_tabs.test.tsx`

**Interfaces:**
- Consumes: `TaskSection.channel_id`, `Team.revisions_enabled` (Task 2).
- Produces: `Revisions` props `{teamId, section: TaskSection, tasks, usersById, selectedId, onSelect, canManage}`; `RevisionTabs({channelId, children})`.

- [ ] **Step 1: Tests** in `revision_tabs.test.tsx`:
  - no section with `channel_id === channelId` → renders children only, no `tablist`.
  - linked section + both team flags on → tabs "Messages" and "Revisions"; Messages shows children; clicking Revisions shows the `<video>` and hides children.
  - linked but `revisions_enabled` false → children only.
  - URL `?revision=t1` → Revisions tab active and `TaskDetail` for t1 shown.
  - `revisions.test.tsx`: drop channel-select assertions; keep ordering, seek, arrow keys, add revision, non-manager.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement** `RevisionTabs`: reads current team, `makeGetTaskSectionsForTeam`/`makeGetTasksForTeam`; when both flags on and sections not loaded, dispatches `fetchTeamTasks(teamId)` and `getProfilesInTeam(teamId, 0, 200)`; finds the linked section; state `tab: 'messages' | 'revisions'` and `selectedId`, both seeded from `?revision=`; Revisions tab renders `Revisions` plus `TaskDetail` (same props as on the tasks page). Remove the Revisions entry from `VIEWS` in `tasks.tsx`.
- [ ] **Step 4: Run** tests + `tsc` — pass.

### Task 4: Webapp — "Create revision channel" in Add Channels

**Files:**
- Create: `webapp/channels/src/components/tasks/revision_channel_modal.tsx`
- Modify: `webapp/channels/src/actions/tasks.ts`, `webapp/channels/src/utils/constants.tsx` (`ModalIdentifiers.REVISION_CHANNEL`)
- Modify: `webapp/channels/src/components/sidebar/sidebar_header/sidebar_browse_or_add_channel_menu.tsx`
- Modify: `webapp/channels/src/i18n/en.json`
- Test: `revision_channel_modal.test.tsx`, `sidebar_browse_or_add_channel_menu.test.tsx`, `actions/tasks.test.ts` (or a new test file)

**Interfaces:**
- Produces: `createRevisionChannel(teamId: string, displayName: string, video: File): ActionFuncAsync<Channel>` — `createChannel({team_id, name: cleanUpUrlable(displayName) || generateId(), display_name, type: 'O'}, me)`, then `createTaskSection({team_id, name: displayName, channel_id})`, then `setTaskSectionVideo`; on any failure after the channel exists, `deleteTaskSection` (if created) and `deleteChannel`, return `{error}`.

- [ ] **Step 1: Tests**
  - action: video upload error → `deleteTaskSection` and `deleteChannel` called, result has `error`; success returns the channel.
  - modal: Create disabled until a name and a video are given; on success navigates to `/{team}/channels/{name}` and closes; on error shows the message.
  - menu: item "Create revision channel" shown only when both team flags are on and the user has `manage_team_tasks`.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement** the action, the modal (`GenericModal`, name input, video file input with the existing `accept` list), and the menu item (`useDispatch(openModal({modalId: ModalIdentifiers.REVISION_CHANNEL, dialogType: RevisionChannelModal}))`, placed after "Create new channel").
- [ ] **Step 4: Run** tests, `tsc`, eslint, stylelint, i18n extract — clean apart from the known warnings.

### Task 5: End-to-end check

- [ ] Rebuild server and webpack, restart the server, apply the dev-DB columns.
- [ ] In the browser: enable revisions in team settings → Add Channels → Create revision channel with a test mp4 → chat works on Messages, video and ← → on Revisions → add a revision, assign it → assignee's DM link opens the channel's Revisions tab with the revision selected → turn the toggle off and see the tab and menu item disappear.
