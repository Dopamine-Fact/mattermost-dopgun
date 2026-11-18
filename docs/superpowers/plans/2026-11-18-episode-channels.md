# Episode channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One channel per series episode, with Messages | Revisions | Tasks | Canvas tabs. The channel starts from the team's default folders and tasks. Every revision channel gets versioned video, and each revision is pinned to the cut it was written on.

**Architecture:** An episode is not a new channel type. It combines a linked task section (as in revision channels), a canvas row and seeded drive folders and tasks, all created by one webapp action that calls existing endpoints in order. Video versions live in a new `TaskSectionVideos` table. A task is a revision exactly when its new `Tasks.VideoFileId` is set, and that field (not the section) decides between `manage_revisions` and `manage_tasks`. The team's folder and task templates are two text columns on `Teams`.

**Tech Stack:** Go (Postgres, squirrel), React/TS, Jest.

**Spec:** `docs/superpowers/specs/2026-11-18-episode-channels-design.md`. Read it in full before Task 1; this plan does not repeat its Design sections.

## Global Constraints

- **Branch:** `feature/episode-channels`, cut from `feature/custom-roles`. Change existing code in place; do not add parallel paths.
- **Go runner:** run Go in docker with `sh /c/Users/dopamine/AppData/Local/Temp/claude/b77d99a4e3601da8/18855b51-ad8f-4ec1-87db-74716ea63234/scratchpad/gorun.sh <dir under server/> "<cmd>"`, written `$G` below.
  - It needs `mattermost-postgres` running.
  - Tests run as `ENABLE_FULLY_PARALLEL_TESTS=true go test ./ -count=1 -parallel 4 -timeout 30m -run '<regex>'`.
  - Never run a whole `channels/app` package on this machine: it crashes Docker Desktop. Use `-run` patterns.
  - Go files are CRLF; edit them with the Edit tool.
- **Store:**
  - Store methods take no `context.Context`.
  - Regenerate the layers and mocks with `make store-layers store-mocks` from `server/`. If mockery can't run, hand-edit the mocks in the generated style and ledger it.
- **i18n:**
  - Server: after editing `server/i18n/en.json`, run `make i18n-extract` and fill every new `description`.
  - Webapp: `en.json` entries are `{defaultMessage, description}`, `tr.json` is flat. Edit both with a Python json round trip (`indent=2`, keep line endings).
  - Every new string goes into en and tr. Turkish words: Bölüm (episode), Revizyonlar, Görevler, Canvas, Mesajlar, "Yeni sürüm yükle".
- **Migration:** `000255_task_video_versions`, postgres only, both files listed in `server/channels/db/migrations/migrations.list`. Files 000253 and 000254 must not change.
- **Permissions:** `api4` picks a task's permission from the task: `VideoFileId != ""` needs `manage_revisions`, anything else `manage_tasks`. Section endpoints keep `sectionPermission`. The rank hierarchy (`requireCanAssign`) gets the permission picked here, unchanged otherwise.
- **Templates:**
  - `Team.EpisodeFolders` / `Team.EpisodeTasks` are newline-separated text of at most 4000 runes and 100 non-empty lines each.
  - Each folder segment must pass `model.IsValidDriveItemName`.
  - Lines are trimmed and empty lines ignored.
- **Webapp checks:**
  - Tests: `npx jest <paths>` from `webapp/channels`.
  - Lint: `npx eslint --rule '@stylistic/linebreak-style: off' <files>`.
  - Types: `npm run check-types`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Planner's call — no Playwright spec.** No earlier plan on this fork runs Playwright, and a testcontainers server under load crashes Docker here. Task 9's manual dopgun walkthrough replaces the spec's Playwright spec.

## Review Focus

