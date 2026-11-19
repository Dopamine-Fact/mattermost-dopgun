# Daily report media and page redesign — design

## Intent

People show the day's progress in their daily report: an animator attaches a short clip of the scene they worked on,
a designer attaches a screenshot. Reviewers see that media next to the text when they approve. Alongside this, the
two daily-report pages are redesigned to match two mockups the user supplied (described below).

## Goals

- A report carries attachments: images (PNG, JPG, GIF, WEBP), videos (MP4, MOV, WEBM) and PDF.
- Attachments are visible only to people who may see the report: its author, and people who may act on the author's
  reports (`manage_daily_reports` via `CanActOnUser`, the same rule the report list uses).
- "My report" and "Team reports" look like the mockups.
- A reviewer can excuse a day on which someone wrote no report (user's decision: "Excuse the day").

## Non-goals

- No server-side video processing (no transcoding, no video thumbnails, no duration limit enforced by the server).
- No change to the reminder or auto-approval timing.
- No attachments in the reject/approve DMs.

## Anti-goals

- An attachment reachable by anyone outside the rule above, including through the stock `/files/{id}` routes.
- Losing an author's unsent text or attachments when they reload the page.
- Breaking existing reports or the CSV export.

## Approaches

- **A — Mattermost file storage linked to the report (chosen).** Upload with `UploadFileForUserAndTeam` with no channel,
  link FileInfos to the report in a new table, serve them through new report-scoped routes that apply the report rule.
  Image thumbnails/previews come from the existing pipeline; the browser shows a video's first frame and duration.
- **B — a hidden per-team channel whose posts hold the files.** Rejected: channel membership cannot express "people who
  outrank the author", so every member would see every attachment.
- **C — the channel Drive.** Rejected: reports have no channel, and the files would show in the file explorer.

The user talked about outcomes, so the approach was my call (A).

## Facts this design rests on (master)

- Routes: `server/channels/api4/daily_report.go:24-31`. Viewing others needs `PermissionManageDailyReports` and
  `CanActOnUser` (`dailyReportFilter` l.79-84, `getVisibleDailyReports` l.91-107, `ActionableUserIDs`
  `app/custom_role_hierarchy.go:128`). Approve/reject: `loadReviewableReport` l.158-188 (own report also needs
  `PermissionManageTeam`).
- Statuses: `pending`, `approved`, `rejected` (`model/daily_report.go:15-17`). "Missing" exists only in the client
  (`team_reports.tsx:98-108`). Auto-approve after 30 min pending, reminders skip weekends (`app/daily_report.go:442+`).
- `UploadFileForUserAndTeam` (`app/file.go:616`) accepts an empty channel. The stock `/files/{id}` handlers load the
  FileInfo's channel and fail for an empty one, for everyone — so channel-less files are not served by them. No job
  deletes FileInfos without a post.
- `FileSettings.MaxFileSize` (default 100 MB) limits uploads.
- Departments: `useTeamDepartments(teamId)` and `ranksOf(departments, roleNames)` in
  `webapp/.../profile_popover/use_custom_roles.ts:55,80`.
- Turkish strings live in `webapp/channels/src/i18n/tr.json` (36 `daily_reports.*` entries today).
- A concurrent uncommitted branch (`feature/daily-report-approved-dm`, worktree `mmdr2`) edits
  `app/daily_report.go` (approve DM). Expect a merge conflict there; whichever lands second resolves it.

## Design

### Data

- New status values: `draft` and `excused`, alongside `pending`, `approved`, `rejected`.
  - `draft`: a report row for a day the author has started attaching media to but not sent. Created by the first
    upload for (team, user, date). Never visible to reviewers, never auto-approved, not in CSV export. To a reviewer
    the author still shows as Missing.
  - `excused`: set by a reviewer on a day with no sent report (no row, or a draft). Stored as a row with empty
    message, `ApprovedBy`/`ApprovedAt` = the reviewer. If the author later sends a report that day, it becomes a
    normal `pending` report (excusing does not block sending). Shown as "Excused" ("Mazeretli").
  - "Sent" below means `pending`, `approved` or `rejected`.
  - Reminders: a `draft` does not count as reported (reminders still fire); `excused` does (no reminder).
    Auto-approve touches `pending` only, as today. Filter by status in the callers (`sendDailyReportReminders`,
    list, export), not by changing store signatures.
  - Reviewers see a report's files only when the report is sent. Files on a `draft` or `excused` row are the
    author's alone until they send.
  - Drafts from a past day can no longer be sent (submit is today-only, as now), so the daily-report tick deletes
    them with their files once their day is over (team-local). It also deletes the files of past-day `excused` rows
    (never sent, so never seen by anyone but the author).
- New table `DailyReportFiles (ReportId, FileId, CreateAt, PRIMARY KEY (ReportId, FileId))`, index on FileId.
  `DailyReport` gains `Files []*model.FileInfo` (json `files`), filled on read.
- Limits: 10 attachments per report; allowed extensions as in Goals (checked on the server by extension and the
  detected MIME type); size = `MaxFileSize`.

### Server routes (new)

- `POST /teams/{team_id}/daily_reports/mine/files` (multipart, one file): creates the day's `draft` row if there is
  no report for today yet, uploads the file with no channel, links it. Today only (team-local date, as submit uses).
  Allowed on the author's own report in any status for today. Returns the FileInfo.
- `POST /daily_reports/{report_id}/files`: the same upload on an existing report of the author's, any date, under the
  same rule as editing it (`PUT /daily_reports/{id}`) — this is how the Edit action on an older rejected report adds
  media.
- `DELETE /daily_reports/{report_id}/files/{file_id}`: author only; unlinks and deletes the FileInfo and the stored
  file.
- Adding or deleting a file on a **sent** report is an edit, exactly like a text resubmit (`resubmit` in
  `app/daily_report.go`: back to `pending`, `Edited` set, approval/rejection cleared, `PreviousMessage` keeps the
  text). A reviewer never approves something that later changes silently. On a `draft` or `excused` row, adding or
  deleting files changes no status.
- Two uploads racing to create the day's draft: handle the unique-key conflict the way `SubmitDailyReport` does.
- `GET /daily_reports/{report_id}/files/{file_id}` and `/thumbnail`, `/preview`: allowed for the author and for
  callers who pass the report-view rule. 404 when the file is not linked to that report. Streams with the stock file
  helpers (`Content-Disposition` per Mattermost's inline rules; videos must support range requests so the browser can
  seek — use the same `http.ServeContent` path the file handlers use).
- `POST /daily_reports/excuse` with `{team_id, user_id, date}`: reviewer rule as approve (`loadReviewableReport`
  equivalent on the user), date must be today or past, refuses when a sent report exists.
- Sending: the existing submit (`PUT .../mine`) turns today's `draft` or `excused` row into `pending` with the
  message, as a first submission (`Edited` false, `PreviousMessage` empty, excuse fields cleared), keeping its files. A report with
  attachments may have an empty message; one with neither is refused as today.
- Existing list and export: drafts are filtered out for everyone but the author; export gains an "Attachments" column
  (file names joined with ", ").

Uploads before sending exist only while the author is writing; a draft row survives reloads, so attachments are never
lost. The text draft stays in localStorage as today.

### Webapp

Theme: colours come from the Mattermost theme variables (the mockups show a dark theme with an orange button colour;
the page must follow whatever theme is active). All strings go into `en.json` and `tr.json`; the Turkish texts below
are the mockup's.

**My report tab ("Raporum")**, top to bottom:

1. Header: page icon, "Günlük Raporlar", tabs "Raporum" / "Ekip Raporları" (active tab underlined in the accent
   colour). Existing.
2. Today card: title "Bugünkü Rapor", status chip (Eksik / Taslak / Gönderildi = pending / Onaylandı / Otomatik onay /
   Geri gönderildi / Mazeretli), a date chip on the right ("19 Kas 2026, Perşembe", team-local). Editor (existing
   AdvancedTextbox, placeholder "Bugün neler yaptın?"), hint "Markdown desteklenir. Ctrl+Enter ile gönder." and a
   primary "Raporu Gönder" button with a send icon. Rejected banner and previous-version note stay as today.
3. Media section inside the card: icon + "Medya Desteği" + "Günlük raporuna ekran görüntüsü, video klibi veya dosya
   ekleyebilirsin." Left: a dashed drop zone ("Dosya sürükle-bırak veya seç", sub-line listing the types; "seç" opens
   the file picker; pasting an image into the editor also attaches it). Right: "Eklenen Medyalar (n)" and one card per
   file — thumbnail (image thumbnail; video first frame with a play icon and duration badge; PDF icon), file name,
   "size · type", and an × to remove. Upload progress shows on the card while uploading; a refused file shows the
   reason inline.
