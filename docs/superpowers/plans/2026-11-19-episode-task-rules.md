# Episode Task Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part 2 of the episode template rules: a task panel in Team Settings › Episodes (department + person,
deadline in days, waits-for, folder), seeded into new episodes, with department pools, a waits-for lock, and the
task's message attachments listed (renamable, deletable) in its drive folder.

**Architecture:** `Teams.EpisodeTasks` holds a JSON list (old text lines still parse as title-only entries, so nothing
migrates). `Tasks` gains `DepartmentId`, `WaitsFor` (JSON id list) and `FolderId`. Pool, claim and lock are judged in
the app's `PatchTask` and the api4 `patchTask` handler. A drive folder listing adds `task_files`: the attachments of
posts in that channel whose `props.task_id` is a task with that `FolderId`; two new drive routes rename and delete
them by acting on the `FileInfo` and the post.

**Tech Stack:** Go (model, app, sqlstore, api4), Postgres migrations, React/TypeScript (webapp `channels`), Jest/RTL.

**Spec:** `docs/superpowers/specs/2026-11-19-episode-task-rules-design.md` (builds on
`2026-11-19-episode-template-rules-design.md`, whose part 1 is built).

## Global Constraints

- Rules apply to newly created episodes only; existing tasks get empty `DepartmentId`, `[]` `WaitsFor`, empty `FolderId`.
- Department, waits-for, claim and lock apply to every task **except revisions** (`VideoFileId != ""`); the folder
  exists only on seeded episode tasks and is never patched.
- Template limits: at most 100 entries (`TeamEpisodeTemplateMaxLines`); size limit `TeamEpisodeFoldersMaxRunes`
  (100000); `due_days` 0–365.
- A person is in department D when their team member `ExplicitRoles` hold a rank of D (same as the drive rules).
- Lock override permission is `manage_tasks` (revisions are out of scope, so `manage_revisions` never applies).
- Store methods take no `context.Context` (follow the existing `TaskStore` signatures).
- i18n: server strings go in `server/i18n/en.json`, then run `make i18n-extract` in `server/` (server/AGENTS.md);
  every entry gets a `description`. Webapp strings: run `npm run i18n-extract` in `webapp/channels`.
- Never run `go mod tidy` (use `make modules-tidy` if needed). Never push or merge without the user's explicit yes.

## Rulings in this plan (my calls on things the spec left open)

- **Claim is a patch, not a new route.** "Take it" sends `PATCH /tasks/{id}` `{assignee_id: <me>}`; the handler skips
  the `manage_tasks` + rank check when the task is an unassigned pool task and the caller is in its department.
- **Due date convention.** `due_at` is local midnight of (today + `due_days`) in the creator's preferred timezone
  (`user.GetPreferredTimezone()`, UTC when empty or unknown), matching the webapp's "local midnight" dates.
- **Task files are only listed at the top of a folder listing** (no paging); a folder shows at most 500 task files,
  newest first.
- **Deleting a task file** edits the post through `App.UpdatePost` with that id dropped from `FileIds` (edit history
  keeps the old version); a post left with an empty message and no files is deleted with `App.DeletePost`.
- **Renaming a task file** updates `FileInfo.Name` only (extension kept by the client, as drive renames do); no
  uniqueness check (attachments are not drive items).

## Review Focus

- A template task whose `waits_for` names a task that failed to seed: the seeded task must still be created, with
  that predecessor dropped (not a dangling id that locks it forever).
- A pool task whose department was deleted after seeding: nobody can claim it, but `manage_tasks` can still assign
  it and the UI shows "Deleted department" instead of crashing.
- Two messages of the same task each carrying the same file name in the folder: both listed, rename of one does not
  touch the other.
- A task file in a folder the viewer cannot see (view-restricted): not in the listing, rename/delete refused with 403.
- Moving a task with waits-for links to another section: links dropped both ways; the successor in the old section
  is unlocked if that was its last unfinished predecessor.

---

## File map

