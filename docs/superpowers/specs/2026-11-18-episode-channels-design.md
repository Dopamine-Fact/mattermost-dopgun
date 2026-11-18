# Episode channels — design

## Intent
A production team works on a series episode by episode. Each episode gets one channel that holds everything about it: chat, the episode video and its revisions, the episode's own tasks, a canvas, and a ready-made folder structure in the channel drive. New episodes start from the team's default folder list and default task list, which team admins can edit. Video gets versions: a new cut is uploaded as v2, v3 … and earlier cuts and their revisions are kept. Versioning applies to every revision channel, not only episodes.

## Goals
- Add Channels → **"Create episode channel"**: name + first video → a channel with tabs **Messages | Revisions | Tasks | Canvas**, default folders in its drive, default tasks on its task list.
- Episode tasks also show on the team task board (the episode is one section/column there, as revision channels are today).
- Revisions are tied to the video version they were written on (user picked option 1).
- Default folders and tasks are set per team in Team Settings.

## Non-goals
- Several templates per team (e.g. per episode type); editing the template of an existing episode; re-applying a changed template.
- Deleting or renaming video versions; comparing two versions side by side.
- Seasons/series grouping above episodes; converting an existing channel into an episode.

## Anti-goals
- A revision's time code pointing at a different cut than the one it was written on.
- A new upload destroying earlier cuts.
- Ordinary episode tasks posting "revision" cards into the chat or linking to the Revisions tab.

## Approaches
1. **Episode = existing pieces combined, created by one client action (picked).** An episode channel is a normal channel with a linked task section (as revision channels), a canvas row (as canvas channels) and seeded drive folders and tasks. A webapp action calls the existing endpoints in order, like `createRevisionChannel` does today. No new channel type; every piece keeps its own permission and toggle checks.
2. One server endpoint `POST /teams/{id}/episodes` doing all steps in one request — not picked: duplicates the video upload, canvas and drive create paths server-side for a flow the client already orchestrates for revision and canvas channels.
3. A new channel type / `Channel.Props` marker — rejected: touches core channel code and every channel-type switch, for no behaviour the combination above lacks.

Versions: a `TaskSectionVideos` table with one row per upload, and the revision's version stored on the task (`Task.VideoFileId`). Alternatives (versions as JSON on the section; one section per version) rejected: untyped, or revisions would split across board columns.

## Design — server

### Video versions (all revision channels)
- Migration `000255_task_video_versions` (postgres up/down + `migrations.list`; 000253/000254 are custom roles and departments):
  - `CREATE TABLE TaskSectionVideos (Id varchar(26) PK, SectionId varchar(26) NOT NULL, FileId varchar(26) NOT NULL, Version int NOT NULL, CreatorId varchar(26) NOT NULL, CreateAt bigint NOT NULL)`, unique `(SectionId, Version)`.
  - `ALTER TABLE Tasks ADD COLUMN VideoFileId varchar(26) NOT NULL DEFAULT ''`.
  - Backfill: each section with `VideoFileId <> ''` gets a version-1 row (CreatorId = FileInfo creator, CreateAt = FileInfo CreateAt). A task in such a section gets `Tasks.VideoFileId = section.VideoFileId` only if a `custom_revision` post with `Props->>'task_id' = Tasks.Id` exists in the section's channel. *(My call: today any task can be moved into a revision section from the task detail, so "every task there is a revision" is false; the revision card post is the reliable mark. A revision whose card was deleted becomes an ordinary task — acceptable.)* Note that revisions written before a video replacement lost their video already; they land on v1 like the rest.
  - `Teams` gets `EpisodeFolders text NOT NULL DEFAULT ''` and `EpisodeTasks text NOT NULL DEFAULT ''` (see Templates).
- `model.TaskSectionVideo {Id, SectionId, FileId, Version, CreatorId, CreateAt}`; store methods on `TaskStore`: `SaveSectionVideo` (assigns `Version = max+1` in the same statement/transaction), `GetSectionVideos(sectionId)` ordered by version. Regenerate store layers.
- `TaskSection.VideoFileId` keeps meaning "latest version", so existing readers keep working.
- `SetTaskSectionVideo` adds a version instead of replacing: upload, save version row, set `section.VideoFileId`, **no longer deletes the previous file**. On failure it removes only the new file.
- `DeleteTaskSection` removes the files of all versions and the version rows, and clears `VideoFileId` on the section's tasks, so its revisions become ordinary tasks under "no section" (their text, comments and files are kept). *(My call: less destructive than deleting them.)*
- New `GET /task_sections/{id}/videos` → `[]TaskSectionVideo` with each FileInfo embedded (name, size, creator), same read rule as `GET .../video`.
- `GET /task_sections/{id}/video?file_id=<id>` streams that version (must belong to the section; default latest).
- `Task.VideoFileId` (`video_file_id`): a task is a **revision** iff it is non-empty. Set on create only (not in `TaskPatch`). On create, if set, the task's section must be a linked section with that file among its versions, else 400 `app.task.invalid_video.app_error`. A patch that changes a revision's section (to another section or to "no section") is rejected with the same error; the webapp disables the section dropdown in `TaskDetail` for revisions.
- `taskRevisionChannel` returns nil when `task.VideoFileId == ""`, so ordinary tasks in an episode section post nothing to chat and their DM links go to the tasks page as today. Revision posts and links are unchanged.

