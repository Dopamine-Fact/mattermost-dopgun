# Team departments and ranks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phase 1's global, flat custom roles with per-team departments holding ordered ranks. Each rank is a team-scope native role. Permissions are set in a rank × permission matrix in Team Settings. The hierarchy requires the permission to come from the rank that outranks the target.

**Architecture:** Keep the `CustomRoles` table and the `model.CustomRole` type, as the rank, and add `TeamId` and `DepartmentId`. A new `Departments` table holds departments. Each rank's native role is named `rk_<id>`, is team-scoped, and is held in `TeamMembers.ExplicitRoles`. This means `SessionHasPermissionToTeam`, `haveITeamPermission` and websocket role updates honor it unchanged. The hierarchy stays in `server/channels/app/custom_role_hierarchy.go`, now with a permission argument. The UI moves from System Console › Roles to a Team Settings tab.

**Tech Stack:** Go (Postgres, squirrel), React/TS, Jest, `@hello-pangea/dnd` 18.0.1, `GenericModal`.

**Spec:** `docs/superpowers/specs/2026-11-18-team-departments-design.md`. Read Rules (Hierarchy, Assigning ranks, Matrix) and Design before starting; this plan does not repeat them.

## Global Constraints

- **Branch:** `feature/custom-roles`. Phase 1 code is the starting point: change it in place, do not add parallel code. Files: `server/public/model/custom_role.go`, `server/channels/app/custom_role*.go`, `server/channels/api4/custom_role*.go`, `server/channels/store/sqlstore/custom_role_store.go`, `server/channels/store/storetest/custom_role_store.go`, `server/public/model/client4_custom_role.go`, and webapp `platform/types/src/custom_roles.ts`, `components/profile_popover/*custom_roles*`, `components/admin_console/custom_roles/`.
- **Go runner:** run Go in docker with `sh /c/Users/dopamine/AppData/Local/Temp/claude/b77d99a4e3601da8/18855b51-ad8f-4ec1-87db-74716ea63234/scratchpad/gorun.sh <dir under server/> "<cmd>"`, written `$G` below.
  - It needs the `mattermost-postgres` container running (`docker start mattermost-postgres`).
  - Tests run as `ENABLE_FULLY_PARALLEL_TESTS=true go test ./ -count=1 -parallel 4 -run '<regex>'`.
  - Never `go mod tidy`; use `make modules-tidy`.
- **Store:** store methods take `request.CTX` only where they need a context, never `context.Context`. Regenerate the layers and mocks with `make store-layers store-mocks` (from `server/`). If mockery can't run, edit the mocks by hand in the generated style and ledger it.
- **i18n:**
  - After editing `server/i18n/en.json`, run `make i18n-extract`. Restore any ids it deletes that aren't ours, and fill in every new `description`.
  - Webapp `en.json` is CRLF with `{defaultMessage, description}` entries; `tr.json` is flat.
  - Every new string goes into en and tr. Turkish UI words: Departmanlar, Departman, Rütbe, Stüdyo geneli, Task yönet, Daily report, Revizyon, Rütbe ver.
- **Migration:** `000254_team_departments`, postgres only, both files listed in `server/channels/db/migrations/migrations.list`. 000253 is already applied on the dopgun DB and must not change.
- **Rank native role:**
  - Name `"rk_" + CustomRole.Id` (`model.RankRoleNamePrefix = "rk_"`). `Scope = model.RoleScopeTeam`, `SchemeManaged = false`, `BuiltIn = false`.
  - Permissions only from `model.CustomRolePermissionWhitelist` (unchanged four), anything else → 400.
- **Field rules:**
  - Color `^#[0-9a-f]{6}$`.
  - Department and rank names: 1–64 runes, trimmed.
  - Department names are unique per team and rank names unique per department, among live rows and case-insensitively. A DB partial unique index enforces both.
  - Positions are contiguous from 0, lower = higher. Stüdyo geneli is always department position 0 and `IsStudio = true`.
