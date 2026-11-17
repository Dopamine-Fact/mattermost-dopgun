# Daily reports v2 — design

Builds on `2026-11-16-daily-reports-design.md`.

## Intent
Make the daily report usable day to day: a nicer place to write, the freedom to fix a report after sending it without hiding the change from the reviewer, a way for reviewers to send a report back with a reason, and control over who is expected to report.

## Goals
1. **Writing area.** Markdown editor with preview (the house `AdvancedTextbox`), today's finished tasks shown as chips above it, Ctrl/Cmd+Enter submits, the draft is kept in `localStorage` until submitted. A submitted report renders as markdown; "Edit" turns it back into the editor.
2. **Editing (option A).** The author can edit their report any time, in any state. Every resubmission sets `edited = true`, puts the report back to `pending` and restarts the 30-minute auto-approval clock. `previous_message` keeps the text the reviewer last saw: the version last approved/rejected, or the first submission if nobody acted yet. The reviewer sees an "edited" tag and can expand the previous text next to the current one.
3. **Rejecting.** A `manage_team_tasks` holder can reject a pending, approved or auto-approved report; a reason (1–1000 chars) is required. Rejected reports are never auto-approved. The author gets a bot DM with the reason. Editing a rejected report resubmits it (rule 2). The last rejection (reason, by, at) stays on the report and is shown as "previously rejected" once it is pending again.
4. **Who reports.** A `manage_team_tasks` holder picks the team members who must report (a standing, per-team list). Empty list = every member (today's behaviour, so nothing changes until someone sets it). When the list is set, reminders and the team view cover only those users, and an unlisted user sees "No report is expected from you" instead of the editor.
5. CSV gains `status` = pending/approved/rejected, `rejected_by`, `reject_reason`, `edited`.

## Non-goals
Full edit history (only one previous text); a formatting toolbar (the post editor's toolbar is bound to its own editor; markdown is typed, with preview); per-day assignee lists; notifying reviewers on each submission; editing other people's reports.

## Approaches
- **Edit semantics** — A (picked by the user): edit → pending + edited + previous text. B (keep approval, tag only) and C (tag, no previous text) rejected: B lets approved content change silently, C hides what changed.
- **Assignee storage** — new table `DailyReportAssignees (TeamId, UserId)` (picked) vs a jsonb column on `Teams`. A column would ride the team patch, which needs `manage_team`, while assignees belong to `manage_team_tasks` holders; a table also lets reminders filter in SQL.
- **Editor** — `AdvancedTextbox` (picked, already used by channel settings) vs `AdvancedTextEditor` (tied to post drafts, too heavy) vs plain textarea (what the user found poor).

## Design
**Migration 000251** (000250 is taken by the drive work on `feature/file-explorer`):
`DailyReports` + `Edited boolean`, `PreviousMessage VARCHAR(16000)`, `RejectedBy VARCHAR(26)`, `RejectedAt bigint`, `RejectReason VARCHAR(1000)`, all with defaults; index `(Status, UpdateAt)` replaces `(Status, CreateAt)`. New table `DailyReportAssignees (TeamId VARCHAR(26), UserId VARCHAR(26), PRIMARY KEY (TeamId, UserId))`.

**Model:** status `rejected`; new fields `edited`, `previous_message`, `rejected_by`, `rejected_at`, `reject_reason`; `DailyReportRejectReasonMaxRunes = 1000`.

**Store:** `Update` no longer requires `pending` (it writes all fields, including status); `Reject(id, by, reason, at)` updates where status in (pending, approved), else conflict/not-found; `GetPendingBefore` filters on `UpdateAt`; `GetAssignees(teamID) ([]string, error)`, `SetAssignees(teamID string, userIDs []string) error` (delete + insert in one transaction).

**App:**
- `SubmitDailyReport(teamID, userID, message)` keeps "today" semantics and, when the report exists, applies rule 2.
- `UpdateDailyReport(reportID, userID, message)` lets the author fix any of their own reports (e.g. yesterday's rejected one); tasks are re-snapshotted for the report's date.
- Both refuse if assignees are set and the user is not one of them.
- `RejectDailyReport(reportID, rejecterID, reason)`, then a DM to the author through the system bot (same path as the reminders).
- `Get/SetDailyReportAssignees`; `SetDailyReportAssignees` drops ids that are not team members.
- Reminders use the assignee list when it is non-empty.

**API (all under daily-reports-enabled teams):**
- `PUT /daily_reports/{id}` author only → update.
- `POST /daily_reports/{id}/reject` `{reason}` → `manage_team_tasks`.
- `GET /teams/{id}/daily_reports/assignees` → team member; `PUT` same path `{user_ids}` → `manage_team_tasks`.
- `GET /teams/{id}/daily_reports` gains `status=rejected&user_id=me` use for the author's "needs fixing" list (the existing filter already allows `user_id` = self).

**Webapp:**
- My report: status chip + "edited" tag, rejection banner with reason and reviewer, task chips, rendered report or `AdvancedTextbox` editor, Ctrl+Enter, local draft; below it, "Needs fixing": the author's rejected reports from earlier days (last 30 days), each editable inline.
- Team view: rows limited to assignees; "edited" tag with an expandable previous text; Approve and Reject buttons (Reject is offered for pending and approved rows); reject opens a small modal with a required reason.
- "Reporters" button opens a modal with a searchable member checklist.

## Calls left to the builder
Exact copy and styling; modal component choice (house `GenericModal`); how the previous text is laid out (side by side on wide screens, stacked on narrow).
