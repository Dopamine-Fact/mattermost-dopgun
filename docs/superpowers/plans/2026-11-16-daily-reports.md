# Daily Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-team end-of-day reports with finished-task snapshot, approver approval, 30-min auto-approval, deadline reminders and CSV export.

**Architecture:** New `DailyReports` table + store; three team columns for the toggle/deadline/timezone. App layer owns submit/approve/list/export and a once-a-minute leader-only tick (`runOnLeader`, like post reminders) that sends bot DMs and auto-approves. Webapp: team-settings section, sidebar link, `/:team/daily_reports` page with local state, live via websocket listener.

**Tech Stack:** Go (squirrel store, api4, app), Postgres migration, React + TypeScript webapp.

**Spec:** `docs/superpowers/specs/2026-11-16-daily-reports-design.md`

## Global Constraints
- Work in a git worktree off `master` (another session edits the main checkout). Migration number **000249**.
- Approver = `model.PermissionManageTeamTasks` on the team. Writer = team member (`PermissionViewTeam`).
- Reminder minutes: deadline −10 and −5, Mon–Fri in team timezone. Auto-approve: `now - CreateAt >= 30 min`.
- Date format `YYYY-MM-DD`; time format `HH:MM` (24h); timezone IANA name.
- After editing `server/i18n/en.json` run `make i18n-extract` in `server/`. Never `go mod tidy`.
- Store layers/mocks are generated: `make store-layers store-mocks` in `server/`.
- Strings in en + tr.

## Review Focus
1. Invalid timezone or time saved on the team → team patch rejected with 400, tick never panics (skip team, log).
2. Report submitted at 23:59 vs 00:01 → date taken in team timezone, not server UTC.
3. Approver approving an already approved report, or a member calling approve → 403 / no-op keeps first approver.
4. Member reading another member's reports or exporting the team → only own rows.
5. Editing an approved report → 400 (`app.daily_report.approved.app_error`).

---

### Task 1: Model, migration, store

**Files:**
- Create: `server/public/model/daily_report.go`, `server/public/model/daily_report_test.go`
- Create: `server/channels/db/migrations/postgres/000249_create_daily_reports.{up,down}.sql`; add both to `migrations.list`
- Create: `server/channels/store/sqlstore/daily_report_store.go`, `server/channels/store/storetest/daily_report_store.go`, `server/channels/store/sqlstore/daily_report_store_test.go`
- Modify: `server/public/model/team.go` (fields, Patch, Auditable, IsValid), `server/channels/store/sqlstore/team_store.go` (columns, Save, Update), `server/channels/store/store.go`, `sqlstore/store.go`, `storetest/store.go`; regenerate layers + mocks

**Interfaces — Produces:**
```go
// model
const DailyReportStatusPending = "pending"; DailyReportStatusApproved = "approved"
const DailyReportMessageMaxRunes = 16000
type DailyReportTask struct { Id, Title, SectionName string } // json: id, title, section_name
type DailyReport struct {
  Id, TeamId, UserId, Date, Message string; Tasks []DailyReportTask
  Status string; AutoApproved bool; ApprovedBy string; ApprovedAt, CreateAt, UpdateAt int64
} // json snake_case; Tasks stored as JSON column
func (r *DailyReport) PreSave(); PreUpdate(); IsValid() *AppError
// Team: DailyReportsEnabled bool `json:"daily_reports_enabled"`, DailyReportTime string `json:"daily_report_time"`, DailyReportTimezone string `json:"daily_report_timezone"`; same three as pointers in TeamPatch.
func ParseDailyReportTime(s string) (hour, minute int, ok bool)
// store
type DailyReportStore interface {
  Save(r *model.DailyReport) (*model.DailyReport, error)   // unique (TeamId, UserId, Date) → store.ErrConflict
  Update(r *model.DailyReport) (*model.DailyReport, error)
  Get(id string) (*model.DailyReport, error)
  GetForUserDate(teamID, userID, date string) (*model.DailyReport, error) // ErrNotFound when none
  GetForTeam(teamID, fromDate, toDate, userID string) ([]*model.DailyReport, error) // userID "" = all; ordered Date DESC, CreateAt ASC
  GetPendingBefore(createdBefore int64) ([]*model.DailyReport, error)
}
// Store.DailyReport() DailyReportStore
```