4. Export card: download icon, "Tarih Aralığına Göre Dışa Aktar", From / To date inputs, "CSV İndir". Existing
   behaviour, new layout.
5. "Son Raporlar": the author's last 30 days, newest first. Each row: date ("18 Kas 2026, Çarşamba"), status chip,
   one-line excerpt of the message, paperclip + "n ek" when there are attachments, and an arrow. Clicking opens the
   report detail (below); a rejected report's detail has an Edit action (replaces today's "Needs fixing" list).

**Team reports tab ("Ekip Raporları")**:

1. Filter bar: search box ("Çalışan veya rapor içeriğinde ara…", matches display name, username and message text),
   "Durum" select (Tümü + each status incl. Eksik and Mazeretli), "Ekip / Üye" select (Tümü, each department, then
   each member), "Başlangıç" / "Bitiş" dates (default today–today; range capped at 31 days in the client only — the
   server keeps its 366-day cap), "CSV İndir" (exports the chosen range, existing endpoint).
2. "{n} rapor" count on the left, "Sıralama" select on the right: Gönderim (Yeni → Eski) default, Gönderim
   (Eski → Yeni), İsim (A → Z).
3. One row per (person, day) in range. Missing rows are produced for each weekday (Mon–Fri) in the range for every
   expected reporter (existing assignee/actionable rule), computed in the browser in the team's local dates as today;
   public holidays are not known and show as missing (excuse them). Columns: initials avatar, username, status chip, submit
   time (— when missing), the message rendered as markdown (bullets as in the mockup, clamped to ~4 lines; "Rapor
   içeriği bulunmuyor." when missing), an attachment chip (icon by content: image, video "n medya", or file
   "n ek"), and actions:
   - sent report: "Görüntüle" always; "Reddet" when today's rules allow reject (pending or approved, as now);
     "Onayla" only while pending.
   - missing: "Onayla" = excuse the day (confirm dialog). No "Reddet" (nothing to reject) — my call.
   - excused: "Görüntüle" only.
