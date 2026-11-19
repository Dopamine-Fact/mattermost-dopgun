# Daily Report Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daily reports carry images, videos and PDFs; reviewers can excuse a missing day; both daily-report tabs match the mockups.

**Architecture:** Files are ordinary channel-less FileInfos (`UploadFileForUserAndTeam(..., channelID "")`), linked to a report through a new `DailyReportFiles` table and served only through report-scoped routes that apply the report's view rule. Two new statuses, `draft` (created by the first upload, author-only) and `excused` (set by a reviewer). The webapp gets a media section, a report detail modal and a rebuilt team tab.

**Tech Stack:** Go (server/channels app, api4, sqlstore, Postgres migrations), React + TypeScript (webapp/channels), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-daily-report-media-design.md`

## Global Constraints

- Branch `feature/daily-report-media` (main checkout). Commit to it; never push or merge.
- Allowed files: images `.png .jpg .jpeg .gif .webp`, videos `.mp4 .mov .webm`, `.pdf`. At most **10** files per report. Size limit = `FileSettings.MaxFileSize` (the upload helper enforces it).
- "Sent" = `pending`, `approved` or `rejected`. Reviewers never see a `draft` row, nor files on a `draft` or `excused` row.
- Adding or deleting a file on a sent report = `resubmit` (back to `pending`, `Edited`, approval cleared). On `draft`/`excused` it changes no status.
- Sending a `draft` or `excused` row is a first submission: `Edited` false, `PreviousMessage` "", approval fields cleared.
- Migration number **000260** (the episode branch already holds 000258–000259; renumber if this branch lands first).
- Colours from theme variables only (`--button-bg`, `--center-channel-color-rgb`, …); no hex colours in scss.
- Every new string: `server/i18n/en.json` (server errors), `webapp/channels/src/i18n/en.json` **and** `webapp/channels/src/i18n/tr.json`, added by hand in sorted position; webapp `en.json` entries follow the neighbours' format. Never run `make i18n-extract`, never `go mod tidy`.
- Turkish UI texts are the spec's (mockup) texts verbatim.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands, Go runner and Docker notes: see `.superpowers/sdd/2026-11-19-episode-folder-rules/context.md` ("Commands", "Go toolchain"); `gorun.sh` there works from any branch.

## Review Focus

1. A non-author without review rights (or a reviewer the author outranks) fetching `/daily_reports/{id}/files/{file_id}` → 403; a file id that belongs to another report → 404; a reviewer fetching a file of a `draft` or `excused` row → 404.
2. A file whose content is HTML but named `x.png` → 400 (sniffed type must agree with the extension's family).
3. Two uploads at once with no report yet today → one draft row, both files linked.
4. Excusing while the author sends at the same moment → the sent report wins (excuse returns 409, never overwrites a sent report).
5. The 11th upload → 400 and nothing stored (no orphan FileInfo).

---

### Task 1: Model — statuses, file rules, files on the report

**Files:**
- Modify: `server/public/model/daily_report.go`
- Test: `server/public/model/daily_report_test.go`

**Interfaces — Produces:**
```go
const DailyReportStatusDraft = "draft"
const DailyReportStatusExcused = "excused"
const DailyReportMaxFiles = 10
// DailyReport gains: Files []*FileInfo `json:"files"` (filled on read, never stored)
func (r *DailyReport) IsSent() bool                      // pending, approved or rejected
// DailyReportFileContentType returns the served type for an allowed name ("" = not allowed); case-insensitive ext.
func DailyReportFileContentType(name string) string
// DailyReportFileMatches reports whether the sniffed type (http.DetectContentType of the first 512 bytes) fits the
// extension's family: image/* for images, video/* or application/octet-stream for videos (MOV sniffs as octet-stream),
// application/pdf for .pdf.
func DailyReportFileMatches(name, sniffed string) bool
```

- [ ] **Step 1: Write failing tests**
  - `TestDailyReportIsValidStatuses`: `draft` and `excused` valid; `"bogus"` invalid.
  - `TestDailyReportIsSent`: true for pending/approved/rejected, false for draft/excused.
  - `TestDailyReportFileContentType`: `"a.PNG"`→`image/png`, `"a.jpeg"`→`image/jpeg`, `"a.mov"`→`video/quicktime`, `"a.webm"`→`video/webm`, `"a.pdf"`→`application/pdf`, `"a.exe"`→`""`, `"noext"`→`""`.
  - `TestDailyReportFileMatches`: `("x.png","image/png")` true; `("x.png","text/html; charset=utf-8")` false; `("x.mov","application/octet-stream")` true; `("x.pdf","application/pdf")` true; `("x.pdf","image/png")` false.
- [ ] **Step 2: Run** `gorun.sh server/public "go test ./model -run 'TestDailyReport' -count=1"` — Expected: FAIL (undefined).
- [ ] **Step 3: Implement** the interfaces above; extend `IsValid`'s status check.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add draft and excused daily report statuses and the attachment rules"`