- **Targets:** ranks are never given to guests or bots (400), nor to non-members of the team (400).
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Generic team role endpoint.** A team admin saves `team_user team_admin` through `PUT /teams/{t}/members/{u}/roles` for someone holding `rk_x`. `rk_x` must survive. Test: Task 4 `TestUpdateTeamMemberRolesKeepsRanks`.
2. **Leaving a team.** A member leaves or is removed, then rejoins: they come back with no ranks. Test: Task 4 `TestLeaveTeamStripsRanks`.
3. **Permission from another rank.** Mert is Animasyon Senior without `manage_tasks` and Modelleme Lead with it. Assigning a task to an Animasyon Mid → 403, and that Mid is not in his `actionable_user_ids?permission=manage_tasks`. Tests: Task 4 `TestCanActOnUserPermissionFromOutrankingRank`, Task 5 api test.
4. **Studio rank in a department.** A Producer who is also Animasyon Mid can't be acted on by the Animasyon Lead. Test: Task 4 `TestStudioRankShieldsTarget`.
5. **Deleting a department whose ranks members hold.** The members' explicit roles and sessions lose the rank immediately, other departments' positions stay contiguous, and Stüdyo geneli can't be deleted. Test: Task 3 `TestDeleteDepartmentStripsMembers`.

---

### Task 1: Model and permission scope

**Files:**
- Modify: `server/public/model/custom_role.go` (+ `custom_role_test.go`)
- Create: `server/public/model/department.go` (+ `department_test.go`)
- Modify: `server/public/model/permission.go`, `server/public/model/role.go`, `server/public/model/migration.go`, `server/channels/app/permissions_migrations.go` (+ `_test.go`)

**Produces:**
- `model.CustomRole` fields:
  - `Id`, `RoleName`, `TeamId`, `DepartmentId`, `DisplayName`, `Color`, `Position`, `Permissions` (`db:"-"`), `CreateAt`, `UpdateAt`, `DeleteAt`.
  - JSON names are snake_case. `Department` is removed.
- `CustomRolePatch{DisplayName, Color *string; Permissions *[]string}`.
- `RankRoleNamePrefix = "rk_"`, `RankRoleNameFromId(id string) string`, `IsRankRoleName(name string) bool`, `RankIdsFromRoles(roles string) []string`. These replace the `CustomRole*Name*` helpers.
- `RemoveRankRoles(roles string) string`: drops every `rk_*` word.
- `model.Department{Id, TeamId, Name, Color string; Position int; IsStudio bool; CreateAt, UpdateAt, DeleteAt int64}`.
  - `DepartmentPatch{Name, Color *string}`.
  - Methods `PreSave`, `PreUpdate`, `IsValid`, `Patch`, `Auditable`. `StudioDepartmentName = "Stüdyo geneli"`, default color `#5d89ea`.
- `PermissionAssignCustomRoles` → `PermissionScopeTeam`. It moves from the system-scoped list to the team-scoped list in `permission.go` and is added to the `team_admin` defaults in `role.go`.
- `MigrationKeyTeamAdminAssignCustomRoles = "team_admin_assign_custom_roles"`: adds `assign_custom_roles` to `team_admin`, and keeps it on `system_admin`.

- [ ] **Step 1: Write the failing tests.**
  - `TestCustomRoleIsValid` cases: missing `TeamId` → error; missing `DepartmentId` → error; `RoleName != "rk_"+Id` → error.
  - `TestRankIdsFromRoles`: `"team_user rk_a cr_b rk_c"` → `["a","c"]`.
  - `TestRemoveRankRoles`: `"team_user rk_a team_admin"` → `"team_user team_admin"`.
  - `TestDepartmentIsValid`: empty name, 65 runes, bad color, no team.
  - `TestTeamAdminAssignCustomRolesMigration`: `team_admin` gains it, `channel_user` unchanged.
- [ ] **Step 2: Run them.** `sh $G public/model "go test ./ -count=1 -run 'CustomRole|RankIds|RemoveRank|Department'"` and `sh $G channels/app "... -run TeamAdminAssignCustomRoles"`. Expected: FAIL (undefined symbols).
- [ ] **Step 3: Implement** the model changes and the permission scope move, and register the migration after `MigrationKeySplitManageTeamTasksPermission`.
- [ ] **Step 4: Run the model tests again.** Expected: PASS. Until Task 4 the server packages above `public/model` don't compile, because the phase 1 helpers are gone. So `TestTeamAdminAssignCustomRolesMigration` is written now but first runs in Task 3, Step 2.
- [ ] **Step 5: Commit** "Make custom roles team ranks in the model".

