# Personal Notes and Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team members write personal notes (private or shared with the team), see dated ones on a FullCalendar month/week calendar, tick them off, and get a system-bot DM reminder; the feature is toggled per team.

**Architecture:** New `PersonalNotes` table + `Teams.NotesEnabled` column, a store, app methods and `/api/v4/teams/{team_id}/notes` routes in core, mirroring Files/Daily Reports. A 1-minute leader task sends due reminders. The webapp adds a sidebar link, a lazily loaded `/:team/calendar` page built on FullCalendar, a note dialog and an undated list.

**Tech Stack:** Go (squirrel/sqlx, Postgres migrations), React 19 + TypeScript, FullCalendar 6.1.22.

**Spec:** `docs/superpowers/specs/2026-11-25-personal-notes-calendar-design.md`

## Global Constraints

- Branch `feature/personal-notes` from current `master` in this checkout. The tree has someone else's **uncommitted** work (task approval, migration 000266) in shared files: `server/public/model/team.go`, `server/channels/store/sqlstore/team_store.go`, `server/channels/db/migrations/migrations.list`, `server/i18n/en.json`, `webapp/channels/src/i18n/en.json`, `tr.json`, `webapp/platform/client/src/client4.ts`, `webapp/platform/types/src/teams.ts`. Never `git add` those whole: stage only this feature's hunks (`git diff <file>` → keep own hunks → `git apply --cached`). Never stash, reset or checkout them.
- Go is not installed on this Mac. Start Docker Desktop, then once: `docker network create mmtest; docker run -d --name mm-postgres --network mmtest -e POSTGRES_USER=mmuser -e POSTGRES_PASSWORD=mostest_password -e POSTGRES_DB=mattermost_test postgres:15`. `GORUN '<cmd>'` means `docker run --rm --network mmtest -v "$PWD":/repo -v mm-gomod:/go/pkg/mod -v mm-gocache:/root/.cache/go-build -w /repo/server golang:1.26 sh -c '<cmd>'` from the repo root. `GOTEST` means `IS_CI=true TEST_DATABASE_POSTGRESQL_DSN='postgres://mmuser:mostest_password@mm-postgres:5432/mattermost_test?sslmode=disable&connect_timeout=10' MM_SQLSETTINGS_DRIVERNAME=postgres go test`.
- Store layers: `GORUN 'go generate ./channels/store'`. Mocks: `GORUN 'go run github.com/vektra/mockery/v2@v2.53.4 --config channels/store/.mockery.yaml'`, then `git checkout` every regenerated mock except `PersonalNoteStore.go` and `Store.go`.
- i18n: add entries by hand in sorted position, each with a `description` — server `server/i18n/en.json`; webapp `webapp/channels/src/i18n/en.json` and `tr.json` (Turkish translation). Never run `npm run i18n-extract`.
- Webapp checks from `webapp/channels`: `npx jest <path>`, `npx eslint --fix <files>`, `npx tsc --noEmit -p .`.
- FullCalendar: `@fullcalendar/core`, `@fullcalendar/react`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`, all exact `6.1.22` (peer range covers React 19; the server CSP has no `style-src`, so its injected styles load).
- Limits (spec): title 1–200 runes after trim; message ≤ 4000 runes; visibility `private` | `team`; `Date` `YYYY-MM-DD` or `''`; `Time` `HH:MM` 24h or `''`, must be `''` when undated; `RemindMinutes` `-1` or 0–10080, must be `-1` when undated; all-day reminder base 09:00 in owner's timezone; range query ≤ 62 days; undated list ≤ 500 rows; reminder tick 1 minute, batch 200.
- Access: active team membership (`TeamMember.DeleteAt == 0`), not `PermissionViewTeam`. Others' private note or note from another team → 404. Non-owner patch/delete of a team note → 403. Feature off or team deleted → 403 `app.note.disabled.app_error`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Guessed id of a teammate's private note** (GET, PATCH, DELETE). Expected: 404 each time, body reveals nothing. (Task 3 test.)
2. **All-day note seen from another timezone.** Expected: shows on the same calendar day — events are built from the `Date` string, never `new Date(...)`. (Task 6 test.)
3. **Drag of a timed note.** Expected: in month view `Date` changes and `Time` is kept; in week view dropping into the all-day row clears `Time`. (Task 6 test.)
4. **Reminder whose time has already passed when saved** (e.g. "1 day before" on today's note). Expected: `RemindAt = 0`, no DM. (Task 1 test.)
5. **Team toggled off with reminders pending, then on again.** Expected: reminders cleared while off, none sent in a burst later. (Task 4 test.)

---

### Task 1: Note model

**Files:**
- Create: `server/public/model/personal_note.go`, `server/public/model/personal_note_test.go`

**Interfaces:**
- Produces (`model`):
  ```go
  const (
      PersonalNoteVisibilityPrivate = "private"
      PersonalNoteVisibilityTeam    = "team"
      PersonalNoteTitleMaxRunes     = 200
      PersonalNoteMessageMaxRunes   = 4000
      PersonalNoteNoReminder        = -1
      PersonalNoteRemindMaxMinutes  = 10080
      PersonalNoteAllDayHour        = 9
  )
  type PersonalNote struct {
      Id, TeamId, UserId, Title, Message, Visibility, Date, Time string
      RemindMinutes                                              int
      RemindAt, DoneAt, CreateAt, UpdateAt                       int64
  } // json: id, team_id, user_id, title, message, visibility, date, time, remind_minutes, remind_at, done_at, create_at, update_at
  type PersonalNotePatch struct {
      Title, Message, Visibility, Date, Time *string
      RemindMinutes                          *int
      Done                                   *bool
  } // json: title, message, visibility, date, time, remind_minutes, done
  func (n *PersonalNote) PreSave()                   // new Id if empty, trim Title, CreateAt=UpdateAt=GetMillis(), Visibility defaults to private
  func (n *PersonalNote) PreUpdate()                 // trim Title, UpdateAt=GetMillis()
  func (n *PersonalNote) IsValid() *AppError         // ids: model.personal_note.is_valid.<id|team_id|user_id|title|message|visibility|date|time|remind_minutes>.app_error, 400
  func (n *PersonalNote) Patch(p *PersonalNotePatch) // Done=true sets DoneAt=GetMillis() only if 0; Done=false sets 0
  func (n *PersonalNote) ComputeRemindAt(loc *time.Location, now int64) // sets RemindAt (ms) or 0
  ```

- [ ] **Step 1: Write failing tests** in `personal_note_test.go`:
  - `TestPersonalNoteIsValid` table: valid dated/timed note → nil; title `"  "` after `PreSave` → `...title...`; title 201 × `"ş"` → error, 200 → ok; message 4001 runes → error; visibility `"public"` → error; date `"2026-13-01"` / `"25-11-2026"` → error; time `"24:00"` / `"9:00"` → error; `Date:""` with `Time:"10:00"` → error; `Date:""` with `RemindMinutes:0` → error; `RemindMinutes:-2` and `10081` → error.
  - `TestPersonalNoteComputeRemindAt` with `ist, _ := time.LoadLocation("Europe/Istanbul")`, now = 2026-11-24 00:00 UTC: `Date:"2026-11-25", Time:"10:00", RemindMinutes:15` → `time.Date(2026,11,25,9,45,0,0,ist).UnixMilli()`; all-day `Time:""`, `RemindMinutes:1440` → 2026-11-24 09:00 Istanbul; same all-day note in `time.UTC` → 2026-11-24 09:00 UTC; `RemindMinutes:-1` → 0; result before `now` → 0; `DoneAt>0` → 0; undated → 0.
  - `TestPersonalNotePatch`: `Done:true` twice keeps the first `DoneAt`; `Done:false` → 0; nil fields untouched.
- [ ] **Step 2: Run** `GORUN 'go test ./public/model -run TestPersonalNote'`. Expected: FAIL (undefined `PersonalNote`).
- [ ] **Step 3: Implement** `personal_note.go`. Start time via `time.ParseInLocation("2006-01-02 15:04", date+" "+time, loc)`; validation via `time.Parse` with exact lengths 10 / 5.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add personal note model`.

