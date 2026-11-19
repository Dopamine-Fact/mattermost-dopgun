# Breaks, overtime, status box and right-side DM panel

## Why

Managers want to see, per person and per day, when they started, how long they were away from the computer during
working hours ("mola"), and how long they kept working after hours ("fazla mesai"). People want to see their own
status and break time at a glance. The DM list also gets lost in the long left sidebar; the user wants a
Discord-style member list on the right instead.

## Goals

1. **Auto-Away after idle.** No mouse/keyboard input on the whole computer for N minutes (wanted: 10) makes the
   user Away. Admin sets N.
2. **Working hours.** Admin sets the workday start and end (default 09:00–18:00).
3. **Activity log.** The server records each user's Away periods and Active periods (start, end).
4. **Status box, bottom-left.** Under the left sidebar: avatar, name, status dot + text. Inside working hours: while
   Away a running "Molada mm:ss"; always "Bugün mola: X dk". After the workday end, while active: a running
   "Fazla mesai hh:mm". Clicking opens the existing status menu.
5. **Report.** System Console page "Molalar", system admins only: pick a day, see per user the first open time,
   break total and count (inside working hours), and overtime (active time after the workday end).
6. **Right DM panel.** A collapsible panel on the right listing everyone in the current team (plus existing group
   DMs at the top); clicking a person opens the DM. The left sidebar's Direct Messages category is hidden while the
   panel is on. A per-user setting turns the panel off and brings the old layout back.

Non-goals: grouping the panel by rank or status; showing the report to team admins or rank holders; editing
records; break limits, alerts or notifications; weekends/holidays (every day uses the same hours); counting work
before the workday start as overtime (early starts show through the first open time); an Electron code change.

Anti-goals: a break counted twice or never closed because the user has two clients; an extra DB write on every
status refresh.

## What exists

- Electron's `UserActivityMonitor` reads system-wide idle time (`powerMonitor.getSystemIdleTime`) every second and
  tells the webapp, which sends `user_update_active_status` over the websocket. The server marks Away in
  `PlatformService.SetStatusAwayIfNeeded` once `LastActivityAt` is older than `TeamSettings.UserStatusAwayTimeout`
  (seconds, default 300), already in Admin Console › Users and Teams. **Goal 1 needs no code**: set it to 600.
  Keyboard counts as activity too; the switch can lag up to about a minute (checked on websocket pong).
- Paths to Away: `SetStatusAwayIfNeeded` (auto from a websocket pong, `PUT /users/{id}/status` with away, `/away`,
  plugin API), plus `UpdateExpiredDNDStatuses`, which restores a pre-DND status with plain SQL. Other status
  writers: `SetStatusOnline` (saves directly), `_setStatusOfflineAndNotify`, `QueueSetStatusOffline` (batched save),
  `SetStatusDoNotDisturb[Timed]`, `SetStatusOutOfOffice`.
- Each `WebConn` knows its `originClient` (`desktop` / `web` / mobile), from the User-Agent.
- A manual status blocks automatic ones: `SetStatusOnline` returns early when `status.Manual` is set.

## Approaches

- **A — server records status periods (chosen).** On each status change the server closes the user's open period
  and opens a new one if the new status starts a period. Breaks, overtime and first open time are all read from
  the same rows. Same result for desktop, browser, mobile and `/away`.
- B — Electron records breaks and work time and posts them. Lost on crash, doubled with two clients, blind to
  browser users. Rejected.
- C — separate mechanisms (break rows, a per-day "first open / last active" row): "last active" can't tell 18:00–
  21:00 of work from a 20:59 reconnect, so overtime would be wrong. Rejected.

Right panel:
- **Own panel component (chosen)** between the center channel and the existing RHS.
- Reusing the RHS: opening a thread or search would replace the DM list. Rejected.

## Design

**Config**
- `TeamSettings.WorkdayStart` and `TeamSettings.WorkdayEnd`, strings `"HH:MM"` (defaults `"09:00"`, `"18:00"`),
  validated (start < end), shown in Admin Console › Users and Teams next to the Away timeout.
- Hours are wall-clock times in the timezone of whoever looks: the user's browser for the status box, the admin's
  browser for the report. The server never converts them.

**Server**
- Table `StatusPeriods` (migration 000262): `Id varchar(26) PK, UserId varchar(26), Kind varchar(16)` (`away` or
  `active`), `StartAt bigint, EndAt bigint default 0`; index on `(UserId, StartAt)` and on `StartAt`. `EndAt = 0`
  means still running. At most one open row per user.