### Task 2: Migration and stores

**Files:**
- Create: `server/channels/db/migrations/postgres/000254_team_departments.{up,down}.sql`, `server/channels/store/sqlstore/department_store.go`, `server/channels/store/storetest/department_store.go`
- Modify: `migrations.list`, `server/channels/store/store.go`, `sqlstore/store.go`, `sqlstore/custom_role_store.go`, `storetest/custom_role_store.go`, `storetest/store.go`, `sqlstore/team_store.go`, `sqlstore/user_store.go` (remove `RemoveRoleFromAll`), `server/channels/testlib/store.go`, the generated layers and mocks.

**Produces:**
- **Migration up:**
  - `CREATE TABLE Departments(Id varchar(26) PK, TeamId varchar(26) NOT NULL, Name varchar(64) NOT NULL, Color varchar(7) NOT NULL, Position int NOT NULL, IsStudio boolean NOT NULL DEFAULT false, CreateAt, UpdateAt bigint, DeleteAt bigint NOT NULL DEFAULT 0)`.
  - Unique `(TeamId, lower(Name)) WHERE DeleteAt = 0` and unique `(TeamId) WHERE IsStudio AND DeleteAt = 0`.
  - `DELETE FROM CustomRoles`, then on `CustomRoles` drop `Department`, add `TeamId varchar(26) NOT NULL`, `DepartmentId varchar(26) NOT NULL`, and unique `(DepartmentId, lower(DisplayName)) WHERE DeleteAt = 0`.
  - `UPDATE Roles SET DeleteAt = <now ms> WHERE Name LIKE 'cr\_%' AND DeleteAt = 0`.
  - Strip `cr_*` words from `Users.Roles` and `Sessions.Roles` (the same regexp as phase 1 `RemoveRoleFromAll`).
  - `ALTER TABLE TeamMembers ALTER COLUMN Roles TYPE varchar(1024)`.
  - Stüdyo geneli rows for existing teams are created lazily by the app (Task 3), not by the migration.
- **Migration down:** drop `Departments`, drop the new columns and index, re-add `Department varchar(64) NOT NULL DEFAULT ''`. Shrink `TeamMembers.Roles` only when every value fits, as 000253 does.
- **`store.DepartmentStore`:**
  - `Save(d *model.Department) (*model.Department, error)`
  - `Update(d *model.Department) (*model.Department, error)`: `*store.ErrNotFound` when the row is missing or deleted.
  - `Get(id string) (*model.Department, error)`: same not-found rule.
  - `GetForTeam(teamID string) ([]*model.Department, error)`: live rows, by Position, then CreateAt.
  - `Delete(id string, at int64) error`
  - `SetPositions(teamID string, orderedIDs []string, at int64) error`: `orderedIDs` must be exactly the team's live departments; else `*store.ErrInvalidInput`. `FOR UPDATE` lock as in phase 1.
  - A unique violation on save or update returns `*store.ErrConflict`.
- **`store.CustomRoleStore`:**
  - `GetAll` becomes `GetForTeam(teamID string) ([]*model.CustomRole, error)`, live rows ordered by department, then Position.
  - `SetPositions(departmentID string, orderedIDs []string, at int64) error`, scoped to that department's live ranks.
  - `Save`, `Update`, `Get`, `Delete` are unchanged. A unique violation returns `*store.ErrConflict`.
- **`TeamStore.CountMembersWithRoles(teamID string, roleNames []string) (map[string]int64, error)`:** live members of the team holding each role name (whole word); names with no holder are absent.
- **`TeamStore.RemoveRoleFromAllMembers(teamID, roleName string) ([]string, error)`:** strips `roleName` (whole word) from `TeamMembers.Roles` of that team and returns the changed user ids.
- **`Store.Department() DepartmentStore`.**