### Task 2: Migration, team toggle and store

**Files:**
- Create: `server/channels/db/migrations/postgres/000267_create_personal_notes.up.sql`, `.down.sql`; modify `migrations.list` (own lines only)
- Modify: `server/public/model/team.go` (`NotesEnabled bool json:"notes_enabled"` next to `FilesEnabled` in struct, `Auditable`, `TeamPatch`, patch `Auditable`, `Patch()`), `server/channels/store/sqlstore/team_store.go` (column list, insert, update — next to `FilesEnabled`)
- Modify: `server/channels/store/store.go` (accessor `PersonalNote() PersonalNoteStore` + interface next to `DailyReport`), `server/channels/store/sqlstore/store.go` (field, constructor, accessor — mirror `dailyReport`), `server/channels/store/storetest/store.go` (mirror `DailyReportStore`)
- Create: `server/channels/store/sqlstore/personal_note_store.go`, `personal_note_store_test.go`, `server/channels/store/storetest/personal_note_store.go`
- Regenerate: retry/timer layers, `storetest/mocks/PersonalNoteStore.go`, `storetest/mocks/Store.go`

**Interfaces:**
- Consumes: Task 1 `model.PersonalNote`.
- Produces (`store`):
  ```go
  type PersonalNoteListOptions struct {
      FromDate, ToDate  string // inclusive, YYYY-MM-DD; ignored when Undated
      Undated, OnlyMine bool
      Limit             int
  }
  type PersonalNoteStore interface {
      Save(n *model.PersonalNote) (*model.PersonalNote, error)
      Get(id string) (*model.PersonalNote, error) // *store.ErrNotFound
      Update(n *model.PersonalNote) (*model.PersonalNote, error)
      Delete(id string) error
      GetForTeam(teamID, userID string, opts PersonalNoteListOptions) ([]*model.PersonalNote, error)
      GetDueReminders(now int64, limit int) ([]*model.PersonalNote, error) // 0 < RemindAt <= now, oldest first
      ClearReminder(id string) error                                       // RemindAt = 0
  }
  ```
