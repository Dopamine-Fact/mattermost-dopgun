# Team departments and ranks — design

Replaces the role model of `2026-11-18-custom-roles-design.md` (phase 1, built on `feature/custom-roles`, not merged). The hierarchy idea, the permission split and the task / daily report / revision checks stay; what a "role" is, where it lives and who edits it change.

## Intent
Phase 1 made roles one global, flat list with a free-text department. In use that is wrong in three ways:
- A department is a typed string, so "Animasyon" and "animasyon" are different departments and nothing lists them.
- The studio thinks in **departments with ranks inside them** (Animasyon › Lead › Senior › Mid › Freelance), each rank with fewer rights than the one above, set by ticking a rank × permission table.
- Teams differ. One team has Animasyon and Modelleme, another has Ses and Kurgu. Roles must belong to a team and give rights only in that team.

## Goals
- Per team: any number of **departments**, each with a name, a color and an order.
- Per department: an ordered list of **ranks**, each with a name, a color and permissions. Lowest rank is typically Freelance (the user's convention, not enforced).
- Every team has one **Stüdyo geneli** (studio-wide) department, created automatically, always shown first. Its ranks (Producer, Coordinator, …) outrank every rank of every other department in that team.
- A person can be in several departments of a team, with **at most one rank per department**. Ranks are per team: being Animasyon Lead in team A gives nothing in team B.
- Permissions are set in a **matrix**: rows are ranks grouped by department, columns are the permissions, cells are checkboxes.
- Team admins and system admins manage this in **Team Settings › Departmanlar**.
- Visuals: rank colors on chips (profile popover now; name colors in a later phase), department color on the department header.

## Non-goals
- Rank holders defining departments, ranks or the matrix. Only team admins and system admins do (team admins already hold every permission in the matrix, so they cannot grant more than they have).
- Ranks that span teams, or a system-wide rank list.
- Carrying phase 1 data over. The only deployed database (dopgun) has no roles yet; phase 1 rows, if any, are dropped.
- Explicit deny, per-person permission overrides, permissions outside the whitelist.
- Mobile UI for managing departments (mobile still honors the permissions, they are native roles).

## Anti-goals
- A rank granting anything in a team other than its own.
- A lower rank, or a peer, approving a higher rank's daily report, assigning them tasks, or changing their ranks.
- Anyone but a system admin changing their own ranks; anyone approving their own daily report without `manage_team`.
- Teams with no departments behaving differently from today: team and system admins keep every right they have.

## Approaches
1. **Each rank is a team-scope native Mattermost role, held in `TeamMembers.ExplicitRoles` (picked).** Mattermost already evaluates team-scope roles from a team member's explicit roles, only in that team. `SessionHasPermissionToTeam`, the webapp's `haveITeamPermission`, mobile and websocket role updates work unchanged. The existing team-member role update path (`app/team.go` `updateTeamMemberRolesInternal`) already keeps non-scheme roles in `ExplicitRoles`.
2. **Keep phase 1's system-scope roles and tag them with a team.** Rejected: a system-scope role's permissions apply in every team, so an Animasyon Lead of team A would manage tasks in team B. Fixing that means rewriting every permission check.
3. **A separate permission engine evaluated at check time.** Rejected in phase 1 for the same reason: the webapp and mobile read native roles, so the UI would show controls that then fail.

## Rules

### Hierarchy
Within one team. Rank A **outranks** rank B when:
- A is in Stüdyo geneli and B is not, or
- A and B are in the same department and A is above B in that department's order.

Ranks in different ordinary departments never outrank each other.

Acting on a person needs a permission P (`manage_tasks`, `manage_daily_reports`, `manage_revisions` or `assign_custom_roles`). An actor may act on a target in a team when one of:
- the actor is a system admin, or a team admin of that team (bypass, as today);
- the target is the actor and the actor holds P, for actions that allow self (self-assigning a task). Changing one's own ranks is refused unless the actor is a system admin; approving one's own daily report needs `manage_team`;
- the actor holds **one rank that both carries P and outranks the target** (below).

*(User's call: the permission must come from the same rank that outranks the target. Holding `manage_tasks` as Modelleme Lead does not let an Animasyon Senior assign tasks to Animasyon Mids.)*

A rank R **outranks a target** when:
- the target has no rank in the team, or
- the target holds a Stüdyo geneli rank, and R outranks that rank (only a higher Stüdyo geneli rank does), or
- the target holds no Stüdyo geneli rank, and R outranks the target's rank in **at least one** department the target is in.

*(User's call: a shared department is enough. Mert, Animasyon Senior + Modelleme Mid, can be directed by the Animasyon Lead and by the Modelleme Lead. The Stüdyo geneli clause is my call, so a Producer who also sits in Animasyon as Mid is not directed by the Animasyon Lead.)*

A target who is a system admin or a team admin of that team can be acted on only by admins.

Applies to: setting a task's or revision task's assignee to someone else; seeing, exporting, approving and rejecting someone's daily reports (the roster lists only people the viewer may act on); giving or removing a rank.

Rights that do not act on a person (creating a task with no assignee, editing sections, uploading a revision video) need P from any of the actor's ranks, as native roles give today.

### Assigning ranks
`PUT` sets a member's full rank set in one team. The server refuses two ranks of the same department, ranks of another team, and deleted ranks. Unchanged ranks are not checked. For each rank K added or removed, the actor (unless an admin) needs one rank R carrying `assign_custom_roles` such that:
- R outranks K itself (so R is above K in K's department, or R is in Stüdyo geneli), and
- R outranks the target's current rank in K's department, if they have one (so a peer or senior cannot be demoted), and
- if the target holds a Stüdyo geneli rank, R outranks it.

*(My call: only K's department is looked at, so the Animasyon Lead can bring a Modelleme Mid into Animasyon as Mid. Cross-department recruiting is a normal studio workflow.)*

### Matrix
Ticks are independent. The matrix does not force a lower rank to have no more rights than the ranks above it; "fewer rights below" is the studio's convention. *(My call: keeps each tick a single-rank save.)*

## Design

### Data
- **New table `Departments`**: `Id`, `TeamId`, `Name` (varchar 64), `Color` (`#rrggbb`), `Position` (int, order within the team), `IsStudio` (bool), `CreateAt`, `UpdateAt`, `DeleteAt`. Unique `(TeamId, lower(Name))` among non-deleted rows; at most one `IsStudio` per team.
- **`CustomRoles` becomes the rank table**: gains `TeamId` and `DepartmentId`, loses `Department`; `Position` is now the order within the department (0 = top). Unique `(DepartmentId, lower(DisplayName))` among non-deleted rows.
- **Native role per rank**: a `Roles` row, `Name = "rk_" + <id>`, **team scope**, `BuiltIn = false`, `SchemeManaged = false`, `Permissions` = the rank's ticked permissions (whitelist only).
- **Assignment**: the rank's role name in `TeamMembers.ExplicitRoles` of that team (`TeamMembers.Roles` column). Written through the existing team-member role update path so caches and websocket events (`MEMBERROLE_UPDATED`) behave as for any role change. `TeamMembers.Roles` is varchar(256); the migration widens it to 1024 (the model check already uses `UserRolesMaxLength`).
- **Stüdyo geneli** is created when a team is created, and for existing teams by the migration (or lazily on first read — builder's call). It cannot be deleted; it can be renamed and recolored; it always sorts first.
- **New migration** (after 000253, which is already applied on dopgun): create `Departments`, reshape `CustomRoles`, widen `TeamMembers.Roles`, soft-delete any phase 1 `cr_*` native roles and strip `cr_*` from `Users.Roles`. Phase 1's `Users.Roles` widening stays.

### Permissions
The matrix columns are the whitelist:
- `manage_tasks`, `manage_daily_reports`, `manage_revisions` — unchanged from phase 1, team scope.
- `assign_custom_roles` — now **team scope** ("give ranks" in this team). Granted to `team_admin` and `system_admin` by a permissions migration.

Defining departments and ranks (create, edit, reorder, delete, tick the matrix) needs `manage_team` on that team (team admin) or system admin; it is not a matrix column.

### Lifecycle
- Deleting a rank soft-deletes its native role first (so it stops granting at once), then removes it from every member's explicit roles in the team, then deletes the rank row and closes the gap in positions.
- Deleting a department does the same for each of its ranks, after a confirmation that names how many members lose a rank.
- Removing a member from a team strips their ranks in that team.
- Renaming a rank updates the native role's `DisplayName` too.

### Server
- `App.CanActOnUser(rctx, actorID, targetID, teamID, permission)` and `App.ActionableUserIDs(rctx, actorID, teamID, permission)` gain the permission, because it must come from the outranking rank. Every phase 1 caller (task and revision assignee paths, daily report list/export/approve/reject, roster) passes the permission it already checks. Ranks are read from team member explicit roles instead of `Users.Roles`.
- `App.CanAssignRank(rctx, actorID, targetID, rankID)` replaces `CanAssignRole` and implements the "Assigning ranks" rule.
- Webapp permission checks (`haveITeamPermission`) still see the union of the user's ranks; they decide whether a control shows at all. Which people a control may target always comes from the server (`actionable_user_ids` per permission), so the UI never offers a person the server would refuse.
- Store: `DepartmentStore` (save, get, get by team, update, delete, set positions) and the reshaped rank store; `request.CTX` in signatures.

### API
- `GET /teams/{team_id}/departments` — departments with their ranks, ordered. Any team member (needed for chip names and colors).
- `POST /teams/{team_id}/departments`, `PATCH|DELETE /teams/{team_id}/departments/{department_id}`, `PUT /teams/{team_id}/departments/order` — `manage_team`.
- `POST /teams/{team_id}/departments/{department_id}/ranks`, `PATCH|DELETE /teams/{team_id}/ranks/{rank_id}`, `PUT /teams/{team_id}/departments/{department_id}/ranks/order` — `manage_team`. `PATCH` carries name, color, permissions; the matrix saves one rank per tick.
- `PUT /teams/{team_id}/members/{user_id}/ranks` `{rank_ids}` — `assign_custom_roles` on the team + hierarchy per added/removed rank.
- `GET /teams/{team_id}/actionable_user_ids?permission=<p>` — gains the permission (task assignee picker: `manage_tasks` or `manage_revisions`; daily report roster: `manage_daily_reports`).
- `GET /teams/{team_id}/members/{user_id}/assignable_ranks` — the ranks the viewer may add or remove for that member, for the edit dropdowns.
- The phase 1 `/custom_roles` and `/users/{id}/custom_roles` routes and their Go client methods are removed.

### Webapp
- **Team Settings › Departmanlar** tab, shown to team admins and system admins:

  ```
  Departmanlar                                  [+ Departman]
  ┌ ● Stüdyo geneli ── Rütbe       │ Task │ Daily report │ Revizyon │ Rütbe ver
  │ ⠿ ● Producer     (2 kişi)      │  ☑   │      ☑       │    ☑     │    ☑
  │ ⠿ ● Coordinator  (1 kişi)      │  ☑   │      ☑       │    ☐     │    ☐
  │                                                       [+ Rütbe]
  ┌ ● Animasyon ─────────────────────────────── [renk] [sil]
  │ ⠿ ● Lead         (1 kişi)      │  ☑   │      ☑       │    ☑     │    ☑
  │ ⠿ ● Senior       (3 kişi)      │  ☑   │      ☐       │    ☑     │    ☐
  │ ⠿ ● Mid          (4 kişi)      │  ☐   │      ☐       │    ☐     │    ☐
  │ ⠿ ● Freelance    (2 kişi)      │  ☐   │      ☐       │    ☐     │    ☐
  │                                                       [+ Rütbe]
  ```
  Ranks drag within their department; departments drag among themselves below Stüdyo geneli. A tick saves at once. Clicking a rank's name or dot edits name and color inline.
- **Profile popover**: chips for the user's ranks in the current team (`Animasyon · Lead`, in the rank's color). "Edit ranks" for viewers who may give ranks: one dropdown per department (none, or one rank), options from `assignable_ranks`; a department whose current rank the viewer may not change is shown read-only. Hidden for guests, for the viewer themself (unless system admin), and when `assignable_ranks` is empty.
- Task assignee filter and daily report roster stay; they already pass the team.
- **Removed**: System Console › Roles page, its sidebar entry and route, the phase 1 roles edit modal.

### Later phases
- Channel settings (phase 1 spec, phase 2) are keyed by rank instead of global role; channels belong to a team, so a channel's role settings list that team's ranks.
- Name colors: the user's highest rank in the current team (Stüdyo geneli first, then department order).

## Left to the builder
Exact migration number; whether Stüdyo geneli for existing teams is created in the migration or lazily; DB unique-index syntax; UI copy and colors; how the matrix reports a failed save; batching for large teams.
