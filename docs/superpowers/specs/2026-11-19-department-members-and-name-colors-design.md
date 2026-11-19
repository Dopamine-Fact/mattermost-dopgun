# Department members in the panel, names in rank colors

## Why

Giving someone a rank today means opening each person's profile card and ticking ranks one by one ("çok amele").
The departments panel already shows who holds what only as a count. And the rank colors picked there mean nothing
outside the panel.

## Goals

1. In Team Settings › Departments, every rank row lists its members (avatar + name + × to take the rank away) and
   has a "+ Kişi ekle" picker of team members.
2. Everywhere a user's name is drawn by the shared `UserProfile` component (post headers, threads, search results,
   lists), a user who holds a rank is shown in that rank's color, always — regardless of compact mode or the
   "colorize usernames" setting. Users without a rank keep today's look.

Non-goals: coloring @mentions in message text; per-user color overrides; changing who may give ranks.

## Approaches

- **A — members in the departments response (chosen).** `GET …/departments` already counts each rank's holders with
  one SQL query; it returns their user ids instead and the count becomes their length. Both features read the
  departments cache every client already keeps and refreshes on `departments_changed`, which `setMemberRanks`
  already publishes. No new endpoint, no extra request per name.
- B — load each post author's team member to read their roles: one more request per unseen author, and the panel
  would still need the member list. Rejected.
- C — a separate "rank members" endpoint for the panel plus A for colors: two sources for one fact. Rejected.

## Design

**Server**
- `CustomRole` gains `MemberIds []string json:"member_ids"` (not stored). `TeamStore.CountMembersWithRoles` becomes
  `MembersWithRoles(teamID, roleNames) (map[string][]string, error)` (same query, selecting `UserId`, ordered by
  user id); `GetTeamDepartments` sets `MemberIds` and `MemberCount = len(MemberIds)`.
- Giving and taking ranks keeps using `PUT …/members/{user_id}/ranks` (`SetMemberRanks`), so the outrank rules,
  "one rank per department", "not yourself" and the websocket event stay as they are.

**Panel (department_card.tsx)**
- Under each rank row: its members as chips (avatar, display name, × button), then a native `<select>` "+ Kişi ekle"
  of the team's active, non-guest, non-bot members not already holding that rank (profiles via
  `getProfilesInTeam`, the way the tasks view loads them).
- A user's current ranks are read from the departments data itself (every rank whose `member_ids` has them). Add =
  those ranks minus any other rank of the same department, plus this one; remove = those ranks minus this one; then
  `Client4.setMemberRanks`. Errors (e.g. 403 when you don't outrank the rank) go through the card's existing error
  display.

**Names**
- A hook `useUserRankColor(teamId, userId)` over `useTeamDepartments`: the color of the first rank, in department
  order then rank order (Stüdyo geneli first), whose `member_ids` holds the user; `undefined` otherwise.
- `UserProfile` uses the current team and, when the hook gives a color, sets `style.color` to it (on both the
  popover and no-popover paths); otherwise the existing colorize logic stands.

## Left to the builder

Chip/picker styling (follow `TeamDepartments__*` classes); i18n strings (en + tr by hand, with descriptions).

## Risks

A rank color with poor contrast on the user's theme makes names hard to read; the admin picks the colors. A user
removed from the team keeps their color in open clients until the next departments reload.