- `GetForTeam`: rows of `teamID` where `UserId = userID` OR (`!OnlyMine` AND `Visibility='team'` AND owner has a `TeamMembers` row with `DeleteAt=0` AND `Users.DeleteAt=0`). Dated: `Date BETWEEN FromDate AND ToDate`, order `Date, Time, CreateAt` (`''` time sorts first = all-day first). Undated: `Date=''`, order open before done, then `CreateAt DESC`.

- [ ] **Step 1: Migration** `000267_create_personal_notes.up.sql`:
  ```sql
  ALTER TABLE Teams ADD COLUMN IF NOT EXISTS NotesEnabled boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS PersonalNotes (
      Id varchar(26) PRIMARY KEY,
      TeamId varchar(26) NOT NULL,
      UserId varchar(26) NOT NULL,
      Title varchar(256) NOT NULL,
      Message text NOT NULL DEFAULT '',
      Visibility varchar(16) NOT NULL,
      Date varchar(10) NOT NULL DEFAULT '',
      Time varchar(5) NOT NULL DEFAULT '',
      RemindMinutes integer NOT NULL DEFAULT -1,
      RemindAt bigint NOT NULL DEFAULT 0,
      DoneAt bigint NOT NULL DEFAULT 0,
      CreateAt bigint NOT NULL,
      UpdateAt bigint NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_personalnotes_team_date ON PersonalNotes (TeamId, Date);
  CREATE INDEX IF NOT EXISTS idx_personalnotes_team_user ON PersonalNotes (TeamId, UserId);
  CREATE INDEX IF NOT EXISTS idx_personalnotes_remindat ON PersonalNotes (RemindAt) WHERE RemindAt > 0;
  ```
  Down: drop the table, drop the column. Add both files to `migrations.list` the way 000265 is listed.