---

### Task 2: Store — file links, deletes, stale rows

**Files:**
- Create: `server/channels/db/migrations/postgres/000260_daily_report_files.up.sql`, `.down.sql`
- Modify: `server/channels/db/migrations/migrations.list` (via `make migrations-extract`), `server/channels/store/store.go` (`DailyReportStore`), `server/channels/store/sqlstore/daily_report_store.go`, generated layers/mocks (`make store-layers store-mocks`)
- Test: `server/channels/store/sqlstore/daily_report_store_test.go` (or the storetest file the existing tests live in — follow it)

**Interfaces — Produces:**
```go
AddFile(reportID, fileID string, createAt int64) error
RemoveFile(reportID, fileID string) error                    // ErrNotFound when the link does not exist
GetFileIds(reportIDs []string) (map[string][]string, error)  // report id -> file ids, oldest link first
Delete(id string) error                                      // the report row and its links
GetBeforeDate(teamID, status, beforeDate string) ([]*model.DailyReport, error) // Date < beforeDate
```
Migration: `CREATE TABLE IF NOT EXISTS DailyReportFiles (ReportId VARCHAR(26) NOT NULL, FileId VARCHAR(26) NOT NULL, CreateAt bigint NOT NULL, PRIMARY KEY (ReportId, FileId));` plus `CREATE INDEX IF NOT EXISTS idx_dailyreportfiles_fileid ON DailyReportFiles (FileId);`. Down drops the table. `Status VARCHAR(16)` already fits the new values.

- [ ] **Step 1: Write failing tests** `TestDailyReportStoreFiles`: add two links → `GetFileIds([id])` returns both in order; adding the same pair twice → error; `RemoveFile` of a missing pair → `*store.ErrNotFound`; `Delete(id)` removes row and links (`Get` → not found, `GetFileIds` → empty); `GetBeforeDate(team,"draft","2026-11-19")` returns a draft dated 18th, not one dated 19th, not a pending one dated 18th.
- [ ] **Step 2: Run** `gorun.sh server "go test ./channels/store/sqlstore -run TestDailyReport -count=1 2>&1 | tail -30"` — Expected: FAIL.
- [ ] **Step 3: Implement**; then `gorun.sh server "make migrations-extract store-layers store-mocks"`.
- [ ] **Step 4: Run** the same test — Expected: PASS. Also `gorun.sh server "go build ./..."` — Expected: no output.
- [ ] **Step 5: Commit** `git commit -m "Store daily report attachments"`

---

### Task 3: App — attach, remove, read, and send with files

**Files:**
- Modify: `server/channels/app/daily_report.go`, `server/i18n/en.json`
- Test: `server/channels/app/daily_report_test.go`

**Interfaces:**
- Consumes: Task 1, Task 2; existing `UploadFileForUserAndTeam`, `removeTaskFiles(rctx, fileIDs)` (`app/task.go:655`), `resubmit`.
- Produces:
```go
// AddMyDailyReportFile attaches to today's report, creating today's draft row first when there is none.
func (a *App) AddMyDailyReportFile(rctx request.CTX, teamID, userID, name string, data []byte) (*model.FileInfo, *model.AppError)
// AddDailyReportFile attaches to one of the author's existing reports (same rule as UpdateDailyReport).
func (a *App) AddDailyReportFile(rctx request.CTX, reportID, userID, name string, data []byte) (*model.FileInfo, *model.AppError)
func (a *App) RemoveDailyReportFile(rctx request.CTX, reportID, fileID, userID string) *model.AppError
// GetDailyReportFile returns the file only when it is linked to that report (404 otherwise); no permission check.
func (a *App) GetDailyReportFile(rctx request.CTX, reportID, fileID string) (*model.FileInfo, *model.AppError)
// fillDailyReportFiles sets Files on each report (one GetFileIds + one FileInfo GetByIds); missing infos are skipped.
func (a *App) fillDailyReportFiles(reports []*model.DailyReport) *model.AppError
```
Rules: name allowed and sniff matches (Task 1) else 400 `app.daily_report.file_type.app_error`; already 10 → 400 `app.daily_report.too_many_files.app_error`, checked before upload; when linking fails after upload, `removeTaskFiles` the new file. Upload on a sent report or delete on a sent report → `resubmit(r, r.Message, r.Tasks)` + `Update`. Draft creation races: reuse `SubmitDailyReport`'s Save→`ErrConflict`→reload. Publish the report event after each change. `GetDailyReport`, `GetDailyReports`, `SubmitDailyReport`, `UpdateDailyReport` return reports with `Files` filled. `SubmitDailyReport`/`UpdateDailyReport`: a `draft` or `excused` row is sent as a first submission (Global Constraints), and a blank message is refused (400 `app.daily_report.empty.app_error`) only when the report has no files.