Server:
- `server/public/model/task.go` — `Task.DepartmentId/WaitsFor/FolderId`, `TaskPatch.DepartmentId/WaitsFor`.
- `server/public/model/team.go` — `EpisodeTask`, `ParseEpisodeTasks`, `isValidEpisodeTasks`.
- `server/public/model/drive_item.go` — `DriveTaskFile`, `DriveListing.TaskFiles`.
- `server/channels/db/migrations/postgres/000261_task_rules.{up,down}.sql`, `migrations.list`.
- `server/channels/store/store.go`, `sqlstore/task_store.go`, `storetest/task_store.go`, generated layers and mock.
- `server/channels/app/department.go` — `UserDepartments`; `drive_rules.go` uses it.
- `server/channels/app/task.go` — lock, waits-for validation, section move, delete cleanup.
- `server/channels/app/episode.go` — structured seeding.
- `server/channels/app/drive_task_files.go` (new) — list, rename, delete, change events.
- `server/channels/api4/task.go`, `server/channels/api4/drive.go`; `server/public/model/client4_drive.go`.

Webapp (`webapp/`):
- `platform/types/src/tasks.ts`, `platform/types/src/drive.ts`, `platform/client/src/client4.ts`.
- `channels/src/components/team_settings/team_episodes_tab/episode_tasks.ts` (new) + `episode_task_panel.tsx` (new)
  + `.scss`; `team_episodes_tab.tsx`, `team_episode_templates_section.tsx`.
- `channels/src/components/tasks/task_departments.ts` (new) — membership and lock helpers;
  `task_bits.tsx`, `list.tsx`, `board.tsx`, `task_detail.tsx`.
- `channels/src/components/file_explorer/use_explorer_data.ts`, `explorer_items.tsx`, `explorer_actions.ts`,
  `explorer_context_menu.tsx`.

Commands (server tests need the test Postgres used by earlier server work):
- Model: `cd server/public && go test ./model -run <Name>`
- Store: `cd server && go test ./channels/store/sqlstore -run TestTaskStore`
- App: `cd server && go test ./channels/app -run <Name>`
- API: `cd server && go test ./channels/api4 -run <Name>`
- Generated layers: `cd server && make store-layers && make store-mocks`
- Webapp (from `webapp/channels`): `TZ=UTC npx jest <paths>`, `npx tsc --noEmit -p .`, `npx eslint <files>`

---

### Task 1: Task template and task fields (model)

**Files:**
- Modify: `server/public/model/team.go` (template section near `EpisodeFolder`, `IsValid` at the
  `isValidEpisodeTemplate(o.EpisodeTasks)` call, audit counts at lines ~114/154)
- Modify: `server/public/model/task.go`
- Test: `server/public/model/team_test.go`, `server/public/model/task_test.go`

**Interfaces:**
- Produces:
  - `type EpisodeTask struct { Key string `json:"key"`; Title string `json:"title"`; DepartmentId string
    `json:"department_id,omitempty"`; AssigneeId string `json:"assignee_id,omitempty"`; DueDays *int
    `json:"due_days,omitempty"`; WaitsFor []string `json:"waits_for,omitempty"`; Folder string
    `json:"folder,omitempty"` }`
  - `func ParseEpisodeTasks(text string) []*EpisodeTask` — JSON list when the trimmed text starts with `[` and parses;
    else one entry per `EpisodeTemplateLines` line with `Key` = `"line" + index` and only `Title`.
  - `func isValidEpisodeTasks(tasks, folders string) bool`
  - `Task.DepartmentId string `json:"department_id"``, `Task.WaitsFor StringArray `json:"waits_for"``,
    `Task.FolderId string `json:"folder_id"``; `TaskPatch.DepartmentId *string`, `TaskPatch.WaitsFor *StringArray`.

- [ ] **Step 1: Write the failing tests**

`TestParseEpisodeTasks`: old text `"Storyboard\nAnimatic"` → 2 entries, titles kept, keys `line0`/`line1`; JSON
`[{"key":"a","title":"Layout","department_id":"<id>","due_days":5,"waits_for":["b"],"folder":"BG/Layout"},{"key":"b","title":"Storyboard"}]`
→ fields round-trip.

`TestTeamIsValidEpisodeTasks` (table, each sets `o.EpisodeTasks` and expects
`model.team.is_valid.episode_tasks.app_error` or nil), with `o.EpisodeFolders = `[{"path":"BG/Layout"},{"path":"M","mirror_of":"BG/Layout"}]``:
- valid: the JSON above; old 100-line text; empty.
- invalid: 101 entries; duplicate key; empty title; title > 512 runes; `department_id` "x"; `assignee_id` "x";
  `due_days` -1 and 366; `waits_for` naming a missing key; naming itself; a cycle a→b→a; `folder` "Nope";
  `folder` "M" (a mirror).