- [ ] **Step 2: Write failing store tests** `TestPersonalNoteStore` in `storetest/personal_note_store.go`, registered in `sqlstore/personal_note_store_test.go` like `daily_report_store_test.go`. Setup: team T; users A, B, C members; D member then removed (`DeleteAt>0`); E deactivated. Notes: A private 2026-11-25, A team 2026-11-25 10:00, A undated, B private 2026-11-25, B team all-day 2026-11-25, D team 2026-11-25, E team 2026-11-25, one note in another team.
  - `GetForTeam(T, A, {FromDate:"2026-11-01", ToDate:"2026-11-30"})` → exactly {A private (all-day), B team (all-day), A team (10:00)}, with A team last.
  - same for C → exactly {B team, A team}, B team first.
  - `OnlyMine:true` for A → A's two dated notes.
  - `Undated:true` for A → A undated; a done undated note sorts after an open one.
  - `GetDueReminders(now, 200)` returns only `0 < RemindAt <= now`; after `ClearReminder` it's gone.
  - `Get` unknown id → `*store.ErrNotFound`; `Delete` then `Get` → not found.
  - Team round-trip: `NotesEnabled=true` survives team `Save`/`Update`/`Get`.
- [ ] **Step 3: Run** `GORUN 'GOTEST ./channels/store/sqlstore -run TestPersonalNoteStore'`. Expected: FAIL (compile error).
- [ ] **Step 4: Implement** store, team field, wiring; regenerate layers and mocks.
- [ ] **Step 5: Run** the store test plus `GORUN 'GOTEST ./channels/store/sqlstore -run TestTeamStore'` and `GORUN 'go test ./public/model -run TestTeam'`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: add personal notes table, store and team toggle` (own hunks only in shared files).

### Task 3: App layer and API

**Files:**
- Create: `server/channels/app/personal_note.go`, `personal_note_test.go`, `server/channels/api4/personal_note.go`, `personal_note_test.go`, `server/public/model/client4_personal_note.go`
- Modify: `server/channels/api4/api.go` (`api.InitPersonalNotes()` next to `InitDailyReports`), `server/i18n/en.json`

**Interfaces:**
- Consumes: Task 1 model, Task 2 store.
- Produces (`app`):
  ```go
  func (a *App) RequireNotesEnabled(teamID string) (*model.Team, *model.AppError)
  func (a *App) CreatePersonalNote(rctx request.CTX, note *model.PersonalNote) (*model.PersonalNote, *model.AppError)
  func (a *App) GetPersonalNote(rctx request.CTX, teamID, noteID, userID string) (*model.PersonalNote, *model.AppError)
  func (a *App) GetPersonalNotes(rctx request.CTX, teamID, userID string, opts store.PersonalNoteListOptions) ([]*model.PersonalNote, *model.AppError)
  func (a *App) PatchPersonalNote(rctx request.CTX, teamID, noteID, userID string, patch *model.PersonalNotePatch) (*model.PersonalNote, *model.AppError)
  func (a *App) DeletePersonalNote(rctx request.CTX, teamID, noteID, userID string) *model.AppError
  func (a *App) personalNoteLocation(userID string) *time.Location // owner's GetPreferredTimezone(); UTC on any error
  ```
  Create/Patch: `PreSave`/`PreUpdate` → `IsValid` → `ComputeRemindAt(personalNoteLocation(owner), model.GetMillis())`.
- Produces (routes on `api.BaseRoutes.Team`, all `APISessionRequired`): `GET /notes` (query `from`, `to`, `undated`, `only_mine`), `POST /notes`, `GET /notes/{note_id}`, `PUT /notes/{note_id}/patch`, `DELETE /notes/{note_id}`.
- Produces (`model.Client4`): `GetPersonalNotes(ctx, teamID, from, to string, undated, onlyMine bool)`, `GetPersonalNote(ctx, teamID, noteID)`, `CreatePersonalNote(ctx, teamID, note)`, `PatchPersonalNote(ctx, teamID, noteID, patch)`, `DeletePersonalNote(ctx, teamID, noteID)`.
- Error ids (server `en.json`): `app.note.disabled.app_error` (403), `app.note.not_found.app_error` (404), `app.note.not_owner.app_error` (403), `api.note.invalid_range.app_error` (400), the Task 1 `model.personal_note.is_valid.*` ids, and `app.note.save.app_error`, `app.note.get.app_error`, `app.note.update.app_error`, `app.note.delete.app_error`.

- [ ] **Step 1: Write failing API tests** in `api4/personal_note_test.go` (`th := Setup(t).InitBasic(t)`, `NotesEnabled` on `th.BasicTeam` via `UpdateTeam`; `th.BasicUser` owner, `th.BasicUser2` teammate):
  - `TestPersonalNotesDisabled`: toggle off → every route 403 `app.note.disabled.app_error`.
  - `TestPersonalNotesMembership`: a user outside the team, and a system admin removed from the team → 403.
  - `TestPersonalNoteCreate`: body `user_id`/`team_id` of someone else ignored (stored as session user / URL team); invalid title → 400; future reminder → `remind_at > 0`.
  - `TestPersonalNotePrivacy`: BasicUser2 GET/PATCH/DELETE of BasicUser's private note → 404 each; the same id under another team → 404; GET of a `team` note → 200; PATCH/DELETE of it → 403.
  - `TestPersonalNotesList`: `from=2026-11-01&to=2026-11-30` → own + team notes; a 63-day range → 400 `api.note.invalid_range.app_error`; no `from` and no `undated=true` → 400; `only_mine=true` filters.
  - `TestPersonalNotePatchDone`: `done:true` → `done_at > 0`, `remind_at == 0`; `done:false` → `remind_at` recomputed.
- [ ] **Step 2: Run** `GORUN 'GOTEST ./channels/api4 -run TestPersonalNote'`. Expected: FAIL.
- [ ] **Step 3: Implement** app, API, client, i18n. Membership: `c.App.GetTeamMember(rctx, teamID, session.UserId)` with `DeleteAt == 0`, else `c.SetPermissionError(model.PermissionViewTeam)`. Limits: 500 undated, 1000 for a range.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add personal notes API` (own hunks only in `en.json`).

