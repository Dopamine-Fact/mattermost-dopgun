# Department Members & Rank-Colored Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give and take ranks from the Departments panel, and draw every ranked user's name in their rank color.

**Architecture:** The departments response carries each rank's member user ids; the panel and a name-color hook both
read the departments cache every client already keeps (refreshed on `departments_changed`).

**Tech Stack:** Go store/app (Postgres), React + jest (webapp/channels).

**Spec:** `docs/superpowers/specs/2026-11-19-department-members-and-name-colors-design.md`

## Global Constraints

- Ranks are given/taken only through `Client4.setMemberRanks(teamId, userId, rankIds)` (full set per user).
- A user holds at most one rank per department.
- Name color = first held rank in department order then rank order (Stüdyo geneli first); applies always, not only when `colorize`.
- i18n: edit `en.json` by hand in sorted position with a `description`; add the Turkish string to `tr.json`. Never run `make i18n-extract` or `go mod tidy`.

## Review Focus

- A user holding a rank in another department keeps it when given a rank here (the full set sent must include it).
- Giving a rank in a department where the user already has another rank replaces that one, not adds a second.
- Picker excludes bots, guests, deactivated users and current holders of the rank.
- `UserProfile` with no current team or departments not loaded yet renders exactly as before.
- A 403 from `setMemberRanks` shows in the card's error line and leaves the list unchanged.

---

### Task 1: Server — rank member ids

**Files:**
- Modify: `server/channels/store/store.go` (TeamStore: `CountMembersWithRoles` → `MembersWithRoles`)
- Modify: `server/channels/store/sqlstore/team_store.go:1831`
- Modify: `server/channels/store/retrylayer/retrylayer.go`, `server/channels/store/timerlayer/timerlayer.go`, `server/channels/store/storetest/mocks/TeamStore.go`
- Modify: `server/public/model/custom_role.go` (`MemberIds []string json:"member_ids" db:"-"`)
- Modify: `server/channels/app/department.go:105-118`
- Test: `server/channels/store/storetest/team_store.go:4090`, app departments test

**Interfaces:**
- Produces: `TeamStore.MembersWithRoles(teamID string, roleNames []string) (map[string][]string, error)` — live members only, ids sorted; `CustomRole.MemberIds` always non-nil in `GetTeamDepartments` output; `MemberCount = len(MemberIds)`.

- [ ] Rewrite `testTeamCountMembersWithRoles` as `testTeamMembersWithRoles` asserting `{"rk_a": sorted[u1,u2], "rk_b": [u1]}` for the same fixture; run → FAIL (compile).
- [ ] Implement store + layers + mock; same query selecting `tm.UserId`, `ORDER BY tm.UserId`.
- [ ] App test: `GetTeamDepartments` returns `MemberIds == [userId]` for a member given a rank via `SetMemberRanks`, `[]` for an empty rank; run → FAIL, then fill `MemberIds` in `department.go`.
- [ ] Run store + app tests → PASS. Commit.

### Task 2: Webapp — members in the department card

**Files:**
- Modify: `webapp/platform/types/src/custom_roles.ts` (`Rank.member_ids: string[]`)
- Modify: `webapp/channels/src/components/team_settings/team_departments_tab/department_card.tsx`, `team_departments_tab.tsx` (pass `departments`, load team profiles), `team_departments_tab.scss`
- Modify: `webapp/channels/src/i18n/en.json`, `tr.json`
- Test: `team_departments_tab.test.tsx`

**Interfaces:**
- Consumes: `Rank.member_ids` from Task 1.
- Produces: `ranksHeldBy(departments: Department[], userId: string): Rank[]` exported from `components/profile_popover/use_custom_roles.ts`, in department then rank order.

- [ ] Tests: (a) rank row lists its members' display names; (b) choosing a user in "Kişi ekle" for `Mid` when they hold `Lead` (same department) and `Producer` (studio) calls `setMemberRanks('team1', uid, ['p','m'])`; (c) clicking a member's × on `Lead` calls `setMemberRanks` without `'l'`; (d) picker omits current holders and bots. Run → FAIL.
- [ ] Implement: chips (Avatar + display name + × `aria-label` "Remove {name} from {rank}"), native `<select>` with placeholder "Add person"; profiles from `getProfilesInTeam` selector, fetched with `getProfilesInTeam(teamId, 0, 200)` on tab mount; writes go through the card's `run()`.
- [ ] i18n keys `team_settings.departments.add_member` ("Add person" / "Kişi ekle"), `team_settings.departments.remove_member` ("Remove {name} from {rank}" / "{name} kişisini {rank} rütbesinden çıkar").
- [ ] jest, tsc, eslint, stylelint → clean. Commit.

### Task 3: Webapp — rank-colored names

**Files:**
- Modify: `webapp/channels/src/components/profile_popover/use_custom_roles.ts` (add `useUserRankColor(teamId, userId): string | undefined`)
- Modify: `webapp/channels/src/components/user_profile/user_profile.tsx`
- Test: `webapp/channels/src/components/user_profile/user_profile.test.tsx`

**Interfaces:**
- Consumes: `ranksHeldBy` from Task 2.

- [ ] Tests: user in `Lead` (#aa0000) renders name with `color: #aa0000` without `colorize`; user in studio `Producer` and `Lead` gets Producer's color; unranked user has no inline color. Run → FAIL.
- [ ] Implement hook (`ranksHeldBy(...)[0]?.color`) and use it in `UserProfile` with `getCurrentTeamId`; rank color wins over `colorize`.
- [ ] jest (user_profile, profile_popover, team_departments_tab), tsc, eslint → clean. Commit.