1. **Revision on an older cut.** v2 is uploaded while someone is still watching v1, and they then add a revision with v1's file id. The server must accept it, because v1 belongs to the section. Test: Task 3 `TestCreateRevisionOnOlderVersion`.
2. **A file id from elsewhere.** `GET /task_sections/{a}/video?file_id=<section b's video or a chat file>` must return 404, not stream the file. Test: Task 4 `TestGetTaskSectionVideoForeignFile`.
3. **Moving a revision.** Patching a revision's `section_id` gives 400, but an ordinary task can leave an episode section. Test: Task 3 `TestPatchTaskSectionRules`.
4. **Deleting an episode section.** Every version's file is removed. Its revisions become ordinary "no section" tasks with `video_file_id = ''`, keeping their comments. Test: Task 2 `testTaskStoreDeleteSectionClearsVersions` and Task 3 `TestDeleteTaskSectionRemovesAllVersions`.
5. **A bad template line.** `../x`, `a//b` or a 256-rune segment in the folder template is rejected when Team Settings saves (400), not when an episode is created. Test: Task 1 `TestTeamEpisodeTemplatesIsValid`.

---

### Task 1: Model

**Files:**
- Modify: `server/public/model/task.go` (+ `task_test.go`)
- Modify: `server/public/model/team.go` (+ `team_test.go`)

**Produces:**
- `Task.VideoFileId string` with JSON `video_file_id`. It is not in `TaskPatch`.
- `TaskSectionVideo{Id, SectionId, FileId string; Version int; CreatorId string; CreateAt int64; File *FileInfo}`.
  - JSON names are snake_case. `File` is `json:"file,omitempty" db:"-"`.
  - `PreSave()` sets `Id` and `CreateAt`.
- `Team.EpisodeFolders` / `Team.EpisodeTasks` (`episode_folders` / `episode_tasks`).
  - Add matching `*string` fields to `TeamPatch`, applied in `Team.Patch`.
  - Add both to `Auditable()` and `TeamPatch.Auditable()` as their line counts, not the text.
- `EpisodeTemplateLines(text string) []string`: trimmed, non-empty lines, in order.
- `Team.IsValid` enforces the template rules in Global Constraints. Errors: `model.team.is_valid.episode_folders.app_error` and `model.team.is_valid.episode_tasks.app_error`.

- [ ] **Step 1: Write the failing tests**
  - `TestEpisodeTemplateLines`: `" a \n\n b/c \r\n"` gives `["a", "b/c"]`.
  - `TestTeamEpisodeTemplatesIsValid`:
    - valid: `"Animasyon/Layout\nSes"`, and 100 lines;
    - invalid: 101 lines, 4001 runes, `"../x"`, `"a//b"`, `"/a"`, and a segment of 256 runes;
    - each of the three line-count and length cases is also run against `EpisodeTasks`.
- [ ] **Step 2: Run them.** `$G public/model "go test ./ -run 'EpisodeTemplate' -count=1"`. Expected: FAIL (undefined).
- [ ] **Step 3: Implement the fields, `EpisodeTemplateLines` and the `IsValid` checks.** A folder line is split on `/`, and an empty segment is invalid. Add both error ids to `server/i18n/en.json`.
- [ ] **Step 4: Run them again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** "Add episode templates and task video versions to the model".

### Task 2: Migration and store

**Files:**
- Create: `server/channels/db/migrations/postgres/000255_task_video_versions.{up,down}.sql`; modify `migrations.list`.
- Modify: `server/channels/store/store.go`, `server/channels/store/sqlstore/task_store.go`, `server/channels/store/sqlstore/team_store.go`, `server/channels/store/storetest/task_store.go` (+ regenerated layers and mocks)
- Test: `server/channels/store/sqlstore/task_video_versions_migration_test.go`

**Produces:**
- `TaskStore.SaveSectionVideo(video *model.TaskSectionVideo) (*model.TaskSectionVideo, error)`. It sets `Version` to the section's max plus 1 in a single `INSERT … SELECT COALESCE(MAX(Version),0)+1`, and returns the saved row.
- `TaskStore.GetSectionVideos(sectionId string) ([]*model.TaskSectionVideo, error)`, ordered by `Version`, without `File`.
- `TaskStore.DeleteSection`, in its existing transaction, also deletes the section's `TaskSectionVideos` rows and sets `VideoFileId = ''` on its tasks.
- `Tasks.VideoFileId` is written by `Save` only, never by `Update`.
- `Teams.EpisodeFolders` and `EpisodeTasks` are in the team select, insert and update columns, next to `FilesEnabled`.