- [ ] **Step 1: Failing tests.** `TestDailyReportIsValid` (bad date `2026-13-01`, empty user, message > 16000 runes → invalid); `TestParseDailyReportTime` (`"18:00"`→18,0,true; `"24:00"`, `"9:5"`, `""` → false); `TestTeamIsValidDailyReport` (enabled with bad time or `Mars/Phobos` tz → invalid; disabled with empty fields → valid). Storetest `TestDailyReportStore`: save→get; second save same team/user/date → `*store.ErrConflict`; `GetForTeam` filters by date range and user; `GetPendingBefore` excludes approved and newer rows; Tasks round-trips.
- [ ] **Step 2:** `go test ./public/model/ -run 'DailyReport|ParseDailyReportTime'` → FAIL (undefined).
- [ ] **Step 3: Implement.** Migration up:
```sql
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS DailyReportsEnabled boolean NOT NULL DEFAULT false;
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS DailyReportTime VARCHAR(5) NOT NULL DEFAULT '18:00';
ALTER TABLE Teams ADD COLUMN IF NOT EXISTS DailyReportTimezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Istanbul';
CREATE TABLE IF NOT EXISTS DailyReports (
  Id VARCHAR(26) PRIMARY KEY, TeamId VARCHAR(26) NOT NULL, UserId VARCHAR(26) NOT NULL, Date VARCHAR(10) NOT NULL,
  Message VARCHAR(16000) NOT NULL DEFAULT '', Tasks jsonb NOT NULL DEFAULT '[]', Status VARCHAR(16) NOT NULL DEFAULT 'pending',
  AutoApproved boolean NOT NULL DEFAULT false, ApprovedBy VARCHAR(26) NOT NULL DEFAULT '', ApprovedAt bigint NOT NULL DEFAULT 0,
  CreateAt bigint NOT NULL, UpdateAt bigint NOT NULL, UNIQUE (TeamId, UserId, Date));
CREATE INDEX IF NOT EXISTS idx_dailyreports_team_date ON DailyReports (TeamId, Date);
CREATE INDEX IF NOT EXISTS idx_dailyreports_status_createat ON DailyReports (Status, CreateAt);
```
Down drops table and the three columns. Store follows `task_store.go`; Tasks column marshals with `json.Marshal` on write and a scan struct on read.
- [ ] **Step 4:** `make store-layers store-mocks`; `go test ./public/model/ ./channels/store/sqlstore/ -run 'DailyReport|ParseDailyReportTime|TestTeamStore'` → PASS.
- [ ] **Step 5:** Commit `feat: daily report model, migration and store`.

### Task 2: App layer and leader tick

**Files:** Create `server/channels/app/daily_report.go`, `server/channels/app/daily_report_test.go`; modify `server/channels/app/server.go` (`runLeaderTasks`), the struct holding `postReminderTask` (add `dailyReportTask`), `server/public/model/websocket_message.go` (`WebsocketDailyReportUpdated = "daily_report_updated"`), `server/i18n/en.json` + `tr.json`.

**Interfaces — Consumes:** Task 1. **Produces:**
```go
func (a *App) RequireDailyReportsEnabled(teamID string) (*model.Team, *model.AppError)
func DailyReportDate(team *model.Team, now time.Time) (string, error) // date in team tz
func (a *App) SubmitDailyReport(rctx request.CTX, teamID, userID, message string) (*model.DailyReport, *model.AppError) // create or update today's; 400 if approved
func (a *App) GetDailyReports(teamID, fromDate, toDate, userID string) ([]*model.DailyReport, *model.AppError)
func (a *App) ApproveDailyReport(rctx request.CTX, reportID, approverID string) (*model.DailyReport, *model.AppError) // already approved → returns as-is
func (a *App) ExportDailyReportsCSV(w io.Writer, reports []*model.DailyReport) *model.AppError
func (a *App) RunDailyReportTick(rctx request.CTX, now time.Time) // reminders + auto-approve
```
- Finished tasks: `Task().GetForTeam(teamID)` filtered by `AssigneeId==userID && Status==done && UpdateAt` in [start,end) of the report day in team tz; section name from `GetSectionsForTeam`. Comment the UpdateAt proxy as a `shortcut:`.
- Reminder: for each team from `Team().GetAll()` with `DailyReportsEnabled`, if weekday Mon–Fri and `deadline - now` truncated to minutes is exactly 10 or 5: active non-bot members (`User().GetProfiles(&model.UserGetOptions{InTeamId, Active: true, PerPage: 10000})`) without a row for today get a DM from `GetSystemBot` (same as `postTaskAssignedMessage`), text `app.daily_report.reminder` with `{{.Minutes}}`, `{{.Time}}`, `{{.Link}}` = `siteURL/teamName/daily_reports`. Team errors are logged and skipped.
- Auto-approve: `GetPendingBefore(now - 30min)` → Status approved, `AutoApproved=true`, `ApprovedAt=now`, publish event.
- Every write publishes `daily_report_updated` to the team with the report JSON.
- Register in `runLeaderTasks`: `CreateRecurringTaskFromNextIntervalTime("Daily report tick", fn, time.Minute)`.