- Store: `Switch(userID, kind /* "" = none */, at)` — closes the user's open row (if its kind differs) and opens a
  row of `kind` (unless `""` or the same kind is already open); `GetRange(userID /* "" = all */, from, to)` returns
  rows overlapping `[from, to)`.
- What each status means for the period:
  - Online, DND → `active`, **only while the user has at least one live `desktop` websocket connection**
    (decided: first open and overtime come from the desktop app only; a phone or browser check starts nothing).
    So periods are also re-evaluated when a user's first desktop connection registers on the hub (→ `active` if
    Online/DND) and when their last one goes away (ends `active`; an open `away` stays).
  - Away → `away`, **if it counts**: a manual Away (status API, `/away`, plugin) always counts; an automatic Away
    counts only if the user has at least one live `desktop` websocket connection at that moment (only Electron sees
    system-wide idle). An Away that doesn't count → `""` (ends the active period, opens nothing).
  - Out of Office → `""`.
  - Offline → ends an `active` period; **leaves an `away` period open** (a machine that sleeps over lunch keeps the
    break running until the user is back).
- A break starts the moment the status becomes Away (`StartAt = now`), not at the last activity: breaks read about
  N minutes shorter than the time actually away, and idle periods under N never count.
- Each status writer calls `Switch` only when the period kind changes from the previous status, so ordinary online
  refreshes add no writes.
- *Builder's call:* a manual Away stays until the user clears it (existing behavior), and so does its break. A timed
  DND that expires back into a previous status doesn't touch periods (the active period from DND simply continues).
- `GET /api/v4/status_periods?from=&to=&user_id=` — `from`/`to` in ms, span ≤ 31 days. Without `manage_system`,
  `user_id` must be the caller (default: the caller). With it, empty `user_id` returns everyone. Open rows come back
  with `end_at = 0`.

**Calculations (webapp, one shared helper with unit tests)** for a local day D with hours [S, E):
- Break total / count: `away` rows clipped to [D+S, D+E); count = rows with a non-empty clip.
- Overtime: `active` rows clipped to [D+E, next midnight).
- First open: earliest `StartAt` of an `active` row starting on D.
- Open rows count up to now.

**Status box (webapp)**
- New component at the bottom of the left sidebar (`sidebar.tsx`), Discord-like: avatar with status dot, display
  name, status text, and the lines from goal 4. Click → the existing status menu (`user_account_menu`).
- Loads today's periods for the current user on mount and when the status changes; a 1-second timer redraws only
  while a counter is running.

**Report (System Console)**
- New page under User Management, "Molalar": a date input (default today), a table with columns Kullanıcı, İlk
  açılış, Mola (toplam), Mola sayısı, Fazla mesai; sorted by break total descending.

**Right DM panel (webapp)**
- New component in the channel layout, right of the center channel, left of the RHS; a toggle button collapses it
  to a thin strip (collapsed state remembered per browser).
- Rows: avatar + status dot, display name (rank color via the existing `UserProfile` rank-color logic), custom
  status text if set, unread badge for the DM. Order: existing group DMs first, then people with an unread DM, then
  online/away/dnd, then offline; each part alphabetical. Bots, deactivated users and the current user excluded.
- Profiles via `getProfilesInTeam` (as other views do), statuses via the existing status fetching.
- Setting: Settings › Sidebar › "DM'leri sağ panelde göster" (user preference, default on). Off → panel gone and
  the left Direct Messages category shown again.
- *Builder's call:* only the Direct Messages category is hidden; DMs a user moved into Favorites or their own
  categories stay where they put them.

## Left to the builder

Exact styling (sidebar theme variables, works in all themes); i18n strings (en + tr, with descriptions, then
`make i18n-extract`); store layers/mocks via the repo's make targets; tests for the store, the period transitions
(including the desktop-only rule and Offline-keeps-away), the endpoint's permission check, and the calculation
helper.

## Risks

- "First open" is the first time the desktop app was connected and Online that day — usually it starting with
  Windows. A desktop app left open overnight shows no new "first open" the next day; its first active period of the
  day starts when the user comes back from Away.
- Someone who works only in the browser shows no first open and no overtime.
- A break running at the workday end stops counting at the end; an overnight Away never reaches the next day's hours
  unless it lasts past the start, in which case the morning portion counts as a break.
- "Has a desktop connection" is checked on the node handling the status change; fine for a single-node server.
- Teams in the thousands would make the right panel slow (no virtualization); the studio is small.