- [ ] **Step 1: Write the failing storetest cases.**
  - `testDepartmentSaveGetForTeam`: two teams, order, deleted rows hidden.
  - `testDepartmentNameUnique`: same name in another case → ErrConflict; same name in another team → ok.
  - `testDepartmentSetPositions`: exact set ok; a missing or extra id → ErrInvalidInput.
  - `testCustomRoleGetForTeam`, `testCustomRoleSetPositionsPerDepartment`.
  - `testTeamRemoveRoleFromAllMembers`: other team untouched; `rk_ab` doesn't match `rk_a`.
  - `testTeamCountMembersWithRoles`: deleted members are not counted.
  - `testTeamMemberRolesLong`: 1000-char explicit roles saved.
  - Wire them into `TestDepartmentStore` and the existing `TestCustomRoleStore` and `TestTeamStore` runners.
- [ ] **Step 2: Run them.** `sh $G channels/store/sqlstore "ENABLE_FULLY_PARALLEL_TESTS=true go test ./ -count=1 -run 'TestDepartmentStore|TestCustomRoleStore|TestTeamStore/RemoveRoleFromAllMembers|TestTeamStore/TeamMemberRolesLong'"`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, the stores, and `make store-layers store-mocks`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** "Add departments and team-scoped ranks to the store".

### Task 3: App — departments and ranks

**Files:**
- Modify: `server/channels/app/custom_role.go` (+ `custom_role_test.go`)
- Create: `server/channels/app/department.go` (+ `department_test.go`)
- Modify: `server/channels/app/team.go` (`CreateTeam` ensures Stüdyo geneli), `server/i18n/en.json`, `tr.json`

**Produces:** all functions take `rctx request.CTX` first.

- **`GetTeamDepartments(rctx, teamID) ([]*model.DepartmentWithRanks, *model.AppError)`:**
  - `model.DepartmentWithRanks{*Department; Ranks []*CustomRole \`json:"ranks"\`}`.
  - Departments in order with their ranks in order and permissions filled from the native roles.
  - Each rank's `MemberCount` (`json:"member_count" db:"-"` on `CustomRole`) comes from `CountMembersWithRoles`.
  - Creates Stüdyo geneli first if the team has none.
- **Department CRUD:**
  - `CreateDepartment(rctx, teamID, name, color string)` appends at the bottom.
  - `PatchDepartment(rctx, teamID, id string, p *model.DepartmentPatch)`.
  - `ReorderDepartments(rctx, teamID string, orderedIDs []string)`: Stüdyo geneli must stay first, else 400.
  - `DeleteDepartment(rctx, teamID, id string) *model.AppError`: deletes each rank as below, then the row, then compacts positions. Stüdyo geneli → 400.
- **Rank CRUD:**
  - `CreateRank(rctx, teamID, departmentID string, r *model.CustomRole)`: native role `rk_<id>` with team scope, at the bottom of its department.
  - `PatchRank(rctx, teamID, id string, p *model.CustomRolePatch)`: a rename updates the native role's `DisplayName` too.
  - `ReorderRanks(rctx, teamID, departmentID string, orderedIDs []string)`.
  - `DeleteRank(rctx, teamID, id string)`, in this order:
    1. Soft-delete the native role.
    2. Delete the row.
    3. `RemoveRoleFromAllMembers`.
    4. For each changed user: `ClearSessionCacheForUser`, `invalidateCacheForUserTeams`, and `sendUpdatedTeamMemberEvent` with the re-read member.
    5. Compact positions.
- **Errors and team checks:** every id is checked to belong to `teamID` (404 otherwise). `*store.ErrConflict` → 400 `app.custom_role.name_taken.app_error`.
- **Removed:** `GetCustomRoles`, `CreateCustomRole`, `PatchCustomRole`, `ReorderCustomRoles`, `DeleteCustomRole`, `refreshUserRoles`.