4. Detail view ("Görüntüle", also used by "Son Raporlar"): a modal with author, date, status, full markdown, the
   task chips, the attachments as a gallery — images open in Mattermost's existing file preview/lightbox style,
   videos play inline with controls, PDFs open in a new tab — and the same Approve/Reject actions as the row.

## Left to the builder

- Exact component split, scss structure, and how the gallery reuses existing preview components.
- How MIME sniffing is done (stdlib `http.DetectContentType` is fine).
- Migration numbering (next free number on the branch base).
- Whether excuse reuses `Approve` in the store or a new store method.

## My calls (for the user to check)

- Drafts are created by the first upload, invisible to reviewers, shown as Missing to them.
- Excusing does not block a later report; a later report replaces "excused" with a normal pending one.
- No "Reddet" on missing rows.
- 10 attachments per report; size limit = server upload limit; PDF allowed as in the mockup.
- Missing rows only on weekdays; team range capped at 31 days.
- Adding or deleting an attachment on a sent report counts as an edit (back to pending), like changing its text.
- Unsent drafts are deleted with their files when their day ends; a past day can't be reported late, as today.
- Files on a draft or excused row stay hidden from reviewers until the author sends.
- Drafts still get the 10 and 5 minute reminders; excused days don't.
- Public holidays show as Missing; reviewers excuse them.
