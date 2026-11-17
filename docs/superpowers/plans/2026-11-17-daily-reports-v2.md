# Daily reports v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editable reports (edit → pending + edited + previous text), reject with a required reason, reviewer-chosen reporters, and a markdown editor for writing.

**Architecture:** Extends the existing model/store/app/api4 daily report layers and `webapp/channels/src/components/daily_reports`. One migration (000251) adds report columns and a `DailyReportAssignees` table.

**Tech Stack:** Go (Postgres, squirrel), React/TS, Jest, `AdvancedTextbox`, `GenericModal`.

**Spec:** `docs/superpowers/specs/2026-11-17-daily-reports-v2-design.md`

## Global Constraints
- Go only in docker: `golang:1.26.10`, test DB container `mattermost-postgres` (55433, mmuser/mostest_password). Never `go mod tidy`.
- After store interface changes: `go generate ./channels/store` (retry/timer layers) and `mockery --config channels/store/.mockery.yaml` (v2.53.4).
- Do not run `make i18n-extract` (enterprise sources missing); add `server/i18n/en.json` entries by hand in sorted position, each with a `description`. Webapp strings go into `webapp/channels/src/i18n/en.json` sorted.
- Status values: `pending`, `approved`, `rejected`. Reject reason 1–1000 runes. Auto-approve after 30 min measured from `UpdateAt`.
- Reviewers = `manage_team_tasks` holders. Empty assignee list = every team member.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- Editing an approved report while a reviewer approves at the same moment: the report must end up pending with the new text (edit wins), never approved-with-new-text-unseen.
- Reject on an already rejected report: returns the current report, no second DM.
- Assignees set, then a non-assignee calls submit: 403, and reminders skip them.
- `SetAssignees` with a user who left the team: silently dropped.
- Draft in localStorage must not overwrite a newer server version when the user opens the page (draft is used only while no report exists or while editing).

---

### Task 1: Model, migration, store

**Files:** `server/public/model/daily_report.go` (+ `_test.go`), `server/channels/db/migrations/postgres/000251_daily_reports_v2.{up,down}.sql`, `server/channels/db/migrations/migrations.list`, `server/channels/store/store.go`, `server/channels/store/sqlstore/daily_report_store.go`, `server/channels/store/storetest/daily_report_store.go`, generated layers + mocks.

**Produces:**
- `DailyReportStatusRejected = "rejected"`, `DailyReportRejectReasonMaxRunes = 1000`.
- `DailyReport` fields `Edited bool json:"edited"`, `PreviousMessage string json:"previous_message"`, `RejectedBy string json:"rejected_by"`, `RejectedAt int64 json:"rejected_at"`, `RejectReason string json:"reject_reason"`; `IsValid` accepts rejected, caps `PreviousMessage` at 16000 and `RejectReason` at 1000.
- `DailyReportStore.Update(r)` — no status guard (writes Message, PreviousMessage, Edited, Tasks, Status, AutoApproved, ApprovedBy, ApprovedAt, UpdateAt).
- `DailyReportStore.Reject(id, rejecterID, reason string, at, seenUpdateAt int64) error` — where status in (pending, approved); else `missOrConflict`.
- `GetPendingBefore(updatedBefore int64)` filters `UpdateAt`.
- `Approve(id, approverID string, auto bool, approvedAt, seenUpdateAt int64)` and `Reject(..., seenUpdateAt int64)`: when `seenUpdateAt > 0` the row must also match `UpdateAt = seenUpdateAt` (else conflict), so a reviewer never approves/rejects text they did not see. The app returns 409 `app.daily_report.changed.app_error` on that conflict; API bodies carry `update_at`; the webapp sends the `update_at` it displayed and refreshes on 409.
- `GetAssignees(teamID string) ([]string, error)`, `SetAssignees(teamID string, userIDs []string) error` (transaction: delete team rows, insert given).

- [ ] Migration up: `ALTER TABLE DailyReports ADD COLUMN IF NOT EXISTS` Edited boolean NOT NULL DEFAULT false, PreviousMessage VARCHAR(16000) NOT NULL DEFAULT '', RejectedBy VARCHAR(26) NOT NULL DEFAULT '', RejectedAt bigint NOT NULL DEFAULT 0, RejectReason VARCHAR(1000) NOT NULL DEFAULT ''; drop `idx_dailyreports_status_createat`, create `idx_dailyreports_status_updateat (Status, UpdateAt)`; `CREATE TABLE IF NOT EXISTS DailyReportAssignees (TeamId VARCHAR(26) NOT NULL, UserId VARCHAR(26) NOT NULL, PRIMARY KEY (TeamId, UserId))`. Down reverses.
- [ ] Storetests: `testDailyReportReject` (pending→rejected sets fields; rejecting rejected → `*store.ErrConflict`; unknown id → `*store.ErrNotFound`; approved→rejected ok), `testDailyReportUpdateAnyStatus` (approved report updated to pending with Edited/PreviousMessage persisted), `testDailyReportAssignees` (set [a,b] → get sorted [a,b]; set [c] → [c]; set [] → []; other team untouched); update `testDailyReportGetPendingBefore` to use UpdateAt.
- [ ] Model test: rejected valid; reason 1001 runes invalid.
- [ ] Implement, regenerate layers/mocks, run `go test ./channels/store/sqlstore -run DailyReport` and `go test ./public/model -run DailyReport` → PASS. Commit.