- [ ] **Step 1: Rewrite `custom_role_test.go` and add `department_test.go`.**
  - `TestGetTeamDepartmentsCreatesStudio`: first call creates one, a second call doesn't duplicate.
  - `TestCreateRankIsTeamScoped`: the native role has `Scope == team` and the given permissions; a non-whitelisted permission → 400.
  - `TestRankGrantsOnlyInItsTeam`:
    - Give rank `manage_tasks`, set `ExplicitRoles` in team A.
    - `SessionHasPermissionToTeam` is true for A and false for B.
  - `TestPatchRankRenamesNativeRole`.
  - `TestReorderDepartmentsKeepsStudioFirst`.
  - `TestDeleteDepartmentStripsMembers`: a member holding the rank loses it, the session loses the permission, and remaining positions are 0..n-1.
  - `TestDeleteStudioRefused`.
  - Keep phase 1's `TestDeleteCustomRoleFailureDropsPermissions`, renamed `TestDeleteRankFailureDropsPermissions`, failing `RemoveRoleFromAllMembers`.
- [ ] **Step 2: Run them.** `sh $G channels/app "ENABLE_FULLY_PARALLEL_TESTS=true go test ./ -count=1 -parallel 4 -run 'Department|Rank|TeamAdminAssignCustomRoles'"`. Expected: FAIL.
- [ ] **Step 3: Implement.** i18n strings: `app.department.*` (not_found, studio_delete, studio_first) plus the reused `app.custom_role.*`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** "Manage team departments and ranks".

### Task 4: App — hierarchy and assignment

**Files:**
- Modify: `server/channels/app/custom_role_hierarchy.go` (+ `_test.go`), `server/channels/app/custom_role.go` (`SetMemberRanks`), `server/channels/app/team.go` (`UpdateTeamMemberRoles`, `leaveTeam`), `server/channels/app/user.go` (drop the `cr_` keep-logic in `UpdateUserRolesWithUser`)

**Produces:**
- **`CanActOnUser(rctx, actorID, targetID, teamID string, permission *model.Permission) bool`:**
  - The self rule and admin bypass are as phase 1.
  - Otherwise, true when some rank of the actor in `teamID` has `permission.Id` in its native role's permissions and `rankOutranksTarget(rank, targetRanks, deptOf)`.
- **`ActionableUserIDs(rctx, actorID, teamID string, candidates []string, permission *model.Permission) []string`:** same rule for each candidate.
- **`CanAssignRank(rctx, actorID, targetID, rankID string) bool`:** the spec's "Assigning ranks" rule.
- **`SetMemberRanks(rctx, actorID, teamID, userID string, rankIDs []string) (*model.TeamMember, *model.AppError)`:**
  - Refusals:
    - guest, bot or non-member → 400;
    - unknown rank, or a rank of another team → 400;
    - two ranks of one department → 400;
    - self change by a non-sysadmin → 403;
    - a changed rank failing `CanAssignRank` → 403 `app.custom_role.not_outranked.app_error`.
  - On success it writes `ExplicitRoles` = non-rank roles + wanted ranks, ordered by department and position, through `updateTeamMemberRolesInternal`. Scheme flags are kept by passing the member's current `Roles`.
- **Pure helpers** in the hierarchy file:
  - `rankOutranks(a, b *model.CustomRole, studio map[string]bool) bool`
  - `rankOutranksTarget(r *model.CustomRole, target []*model.CustomRole, studio map[string]bool) bool`
  - Here `studio` is the set of Stüdyo geneli department ids.
- **`UpdateTeamMemberRoles`:** if `newRoles` names no `rk_*` role, the member's current `rk_*` roles are appended. Guests are the exception: when `newRoles` contains `team_guest`, ranks drop.
- **`leaveTeam`:** sets `teamMember.ExplicitRoles = model.RemoveRankRoles(teamMember.ExplicitRoles)` before `RemoveTeamMember`.
- **Rank lookup:** ranks of a user in a team are read from `TeamMember.ExplicitRoles` via `RankIdsFromRoles`, against `CustomRole().GetForTeam(teamID)` plus the native roles' permissions (one `GetRolesByNames`).