**Migration contents:**
- Write the up file exactly as the spec's "Video versions" list says. Make it idempotent, because the backfill test re-runs it:
  - `CREATE TABLE IF NOT EXISTS`;
  - `ADD COLUMN IF NOT EXISTS`;
  - the version-1 insert uses `ON CONFLICT (SectionId, Version) DO NOTHING`;
  - the task backfill only touches rows `WHERE VideoFileId = ''`.
- The revision mark is `Posts.Type = 'custom_revision' AND Posts.Props->>'task_id' = Tasks.Id AND Posts.ChannelId = TaskSections.ChannelId`.
- The down file drops the table and the three columns.

- [ ] **Step 1: Write the failing tests**
  - `testTaskStoreSectionVideos`:
    - three saves give versions 1, 2, 3;
    - `GetSectionVideos` returns them in that order;
    - another section starts again at 1.
  - `testTaskStoreDeleteSectionClearsVersions`: after `DeleteSection`, `GetSectionVideos` is empty, and a task that had `VideoFileId` now has `""` and `SectionId ""`.
  - `testTaskStoreSaveKeepsVideoFileId`: `Save` stores `VideoFileId`, and `Update` with a different value leaves it unchanged.
  - Team store: a round trip of `EpisodeFolders` and `EpisodeTasks` through `Save`, `Update` and `Get`.
  - `TestTaskVideoVersionsBackfill` (sqlstore) inserts this fixture:
    - a linked section with `VideoFileId = f1` and a FileInfo row `f1`;
    - task A with a `custom_revision` post in the channel;
    - task B without one.

    It then executes the up file again (read with `os.ReadFile` relative to the package) and asserts:
    - exactly one version-1 row for the section, `FileId = f1`, `CreatorId` from the FileInfo;
    - A has `VideoFileId = f1`;
    - B still has `''`.
- [ ] **Step 2: Run them.** `$G channels/store/sqlstore "… -run 'TestTaskStore|TestTeamStore|TestTaskVideoVersionsBackfill'"`. Expected: FAIL (compile errors).
- [ ] **Step 3: Write the migration, the store methods and the team columns.** Then run `make store-layers store-mocks` and `make migrations-extract` if it rewrites `migrations.list`.
- [ ] **Step 4: Run them again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** "Store task video versions and episode templates".

### Task 3: App layer

**Files:**
- Modify: `server/channels/app/task.go` (+ `task_test.go` or a new `task_video_test.go`)

**Produces:**
- `SetTaskSectionVideo` (same signature):
  - upload the file;
  - `SaveSectionVideo`;
  - set `section.VideoFileId`;
  - publish the section.
  - It never deletes earlier files. On a store failure it removes only the new file.
- `GetTaskSectionVideos(rctx request.CTX, section *model.TaskSection) ([]*model.TaskSectionVideo, *model.AppError)`. Each row gets its `File` from one `FileInfo().GetByIds` call. Rows whose file is gone are dropped.
- `GetTaskSectionVideo(rctx, section, fileID string)`: an empty `fileID` means the latest version. Otherwise the file must be one of the section's versions, or 404 `app.task.not_found.app_error`.
- `DeleteTaskSection` removes the files of every version, read before the store delete.
- `CreateTask`, when `task.VideoFileId != ""`, requires all of:
  - a section;
  - `section.IsRevision()`;
  - the file is among `GetSectionVideos`.

  Otherwise it returns 400 `app.task.invalid_video.app_error`.
- `PatchTask` returns the same 400 when `task.VideoFileId != ""` and the patched `SectionId` differs from the original.
- `taskRevisionChannel(task)` returns nil when `task.VideoFileId == ""`.

