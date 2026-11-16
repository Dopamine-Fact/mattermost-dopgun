# Daily reports — design

## Intent
Each team member writes an end-of-day report; an authorised person approves it. Managers get a record of what everyone did each day, including the tasks they finished, and can download it for any date range. The feature is per team, like tasks.

## Goals
- Team toggle + deadline time (HH:MM) in team settings.
- Members who have not written today's report get a reminder at deadline −10 and −5 minutes.
- Report = free text + a snapshot of the tasks the author finished that day.
- Approvers approve; a report not approved within 30 minutes of submission is approved by the system and tagged "auto-approved".
- All reports are stored; a date range can be downloaded as CSV.

## Non-goals
Rejecting / requesting changes; DMs to approvers on each submission; weekend reminders; per-user managers; editing after approval.

## Approaches
1. **Leader-only ticker, once a minute (picked).** Small; idempotent; a reminder minute is missed if the server restarts in that minute.
2. Mattermost jobs framework (scheduler + worker) — rejected: 3–4× the code for a once-a-minute check.

## Design
- **Who:** writers = members of a team with `DailyReportsEnabled`. Approvers = users with `manage_team_tasks` on that team (team admins by default).
- **Team settings:** `Team.DailyReportsEnabled bool`, `Team.DailyReportTime string` ("18:00"), `Team.DailyReportTimezone string` (IANA name; the webapp sends the saving admin's browser zone). New section in team settings next to Tasks, shown to whoever can edit team settings.
- **Report day:** the date (YYYY-MM-DD) in the team timezone at submit time. One report per user per team per day (unique key). The author can edit it until approved.
- **Model `DailyReport`** (table `DailyReports`, migration 000249): Id, TeamId, UserId, Date, Message, Tasks (JSON snapshot: id, title, section name), Status (`pending` | `approved`), AutoApproved bool, ApprovedBy, ApprovedAt, CreateAt, UpdateAt.
- **Finished tasks:** on submit/edit, tasks in that team assigned to the author with status `done` and `UpdateAt` within the report day are copied into `Tasks`. (Shortcut: tasks have no done timestamp; UpdateAt is the proxy.)
- **Ticker:** in the app server, every minute, cluster leader only. For each enabled team, on Mon–Fri in the team timezone: at deadline−10 and deadline−5 (exact minute), DM every member without a report for today from the system bot, with a link to the report page. Every tick: approve pending reports whose CreateAt is more than 30 min ago with `AutoApproved=true`, `ApprovedBy=""`.
- **API (`/api/v4/teams/{team_id}/daily_reports`):** `GET ?from&to[&user_id]` list (members see only their own; approvers see all); `PUT /mine` create/update today's report; `POST /{id}/approve` (approver only); `GET /export?from&to` CSV (same visibility). Websocket events `daily_report_updated` to the team so lists stay live.
- **Webapp:** sidebar link "Daily report" (like `TasksLink`) → `/:team/daily_reports`. Tabs: **My report** (today's text box, finished-task preview, status) and, for approvers, **Team reports** (date picker, list of members with status: missing / pending / approved / auto-approved, Approve button). Date-range picker + Download CSV on both tabs.
- **i18n:** en + tr strings.

## Calls made (after builder check)
- `manage_team_tasks` already exists and team admins have it (from the tasks work); no new permission. Members without it see and export only their own reports.
- The 30-minute clock runs from the first submission (CreateAt); edits do not reset it.
- `Task.AssigneeId` is a single assignee; `done` is the team-wide done status. The UpdateAt proxy can put a task edited later in the wrong day; the snapshot taken at submit time does not change afterwards. A done-at column is the upgrade if this matters.
- No drafts: a row exists only after submit. "Missing" = current team member with no row for that date. Holidays are not handled.
- Changing time or timezone applies from the next tick; stored reports keep their date.
- Reports of members who leave stay stored and remain in lists and exports.
- CSV columns: date, user, message, finished tasks, status, auto-approved, approved by, approved at, submitted at.

## Left to the builder
Exact UI layout and styles; CSV column order; store query shapes.