`TestTaskPatchRules`: `Patch` sets `DepartmentId` and `WaitsFor`; `PreSave` turns nil `WaitsFor` into `{}`;
`IsValid` rejects `DepartmentId` "x", a `WaitsFor` entry "x", `FolderId` "x".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server/public && go test ./model -run 'TestParseEpisodeTasks|TestTeamIsValidEpisodeTasks|TestTaskPatchRules'`
Expected: FAIL (undefined: ParseEpisodeTasks, unknown fields)

- [ ] **Step 3: Implement**

`isValidEpisodeTasks`: rune limit `TeamEpisodeFoldersMaxRunes`; ≤ `TeamEpisodeTemplateMaxLines` entries; per entry the
checks listed in the test; cycle check by DFS over keys; `Folder` must match (case-insensitive) a
`ParseEpisodeFolders(folders)` entry with empty `MirrorOf`. `Team.IsValid` calls it with `o.EpisodeFolders`, keeping
the error id `model.team.is_valid.episode_tasks.app_error`. Audit counts use `len(ParseEpisodeTasks(...))`.
`Task.Patch` copies the two new patch fields; `Task.IsValid` checks ids.

- [ ] **Step 4: Run them to verify they pass** (same command) — Expected: PASS, and `go test ./model` stays green.

- [ ] **Step 5: Commit** — `git commit -m "Episode task template entries and task rule fields"`

### Task 2: Store columns

**Files:**
- Create: `server/channels/db/migrations/postgres/000261_task_rules.up.sql`, `.down.sql`; add both to
  `server/channels/db/migrations/migrations.list`
- Modify: `server/channels/store/sqlstore/task_store.go` (`taskColumns`, line 24)
- Test: `server/channels/store/storetest/task_store.go`

**Interfaces:**
- Consumes: Task 1's fields.
- Produces: tasks persist `DepartmentId`, `WaitsFor`, `FolderId`; `GetForTeam`/`Get` return them.

- [ ] **Step 1: Write the failing test** — `testTaskRuleFields`: save a task with `DepartmentId`, `WaitsFor{a,b}`,
  `FolderId`; `Get` returns them equal; `Update` with `WaitsFor{}` returns empty; a task saved without them reads back
  `""`, `StringArray{}`, `""`.
- [ ] **Step 2: Run** `cd server && go test ./channels/store/sqlstore -run TestTaskStore` — Expected: FAIL.
- [ ] **Step 3: Implement** — up: `ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS DepartmentId varchar(26) NOT NULL DEFAULT ''`,
  `WaitsFor text NOT NULL DEFAULT '[]'`, `FolderId varchar(26) NOT NULL DEFAULT ''`; down drops them. Append the three
  names to `taskColumns` (`StringArray` already scans JSON text).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Store task departments, waits-for and folders"`

### Task 3: Department membership, lock and waits-for rules (app)

**Files:**
- Modify: `server/channels/app/department.go`, `server/channels/app/drive_rules.go:62-87`, `server/channels/app/task.go`
- Test: `server/channels/app/task_test.go`

**Interfaces:**
- Produces:
  - `func (a *App) UserDepartments(rctx request.CTX, teamID, userID string) (map[string]bool, *model.AppError)` —
    the body of today's `driveViewerFor` department loop (not a member / deleted member → empty map);
    `driveViewerFor` calls it.
  - `func (a *App) taskLocked(task *model.Task, byID map[string]*model.Task) []*model.Task` — the waits-for tasks
    that are not Done.
  - `PatchTask` (same signature) enforces the rules below.