### Task 4: Reminders

**Files:**
- Modify: `server/channels/app/personal_note.go`, `personal_note_test.go`, `server/channels/app/channels.go` (`noteReminderTask leaderTask` + its `stop()` next to `driveTrashTask`), `server/channels/app/server.go` (`runLeaderTasks`, next to post reminders), `server/i18n/en.json`

**Interfaces:**
- Consumes: Task 2 `GetDueReminders`, `ClearReminder`; Task 3 `RequireNotesEnabled`.
- Produces: `func (a *App) CheckNoteReminders(rctx request.CTX)`; leader task `"Check note reminders"` every `time.Minute`.
- DM `app.note_reminder_dm`: `"🔔 Reminder: **{{.Title}}** — {{.When}}\n[Open in calendar]({{.SiteURL}}/{{.TeamName}}/calendar?note={{.NoteId}})"`; `When` = `Date` or `Date Time`; owner's locale; posted by the system bot in its DM with the owner, the way `CheckPostReminders` (`app/post.go`) does.

- [ ] **Step 1: Write failing test** `TestCheckNoteReminders`:
  - due note of `th.BasicUser` → exactly one new post in the system-bot DM containing the title and `/calendar?note=<id>`; `RemindAt == 0` after; a second call sends nothing.
  - team `NotesEnabled=false` with a due note → no post, `RemindAt == 0`; turned back on, call again → no post.
  - owner removed from the team → no post, cleared; owner deactivated → no post, cleared.
  - future `RemindAt` → untouched.