- [ ] **Step 1: Write the failing tests**
  - `TestSetTaskSectionVideoKeepsVersions`: two uploads give versions 1 and 2, both files still readable, and `section.VideoFileId` is the second.
  - `TestDeleteTaskSectionRemovesAllVersions`: after delete, both FileInfos are deleted or unreadable, and a revision task has `VideoFileId ""`.
  - `TestCreateRevisionOnOlderVersion`: creating with v1's file id after v2 succeeds and posts a `custom_revision`.
  - `TestCreateTaskInvalidVideo`: a file id from another section gives 400, as do a video on an ordinary section and a video without a section.
  - `TestOrdinaryTaskInLinkedSectionPostsNothing`: no post appears in the channel, and the assignee DM link is `/tasks?task=`.
  - `TestPatchTaskSectionRules`: moving a revision to another section or to `""` gives 400, and an ordinary task in a linked section moves out.
- [ ] **Step 2: Run them.** `$G channels/app "… -run 'TestSetTaskSectionVideo|TestDeleteTaskSection|TestCreateRevision|TestCreateTaskInvalidVideo|TestOrdinaryTask|TestPatchTaskSection'"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `""` from the `api4` caller of `GetTaskSectionVideo` until Task 4, so the server still builds. Add `app.task.invalid_video.app_error` to `server/i18n/en.json`, run `make i18n-extract` and write its description.
- [ ] **Step 4: Run them again.** Same command, then the existing task tests: `-run 'Task|Revision|DailyReport|CustomRole|Hierarchy'`. Expected: PASS.
- [ ] **Step 5: Commit** "Keep every video version and pin revisions to theirs".

### Task 4: API and Go client

**Files:**
- Modify: `server/channels/api4/task.go` (+ `task_test.go`), `server/public/model/client4_task.go`

**Produces:**
- `taskPermission(task *model.Task) *model.Permission` is `manage_revisions` when the task has `VideoFileId`, and `manage_tasks` otherwise.
  - `requireTaskPermission(c, task *model.Task) *model.Permission` replaces the section-id version.
  - Callers: create (task from the body), assignee change, delete, deleting someone else's comment.
  - The assignee-change path no longer needs `sectionID`.
- `GET /task_sections/{section_id}/videos` returns `[]TaskSectionVideo` with `file`. It uses the same read rule as `getTaskSectionVideo` (team member through `loadTaskSection`).
- `GET /task_sections/{section_id}/video` reads the `file_id` query parameter.
- Go client: `GetTaskSectionVideos(ctx, sectionId)`. `GetTaskSectionVideo` gains a `fileId string` argument; update its callers.

- [ ] **Step 1: Write the failing tests**
  - `TestTaskPermissionFollowsTask`, with two users:
    - one holding only `manage_tasks`, through a rank as in the existing tests;
    - one holding only `manage_revisions`.

    In a linked section, each can create, assign and delete their own kind of task and gets 403 on the other kind.
  - `TestGetTaskSectionVideos`: two uploads give two rows with `file.name` set, and a non-member gets 403.
  - `TestGetTaskSectionVideoForeignFile`: another section's video id gives 404, and so does a plain uploaded file id. v1's id streams v1's bytes.
- [ ] **Step 2: Run them.** `$G channels/api4 "… -run 'TestTaskPermissionFollowsTask|TestGetTaskSectionVideo'"`. Expected: FAIL.
- [ ] **Step 3: Implement the routes, the permission change and the client methods.**
- [ ] **Step 4: Run them again.** Same command plus `-run 'Task|Revision|Actionable|CustomRoleEnforcement'`. Expected: PASS.
- [ ] **Step 5: Commit** "Pick a task's permission from the task and serve video versions".

### Task 5: Webapp types, client and revision versions

**Files:**
- Modify: `webapp/platform/types/src/tasks.ts`, `webapp/platform/types/src/teams.ts`, `webapp/platform/client/src/client4.ts`
- Modify: `webapp/channels/src/components/tasks/revisions.tsx` (+ test), `webapp/channels/src/components/tasks/task_detail.tsx` (+ test)

**Produces:**
- Types:
  - `Task.video_file_id: string`;
  - `TaskSectionVideo` (spec fields plus `file: FileInfo`);
  - `Team.episode_folders?: string` and `episode_tasks?: string`.
- Client:
  - `Client4.getTaskSectionVideos(sectionId): Promise<TaskSectionVideo[]>`;
  - `getTaskSectionVideoUrl(sectionId, fileId?)` appends `file_id` when given.
- `Revisions` loads the versions with `Client4.getTaskSectionVideos` in an effect, refetched when `section.video_file_id` changes.
  - A picker labelled `v{n} · {date} · {uploader}`, newest first, latest selected.
  - The list shows revisions with `video_file_id === selected`. On the latest version it also shows open revisions (`status !== 'done'`) of older versions, each with a `v{n}` badge. Picking one switches the version and seeks.
  - New revisions send `video_file_id: selected`.
  - The "Replace video" button becomes "Upload new version" (`tasks.revisions.uploadVersion`).
- `TaskDetail` sets `permission = task.video_file_id ? 'manage_revisions' : 'manage_tasks'`. For revisions the section select is disabled.

- [ ] **Step 1: Write the failing tests** in `revisions.test.tsx`:
  - "lists versions newest first";
  - "shows an older open revision with its version badge on the latest version";
  - "picking an older revision switches the video to its version";
  - "a new revision is created on the selected version".

  In `task_detail.test.tsx`:
  - "an ordinary task in a revision section asks for manage_tasks", which replaces the section-based test;
  - "a revision's section cannot be changed".
- [ ] **Step 2: Run them.** `npx jest src/components/tasks`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Add the strings to en and tr.
- [ ] **Step 4: Run them again,** then lint and check-types. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** "Pick, upload and pin revisions to video versions".

### Task 6: ChannelTabs

**Files:**
- Create: `webapp/channels/src/components/channel_view/channel_tabs.tsx` (+ test)
- Delete: `components/canvas/canvas_tabs.tsx` and `components/tasks/revision_tabs.tsx` with their tests. Move any of their test cases that still apply into `channel_tabs.test.tsx`.
- Modify: `components/channel_view/channel_view.tsx`, `components/tasks/task_bits.tsx` (`AddTask`)

**Produces:**
- `ChannelTabs({channelId, children})` absorbs the logic of both old components:
  - the canvas probe;
  - the linked-section lookup;
  - fetching tasks and profiles;
  - `?revision=` / `?canvas=1`;
  - the `RevisionTabs` CSS classes, keeping the existing i18n ids.
- Tabs: Messages, then Revisions and Tasks when a section is linked, then Canvas when the canvas probe succeeds. With no extra tab the chat renders alone.
- Tasks tab: `List` with this section's tasks where `video_file_id === ''`, and the existing `TaskDetail` on select.
  - `canManage` comes from `manage_tasks`. The Revisions tab keeps `manage_revisions`.
- `AddTask` gains an optional `sectionId` and sends it. `List` passes it through when it gets a new optional `sectionId` prop.

- [ ] **Step 1: Write the failing tests:**
  - "a revision channel shows Messages, Revisions, Tasks";
  - "a canvas channel shows Messages, Canvas";
  - "an episode shows all four";
  - "a plain channel has no tab bar";
  - "the Tasks tab lists only ordinary tasks of this section";
  - "Add task on the Tasks tab creates in this section";
  - "?revision= opens Revisions; ?canvas=1 opens Canvas".
- [ ] **Step 2: Run them.** `npx jest src/components/channel_view src/components/tasks src/components/canvas`. Expected: FAIL.
- [ ] **Step 3: Implement it and swap it into `channel_view.tsx`.** Add the "Tasks" tab string to en and tr.
- [ ] **Step 4: Run them again,** then lint and check-types. Expected: PASS.
- [ ] **Step 5: Commit** "Show one tab bar built from what the channel has".

### Task 7: Creating an episode

**Files:**
- Modify: `webapp/channels/src/actions/tasks.ts` (+ `tasks.test.ts`)
- Create: `webapp/channels/src/components/tasks/episode_channel_modal.tsx` (+ test), modelled on `revision_channel_modal.tsx`
- Modify: `components/sidebar/sidebar_header/sidebar_browse_or_add_channel_menu.tsx`, `utils/constants.tsx` (`ModalIdentifiers.EPISODE_CHANNEL_MODAL`)

**Produces:**
- `createEpisodeChannel(teamId, displayName, video): ActionFuncAsync<{channel: Channel; failed: string[]}>`:
  - It runs the steps of `createRevisionChannel`, then `Client4.createCanvas(teamId, channelId)`. Any failure up to here rolls back like `createRevisionChannel` does.
  - It then seeds the folders from `EpisodeTemplateLines`-equivalent parsing of `team.episode_folders`. A shared `templateLines(text)` helper goes in `components/tasks/task_utils.ts`. Folders are created parent before child with `Client4.createDriveFolder(channelId, parentId, name)`, and created ids are cached by path.
  - It then creates one task per `team.episode_tasks` line (`section_id`, no assignee, status todo), in template order.
  - A failed folder or task does not stop the others. Its line goes into `failed`.
- The modal navigates to the channel. When `failed` is non-empty, it first shows a warning listing them, then navigates on close.
- The menu item "Create episode channel" requires all of:
  - `tasks_enabled`, `revisions_enabled`, `canvas_enabled` and `files_enabled`;
  - the `MANAGE_REVISIONS` and `MANAGE_TASKS` permissions.

- [ ] **Step 1: Write the failing tests** in `tasks.test.ts`:
  - "createEpisodeChannel calls channel, section, video, canvas in order";
  - "a canvas failure deletes the section and the channel";
  - "folders are created parent first and a shared parent once";
  - "a failed folder or task is reported and the rest still created".

  For the modal and menu:
  - "the episode menu item needs all four toggles and both permissions";
  - "the modal shows the warning list".
- [ ] **Step 2: Run them.** `npx jest src/actions/tasks.test.ts src/components/tasks src/components/sidebar/sidebar_header`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the strings to en and tr.
- [ ] **Step 4: Run them again,** then lint and check-types. Expected: PASS.
- [ ] **Step 5: Commit** "Create episode channels from the team templates".

### Task 8: Team Settings templates

**Files:**
- Modify: `webapp/channels/src/components/team_settings/team_info_tab/team_info_tab.tsx` (+ test)

**Produces:**
- Two textareas, "Default episode folders" and "Default episode tasks", each with a one-line hint. They show when tasks and revisions are both on.
- Their values join the existing unsaved-changes check and the patch. Only changed fields are sent, as `files_enabled` is.
- A server `model.team.is_valid.episode_*` error is shown under the matching field.

- [ ] **Step 1: Write the failing tests:**
  - "template fields show only with tasks and revisions on";
  - "editing a template marks unsaved changes and saves it in the patch";
  - "a rejected folder template shows the error under the field".
- [ ] **Step 2: Run them.** `npx jest src/components/team_settings/team_info_tab`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the strings to en and tr.
- [ ] **Step 4: Run them again,** then lint and check-types. Expected: PASS.
- [ ] **Step 5: Commit** "Edit the episode templates in Team Settings".

### Task 9: Deploy to dopgun and walk through

- [ ] **Step 1: Build and swap the server binary** the way the custom roles deploy did: build `bin/mattermost.new`, stop `dopgun-server`, keep the old binary as `mattermost.old`, start the server and ping it. Then run `npm run build` in `webapp/channels`.
  - Expected: the ping returns OK, and the log shows migration 000255 applied.
- [ ] **Step 2: Walk through the episode flow in the browser pane:**
  - in Team Settings, set two folder lines (one nested) and two task lines;
  - create an episode with a small mp4;
  - check:
    - the four tabs;
    - the folders in the file explorer;
    - the two tasks on the Tasks tab and in the team task board's section column;
  - add a revision;
  - upload v2;
  - check the old revision shows with a `v1` badge.

  Expected: as described. Ledger the result.
- [ ] **Step 3: Remove the walkthrough data only with the user's yes.**