- [ ] **Step 1: Write the failing tests** (`TestPatchTaskRules`; fixture: tasks enabled, section S with tasks A, B
  (B waits for A), section T with C; a plain member session in `rctx`, and a `manage_tasks` session):
  - member patches B `status: in_progress` → 400 `app.task.locked.app_error`; same as manager → OK.
  - A set Done, then member patches B to `in_progress` → OK; A back to `todo`, member patches B to `done` → OK
    (lock gates To do only).
  - patch B `waits_for: [C]` → 400 `app.task.waits_for.app_error`; `[B]` → 400; A `waits_for: [B]` → 400 (cycle).
  - patch A `section_id: T` → A saved, B's `waits_for` is `[]`, A's is `[]`.
  - `DeleteTask(A)` → B's `waits_for` is `[]`.
  - revision task patch with `department_id` → 400 `app.task.revision_rules.app_error`.
- [ ] **Step 2: Run** `cd server && go test ./channels/app -run TestPatchTaskRules` — Expected: FAIL.
- [ ] **Step 3: Implement** — in `PatchTask`, after `patched.Patch(patch)`: load team tasks once
  (`GetForTeam`) into `byID`; reject rule fields on revisions; validate `WaitsFor` (each id in `byID`, same
  `SectionId` as `patched`, not itself, no duplicates, no cycle through `byID` with `patched` substituted); if the
  section changed, clear `patched.WaitsFor` and remove `task.Id` from every other task's `WaitsFor` (save each,
  publish `WebsocketTaskUpserted`); if `task.Status == todo` and the patch moves status off todo or sets the assignee
  (claim), and `taskLocked` is non-empty, refuse unless the session has `manage_tasks` on the team. `DeleteTask`
  removes the id from other tasks' `WaitsFor` the same way. Add the three error ids to `server/i18n/en.json`.
- [ ] **Step 4: Run** the same command, then `go test ./channels/app -run 'TestTask|TestDrive'` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Lock tasks on unfinished predecessors and keep waits-for in one section"`

### Task 4: Permissions for department, waits-for and claim (api4)

**Files:**
- Modify: `server/channels/api4/task.go:174-209`
- Test: `server/channels/api4/task_test.go`

**Interfaces:**
- Consumes: Task 3's `App.UserDepartments`.

- [ ] **Step 1: Write the failing tests** (`TestPatchTaskDepartmentRules`): a plain member in department D, a member
  of another department, a `manage_tasks` lead.
  - lead patches `department_id` / `waits_for` → 200; plain member → 403.
  - D-member claims an unassigned task with `department_id: D` (`assignee_id: <self>`) → 200 and assignee set.
  - other-department member claims it → 403; D-member assigns it to someone else → 403; D-member claims a task with
    an assignee already → 403.
  - D-member claims a locked pool task → 400 `app.task.locked.app_error`.
- [ ] **Step 2: Run** `cd server && go test ./channels/api4 -run TestPatchTaskDepartmentRules` — Expected: FAIL.
- [ ] **Step 3: Implement** — in `patchTask`: `department_id` or `waits_for` present and changed →
  `requireTaskPermission`. Assignee change: a claim (`*patch.AssigneeId == session user`, `task.AssigneeId == ""`,
  `task.DepartmentId != ""`, caller in that department) skips `requireTaskPermission`/`requireCanAssign`; anything
  else keeps today's checks.
- [ ] **Step 4: Run** the same command and `go test ./channels/api4 -run TestTask` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Let department members take their pool tasks"`

### Task 5: Seed episode tasks from the structured template

**Files:**
- Modify: `server/channels/app/episode.go`
- Test: `server/channels/app/episode_test.go`

**Interfaces:**
- Consumes: Task 1's `ParseEpisodeTasks`; Task 3's waits-for validation (seeding writes `WaitsFor` with a store
  `Update`, not `PatchTask`, so the lock and permission paths are not involved).
- Produces: `seedEpisodeFolders` returns `(failed []string, ids map[string]string)`; `ids` keyed as today
  (`"/" + lowercased path segments joined by "/"`).

- [ ] **Step 1: Write the failing tests** (`TestCreateEpisodeTaskRules`): team template with folders `BG/Layout` and
  tasks `[{key:a,title:Storyboard,department_id:D,due_days:5},{key:b,title:Layout,assignee_id:U,waits_for:[a],folder:"BG/Layout"}]`,
  creator's timezone `Europe/Istanbul`:
  - Storyboard: `DepartmentId == D`, `AssigneeId == ""`, `DueAt` == Istanbul midnight of today+5 (compute in test);
    Layout: `AssigneeId == U`, `WaitsFor == [Storyboard.Id]`, `FolderId` == the seeded `BG/Layout` folder id,
    `DueAt == 0`.
  - U has a new DM from the system bot naming "Layout"; the creator assigned to a task gets none.
  - old text template still seeds title-only tasks.
  - predecessor title > 512 runes (fails) → successor seeded with `WaitsFor == []`, failed lists the title.