### Task 2: App logic

**Files:** `server/channels/app/daily_report.go`, `server/channels/app/daily_report_test.go`, `server/i18n/en.json`.

**Consumes:** Task 1. **Produces:**
- `(a *App) UpdateDailyReport(rctx, reportID, userID, message string) (*model.DailyReport, *model.AppError)` — author only (else 403 `app.daily_report.not_author.app_error`).
- `(a *App) RejectDailyReport(rctx, reportID, rejecterID, reason string) (*model.DailyReport, *model.AppError)` — reason trimmed, required (400 `app.daily_report.reject_reason.app_error`); conflict → return current, no DM; success → publish + bot DM to author (`app.daily_report.rejected_dm`, values date, reviewer name, reason).
- `(a *App) GetDailyReportAssignees(teamID string) ([]string, *model.AppError)`, `(a *App) SetDailyReportAssignees(rctx, teamID string, userIDs []string) ([]string, *model.AppError)` — drops non-members/bots, dedupes, publishes `daily_report_updated`.
- `(a *App) IsDailyReportAssignee(teamID, userID string) (bool, *model.AppError)` — true when list empty or contains user.
- Shared helper `resubmit(existing, message, tasks)`: if `existing.Status != pending || existing.PreviousMessage == ""` then `PreviousMessage = existing.Message`; `Edited = true`; Status pending; clear Approved*/AutoApproved; keep Rejected* fields.

- [ ] Tests: `TestEditApprovedDailyReport` (submit, approve, submit again → pending, edited, previous = first text, approved_by cleared); `TestEditPendingKeepsFirstPrevious` (submit A, B, C → previous A); `TestRejectDailyReport` (empty reason → 400; reject approved+auto-approved → rejected with reason; author gets one DM containing the reason; second reject → no new DM); `TestRejectedNotAutoApproved` (tick after 31 min leaves it rejected); `TestUpdateDailyReportNotAuthor` (403); `TestDailyReportAssignees` (set includes non-member → dropped; non-assignee submit → 403; reminders only to assignees); `TestAutoApproveUsesUpdateAt` (edit restarts the clock); CSV header contains `status,rejected_by,reject_reason,edited`.
- [ ] Implement; `SubmitDailyReport` uses `resubmit` and the assignee check; reminders filter by assignees; CSV columns added.
- [ ] `go test ./channels/app -run 'DailyReport'` → PASS. Commit.

### Task 3: API + Go client

**Files:** `server/channels/api4/daily_report.go`, `server/channels/api4/daily_report_test.go`, `server/public/model/client4_daily_report.go`.

**Produces routes:** `PUT /api/v4/daily_reports/{report_id}` body `{"message"}`; `POST /api/v4/daily_reports/{report_id}/reject` body `{"reason"}` (`manage_team_tasks` on the report's team); `GET|PUT /api/v4/teams/{team_id}/daily_reports/assignees` (GET team member, PUT `manage_team_tasks`, body `{"user_ids": []}`, returns `{"user_ids": []}`). Client: `UpdateDailyReport(ctx, reportID, message)`, `RejectDailyReport(ctx, reportID, reason)`, `GetDailyReportAssignees(ctx, teamID) ([]string, …)`, `SetDailyReportAssignees(ctx, teamID, userIDs) ([]string, …)`. Audit records for update/reject/set-assignees like approve.

- [ ] Extend `TestDailyReportsAPI` with subtests: member cannot reject (403); manager rejects with reason; author updates rejected report → pending+edited; other member updates → 403; member cannot set assignees (403); manager sets, member reads.
- [ ] Implement; `go test ./channels/api4 -run DailyReport` → PASS. Commit.

### Task 4: Webapp

**Files:** `webapp/platform/types/src/daily_reports.ts`, `webapp/platform/client/src/client4.ts`, `webapp/channels/src/components/daily_reports/*` (split: `my_report.tsx`, `team_reports.tsx`, `reject_modal.tsx`, `assignees_modal.tsx`), `daily_reports.scss`, `daily_reports.test.tsx`, `webapp/channels/src/i18n/en.json`.

**Consumes:** Task 3 routes. Client4: `updateDailyReport(id, message)`, `rejectDailyReport(id, reason)`, `getDailyReportAssignees(teamId)`, `setDailyReportAssignees(teamId, userIds)`.

- [ ] Tests (RTL): editor submits on Ctrl+Enter; rejected report shows the reason banner; edited row shows "Edited" and reveals previous text on click; Reject button disabled until a reason is typed; unlisted user sees "No report is expected from you"; assignees modal saves checked ids.
- [ ] Implement per spec Webapp section: `AdvancedTextbox` with preview, task chips, rendered markdown via `components/markdown`, draft key `dailyReportDraft:<teamId>:<date>` (try/catch), "Needs fixing" list (`getDailyReports(teamId, today-30, today, me)` filtered to rejected, excluding today); team rows filtered to assignees; Reject modal + Reporters modal on `GenericModal`.
- [ ] Rebuild types/client (`npm run build --workspace platform/types --workspace platform/client`), `npx jest src/components/daily_reports` → PASS, `npx tsc --noEmit`. Commit.

### Task 5: End-to-end check
- [ ] Build server binary and webapp, run against a throwaway DB, walk through: write with markdown → approve → edit (pending, edited, previous visible) → reject with reason (DM arrives) → fix → set reporters (unlisted user sees the notice). Fix anything found. Commit.
