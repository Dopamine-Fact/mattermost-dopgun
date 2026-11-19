# Breaks, Overtime, Status Box and Right DM Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log each user's Away and Active periods on the server, show break/overtime counters bottom-left and a
System Console report, and move DMs into a collapsible right-side team member panel.

**Architecture:** One `StatusPeriods` table filled by a single hook (`PlatformService.updateStatusPeriod`) called
from every status save path and from desktop websocket register/unregister; an in-memory "last kind" cache keeps
it write-free on ordinary refreshes. The webapp reads raw periods through one endpoint and does all day/hour math
in a shared helper in the viewer's timezone.

**Tech Stack:** Go (server, squirrel, morph migrations), React + Redux + TypeScript (webapp), Jest, Go testify.

**Spec:** `docs/superpowers/specs/2026-11-20-breaks-and-dm-panel-design.md`

## Global Constraints

- Period kinds are exactly `"active"` and `"away"`; `EndAt = 0` means open; at most one open row per user.
- Config: `TeamSettings.WorkdayStart` / `TeamSettings.WorkdayEnd`, `"HH:MM"`, defaults `"09:00"` / `"18:00"`, start < end.
- Endpoint: `GET /api/v4/status_periods?from=&to=&user_id=`, ms, `to - from` ≤ 31 days; non-`manage_system` callers only get their own rows.
- `active` only while the user has a live websocket whose `originClient == "desktop"`. Automatic Away → `away` only with a desktop connection; manual Away always. Offline keeps an open `away`. OOO → none.
- Store methods take no `context.Context` (server/AGENTS.md). Never run `go mod tidy`; after editing `server/i18n/en.json` run `make i18n-extract` and fill `description`.
- UI copy (tr in `webapp/channels/src/i18n/tr.json`, en defaults): "Molada", "Bugün mola", "Fazla mesai", "Molalar", "İlk açılış", "Mola sayısı", "DM'leri sağ panelde göster".

## Review Focus

1. User has two desktop clients and closes one → active period must not end (only the *last* desktop conn ends it). Test in Task 3.
2. Away → Offline → Online next morning: one `away` row from Away until Online; report clips it to hours. Tests in Task 3 and Task 5.
3. Repeated `SetStatusOnline` calls (every activity ping) must not write periods. Test in Task 3 (count rows).
4. Report day with an open row (user still on break now) counts up to now, not to end-of-day. Test in Task 5.
5. Server restarted (cache empty) while a row is open → first status save reconciles without a second open row. Covered by the store's `Switch` idempotence test in Task 2.

---

### Task 1: Workday config

**Files:**
- Modify: `server/public/model/config.go` (TeamSettings struct ~2712, SetDefaults ~2778, isValid ~4814)
- Modify: `webapp/platform/types/src/config.ts` (TeamSettings type)
- Modify: `webapp/channels/src/components/admin_console/admin_definition.tsx` (after `TeamSettings.UserStatusAwayTimeout` ~2795)
- Test: `server/public/model/config_test.go`

**Interfaces:**
- Produces: `TeamSettings.WorkdayStart *string`, `TeamSettings.WorkdayEnd *string` (json `WorkdayStart`/`WorkdayEnd`); client config keys of the same names via the existing client-config path (add to `GenerateLimitedClientConfig`/`GenerateClientConfig` in `server/config/client.go` as `WorkdayStart`, `WorkdayEnd`).

- [ ] **Step 1: Failing test** `TestTeamSettingsWorkdayDefaultsAndValidation`: defaults equal `"09:00"`/`"18:00"`; `"18:00"`→`"09:00"` invalid; `"9:00"` invalid; `"08:30"`/`"17:30"` valid.
- [ ] **Step 2:** `cd server && go test ./public/model -run TestTeamSettingsWorkday` → FAIL.
- [ ] **Step 3:** Add fields with `access:"site_users_and_teams"`, defaults, validation (`^([01]\d|2[0-3]):[0-5]\d$`, start < end, new app error id `model.config.is_valid.workday_hours.app_error`), client config keys, two `text` admin settings ("Workday start (HH:MM)", "Workday end (HH:MM)").
- [ ] **Step 4:** Test passes; `make i18n-extract` in `server/`, fill description.
- [ ] **Step 5:** Commit `Add workday start and end settings`.

### Task 2: StatusPeriods table and store