- [ ] **Step 1: Write failing tests** (`TestDailyReportFiles`, subtests):
  - first upload with no report → a `draft` row for today with that file; second upload → same row, two files.
  - `"x.png"` with HTML bytes → 400; `"x.exe"` → 400; 11th file → 400 and FileInfo count unchanged.
  - upload to an `approved` report → status `pending`, `Edited` true; delete from a `pending` report → `Edited` true; upload/delete on a `draft` → status stays `draft`.
  - `AddDailyReportFile` by another user → 403.
  - `RemoveDailyReportFile` → FileInfo gone (`GetFileInfo` 404) and link gone.
  - `GetDailyReportFile(otherReport, fileID)` → 404.
  - submit with blank message after one upload → `pending`, `Edited` false, `PreviousMessage` ""; blank with no files → 400.
  - submit over an `excused` row → `pending`, `ApprovedBy` "".
- [ ] **Step 2: Run** `gorun.sh server "go test ./channels/app -run 'TestDailyReport' -count=1 2>&1 | tail -40"` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS (old daily report tests too).
- [ ] **Step 5: Commit** `git commit -m "Attach files to daily reports"`

---

### Task 4: App — excuse, reminders, cleanup, export

**Files:**
- Modify: `server/channels/app/daily_report.go`, `server/i18n/en.json`
- Test: `server/channels/app/daily_report_test.go`

**Interfaces — Produces:**
```go
// ExcuseDailyReport marks userID's day as excused by reviewerID. date must be today or earlier (team-local);
// a sent report that day → 409 app.daily_report.already_sent.app_error; a draft row is turned into excused (files kept).
func (a *App) ExcuseDailyReport(rctx request.CTX, teamID, userID, date, reviewerID string) (*model.DailyReport, *model.AppError)
```
Excused row: `Message` "", `ApprovedBy` reviewer, `ApprovedAt` now, `Status` excused. Save with conflict handling: on `ErrConflict` reload; if the reloaded row is sent → 409. Reminders: `reported` counts every row except `draft`. Tick: per enabled team, `GetBeforeDate(team, draft, today)` → `removeTaskFiles` + `Delete`; `GetBeforeDate(team, excused, today)` → remove their files and links (keep the row). Log and continue on errors. `ExportDailyReportsCSV` skips drafts and gains a last column `Attachments` (file names joined by ", ") — callers pass reports with `Files` filled.