- [ ] **Step 1: Write the failing tests.** Table test `TestRankOutranksTarget` over the spec's examples:
  - same department above/below;
  - different departments;
  - studio over department;
  - target without ranks;
  - a target with Animasyon Senior + Modelleme Mid is outranked by Animasyon Lead and by Modelleme Lead;
  - a target with Producer + Animasyon Mid is not outranked by Animasyon Lead.

  App tests:
  - `TestCanActOnUserPermissionFromOutrankingRank` (Review Focus 3).
  - `TestStudioRankShieldsTarget`.
  - `TestAdminsRankAboveRanks` (from phase 1).
  - `TestSetMemberRanks`: cross-department recruit allowed; demoting a peer → 403; two ranks in one department → 400; another team's rank → 400; guest → 400; self → 403.
  - `TestUpdateTeamMemberRolesKeepsRanks`.
  - `TestLeaveTeamStripsRanks`: leave, rejoin through `JoinUserToTeam`, then `ExplicitRoles` has no `rk_`.
  - Delete phase 1 tests for `CanAssignRole`, `SetUserCustomRoles` and `UpdateUserRolesKeepsCustomRoles`.
- [ ] **Step 2: Run them.** `sh $G channels/app "... -run 'Rank|CanActOn|Studio|Admins|LeaveTeamStrips|UpdateTeamMemberRolesKeeps'"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again,** then `-run 'Team|User'` to catch regressions in the touched paths. Expected: PASS.
- [ ] **Step 5: Commit** "Apply the rank hierarchy per team and permission".

### Task 5: API, Go client, enforcement callers

**Files:**
- Modify: `server/channels/api4/custom_role.go` (+ `custom_role_test.go`, `custom_role_enforcement_test.go`), `server/channels/api4/task.go`, `server/channels/api4/daily_report.go`, `server/public/model/client4_custom_role.go`, `server/public/model/audit_events.go`, `server/public/model/websocket_message.go`, i18n

**Produces:**
- **Routes:** handlers in `custom_role.go`, renamed `InitDepartments`.
  - `GET /teams/{team_id}/departments`: team member.
  - `POST /teams/{team_id}/departments`, `PUT .../departments/order` (`{ids}`), `PATCH|DELETE .../departments/{department_id}`: `manage_team` on the team.
  - `POST .../departments/{department_id}/ranks`, `PUT .../departments/{department_id}/ranks/order`, `PATCH|DELETE /teams/{team_id}/ranks/{rank_id}`: `manage_team`.
  - `PUT /teams/{team_id}/members/{user_id}/ranks` (`{rank_ids}`): `assign_custom_roles` on the team, then `SetMemberRanks`.
  - `GET /teams/{team_id}/members/{user_id}/assignable_ranks`: returns `[]string` rank ids the session user may add or remove for that member (`CanAssignRank` per team rank). Empty for self unless sysadmin, and empty for guests and bots.
  - `GET /teams/{team_id}/actionable_user_ids?permission=<id>`: replaces `/custom_roles/actionable_users`. `permission` must be one of the three team task permissions, else 400.
- **Websocket:** `WebsocketEventCustomRolesChanged` is renamed `WebsocketEventDepartmentsChanged = "departments_changed"`, broadcast to the team (`teamID` in the event). It is sent on every department or rank change.
- **Audit events:** renamed to department/rank verbs (`createDepartment`, `patchDepartment`, `deleteDepartment`, `reorderDepartments`, `createRank`, `patchRank`, `deleteRank`, `reorderRanks`, `setMemberRanks`).
- **Go client:** `GetTeamDepartments`, `CreateDepartment`, `PatchDepartment`, `DeleteDepartment`, `ReorderDepartments`, `CreateRank`, `PatchRank`, `DeleteRank`, `ReorderRanks`, `SetMemberRanks`, `GetAssignableRanks`, `GetActionableUserIds(ctx, teamID, permission)`. The phase 1 methods are removed.
- **Callers:**
  - `requireCanAssign(c, teamID, assigneeID string, permission *model.Permission)`: `createTask` and `patchTask` pass `sectionPermission(section)` of the task's section, or `PermissionManageTasks` when it has none.
  - Daily report `CanActOnUser` and `ActionableUserIDs` calls pass `PermissionManageDailyReports`.

- [ ] **Step 1: Write the failing tests.**
  - api `TestDepartmentRoutes`:
    - a team admin creates, patches, reorders and deletes;
    - a plain member → 403 on writes, 200 on GET;
    - a member of another team → 403 on GET;
    - a sysadmin works in any team.
  - `TestSetMemberRanksRoute`: without `assign_custom_roles` → 403; a lead recruits from another department → 200; the target's sessions get the rank's permission at once (`SessionHasPermissionToTeam` after the call).
  - `TestActionableUserIdsPermission` (Review Focus 3).
  - In `custom_role_enforcement_test.go`, port the task and daily report subcases to department ranks.
- [ ] **Step 2: Run them.** `sh $G channels/api4 "ENABLE_FULLY_PARALLEL_TESTS=true go test ./ -count=1 -parallel 4 -run 'Department|MemberRanks|Actionable|CustomRoleEnforcement|Task|DailyReport'"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then `make i18n-extract` and restore foreign ids.
- [ ] **Step 4: Run the tests again,** plus `go vet ./...` for `channels/api4` and `public/model`. Expected: PASS.
- [ ] **Step 5: Commit** "Serve departments and ranks per team".