**Files:**
- Create: `server/channels/db/migrations/postgres/000262_status_periods.{up,down}.sql` (+ append to `server/channels/db/migrations/migrations.list`)
- Create: `server/public/model/status_period.go`
- Create: `server/channels/store/sqlstore/status_period_store.go`, `..._test.go` (one-liner like `department_store_test.go`)
- Create: `server/channels/store/storetest/status_period_store.go`
- Modify: `server/channels/store/store.go`, `sqlstore/store.go`, `storetest/store.go`; regenerate `retrylayer`, `timerlayer` (`make store-layers`) and mocks (`make store-mocks`)

**Interfaces:**
- Produces:
  - `model.StatusPeriod{Id, UserId, Kind string; StartAt, EndAt int64}` json `id,user_id,kind,start_at,end_at`; consts `model.StatusPeriodActive = "active"`, `model.StatusPeriodAway = "away"`.
  - `store.StatusPeriodStore`:
    - `Switch(userID, kind string, at int64) error` — closes the user's open row if its kind ≠ `kind` (EndAt = at); opens a row of `kind` unless `kind == ""` or a row of that kind is already open. One transaction.
    - `End(userID, kind string, at int64) error` — closes the open row only if its kind == `kind`.
    - `GetRange(userID string, from, to int64) ([]*model.StatusPeriod, error)` — rows with `StartAt < to AND (EndAt = 0 OR EndAt > from)`, `userID == ""` = all users, ordered by `UserId, StartAt`.
  - `Store.StatusPeriod() StatusPeriodStore`.