- [ ] **Step 2: Run** `cd server && go test ./channels/app -run TestCreateEpisode` — Expected: FAIL.
- [ ] **Step 3: Implement** — seed folders first, keep `ids`; create tasks in template order with department,
  assignee, `FolderId = ids["/"+lower(folder)]`, due date via `time.LoadLocation(user.GetPreferredTimezone())`
  (UTC on error); collect `key → task id`; second pass sets `WaitsFor` from keys that seeded and saves through the
  store, publishing `WebsocketTaskUpserted`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Seed episode tasks with departments, deadlines, waits-for and folders"`

### Task 6: List task files in their folder

**Files:**
- Modify: `server/public/model/drive_item.go`, `server/channels/store/store.go` (`TaskStore`),
  `server/channels/store/sqlstore/task_store.go`, `storetest/task_store.go`, generated layers + mock
- Create: `server/channels/app/drive_task_files.go`
- Modify: `server/channels/app/drive.go` (`ListDriveFolder`, `WriteDriveZip`), `server/channels/app/post.go`
  (`CreatePost`, `UpdatePost`, `DeletePost`)
- Test: `server/channels/app/drive_task_files_test.go`, store test

**Interfaces:**
- Produces:
  - `type DriveTaskFile struct { *FileInfo; TaskId string `json:"task_id"` }`; `DriveListing.TaskFiles
    []*DriveTaskFile `json:"task_files"`` (always non-nil, `[]` when none).
  - store `GetFolderTaskFiles(channelId, folderId string, limit int) ([]*model.DriveTaskFile, error)` — live
    `FileInfo`s of live posts in `channelId` whose `Props->>'task_id'` is a task with `FolderId = folderId`, newest
    first (uses `idx_posts_task_id`).
  - app `func (a *App) publishTaskFolderChanged(post *model.Post)` — if the post has files and its `task_id` names a
    task with a `FolderId`, `publishDriveChanged(post.ChannelId, task.FolderId)`.

- [ ] **Step 1: Write the failing tests**
  - store `testGetFolderTaskFiles`: two posts of task T (folder F) with one file each, a reply with a file, a post of
    task T in another channel, a deleted post → returns the 3 in-channel live files, newest first, each `TaskId == T`.
  - app `TestListDriveFolderTaskFiles`: listing F returns `task_files` with the file; listing a mirror of F returns
    it too; a viewer outside F's view departments gets 403/hidden as for F itself; zip of F contains the file.
  - app `TestTaskFolderChangedEvent`: creating a post with a file under T publishes `drive_changed` naming F.
- [ ] **Step 2: Run** `cd server && go test ./channels/store/sqlstore -run TestTaskStore` and
  `go test ./channels/app -run 'TestListDriveFolderTaskFiles|TestTaskFolderChangedEvent'` — Expected: FAIL.
- [ ] **Step 3: Implement** — in `ListDriveFolder`, after the items, `listing.TaskFiles = GetFolderTaskFiles(channel.Id,
  listID, 500)` (skipped for the root and when `SourceMissing`); `WriteDriveZip` adds a selected folder's task files
  at that folder's path; call `publishTaskFolderChanged` after a successful create/update/delete in the three post
  functions.