- [ ] **Step 2: Run** `GORUN 'GOTEST ./channels/app -run TestCheckNoteReminders'`. Expected: FAIL.
- [ ] **Step 3: Implement.** Send, then `ClearReminder`; a failed send is logged and left for the next tick. Cache team lookups within one tick.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: send personal note reminders`.

### Task 5: Webapp types, client, team toggle and entry point

**Files:**
- Create: `webapp/platform/types/src/personal_notes.ts`, `webapp/channels/src/components/personal_notes/calendar_link.tsx`, `calendar_link.test.tsx`, placeholder `index.tsx`
- Modify: `webapp/platform/types/src/teams.ts` (`notes_enabled?: boolean`), `webapp/platform/client/src/client4.ts`, `webapp/channels/src/components/team_settings/team_info_tab/team_info_tab.tsx` (+ the child it passes `filesEnabled` to), `webapp/channels/src/components/sidebar/sidebar_list/sidebar_list.tsx`, `webapp/channels/src/components/channel_layout/center_channel/center_channel.tsx`, i18n `en.json`/`tr.json`

**Interfaces:**
- Produces (types):
  ```ts
  export type PersonalNoteVisibility = 'private' | 'team';
  export type PersonalNote = {id: string; team_id: string; user_id: string; title: string; message: string; visibility: PersonalNoteVisibility; date: string; time: string; remind_minutes: number; remind_at: number; done_at: number; create_at: number; update_at: number};
  export type PersonalNotePatch = Partial<Pick<PersonalNote, 'title' | 'message' | 'visibility' | 'date' | 'time' | 'remind_minutes'>> & {done?: boolean};
  ```
- Produces (`Client4`): `getPersonalNotesRoute(teamId)`, `getPersonalNotes(teamId, opts: {from?: string; to?: string; undated?: boolean; only_mine?: boolean})`, `getPersonalNote(teamId, noteId)`, `createPersonalNote(teamId, note: Partial<PersonalNote>)`, `patchPersonalNote(teamId, noteId, patch: PersonalNotePatch)`, `deletePersonalNote(teamId, noteId)`.
- Produces: route `/:team(${TEAM_NAME_PATH_PATTERN})/calendar` → `makeAsyncComponent('PersonalNotes', lazy(() => import('components/personal_notes')))`. `CalendarLink` mirrors `FileExplorerLink` (`CalendarOutlineIcon`, id `sidebarItem_calendar`, text id `personal_notes.sidebarLink` = "Calendar" / "Takvim"), hidden unless `team.notes_enabled`, rendered right after `<FileExplorerLink/>` and loaded the same lazy way.
- Team settings: `notes_enabled` checkbox mirroring `files_enabled` everywhere it appears (state, dirty check, patch, reset); label id `team_settings.notesEnabled` = "Personal notes and calendar" / "Kişisel notlar ve takvim".

- [ ] **Step 1: Write failing test** `calendar_link.test.tsx`: renders nothing when `notes_enabled` is false or missing; renders a link to `/<team>/calendar`, with `active` on the `li` when the path is `/<team>/calendar`.
- [ ] **Step 2: Run** `npx jest src/components/personal_notes/calendar_link.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the task's file list.
- [ ] **Step 4: Run** the test, the existing `team_info_tab` tests, `npx tsc --noEmit -p .`, eslint on changed files. Expected: PASS, no errors.
- [ ] **Step 5: Commit** `feat: add calendar entry point and team toggle` (own hunks only in shared files).

### Task 6: Calendar page, note dialog, undated list

**Files:**
- Modify: `webapp/channels/package.json`, `webapp/package-lock.json` (from `webapp/`: `npm install --save-exact --workspace=channels @fullcalendar/core@6.1.22 @fullcalendar/react@6.1.22 @fullcalendar/daygrid@6.1.22 @fullcalendar/timegrid@6.1.22 @fullcalendar/interaction@6.1.22`)
- Create in `webapp/channels/src/components/personal_notes/`: `index.tsx` (replaces placeholder), `personal_notes_page.tsx`, `note_dialog.tsx`, `undated_list.tsx`, `note_utils.ts`, `personal_notes.scss`, `note_utils.test.ts`, `personal_notes_page.test.tsx`
- Modify: i18n `en.json`/`tr.json` (ids under `personal_notes.`)