- [ ] **Step 1: Write failing tests:**
  - `TestExcuseDailyReport`: no row → excused row with reviewer; draft row with a file → excused, file still linked; pending row → 409; tomorrow's date → 400.
  - `TestDailyReportRemindersIgnoreDrafts`: user with a draft gets the 10-minute reminder; user with excused does not (follow the existing reminder test's clock setup).
  - `TestDailyReportTickCleansUp`: yesterday's draft with a file → row and FileInfo gone after `RunDailyReportTick`; today's draft untouched; yesterday's excused row keeps the row, loses the file.
  - `TestExportDailyReportsCSV` (extend): header ends with `Attachments`; a report with two files shows `"a.png, b.mp4"`; a draft row is absent.
- [ ] **Step 2: Run** `gorun.sh server "go test ./channels/app -run 'TestExcuse|TestDailyReport|TestExport' -count=1 2>&1 | tail -40"` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Excuse missing daily reports and clean up unsent drafts"`

---

### Task 5: API routes and visibility

**Files:**
- Modify: `server/channels/api4/daily_report.go`, `server/public/model/client4.go` (Go client methods for tests), `server/i18n/en.json` if new ids
- Test: `server/channels/api4/daily_report_test.go`

**Interfaces:**
- Consumes: Tasks 3–4; `readUploadedFile(c, r, field)` (`api4/task.go`), `web.WriteFileResponse`.
- Produces routes (multipart field name `file`):
  - `POST /teams/{team_id}/daily_reports/mine/files` → `AddMyDailyReportFile` → 200 FileInfo
  - `POST /daily_reports/{report_id}/files` → `AddDailyReportFile` → 200 FileInfo
  - `DELETE /daily_reports/{report_id}/files/{file_id}` → `RemoveDailyReportFile` → 200 `{"status":"OK"}`
  - `GET /daily_reports/{report_id}/files/{file_id}`, `.../thumbnail`, `.../preview` → stream with `web.WriteFileResponse`, content type from `DailyReportFileContentType` (thumbnail/preview: the stored jpeg as `getFileThumbnail` does; 404 when the file has none). `?download=1` forces download.
  - `POST /teams/{team_id}/daily_reports/excuse` body `{user_id, date}` → `ExcuseDailyReport`; permission exactly as `loadReviewableReport` but on `user_id` (manage_daily_reports, `CanActOnUser`, own day needs `manage_team`).
  - Go client: `AddMyDailyReportFile`, `AddDailyReportFile`, `RemoveDailyReportFile`, `GetDailyReportFile`, `ExcuseDailyReport`.
- View rule for file reads (one helper `canViewDailyReport(c, report) bool`): the author; or, when `report.IsSent()`, a caller with `manage_daily_reports` on the team who passes `CanActOnUser`. A reviewer reading a non-sent report's file → 404 (not 403, so drafts stay invisible).
- `getVisibleDailyReports`: drop `draft` rows not authored by the caller; on `excused` rows not authored by the caller, set `Files` to empty. `submitDailyReport`/`updateDailyReport` accept an empty message (the app decides). Export passes filled reports.

- [ ] **Step 1: Write failing tests** `TestDailyReportFilesAPI`: author uploads → 200; a team member without manage_daily_reports gets the file → 403; a reviewer who outranks the author gets it after send → 200 with `Content-Type: image/png` and a `Range: bytes=0-3` request → 206; the same reviewer before send → 404; the list for the reviewer omits the draft; delete by non-author → 403; excuse by a reviewer → 200 status `excused`; excuse by the user themself without manage_team → 403.
- [ ] **Step 2: Run** (Redis up, see context.md) `gorun.sh server "IS_CI=true go test ./channels/api4 -run 'TestDailyReport' -count=1 2>&1 | tail -40"` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Serve daily report attachments to the people who may see the report"`

---

### Task 6: Webapp client and types

**Files:**
- Modify: `webapp/platform/types/src/daily_reports.ts`, `webapp/platform/client/src/client4.ts`
- Test: `webapp/platform/client/src/client4.test.ts` if it exists for neighbours; otherwise covered by Task 7/8 tests via mocks.

**Interfaces — Produces:**
```ts
type DailyReportStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'excused';
// DailyReport gains: files?: FileInfo[]
uploadMyDailyReportFile(teamId: string, file: File, onProgress?: (loaded: number, total: number) => void): Promise<FileInfo>
uploadDailyReportFile(reportId: string, file: File, onProgress?: (loaded: number, total: number) => void): Promise<FileInfo>
deleteDailyReportFile(reportId: string, fileId: string): Promise<StatusOK>
getDailyReportFileUrl(reportId: string, fileId: string, kind?: 'thumbnail' | 'preview'): string
excuseDailyReport(teamId: string, userId: string, date: string): Promise<DailyReport>
```
Extract the XHR body of `setTaskSectionVideo` into a private `uploadWithProgress<T>(url, formData, connectionId?, onProgress?)` and use it from all three uploads (no behaviour change for the video).

- [ ] **Step 1:** Implement; **Step 2: Run** `npx tsc --noEmit -p .` from `webapp/channels` and the task-section video tests (`TZ=UTC npx jest src/components -t "video"` or the file that covers `setTaskSectionVideo`) — Expected: no type errors, PASS.
- [ ] **Step 3: Commit** `git commit -m "Client calls for daily report attachments and excuses"`

---

### Task 7: My report tab — today card, media, export card, recent reports, detail modal

**Files:**
- Create: `webapp/channels/src/components/daily_reports/media_section.tsx`, `report_detail_modal.tsx`
- Modify: `my_report.tsx`, `common.tsx` (status chip: `draft` "Taslak", `excused` "Mazeretli"; Gönderildi for pending on the author's own view per spec), `daily_reports.tsx` (move the CSV From/To export into an export card on My report and into the team filter bar — Task 8), `daily_reports.scss`, `webapp/channels/src/i18n/en.json`, `tr.json`
- Test: `daily_reports.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 6.
- Produces:
```ts
// MediaSection: drop zone + picker + paste target, cards with progress/error/remove. upload is the Client4 call bound to
// today or to a report id; onChange is called after each successful upload/remove so the parent refetches.
function MediaSection(props: {files: FileInfo[]; reportId?: string; upload: (f: File, onProgress) => Promise<FileInfo>; onChange: () => void; disabled?: boolean}): JSX.Element
// ReportDetailModal: author, date, status, markdown, task chips, gallery; actions passed in (approve/reject/edit).
function ReportDetailModal(props: {report: DailyReport; onClose: () => void; actions?: React.ReactNode}): JSX.Element
```
Layout and texts: spec "My report tab" items 1–5. The "Son Raporlar" list replaces "Needs fixing" (last 30 days, newest first, all statuses except today); its rejected entry's detail offers Edit, which reuses `ReportCard` + `MediaSection` bound to `uploadDailyReportFile(report.id)`. Client-side checks before upload: allowed extension and count < 10 (show the reason on the card); the server is still the authority. Video cards: `<video preload="metadata">` for first frame and duration (`m:ss` badge). Images: thumbnail URL. PDF: icon; in the modal a link to the file URL with `target="_blank"` (the server sends PDFs as downloads — accepted). Pasting an image into the editor attaches it.

- [ ] **Step 1: Write failing tests:**
  - `media: uploads a dropped file and lists it with size and type` (mock `uploadMyDailyReportFile` resolving a FileInfo `{name:'a.png', size: 1258291, mime_type:'image/png'}` → card shows `a.png` and `1.2 MB`).
  - `media: refuses an .exe before uploading` (upload mock not called; reason shown).
  - `media: removes a file` (calls `deleteDailyReportFile(reportId, fileId)`).
  - `media: an 11th file is refused in the browser`.
  - `today card: sends with only attachments and an empty message`.
  - `recent reports: lists the last 30 days with attachment count and opens the detail modal`.
  - `recent reports: a rejected report's detail offers Edit and saves by id`.
  - Update the existing "Needs fixing" test to the new list.
- [ ] **Step 2: Run** `TZ=UTC npx jest src/components/daily_reports` (from `webapp/channels`) — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same + `npx tsc --noEmit -p .` + `npx eslint src/components/daily_reports` + `npx stylelint src/components/daily_reports/daily_reports.scss` — Expected: PASS, no errors.
- [ ] **Step 5: Commit** `git commit -m "Daily report media and the new My report tab"`

---

### Task 8: Team reports tab — filters, range, missing days, excuse

**Files:**
- Modify: `team_reports.tsx`, `daily_reports.tsx`, `common.tsx`, `daily_reports.scss`, `en.json`, `tr.json`
- Test: `daily_reports.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 6, Task 7 (`ReportDetailModal`), `useTeamDepartments(teamId)` and `ranksOf(departments, roleNames)` from `components/profile_popover/use_custom_roles.ts`.
- Produces: `rowsForRange(from, to, owes: UserProfile[], reports: DailyReport[]): Array<{user, date, report?}>` exported from `team_reports.tsx` (pure; weekdays only for missing rows; a report on a weekend still gets its row).

Layout and texts: spec "Team reports tab" items 1–4. One `getDailyReports(teamId, from, to)` call for the range (client cap 31 days: To is clamped and the date input shows the limit). Filters are client-side. Department option filters by `ranksOf(departments, user.roles)` containing the department; member option filters by user id. Missing row "Onayla" opens a confirm dialog, then `excuseDailyReport(teamId, userId, date)`. Attachment chip by content: any video → video icon "n medya", else any image → image icon "n ek", else file icon "n ek".

- [ ] **Step 1: Write failing tests:**
  - `rowsForRange: Mon–Sun range gives missing rows only for Mon–Fri` (pure function test).
  - `team: search matches name and message text`.
  - `team: status filter Eksik shows only missing rows`.
  - `team: department filter keeps members of that department` (mock departments the way existing profile-popover tests do).
  - `team: sort by name A→Z`.
  - `team: Onayla on a missing row asks, then excuses that user and date`.
  - `team: no Reddet on missing or excused rows`.
  - `team: Görüntüle opens the detail with the gallery`.
  - Keep the existing approve/reject/roster tests passing (adapt selectors to the new markup, not their intent).
- [ ] **Step 2: Run** `TZ=UTC npx jest src/components/daily_reports` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same + `npx tsc --noEmit -p .` + eslint + stylelint — Expected: PASS, no errors.
- [ ] **Step 5: Commit** `git commit -m "Team reports: filters, date range, missing days and excuses"`