- [ ] **Step 4: Run** the same commands — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "List a task's message files in its drive folder"`

### Task 7: Rename and delete task files

**Files:**
- Modify: `server/channels/app/drive_task_files.go`, `server/channels/api4/drive.go` (routes at line ~22),
  `server/public/model/client4_drive.go`
- Test: `server/channels/api4/drive_test.go`

**Interfaces:**
- Produces:
  - `PATCH /channels/{channel_id}/drive/task_files/{file_id}` body `{"name": string}` → `FileInfo`;
    `DELETE /channels/{channel_id}/drive/task_files/{file_id}` → status OK.
  - app `RenameDriveTaskFile(rctx, session, channel, fileID, name string) (*model.FileInfo, *model.AppError)`,
    `DeleteDriveTaskFile(rctx, session, channel, fileID string) *model.AppError`.
  - client `RenameDriveTaskFile(ctx, channelID, fileID, name)`, `DeleteDriveTaskFile(ctx, channelID, fileID)`.

- [ ] **Step 1: Write the failing tests** (`TestDriveTaskFiles`; folder F with write department D; files by user X):
  - X renames own file (F has no write rule variant) → 200, `GetFileInfo` shows the name, the post's file shows it.
  - D-member renames X's file in F → 200; non-D member → 403; channel manager → 200; invalid name → 400.
  - two posts of the task each attach a file named `a.png`: renaming one leaves the other `a.png`.
  - F view-restricted to D: a non-D channel member gets 403 on rename and delete.
  - delete: post keeps its message and loses the file id; a file-only post is deleted; post edit history has the
    earlier version.
  - a file not attached to a task with folder in this channel → 404.
- [ ] **Step 2: Run** `cd server && go test ./channels/api4 -run TestDriveTaskFiles` — Expected: FAIL.
- [ ] **Step 3: Implement** — resolve: `FileInfo` live, `PostId` set, post live in `channel`, its `task_id` names a task
  whose `FolderId` is a live folder of `channel`; else 404. Permission:
  `DriveCan(rctx, session, channel, DriveModify, &model.DriveItem{ChannelId: channel.Id, ParentId: task.FolderId,
  Type: model.DriveItemTypeFile, CreatorId: info.CreatorId})`. Rename: `IsValidDriveItemName`, then update the
  `FileInfo` name the way `syncDriveFileName` does. Delete: per the ruling above. Both call `publishTaskFolderChanged`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Rename and delete task files from their folder"`

### Task 8: Webapp types, client and the task panel

**Files:**
- Modify: `webapp/platform/types/src/tasks.ts`, `webapp/platform/types/src/drive.ts`,
  `webapp/platform/client/src/client4.ts`
- Create: `webapp/channels/src/components/team_settings/team_episodes_tab/episode_tasks.ts`, `episode_tasks.test.ts`,
  `episode_task_panel.tsx`, `episode_task_panel.test.tsx`, `episode_task_panel.scss`
- Modify: `team_episodes_tab.tsx`, `team_episode_templates_section.tsx`, `team_episodes_tab.test.tsx`

**Interfaces:**
- Produces:
  - `Task` gains `department_id: string; waits_for: string[]; folder_id: string`; `TaskPatch` gains
    `department_id`, `waits_for`.
  - `DriveTaskFile = FileInfo & {task_id: string}`; `DriveListing.task_files: DriveTaskFile[]`.
  - `Client4.renameDriveTaskFile(channelId, fileId, name)`, `Client4.deleteDriveTaskFile(channelId, fileId)`.
  - `episode_tasks.ts`: `EpisodeTask` (mirrors the server struct), `parseEpisodeTasks(text?: string): EpisodeTask[]`,
    `serializeEpisodeTasks(tasks: EpisodeTask[]): string` ('' when empty; empty optional fields left out),
    `episodeTaskCycle(tasks): boolean`, `MAX_EPISODE_TASKS = 100`.
  - `EpisodeTaskPanel` props: `{teamId: string; tasks: EpisodeTask[]; folders: EpisodeFolder[]; onChange: (tasks: EpisodeTask[]) => void}`.

- [ ] **Step 1: Write the failing tests**
  - `episode_tasks.test.ts`: old text parses to title-only entries with keys `line0..`; serialize(parse(json)) is
    stable; untouched old text is not re-serialized as changed (the tab compares serialized forms only after an edit);
    cycle a→b→a detected.
  - `episode_task_panel.test.tsx`: add task → row "New task"; select it → department select lists departments,
    person select lists the department's members first; "days after opening" accepts 0–365; "waits for" lists the
    other tasks only and refuses a choice that makes a cycle (option disabled); folder select lists own-files
    folders, not mirrors; deleting a task removes it from others' waits-for; a deleted department shows
    "Deleted department".