- [ ] **Step 1: Failing storetest** `TestStatusPeriodStore` with subtests: `SwitchOpensAndCloses` (active@100 → away@200 → rows: active[100,200], away[200,0]); `SwitchSameKindIsNoop` (Switch active twice → 1 row) — Review Focus 5; `SwitchEmptyClosesOnly`; `EndOnlyMatchingKind` (End active while away open → away still open); `GetRangeOverlap` (row [50,150] returned for [100,200); row [250,0] not returned for [100,200); open row [150,0] returned; `""` returns other users' rows).
- [ ] **Step 2:** `cd server && go test ./channels/store/sqlstore -run TestStatusPeriodStore` → FAIL (compile).
- [ ] **Step 3:** Migration: table `StatusPeriods (Id varchar(26) PK, UserId varchar(26) NOT NULL, Kind varchar(16) NOT NULL, StartAt bigint NOT NULL, EndAt bigint NOT NULL DEFAULT 0)`, `idx_statusperiods_userid_startat (UserId, StartAt)`, `idx_statusperiods_startat (StartAt)`; down drops table. Store following `department_store.go`; regenerate layers and mocks.
- [ ] **Step 4:** Test passes; `go build ./...` clean.
- [ ] **Step 5:** Commit `Add StatusPeriods table and store`.

### Task 3: Period transitions in PlatformService

**Files:**
- Create: `server/channels/app/platform/status_period.go`, `status_period_test.go`
- Modify: `server/channels/app/platform/status.go` (call sites), `web_hub.go` (desktop count + register/unregister hooks)

**Interfaces:**
- Consumes: `Store.StatusPeriod().Switch/End` (Task 2).
- Produces:
  - `(h *Hub) DesktopConnCountForUser(userID string) int` — like `WebConnCountForUser`, counting active conns with `originClient == "desktop"` (add a `desktopOnly bool` to `webConnCountMessage`).
  - `(ps *PlatformService) updateStatusPeriod(status *model.Status)` — computes the kind, compares with `ps.statusPeriodKinds` (`sync.Map` userID→kind); on difference calls the store and updates the cache. Rules:
    - Online/DND → `active` if desktop count > 0, else `""`.
    - Away → `away` if `status.Manual` or desktop count > 0, else `""`.
    - Offline → if cached kind (or, on miss, treat as unknown and call `End(userID, active, now)`) is `away`: nothing; else `End(active)` and cache `""`.
    - OOO → `""`.
    - On cache miss, call `Switch` (idempotent) rather than skipping.
  - Calls: end of `SaveAndBroadcastStatus`; in `SetStatusOnline` inside the "status changed" save branch; in `processStatusUpdates` per saved status; hub `register`/`unregister` cases when `conn.originClient == "desktop"` → `ps.Go(func(){ status, _ := ps.GetStatus(uid); ps.updateStatusPeriod(status) })`. Always run via `ps.Go` from hub goroutine (never block the hub).
  - shortcut comment: async updates can reorder within milliseconds; fine for minute-scale statuses, revisit if periods ever look swapped.

- [ ] **Step 1: Failing tests** (use the platform test helper with a real store, simulate desktop conns by registering a `WebConn` with `OriginClient: "desktop"`):
  - `TestStatusPeriodDesktopOnlyActive`: SetStatusOnline without desktop conn → 0 rows; with → 1 `active`.
  - `TestStatusPeriodAutoAwayNeedsDesktop`: auto Away without desktop → no `away` row; manual Away without desktop → `away` row.
  - `TestStatusPeriodOfflineKeepsAway`: desktop, Online → Away → Offline → Online: rows active, away (closed at second Online), active. (Review Focus 2)
  - `TestStatusPeriodRepeatedOnlineNoWrites`: 5× SetStatusOnline(…, false) with desktop → exactly 1 row. (Review Focus 3)
  - `TestStatusPeriodSecondDesktopConnKeepsActive`: two desktop conns, unregister one → active still open; unregister both → closed. (Review Focus 1)
- [ ] **Step 2:** `go test ./channels/app/platform -run TestStatusPeriod` → FAIL.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** Tests pass; also `go test ./channels/app/platform -run Status` stays green.
- [ ] **Step 5:** Commit `Record Away and Active periods from status changes`.

### Task 4: Endpoint and client

**Files:**
- Create: `server/channels/api4/status_period.go`, `status_period_test.go`; register `api.InitStatusPeriods()` in `api4/api.go` (route on `api.BaseRoutes.APIRoot.Handle("/status_periods", api.APISessionRequired(getStatusPeriods))`)
- Create: `server/channels/app/status_period.go` (`(a *App) GetStatusPeriods(userID string, from, to int64) ([]*model.StatusPeriod, *model.AppError)`)
- Modify: `webapp/platform/client/src/client4.ts`, `webapp/platform/types/src/status_periods.ts` (new)

**Interfaces:**
- Produces: `Client4.getStatusPeriods(from: number, to: number, userId?: string): Promise<StatusPeriod[]>`; type `StatusPeriod = {id: string; user_id: string; kind: 'active' | 'away'; start_at: number; end_at: number}`.

- [ ] **Step 1: Failing api test** `TestGetStatusPeriods`: regular user, no `user_id` → own rows only; regular user with other `user_id` → 403; sysadmin with `user_id=""` → all users; `to-from` > 31 days → 400; missing `from` → 400.
- [ ] **Step 2:** `go test ./channels/api4 -run TestGetStatusPeriods` → FAIL.
- [ ] **Step 3:** Implement; permission via `c.App.SessionHasPermissionTo(*c.AppContext.Session(), model.PermissionManageSystem)`; empty `user_id` for a non-admin means the caller.
- [ ] **Step 4:** Test passes.
- [ ] **Step 5:** Commit `Serve status periods to users and system admins`.

### Task 5: Calculation helper

**Files:**
- Create: `webapp/channels/src/utils/status_periods.ts`, `status_periods.test.ts`

**Interfaces:**
- Consumes: `StatusPeriod` (Task 4).
- Produces: `summarizeDay(periods: StatusPeriod[], day: Date, workdayStart: string, workdayEnd: string, now: number): {breakMs: number; breakCount: number; overtimeMs: number; firstOpenAt?: number}` — `day` is any time on the local day; open rows end at `now`; break = `away` ∩ [day+start, day+end); count = rows with non-empty intersection; overtime = `active` ∩ [day+end, next local midnight); firstOpenAt = min `start_at` of `active` rows starting on that local day.

- [ ] **Step 1: Failing tests** (local-time `new Date(2026, 10, 20, h, m)`): away 12:00–12:30 → break 30 min, count 1; away 17:50–19:00 → break 10 min; away 08:00–09:15 → break 15 min; active 17:00–19:30 → overtime 90 min; open away from 12:00 with now 12:20 → 20 min (Review Focus 4); away from previous day 18:00 to 09:30 (Review Focus 2) → 30 min; no active rows → `firstOpenAt` undefined; two actives 08:40 and 13:00 → firstOpenAt 08:40.
- [ ] **Step 2:** `cd webapp/channels && npx jest src/utils/status_periods.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Pass.
- [ ] **Step 5:** Commit `Add day summary helper for status periods`.

### Task 6: Status box bottom-left

**Files:**
- Create: `webapp/channels/src/components/sidebar/status_box/status_box.tsx`, `status_box.scss`, `status_box.test.tsx`
- Modify: `webapp/channels/src/components/sidebar/sidebar.tsx` (render `<StatusBox/>` as last child before `<DataPrefetch/>`, desktop only)

**Interfaces:**
- Consumes: `Client4.getStatusPeriods` (Task 4), `summarizeDay` (Task 5), config `WorkdayStart/End` (Task 1), existing `UserAccountMenu` (`components/user_account_menu`), `getStatusForUserId`, `getCurrentUser`.
- Produces: `StatusBox` (no props).

- [ ] **Step 1: Failing test** `status_box.test.tsx`: renders name and status text; with mocked periods + Away status + now 12:20 inside hours shows "Molada" and "Bugün mola: 20 dk"; now 19:00 with open active from 17:00 shows "Fazla mesai 01:00".
- [ ] **Step 2:** Run jest → FAIL.
- [ ] **Step 3:** Implement: fetch today's periods on mount and on status change; 1 s interval only while Away inside hours or active after end; clicking avatar/name opens the same menu as `UserAccountMenu` (render `UserAccountMenu` as the trigger, styled for the box). Styles use sidebar theme vars (`--sidebar-text`, `--sidebar-bg`).
- [ ] **Step 4:** Pass.
- [ ] **Step 5:** Commit `Show status, break and overtime counters at the bottom of the sidebar`.

### Task 7: System Console "Molalar" report

**Files:**
- Create: `webapp/channels/src/components/admin_console/breaks_report/breaks_report.tsx`, `breaks_report.test.tsx`
- Modify: `admin_definition.tsx` (`user_management.subsections.breaks_report`, url `user_management/breaks`, title "Molalar", `isHidden: it.not(it.isSystemAdmin)`)

**Interfaces:**
- Consumes: `Client4.getStatusPeriods(from, to)` with no user id, `summarizeDay`, `getProfilesByIds` for names.

- [ ] **Step 1: Failing test**: given periods for two users, the table shows columns Kullanıcı / İlk açılış / Mola / Mola sayısı / Fazla mesai, sorted by break descending; date input change refetches with that local day's `[midnight, next midnight)`.
- [ ] **Step 2:** jest → FAIL.
- [ ] **Step 3:** Implement with `AdminHeader` + plain table like other admin pages.
- [ ] **Step 4:** Pass.
- [ ] **Step 5:** Commit `Add Molalar report to the System Console`.

### Task 8: Right DM panel and setting

**Files:**
- Create: `webapp/channels/src/components/dm_panel/dm_panel.tsx`, `dm_panel.scss`, `dm_panel.test.tsx`, `index.ts`
- Create: `webapp/channels/src/components/user_settings/sidebar/show_dm_panel/` (copy of `show_unreads_category` pattern)
- Modify: `components/channel_layout/channel_controller.tsx` (render `<DmPanel/>` inside `#channel_view` after `.channel-view-inner`; `.channel-view` lays out as a row), `user_settings_sidebar.tsx`, `sidebar_list` (filter out the `direct_messages` category when the preference is on)
- Modify: `mattermost-redux` preferences: constant `Preferences.SHOW_DM_PANEL = 'show_dm_panel'` (category `sidebar_settings`, default `'true'`) and selector `shouldShowDmPanel(state)`

**Interfaces:**
- Produces: `shouldShowDmPanel(state: GlobalState): boolean`; `DmPanel` (no props).

- [ ] **Step 1: Failing tests**: list excludes bots, deactivated users and self; order = group DMs, unread DMs, online/away/dnd, offline, alphabetical within; clicking a row navigates to `/{team}/messages/@{username}`; collapse toggle hides rows and is remembered (`localStorage` key `dm_panel_collapsed`, wrapped in try/catch); with preference off, `sidebar_list` shows the DM category and `DmPanel` renders nothing.
- [ ] **Step 2:** jest → FAIL.
- [ ] **Step 3:** Implement: profiles via `getProfilesInTeam(teamId, 0, 200, '', {active: true})` on team change, statuses via existing `getStatusesByIds`; row = avatar with status dot, `UserProfile`-style name (rank color via the existing hook), custom status text, unread badge from the DM channel's unread count.
- [ ] **Step 4:** Pass; `npm run check-types` in `webapp/channels` clean.
- [ ] **Step 5:** Commit `Move direct messages to a collapsible right panel`.

### Task 9: i18n and end-to-end check

- [ ] **Step 1:** `cd webapp/channels && npm run i18n-extract`; add tr strings with the copy from Global Constraints.
- [ ] **Step 2:** Run server + webapp, sign in from the desktop app: go idle (temporarily set Away timeout to 60), check Away, box counter, report row, overtime after setting WorkdayEnd to a past minute; open/collapse DM panel; toggle setting off → DM category back on the left.
- [ ] **Step 3:** Commit `Add translations for breaks and DM panel`.
