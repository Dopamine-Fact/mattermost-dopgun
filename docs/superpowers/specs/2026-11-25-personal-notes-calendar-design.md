# Personal notes and calendar — design

## Intent
Team members track their own work inside Mattermost: they write notes, put them on a calendar, tick them off when done, and get a reminder when one is due. Everything belongs to a team, and the team admin turns the feature on or off per team. A note is private by default; the owner can share it with the team, so the calendar can also show teammates' shared notes, with a filter to see only your own.

## Goals
- Per-team on/off in Team Settings (`Team.NotesEnabled`), off by default.
- One kind of item, the **note**: title, optional description, optional date, optional time, optional reminder, done checkbox, visibility (`private` | `team`).
- A note with a date shows on the calendar; a note without one shows in an "Undated" list under it.
- Calendar page with **month** and **week** views built on **FullCalendar** (picked by the user), drag-and-drop to move your own dated notes.
- Filter: "Everyone" (own notes + teammates' shared notes) / "Only mine".
- Reminders are delivered to the owner only, as a DM from the system bot.

## Non-goals (v1)
- Recurring notes or reminders ("every Monday").
- Editing or deleting someone else's note, even a shared one.
- Attachments, comments, mentions, or linking a note to a channel/post.
- Live updates (websocket) when a teammate changes a shared note; the page refetches when opened, when the visible range changes, and after the user's own changes.
- Dragging an undated note onto the calendar (set the date in the note dialog instead).
- Multi-day notes (start/end ranges), mobile app support.

## Anti-goals
- Anyone other than the owner seeing a private note, its title, or that it exists — including system admins through the API and including via guessed ids.
- A reminder going to anyone but the owner, or firing for a deleted/done note.
- A team with the feature off still exposing notes through the API.

## Approaches
1. **Core feature, like the other team features (picked for the server).** `Teams.NotesEnabled` column, a new `PersonalNotes` table, store + app + api4 layers, a leader task for reminders. Same pattern as Files (`2026-11-17-file-explorer-design.md`) and Daily Reports.
2. Plugin with its own KV store — rejected: every other feature in this fork is in core, and the team toggle + team settings UI would have to be rebuilt inside a plugin.
3. Notes stored as posts in a hidden channel — rejected: visibility and edit rules fight the channel permission model.
4. (UI) Custom month/week grid on `date-fns` vs **FullCalendar** — the user picked **FullCalendar** (drag-and-drop and week view out of the box; costs a new dependency and theming work).

## Decided by the user
- Used for tracking one's own work; scoped to a team; per-team toggle.
- Visibility per note, `private` (default) or `team`; "Only mine" filter.
- Single note model with optional date/time/reminder and a done flag; undated notes listed separately.
- Only the owner edits or deletes; reminders go to the owner by system-bot DM.
- Sidebar "Calendar" link next to the File Explorer link; FullCalendar for the calendar.

## Design — server

### Team toggle
`Team.NotesEnabled bool` (`json:"notes_enabled"`) + `TeamPatch.NotesEnabled *bool`, wired exactly like `FilesEnabled` (`public/model/team.go`: struct, `Auditable`, patch struct, patch `Auditable`, `Patch()`; `sqlstore/team_store.go`: column list, insert, update). `App.RequireNotesEnabled(teamID)` returns 403 `app.note.disabled.app_error` unless the team exists, is not deleted and has `NotesEnabled` — same shape as `RequireDailyReportsEnabled` (`app/daily_report.go`).

### Data
Migration `000267_create_personal_notes` (postgres up/down + `migrations.list`; 000266 is the in-flight task-approval migration — renumber if another lands first):
- `ALTER TABLE Teams ADD COLUMN IF NOT EXISTS NotesEnabled boolean NOT NULL DEFAULT false`.
- `PersonalNotes`:
  - `Id varchar(26) PK, TeamId varchar(26), UserId varchar(26)`
  - `Title varchar(256)` — required, 1–200 runes after trim
  - `Message text` — optional, up to 4000 runes
  - `Visibility varchar(16)` — `private` | `team`
  - `Date varchar(10)` — `YYYY-MM-DD`, `''` = undated
  - `Time varchar(5)` — `HH:MM` (24h), `''` = all day; must be `''` when `Date` is `''`
  - `RemindMinutes integer` — minutes before the start; `-1` = no reminder; must be `-1` when undated
  - `RemindAt bigint` — computed by the server (UTC ms), `0` = nothing pending
  - `DoneAt bigint` — `0` = not done
  - `CreateAt, UpdateAt bigint`
- Indexes: `(TeamId, Date)`, `(TeamId, UserId)`, partial `(RemindAt) WHERE RemindAt > 0`.
- Delete is a hard delete (the dialog asks for confirmation). *(My call: no trash for personal notes.)*

**Dates are wall-clock ("floating").** `Date`/`Time` mean the same calendar day and clock time for every viewer; no timezone conversion for display. *(My call: a team is usually in one timezone, and all-day notes must never slide to the previous day for a viewer elsewhere.)*

**Reminder time is computed on the server** from `Date`, `Time` and the **owner's** timezone (`user.GetPreferredTimezone()`, falling back to UTC): start = `Date Time` in that zone, or `Date 09:00` for all-day notes; `RemindAt = start − RemindMinutes`. Recomputed on every create/update (including a drag that changes the date). If the result is in the past, `RemindAt = 0` (no reminder fires for something already past). Marking a note done sets `RemindAt = 0`; un-marking recomputes it. *Shortcut (my call): `RemindAt` is fixed at save time, so if the owner later changes their timezone, pending reminders keep the old local time until the note is edited; upgrade by recomputing pending reminders from the user-update path if people travel often.*

Reminder choices offered by the UI (server accepts any value 0–10080): timed notes — at start (0), 5, 15, 30, 60 min, 1 day (1440) before; all-day notes — on the day at 09:00 (0), 1 day before at 09:00 (1440).

`model.PersonalNote` with `PreSave`, `PreUpdate`, `IsValid`, plus `PersonalNotePatch`. Store `PersonalNoteStore`: `Save, Get, Update, Delete, GetForTeam(teamID, userID, opts)` (returns the user's own notes plus `team` notes of others **whose owner is still an active member of the team and not deactivated** — joins `TeamMembers` (`DeleteAt = 0`) and `Users` (`DeleteAt = 0`); *my call: a departed colleague's tasks are noise on the calendar; their rows stay in the table*; opts: `FromDate`, `ToDate`, `Undated bool`, `OnlyMine bool`), `GetDueReminders(now, limit)`, `ClearReminder(id)`. Regenerate the timer/retry layers the way the repo does (`make store-layers` / existing generator).

### API (`api4/personal_note.go`)
All routes require a session, an **active team membership** (`GetTeamMember` with `DeleteAt == 0` — not `PermissionViewTeam`, which would let non-member system admins in) and `RequireNotesEnabled`. *(My call: notes are personal; a system admin who isn't in the team has no reason to read the team's calendar.)*
- `GET /api/v4/teams/{team_id}/notes/{note_id}` — one note (same 404 rule below). Used by the `?note={id}` reminder link: the page fetches the note, jumps the calendar to its date and opens its dialog.
- `GET /api/v4/teams/{team_id}/notes?from=YYYY-MM-DD&to=YYYY-MM-DD&only_mine=true|false` — dated notes in `[from, to]`.
- `GET /api/v4/teams/{team_id}/notes?undated=true&only_mine=...` — undated notes, newest first.
- `POST /api/v4/teams/{team_id}/notes` — create; `UserId`, `TeamId` taken from the session/URL, never the body.
- `PUT /api/v4/teams/{team_id}/notes/{note_id}/patch` — owner only.
- `DELETE /api/v4/teams/{team_id}/notes/{note_id}` — owner only.

Not the owner of a `private` note, or the note belongs to another team → **404** (never 403, so ids reveal nothing). Not the owner of a `team` note on patch/delete → 403. Range queries cap at 62 days and undated lists at 500 rows.

Each response note carries the owner's `user_id`; the webapp resolves names/avatars through the existing user profile store.

### Reminders
New leader task next to post reminders in `runLeaderTasks` (`app/server.go`): `"Check note reminders"`, every **1 minute** (post reminders use 5; a calendar reminder that is 4 minutes late is noticeable). `App.CheckNoteReminders(rctx)`:
1. Get the system bot (skip quietly when there is no admin, like `CheckPostReminders`).
2. `GetDueReminders(now, 200)`.
3. For each: if the team is deleted or `NotesEnabled` is off, or the owner is deactivated or no longer a team member → `ClearReminder`, don't send. *(My call: avoids a burst of stale reminders when a team turns the feature back on.)*
4. Otherwise DM the owner from the system bot (`GetOrCreateDirectChannel`), translated with the owner's locale: `app.note_reminder_dm` — bell, bold title, date/time, link `{SiteURL}/{teamName}/calendar?note={id}`. Then `ClearReminder`.

Send-then-clear: a crash between the two can send a reminder twice; never loses one. *(My call; post reminders do the opposite and can lose them.)*

### i18n
Server strings in `server/i18n/en.json` with descriptions, then `make i18n-extract`.

## Design — webapp

### Toggle
`notes_enabled` checkbox in Team Settings next to `files_enabled` (`components/team_settings/team_info_tab/team_info_tab.tsx`), added to the `Team` type in `@mattermost/types`.

### Entry point
`CalendarLink` in the sidebar next to `FileExplorerLink` (`components/sidebar/sidebar_list/sidebar_list.tsx`), hidden unless `team.notes_enabled`. Route `/:team/calendar` in `center_channel.tsx`, loaded with `makeAsyncComponent` + `lazy` so FullCalendar is only downloaded when the page opens. `?note={id}` opens that note's dialog (reminder link).

### Calendar page (`components/personal_notes/`)
```
┌ Calendar ───────────── [Everyone ▾ | Only mine] [+ Note] ┐
│ ◀ November 2026 ▶  Today        Month | Week             │
│ Mon  Tue  Wed  Thu  Fri  Sat  Sun                        │
│  …   24   25   26   27   …                               │
│           10:00 Send report 🔔                            │
│           ☐ Prepare slides · Ayşe                         │
├ Undated ─────────────────────────────────────────────────┤
│ ☐ Book list    ☑ Reset password                          │
└──────────────────────────────────────────────────────────┘
```
- FullCalendar v6: `@fullcalendar/react`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`. Pin exact versions; confirm the React 19 peer range before installing.
- Views `dayGridMonth` and `timeGridWeek`; first day Monday; locale and 24h/12h from the user's locale and the existing "clock display" preference.
- Events: notes with a `Date`; all-day when `Time` is empty, else a 30-minute event at `Time` (end only for drawing). Own notes use the theme's button color; teammates' shared notes a muted color with the owner's name. Done notes struck through. 🔔 marks a pending reminder; a lock icon marks private notes.
- `datesSet` triggers a fetch for the visible range; results kept in component state (no Redux slice — the data is page-local). *(My call.)*
- Drag-and-drop: `editable` only for the current user's notes. Dropping sends a patch with the new `Date` (and `Time` in week view; month view keeps the existing time). On error, `info.revert()` and show the error.
- Click an empty day/slot → new-note dialog prefilled with that date (and time in week view). Click a note → own: edit dialog; teammate's: read-only view.
- Filter `Everyone` / `Only mine`, remembered per user in `localStorage`.
- Theme: map FullCalendar `--fc-*` CSS variables to Mattermost theme variables (`--center-channel-bg`, `--center-channel-color`, `--button-bg`, …) so every theme, Amethyst included, looks native.

### Note dialog
Existing `GenericModal`. Fields: title, description, date (existing date input) with "No date", time with "All day", reminder select (choices above; hidden when undated), visibility toggle (Private / Team, default Private), done checkbox; Delete button with confirm for existing notes. Client-side validation mirrors `IsValid`.

### Undated list
Below the calendar: checkbox (toggles done via patch), title, lock icon if private, owner name for teammates' notes; click opens the dialog. Respects the filter.

### Client
`Client4` methods `getNote`, `getNotes`, `createNote`, `patchNote`, `deleteNote`; `PersonalNote` type in `@mattermost/types`. Webapp strings via `make i18n-extract` in the webapp.

## Testing
- Model: `IsValid` (title length, date/time format, undated with time or reminder, visibility values), `RemindAt` computation across timezones and all-day 09:00.
- Store: `GetForTeam` returns own + others' team notes, never others' private ones, respects range/undated/only-mine; `GetDueReminders`.
- App/API: toggle off → 403; non-member (including a non-member system admin) → 403; departed/deactivated owner's shared notes not listed; others' private note → 404; patch/delete by non-owner → 403; reminder sent once to the owner, skipped and cleared when disabled/done/owner left.
- Webapp: page renders when enabled, link hidden when disabled, filter, dialog create/edit/read-only, drag revert on error (FullCalendar can be mocked in unit tests).

## Left to the builder
Verify before installing: FullCalendar's React 19 peer range and that its runtime-injected styles pass the webapp's CSP. Week-view drag between the all-day row and time slots (all-day row → clear `Time`), ordering of done notes in the undated list, cleanup on permanent user/team deletion (follow what Drive/Daily Reports do).
Component/file names inside `components/personal_notes/`, exact CSS, how the dialog lays out its fields, whether the date input reuses `datetime_input` or `react-day-picker` directly, test structure, and i18n wording.
