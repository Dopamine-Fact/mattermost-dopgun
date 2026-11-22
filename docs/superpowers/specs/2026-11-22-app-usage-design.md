# App usage tracking and hidden break counter — design

## Intent

Managers want to see, per person and per day, which applications people spent their working time in on the desktop app:
the focused window's full title and hours:minutes per application. Employees must not see it. Separately, the break
counter comes off the status box at the bottom left of the sidebar.

## Goals

- Record the foreground window (application + full window title) while the user is active at the computer and the
  desktop app is running.
- Show System Admins a per-user, per-day breakdown next to the Breaks report: application → h:mm, and under each
  application its window titles → h:mm.
- Hide the break counter from the status box.

## Non-goals

- Employees seeing their own usage (explicitly ruled out).
- Screenshots, keystrokes, URLs or anything beyond app name + window title.
- Browser / web client tracking (only the desktop app can see other windows).
- macOS and Linux for now (see Constraints).
- Retention policy, exports, charts, per-team filters.

## Anti-goals

- Counting idle time: once the computer has had no input for 60 s, the time since the last input must not be credited
  to any application.
- Double counting: one user's minute must be stored once per server, even with several views/popouts open or a retry.
- Any non-admin being able to read anyone's usage, including their own.

## Constraints

- Desktop repo `mattermost-desktop-dopgun` has ~60 uncommitted files (branding work) that are not ours, including
  `src/main/app/initialize.ts`. Desktop changes are left uncommitted for the user to commit with their work.
- Reading another application's window needs native calls. `koffi` 3.1.1 is already a desktop dependency and already
  used on Windows (`windowsSessionAttributeCollector.ts`), so the Windows path uses it: no new dependency.
- The desktop main process has no server session; the webapp does.

## Approaches

- **A. Desktop records window intervals, webapp forwards them to the server (chosen by the user).** Desktop samples
  the foreground window, merges consecutive samples into intervals, and hands finished intervals to the webapp, which
  posts them with its session. The server stores raw intervals like StatusPeriods and sums them for the asked range.
- B. Server keeps only daily totals per (user, day, app, title). Smaller table, but "day" is fixed on the server
  (timezone, midnight problems) and when-it-happened is lost.
- C. Desktop posts straight to the server. Needs its own authentication from the main process: more work and more risk.

## Design

### Desktop (`mattermost-desktop-dopgun`)

- New `src/main/appUsage/` module:
  - `foregroundWindow.ts` (Windows): via koffi on `user32`/`kernel32`: `GetForegroundWindow`, `GetWindowTextW`,
    `GetWindowThreadProcessId`, `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`, `QueryFullProcessImageNameW`,
    `CloseHandle`. Returns `{app, title}` where `app` is the exe basename without `.exe` (e.g. `Photoshop`, `chrome`),
    or `undefined` when nothing is focused or a call fails. Other platforms return `undefined` (not recorded).
  - `appUsageTracker.ts`: every 5 s, read `powerMonitor.getSystemIdleTime()` itself (not `UserActivityMonitor`, which
    can be disabled in dev mode and reports late).
    - Idle ≥ 60 s → close the open interval at `now − idle` (the idle lead-in is not credited) and open none.
    - Otherwise sample the window. Same `{app, title}` as the open interval → extend it; different or none → close it
      at the sample time and open a new one if there is a window.
    - Every 60 s, cut the open interval at now (reopen it with the same app/title, same start = previous end), so a
      finished piece is never longer than ~60 s.
- Delivery is **pull**, not push: `ipcMain.handle('get-app-usage')`. The tracker appends every finished interval to a
  queue per configured server; a call drains the queue of the server the calling view belongs to. Any view of that
  server (main or popout) may call; whichever drains first gets it, so nothing is sent twice and nothing is lost at
  startup. Queues live in memory, capped at 24 h of intervals each (shortcut: lost on app quit).
- Preload `externalAPI.ts`: `getAppUsage(): Promise<AppUsageInterval[]>` via `ipcRenderer.invoke`.

### Webapp

- `utils/desktop_api.ts`: `getAppUsage()` wrapper; returns `[]` when the desktop API doesn't have it (old desktop, web
  browser). The `@mattermost/desktop-api` type doesn't know it yet, so it is typed locally.
- `logged_in.tsx`: every 60 s, `getAppUsage()` → append to a pending list → `Client4.postAppUsage(pending)` in chunks of
  ≤ 200; on success drop what was sent, on failure keep it for the next tick (pending capped at 24 h of intervals).
- Breaks report (`admin_console/breaks_report`): below the table, an "App usage" section for the same local day,
  loaded from `Client4.getAppUsage(from, to)` (from/to = the selected local day's bounds). One `<details>` per user
  (name + total h:mm), inside: applications sorted by time with h:mm, each with its window titles sorted by time with
  h:mm. The server already clamps and sums, so the client only groups.
- Status box: remove the "On break mm:ss" and "Breaks today: N min" lines and their 1 s tick for breaks; overtime stays.
  Unused i18n strings go too.

### Server

- Model `AppUsage{Id, UserId, App, Title, StartAt, EndAt}` (JSON snake_case) and `AppUsageTotal{UserId, App, Title,
  Ms}`.
- Migration 264 `app_usage`: table `AppUsage`, index on `(StartAt)`, **unique** index on `(UserId, StartAt)`.
- Store `AppUsageStore`:
  - `SaveMany([]*AppUsage) error` with `ON CONFLICT (UserId, StartAt) DO NOTHING`, so a retried batch doesn't duplicate.
  - `GetTotals(userID string, from, to int64) ([]*AppUsageTotal, error)`: rows overlapping [from, to),
    `SUM(LEAST(EndAt, to) − GREATEST(StartAt, from)) GROUP BY UserId, App, Title`; empty userID = everyone.
  - Layers + mocks regenerated.
- API:
  - `POST /api/v4/app_usage` (session required): body is an array, at most 200 items. The server sets `UserId` from the
    session and a new `Id`. Rejects `StartAt >= EndAt`, a single interval longer than 24 h, or `EndAt` more than 5 min in
    the future. App is truncated to 128 runes, title to 512 runes; empty app is rejected.
  - `GET /api/v4/app_usage?from&to[&user_id]` (System Admin only, `PermissionManageSystem`, for everyone including
    oneself): returns `[]AppUsageTotal`; same span limit as `/status_periods`.
- Client4: `postAppUsage`, `getAppUsage`. Types in `@mattermost/types/app_usage`.

## Known gaps (accepted)

- Between 60 s of no input and the server's Away timeout (`TeamSettings.UserStatusAwayTimeout`, 300 s by default), time
  is neither app time nor break time. A day's app time plus break time can be a few minutes short of the day.
- A user signed in on two PCs: each PC records only while it has input, so the unused one records nothing; if both are
  used at once, both are recorded.

## Decided by the user

- Approach A.
- Only managers (System Admins) see it, in the Breaks report page; employees cannot.
- Full window title kept; time shown per application in hours:minutes.

## My calls (correct me)

- Windows only for now; macOS/Linux don't record (office machines assumed Windows).
- App name = exe name without `.exe`, not the product's display name.
- 5 s sampling, 60 s idle threshold, 60 s upload.
- Mattermost's own window is recorded like any other app.
- No on/off setting and no retention limit; rows are kept.

## Left to the builder

- Exact koffi signatures and buffer sizes, file layout inside the modules, test structure, CSS for the section.