### Permissions follow the task (user's pick)
- Today `api4/task.go` picks the permission from the task's section (`sectionPermission`: a linked section needs `manage_revisions`). That would let only revision managers add or delete an episode's ordinary tasks.
- New rule: a task's own `VideoFileId` decides. Revision (`VideoFileId != ""`) → `manage_revisions`; any other task, also one in a linked section → `manage_tasks`. `requireTaskPermission` takes the task instead of a section id; it covers create (from the request body), assignee change, delete, and deleting someone else's comment. The rank hierarchy check (`requireCanAssign`) is unchanged and gets the permission picked here.
- Section endpoints (create/patch/delete a linked section, upload a video version) keep `sectionPermission` → `manage_revisions`.
- Webapp: `TaskDetail` picks `task.video_file_id ? 'manage_revisions' : 'manage_tasks'` instead of looking at the section. The Revisions tab keeps `manage_revisions`; the Tasks tab's "Add task" and edit controls use `manage_tasks`.
- Consequence of the backfill: a task in a revision section without a revision card becomes ordinary and from then on needs `manage_tasks`.

### Templates
- `Team.EpisodeFolders` (`episode_folders`) and `Team.EpisodeTasks` (`episode_tasks`): newline-separated text, wired like `FilesEnabled` (model, patch, `Auditable`, `team_store` columns). `IsValid`: each ≤ 4000 runes; folders max 100 lines, tasks max 100 lines.
- Folder lines are paths with `/` (e.g. `Animasyon/Layout`); each segment must pass the DriveItem name rule. Validated in `Team.IsValid` so a bad template is rejected when saved, not when an episode is created.
- Empty lines and surrounding spaces are ignored. Changing a template only affects episodes created later.
- Visibility *(my call)*: the templates live on `Team`, so every team member — and, for open teams, users who can list them — can read them, like the team description. Fine for generic folder/task names; managers who create episodes need to read them anyway. If names become sensitive, move them to a team-admin endpoint.

## Design — webapp

### Creating an episode
- Add Channels menu entry **"Create episode channel"**, shown when the team has tasks, revisions, canvas and files all enabled and the user has both `manage_revisions` (channel, section, video) and `manage_tasks` (the seeded tasks). `manage_team_tasks` no longer exists; it was split into `manage_tasks`, `manage_daily_reports` and `manage_revisions`. *(My call: requiring all four keeps every episode complete; a team that turns one off still sees the other tabs.)*
- Modal: name + video file (same as the revision channel modal).
- Action `createEpisodeChannel(teamId, name, video)`:
  1. create channel → create linked section → upload video (v1) → `createCanvas(channelId)`. Any failure here: delete section, delete (archive) channel, show the error — as `createRevisionChannel` does.
  2. Seed folders: create each path segment in order with `createDriveFolder` (parents before children, reusing an id when two lines share a parent).
  3. Seed tasks: `createTask` for each line, in the episode section, unassigned, status todo, in template order.
  Steps 2–3 are best-effort: on failure the channel is kept and a warning says which default items could not be created. *(My call: the channel is usable; rolling back after a partial seed would lose the video upload for a missing folder.)*
- On success navigate to the channel.

### Channel tabs
- Replace the nested `CanvasTabs` + `RevisionTabs` in `channel_view.tsx` with one `ChannelTabs` that builds a single tab bar from what the channel has:
  - linked section → **Revisions** and **Tasks**
  - canvas row → **Canvas**
  - none → chat only, no tab bar.
  Existing revision channels therefore also get a Tasks tab; existing canvas channels are unchanged. `?revision=<id>` and `?canvas=1` keep working.
- **Revisions tab:** version picker above the player ("v3 · 18 Nov · uploader", newest first, latest selected). The list shows revisions of the selected version; on the latest version it also lists still-open revisions of older versions with a "v2" badge. Selecting one switches the player to its version and seeks to its time. New revisions are saved with the selected version's file id. The manager button "Replace video" becomes **"Upload new version"**.
- **Tasks tab:** the existing `List` view, fed only this section's tasks with `video_file_id === ''`; "Add task" creates in this section. Task detail is the existing `TaskDetail`.
- **Canvas tab:** the existing board, unchanged.
- Team task board/list/timeline show both revisions and ordinary tasks in the section column, as today.

### Team Settings
- In the tasks/revisions area, two textareas: **"Default episode folders"** (one path per line, `/` for sub-folders) and **"Default episode tasks"** (one task per line). Shown when tasks and revisions are on. Server validation errors are shown inline.

## Tests
- Model: template validation (lengths, line counts, bad folder names); task revision validation.
- Store: version numbering, backfill migration on a fixture with an existing revision section.
- App: new upload keeps old file and bumps version; delete section removes all version files; ordinary task in a linked section posts nothing; revision create with a foreign file id → 400.
- API: in a linked section, a `manage_tasks`-only user can create/assign/delete an ordinary task but gets 403 on a revision; a `manage_revisions`-only user the reverse.
- Webapp: `createEpisodeChannel` call order and rollback; ChannelTabs tab sets; Revisions version picker and older-version badge; Tasks tab filters.
- One Playwright spec: create an episode with templates, see folders in the explorer and tasks on the board, upload v2, old revision shows with badge.

## Left to the builder
Exact i18n wording, picker styling, whether folder seeding uses one request per folder or a small batch, and where in Team Settings the textareas sit.