- [ ] **Step 2: Run** `cd webapp/channels && TZ=UTC npx jest src/components/team_settings/team_episodes_tab` — Expected: FAIL.
- [ ] **Step 3: Implement** — the panel follows `episode_folder_panel.tsx` (list on the left, detail on the right,
  `useTeamDepartments(teamId)`); members from the team's profiles selector already used by the tasks views; the tab
  keeps `episode_tasks` as a string and replaces the text box with the panel.
- [ ] **Step 4: Run** the same command, `npx tsc --noEmit -p .`, `npx eslint` on the files — Expected: PASS / clean.
- [ ] **Step 5: Commit** — `git commit -m "Episode task panel in Team Settings"`

### Task 9: Department, pool, lock and folder in the task views

**Files:**
- Create: `webapp/channels/src/components/tasks/task_departments.ts`, `task_departments.test.ts`
- Modify: `task_bits.tsx`, `list.tsx`, `board.tsx`, `task_detail.tsx`, `tasks.scss`, `task_detail.test.tsx`,
  `views.test.tsx`

**Interfaces:**
- Produces: `userDepartmentIds(roles: string, departments: Department[]): Set<string>` (a rank's `role_name` in the
  space-separated roles), `lockedBy(task: Task, byId: Record<string, Task>): Task[]` (non-Done waits-for, only while
  `task.status === 'todo'`), `DepartmentChip`, `LockLine`, `TakeItButton` in `task_bits.tsx`.

- [ ] **Step 1: Write the failing tests**
  - `task_departments.test.ts`: roles `"team_user rk_<rank of D>"` → `{D}`; `lockedBy` empty once predecessors are
    Done and for tasks already In progress.
  - `task_detail.test.tsx`: pool task shows department chip and "Unassigned"; D-member sees "Take it", clicking
    patches `{assignee_id: me}`; non-member sees no button; locked task shows "Waiting for: Storyboard" and the
    status select offers no move off To do for a non-manager; manager edits department and waits-for (other tasks of
    the same section only); task with `folder_id` shows a link to its folder in the channel's Files tab; revision
    tasks show none of these; a pool task whose department no longer exists shows "Deleted department", no
    "Take it", and a manager can still assign it.
  - `views.test.tsx`: list and board rows show the department chip and the lock icon.
- [ ] **Step 2: Run** `cd webapp/channels && TZ=UTC npx jest src/components/tasks` — Expected: FAIL.
- [ ] **Step 3: Implement** — reuse the existing Files-tab link (`file_explorer_link.tsx`) for the folder link; a
  rejected patch (`app.task.locked.app_error`) shows the server's message as today's patch errors do.
- [ ] **Step 4: Run** the same command plus `tsc` and `eslint` — Expected: PASS / clean.
- [ ] **Step 5: Commit** — `git commit -m "Show departments, pools and the waits-for lock on tasks"`

### Task 10: Task files in the file explorer

**Files:**
- Modify: `webapp/channels/src/components/file_explorer/use_explorer_data.ts`, `explorer_items.tsx`,
  `explorer_actions.ts`, `explorer_context_menu.tsx`, `use_explorer_dnd.ts`, tests beside them

**Interfaces:**
- Consumes: Task 8's `DriveListing.task_files` and client calls.
- Produces: `ExplorerEntryKind` gains `'task_file'`; entries keyed `task:<file id>` with `fileInfo` and `taskId`.

- [ ] **Step 1: Write the failing tests**
  - `use_explorer_data`: a listing with `task_files` yields `task_file` entries after the drive items; `canModify`
    follows the folder's `access` and creator like drive files; read-only inside a mirror.
  - `explorer_items.test.tsx`: a task file row shows the task chip with the task title; clicking it opens the task.
  - `explorer_actions.test.ts`: rename of a task file calls `renameDriveTaskFile`; delete calls
    `deleteDriveTaskFile` and never the drive delete; move/cut and drag are not offered for task files; copy sends
    them as chat file ids.
- [ ] **Step 2: Run** `cd webapp/channels && TZ=UTC npx jest src/components/file_explorer` — Expected: FAIL.
- [ ] **Step 3: Implement** — reload on `drive_changed` already covers live updates.
- [ ] **Step 4: Run** the same command plus `tsc` and `eslint` — Expected: PASS / clean.
- [ ] **Step 5: Commit** — `git commit -m "Show, rename and delete task files in the file explorer"`