### Task 6: Webapp — data, popover, existing consumers

**Files:**
- Modify: `webapp/platform/types/src/custom_roles.ts`, `webapp/platform/client/src/client4.ts`, `components/profile_popover/{use_custom_roles.ts,profile_popover_custom_roles.tsx,custom_roles_edit_modal.tsx,profile_popover.tsx}` (+ test), `components/tasks/task_detail.tsx` (+ test), `components/daily_reports/team_reports.tsx` (+ `daily_reports.test.tsx`), i18n
- Delete: `components/admin_console/custom_roles/` and its entry in `admin_definition.tsx`. Leave the `admin_sidebar` test unless it references it.

**Produces:**
- **Types:**
  - `Rank` = phase 1 `CustomRole` minus `department` plus `team_id` and `department_id`.
  - `Department{id, team_id, name, color, position, is_studio, ranks: Rank[]}`.
  - `RankPatch`, `DepartmentPatch`, `RANK_PERMISSIONS` (= the four), `DEPARTMENTS_CHANGED = 'departments_changed'`.
- **Client4:** methods mirroring the Go client. `getActionableUserIds(teamId, permission)`.
- **`useTeamDepartments(teamId): Department[]`:** replaces `useCustomRoles`. It caches per team, refetches on `DEPARTMENTS_CHANGED` for that team, and is exported for Task 7.
- **`ranksOf(departments, explicitRoles): Array<{department, rank}>`:** replaces `rolesOf`. Drop `outranks` (the server decides).
- **Popover:**
  - Chips come from the user's team member (`getTeamMember` selector for current team; fetch via `getTeamMember` action if missing). Chip text is `Department · Rank` in the rank color.
  - "Edit ranks" appears only when `haveITeamPermission(ASSIGN_CUSTOM_ROLES)`, the target isn't a guest or bot, the target isn't the viewer (unless sysadmin), and `getAssignableRanks` is non-empty.
  - The edit modal shows one select per department (`—` plus ranks). Options outside `assignable_ranks` are disabled. A department whose current rank isn't assignable is disabled. Saving calls `setMemberRanks`.
- **Task detail:** `getActionableUserIds(task.team_id, sectionHasChannel ? 'manage_revisions' : 'manage_tasks')`, where the section comes from `sections.find((s) => s.id === task.section_id)`.
- **Team reports:** `getActionableUserIds(teamId, 'manage_daily_reports')`.

- [ ] **Step 1: Update the tests first.**
  - `profile_popover_custom_roles.test.tsx`:
    - chips show `Animasyon · Lead` from the team member's explicit roles;
    - no edit button when `assignable_ranks` is empty;
    - the edit modal disables a department whose rank isn't assignable;
    - saving sends the full `rank_ids`.
  - `task_detail.test.tsx`: a revision task asks with `manage_revisions`.
  - `daily_reports.test.tsx`: the roster asks with `manage_daily_reports`.