**Interfaces:**
- Consumes: Task 5 types and `Client4` methods.
- Produces (`note_utils.ts`):
  ```ts
  export function noteToEvent(note: PersonalNote, currentUserId: string, ownerName: string): EventInput; // allDay when time===''; start = date or `${date}T${time}`; timed end = +30 min; editable = owner; extendedProps.note
  export function dropToPatch(note: PersonalNote, start: Date, allDay: boolean, view: 'dayGridMonth' | 'timeGridWeek'): PersonalNotePatch; // month: date only; week: date + time, or time '' when allDay
  export function reminderOptions(allDay: boolean): Array<{value: number; labelId: string}>; // timed: -1,0,5,15,30,60,1440; all-day: -1,0,1440
  export function validateNote(note: Partial<PersonalNote>): string | null; // i18n id of the first problem; mirrors model IsValid
  export function toLocalDateString(d: Date): string; // YYYY-MM-DD from local fields, never toISOString
  ```
- Page (spec "Calendar page"): views `dayGridMonth`/`timeGridWeek`, `firstDay: 1`, locale from the user locale, 24h unless the clock-display preference is 12h; `datesSet` fetches `{from, to}` (`to` = view end − 1 day) and the undated list; filter "Everyone" / "Only mine" in `localStorage` key `personal_notes_filter_<userId>` (try/catch); `dateClick`/`select` → new-note dialog prefilled; `eventClick` → edit dialog (own) or read-only view (teammate); `eventDrop` → `patchPersonalNote(dropToPatch(...))`, on error `info.revert()` and show the error; `?note=<id>` → `getPersonalNote`, `gotoDate(note.date)` if dated, open its dialog; `--fc-*` variables in `personal_notes.scss` mapped to theme variables.
- Dialog: `GenericModal`; title, description, "No date" + date input, "All day" + time input, reminder select (hidden when undated), visibility (Private default / Team), done checkbox, Delete with confirm; errors from `validateNote`.

- [ ] **Step 1: Write failing tests** `note_utils.test.ts`:
  - `noteToEvent({date:'2026-11-25', time:''})` → `allDay: true`, `start === '2026-11-25'` (a string, not a Date); timed → `start === '2026-11-25T10:00'`; teammate's note → `editable: false`.
  - `dropToPatch`: month view, 10:00 note dropped on 2026-11-27 → `{date: '2026-11-27'}` with no `time` key; week view at 2026-11-27 14:30 → `{date: '2026-11-27', time: '14:30'}`; week view all-day row → `{date: '2026-11-27', time: ''}`.
  - `toLocalDateString(new Date(2026, 10, 25, 23, 30)) === '2026-11-25'`.
  - `validateNote`: title `'  '` → title-required id; `{date: '', time: '10:00'}` → time-without-date id.
  - `reminderOptions(true).map((o) => o.value)` → `[-1, 0, 1440]`.
- [ ] **Step 2: Write failing test** `personal_notes_page.test.tsx` with `jest.mock('@fullcalendar/react', ...)` (stub renders event titles and buttons that fire `datesSet`, `eventClick`, `eventDrop`): `datesSet` → `getPersonalNotes` called with the range; switching to "Only mine" refetches with `only_mine: true`; clicking a teammate's note shows the read-only view (no Save button); a rejected `patchPersonalNote` on drop calls `revert`.
- [ ] **Step 3: Run** `npx jest src/components/personal_notes`. Expected: FAIL.
- [ ] **Step 4: Install FullCalendar and implement** the files.
- [ ] **Step 5: Run** the tests, `npx tsc --noEmit -p .`, eslint on changed files. Expected: PASS, no errors.
- [ ] **Step 6: Commit** `feat: add personal notes calendar page` (own hunks only in i18n files).

### Task 7: End-to-end check

- [ ] **Step 1:** `GORUN 'GOTEST ./public/model ./channels/store/sqlstore ./channels/app ./channels/api4 -run "PersonalNote|NoteReminders|TestTeamStore"'`. Expected: PASS.
- [ ] **Step 2:** Run the app, turn the toggle on in Team Settings and check by hand: the link appears; create a private and a team note; a second user sees only the team note; "Only mine" hides it; drag a note in month and week view; a reminder set one minute ahead arrives as a system-bot DM and its link opens the note; toggling off hides the link and the page shows the disabled error.
- [ ] **Step 3:** Report what could not be checked.

## Not covered by tests
FullCalendar's real rendering and drag behaviour (mocked in unit tests; checked by hand in Task 7), theme colors across themes, Turkish copy quality.