- [ ] **Step 1: Failing tests** (`th := Setup(t).InitBasic(t)`; enable on `th.BasicTeam` with tz `Europe/Istanbul`): `TestDailyReportDate` (`2026-11-16T21:30Z` in Istanbul → `2026-11-17`); `TestSubmitDailyReport` (snapshot contains done task assigned to user updated today, not a todo task or another user's; second submit updates same row; after approve → error id `app.daily_report.approved.app_error`); `TestApproveDailyReport` (sets ApprovedBy, AutoApproved false); `TestRunDailyReportTick` (now = deadline−10 on a Monday → `th.BasicUser2` without report gets a DM from system bot, `th.BasicUser` with report does not; now = deadline−7 → no DM; Saturday → no DM; report with CreateAt 31 min ago → approved with AutoApproved true, one 29 min ago stays pending); `TestExportDailyReportsCSV` (header row `date,user,message,finished_tasks,status,auto_approved,approved_by,approved_at,submitted_at`, tasks joined with `; `, usernames resolved).
- [ ] **Step 2:** `go test ./channels/app/ -run 'DailyReport'` → FAIL.
- [ ] **Step 3:** Implement as above; add i18n ids; `make i18n-extract`; fill descriptions and tr translations.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat: daily report app layer, reminders and auto-approval`.

### Task 3: REST API and Go client

**Files:** Create `server/channels/api4/daily_report.go`, `server/channels/api4/daily_report_test.go`, `server/public/model/client4_daily_report.go`; modify `server/channels/api4/api.go` (`api.InitDailyReports()`).

**Routes** (all `APISessionRequired`, all call `RequireDailyReportsEnabled` and require `PermissionViewTeam`):
- `GET  /teams/{team_id}/daily_reports?from=&to=&user_id=` — non-approvers forced to own `user_id`. Default from=to=today.
- `PUT  /teams/{team_id}/daily_reports/mine` body `{"message": "..."}` → 200 report.
- `POST /daily_reports/{report_id}/approve` — needs `PermissionManageTeamTasks` on the report's team.
- `GET  /teams/{team_id}/daily_reports/export?from=&to=` — same visibility; `Content-Type: text/csv`, `Content-Disposition: attachment; filename="daily-reports-<from>_<to>.csv"`.
- `from`/`to` must parse as dates, `to >= from`, range ≤ 366 days, else 400.

Client4: `GetDailyReports(ctx, teamID, from, to, userID)`, `SubmitDailyReport(ctx, teamID, message)`, `ApproveDailyReport(ctx, reportID)`, `ExportDailyReports(ctx, teamID, from, to) ([]byte, *Response, error)`.

- [ ] **Step 1: Failing tests** `TestDailyReportsAPI`: disabled team → 501/403 per `RequireDailyReportsEnabled`'s status; member submits and lists own; member list with `user_id` of another → only own rows; member approve → 403; team admin approve → 200; export by member contains only own username; bad `from` → 400; edit after approval → 400.
- [ ] **Step 2:** `go test ./channels/api4/ -run TestDailyReportsAPI` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; also `go test ./channels/api4/ -run 'TestPatchTeam|TestTasks'`.
- [ ] **Step 5:** Commit `feat: daily report REST API`.

### Task 4: Webapp

**Files:** Modify `webapp/platform/types/src/teams.ts` (3 fields), create `webapp/platform/types/src/daily_reports.ts`; `webapp/platform/client/src/client4.ts` (`getDailyReports`, `submitDailyReport`, `approveDailyReport`, `getDailyReportsExportUrl`); `team_settings/team_info_tab/team_info_tab.tsx` + new `team_daily_reports_section.tsx` (checkbox + `<input type="time">`; on save also sends `daily_report_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone`); create `components/daily_reports/{index.ts,daily_reports.tsx,daily_reports_link.tsx,daily_reports.scss,daily_reports.test.tsx}`; register link in `sidebar_list.tsx` after `TasksLink` and route `/:team/daily_reports` in `center_channel.tsx` like Tasks; add `LhsPage.DailyReports`.

Page behaviour: tabs **My report** (textarea, Submit/Update, read-only after approval, status chip, today's snapshot from response) and **Team reports** (only when `haveITeamPermission(MANAGE_TEAM_TASKS)`: date input defaulting to today, rows = team members with status *Missing / Pending / Approved / Auto-approved*, finished tasks, Approve button on pending). Both tabs: from/to date inputs + Download CSV (an `<a href>` to the export URL). Listens to `daily_report_updated` via `WebSocketClient.addMessageListener` and refetches the visible list. Redirect to team root when disabled.

- [ ] **Step 1: Failing tests** `daily_reports.test.tsx`: renders My report and submits text through mocked `Client4.submitDailyReport`; Team reports tab hidden without permission; pending row shows Approve and calls `Client4.approveDailyReport`; auto-approved row shows the auto-approved label.
- [ ] **Step 2:** `npx jest components/daily_reports` (in `webapp/channels`) → FAIL.
- [ ] **Step 3:** Implement; `npm run i18n-extract` in `webapp/channels`; add tr strings to `src/i18n/tr.json`.
- [ ] **Step 4:** Jest PASS; `npm run check-types` PASS.
- [ ] **Step 5:** Commit `feat: daily reports page and team setting`.

### Task 5: End-to-end check
- [ ] Run the server + webapp from the worktree; enable on a team, set deadline 11 minutes ahead, confirm DM at −10 and −5, submit a report, approve as admin, leave one pending 30 min (or patch CreateAt in DB) and see auto-approved, download CSV.