- [ ] **Step 2: Run them.** `npx jest src/components/profile_popover src/components/tasks/task_detail.test.tsx src/components/daily_reports` (from `webapp/channels`). Expected: FAIL.
- [ ] **Step 3: Implement,** and delete the admin console page and its strings.
- [ ] **Step 4: Run the tests again,** plus `npm run check-types` and `npx eslint --rule '@stylistic/linebreak-style: off' <changed files>`. Expected: PASS, clean.
- [ ] **Step 5: Commit** "Show and edit team ranks in the profile popover".

### Task 7: Webapp — Team Settings › Departmanlar

**Files:**
- Create: `components/team_settings/team_departments_tab/{team_departments_tab.tsx,department_card.tsx,team_departments_tab.scss,team_departments_tab.test.tsx,index.ts}`
- Modify: `components/team_settings_modal/team_settings_modal.tsx` (tab `departments`, icon `icon icon-sitemap` or the closest compass icon, `display: haveITeamPermission(MANAGE_TEAM) || sysadmin`), `components/team_settings/team_settings.tsx` (switch case), i18n

**Produces:** the tab laid out as the spec's sketch.
- **Department card:**
  - Header: color dot (an `<input type='color'>` behind it), editable name, delete button. Stüdyo geneli has no delete button.
  - A `DragDropContext` of rank rows. Each row has a drag handle, a color dot (`input[type=color]`), an inline-editable name, a member count (`rank.member_count`, "N kişi") and four checkboxes.
  - "+ Rütbe" adds `Yeni rütbe` with color `#888888`.
- **Departments** drag among themselves below Stüdyo geneli. "+ Departman" adds one.
- **Saving:** a checkbox change calls `patchRank(teamId, id, {permissions})` at once. On failure the box reverts and an inline error shows under the card.
- **Deleting:** department and rank delete go through a confirm `GenericModal` that names the department or rank.

- [ ] **Step 1: Write the failing tests** in `team_departments_tab.test.tsx` (mock `Client4`):
  - renders Stüdyo geneli first with no delete button;
  - ticking `Task yönet` on Lead calls `patchRank` with `[...existing, 'manage_tasks']`;
  - a rejected patch unticks the box and shows the error;
  - "+ Rütbe" calls `createRank` with the department id;
  - delete asks for confirmation, then calls `deleteDepartment`;
  - the tab is hidden for a plain member (in `team_settings_modal.test.tsx`).
- [ ] **Step 2: Run them.** `npx jest src/components/team_settings src/components/team_settings_modal`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again,** plus `npm run check-types` and eslint on the changed files. Expected: PASS.
- [ ] **Step 5: Commit** "Add the Departmanlar tab to Team Settings".

### Task 8: Build, deploy, check on dopgun

- [ ] **Step 1: Run the full touched suites:**
  - `sh $G channels/app "... -run 'Department|Rank|CanActOn|Team|DailyReport|Task'"`
  - api4 `-run 'Department|MemberRanks|Actionable|CustomRoleEnforcement|Task|DailyReport|Team'`
  - sqlstore `-run 'TestDepartmentStore|TestCustomRoleStore|TestTeamStore'`
  - webapp `npx jest src/components/profile_popover src/components/tasks src/components/daily_reports src/components/team_settings src/components/team_settings_modal`

  Expected: all PASS. Record any failure outside our files by name.
- [ ] **Step 2: Build and deploy.**
  - `sh $G . "go build -o bin/mattermost.new ./cmd/mattermost"`
  - `cd webapp/channels && npm run build`
  - `docker stop dopgun-server`, `mv bin/mattermost.new bin/mattermost`, `docker start dopgun-server`
  - Check that the server log shows migration 254 applied, and that `GET /api/v4/system/ping` is OK.
- [ ] **Step 3: Check in the browser pane** (already signed in by the user; never type their password):
  - Team Settings shows Departmanlar with Stüdyo geneli.
  - Create Animasyon with Lead and Mid, and tick boxes; reload and the ticks persist.
  - The profile popover's "Edit ranks" gives a member Animasyon Mid; the chip appears.
  - Remove the test department afterwards only if the user agrees; ask in the final message.
- [ ] **Step 4: Commit** any fixes. Ledger the result.
