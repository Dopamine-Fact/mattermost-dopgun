# Custom roles — Phase 1 (roles, permissions, hierarchy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-defined roles (name, color, position, department, permissions) assigned to users, `manage_team_tasks` split into task / daily report / revision permissions, and the outrank hierarchy enforced on task assignment, daily reports and role assignment.

**Architecture:** Each custom role is a native `Roles` row named `cr_<id>` (system scope) plus a `CustomRoles` metadata row; assignment appends the name to `Users.Roles`, so existing permission checks and the webapp's permission selectors honor it unchanged. Hierarchy lives in one app file (`custom_role_hierarchy.go`) used by the task, daily report and role-assignment handlers. Channel settings (phase 2) and name colors (phase 3) get their own plans.

**Tech Stack:** Go (Postgres, squirrel), React/TS, Jest, `@hello-pangea/dnd` 18.0.1, `GenericModal`.

**Spec:** `docs/superpowers/specs/2026-11-18-custom-roles-design.md` — read the Rules, Data, Permissions and Hierarchy sections first; this plan does not repeat them.

## Global Constraints

- Follow the daily reports feature as the template for every wiring point (model → migration → store → app → api4 → Go client → webapp; see `docs/superpowers/plans/2026-11-17-daily-reports-v2.md`).
- Go runs in docker `golang:1.26.10`, test DB container `mattermost-postgres` (55433, mmuser/mostest_password), same as earlier plans. Never `go mod tidy`; use `make modules-tidy`.
- Store methods take `request.CTX` where they need context, never `context.Context`. Regenerate layers/mocks with `make store-layers store-mocks` (from `server/`), never by hand.
- After editing `server/i18n/en.json` run `make i18n-extract`; if its diff deletes ids that are not ours, restore those and keep only our additions. Fill every new `description`. Strings in en + tr (server and webapp).
- Migration number `000253`, postgres only, add both files to `server/channels/db/migrations/migrations.list`.
- Native role name `"cr_" + CustomRole.Id`. Color `^#[0-9a-f]{6}$` (lowercase). DisplayName 1–64 runes, unique among live roles case-insensitively. Department 0–64 runes, trimmed. Position: lower = higher rank, contiguous from 0.
- Whitelist of permissions a custom role may carry: `manage_tasks`, `manage_daily_reports`, `manage_revisions`, `assign_custom_roles`. Anything else → 400.
- Custom roles are never given to guests or bots (400).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Upgrade of an existing server: team admins and system admins must still manage tasks, revisions and daily reports right after the migration, and `PatchRole` on an old `team_admin` row still containing `manage_team_tasks` must not fail validation (it moves to `DeprecatedPermissions`).
- The System Console "Manage roles" modal saves `system_user system_admin` for someone holding `cr_x`: `cr_x` must survive (Task 3 test `TestUpdateUserRolesKeepsCustomRoles`).
- Deleting a role that users hold: their `Users.Roles` and active sessions lose `cr_<id>` immediately, and positions of the remaining roles stay contiguous (Task 3 test `TestDeleteCustomRoleStripsUsers`).
- A Lead tries to raise someone to Lead or above, or give a role to a peer: 403 (Task 3 `TestCanAssignRole`, Task 5 api test).
- A user with eight roles: `Users.Roles` and `Sessions.Roles` hold them (column widened to 1024; Task 2 store test).

---

### Task 1: Split `manage_team_tasks`

**Files:** `server/public/model/permission.go`, `server/public/model/role.go`, `server/public/model/migration.go`, `server/channels/app/permissions_migrations.go` (+ `_test.go`), `server/channels/api4/task.go`, `server/channels/api4/daily_report.go` (+ their `_test.go`), webapp `packages/mattermost-redux/src/constants/permissions.ts`, `utils/constants.tsx`, `components/admin_console/permission_schemes_settings/permissions_tree/permissions_tree.tsx`, `.../strings/permissions.tsx`, `components/tasks/{tasks.tsx,revision_tabs.tsx,task_utils.ts}`, `components/daily_reports/daily_reports.tsx`, `components/sidebar/sidebar_header/sidebar_browse_or_add_channel_menu.tsx`, i18n files.

**Produces:**
- `model.PermissionManageTasks` (`manage_tasks`), `PermissionManageDailyReports` (`manage_daily_reports`), `PermissionManageRevisions` (`manage_revisions`), all `PermissionScopeTeam`; `PermissionAssignCustomRoles` (`assign_custom_roles`, `PermissionScopeSystem`). All in `AllPermissions`; `PermissionManageTeamTasks` moves to `DeprecatedPermissions`.
- `team_admin` defaults carry the three team permissions instead of `manage_team_tasks`.
- `MigrationKeySplitManageTeamTasksPermission = "split_manage_team_tasks_permission"`: on roles having `manage_team_tasks` → add the three team permissions, remove `manage_team_tasks`; on `system_admin` → add `assign_custom_roles`.
- api4 helper `requireTeamPermission(c *Context, teamID string, p *model.Permission)` replaces `requireManageTasks`. A task or section is a revision when its section has `ChannelId != ""`: those paths require `manage_revisions`, others `manage_tasks`. Daily report paths require `manage_daily_reports`.
- Webapp constants `MANAGE_TASKS`, `MANAGE_DAILY_REPORTS`, `MANAGE_REVISIONS`, `ASSIGN_CUSTOM_ROLES`; each component checks the matching one (`tasks.tsx` → tasks, `revision_tabs.tsx` and the "Create revision channel" menu → revisions, `daily_reports.tsx` → daily reports).

- [ ] Tests (server): `TestSplitManageTeamTasksMigration` (role with old perm gets the three, loses old; system_admin gets `assign_custom_roles`; role without old perm untouched); api: user whose team role has only `manage_tasks` → create task 201, create revision section 403, approve report 403; only `manage_revisions` → revision section 201, plain task 403; only `manage_daily_reports` → approve 200, other users' reports listed.
- [ ] Run them → FAIL. Implement. Update existing tests that reference `manage_team_tasks`. Run `go test ./public/model ./channels/app -run 'Permission|Migration' ` and `go test ./channels/api4 -run 'Task|DailyReport'` → PASS.
- [ ] Webapp: update component tests that mock `MANAGE_TEAM_TASKS`; `npm run check-types` and `npm test -- tasks daily_reports sidebar_browse_or_add_channel_menu permissions_tree` in `webapp/channels` → PASS. Commit.

### Task 2: Model, migration, store

**Files:** create `server/public/model/custom_role.go` (+ `_test.go`), `server/channels/db/migrations/postgres/000253_custom_roles.{up,down}.sql`, `server/channels/store/sqlstore/custom_role_store.go`, `server/channels/store/storetest/custom_role_store.go`, `server/channels/store/sqlstore/custom_role_store_test.go`; modify `migrations.list`, `server/channels/store/store.go`, `sqlstore/store.go`, `storetest/store.go`, `server/public/model/user.go` (`UserRolesMaxLength = 1024`); regenerate layers + mocks.

**Produces:**
- `model.CustomRole{Id, RoleName, DisplayName, Color, Position int, Department string, Permissions []string json:"permissions" db:"-", CreateAt, UpdateAt, DeleteAt int64}` (json snake_case). `Permissions` is filled by the app from the native role.
- `(r *CustomRole) PreSave()`, `IsValid() *model.AppError` (constraints above), `CustomRoleNamePrefix = "cr_"`, `CustomRoleNameFromId(id string) string`, `IsCustomRoleName(name string) bool`, `CustomRoleIdsFromRoles(roles string) []string`, `CustomRolePermissionWhitelist []string`.
- `CustomRolePatch{DisplayName, Color, Department *string; Permissions *[]string}`.
- Migration: `CREATE TABLE IF NOT EXISTS CustomRoles (Id VARCHAR(26) PRIMARY KEY, RoleName VARCHAR(64) NOT NULL, DisplayName VARCHAR(64) NOT NULL, Color VARCHAR(7) NOT NULL, Position integer NOT NULL, Department VARCHAR(64) NOT NULL DEFAULT '', CreateAt bigint, UpdateAt bigint, DeleteAt bigint NOT NULL DEFAULT 0)`; `ALTER TABLE users ALTER COLUMN roles TYPE VARCHAR(1024)`; same for `sessions.roles`. Down reverses (shrinking only if no row exceeds 256, else leave it).
- `CustomRoleStore`: `Save(r) (*CustomRole, error)`, `Update(r) (*CustomRole, error)`, `Get(id) (*CustomRole, error)`, `GetAll() ([]*CustomRole, error)` (live, ordered by Position), `Delete(id string, at int64) error` (soft), `SetPositions(orderedIDs []string, at int64) error` (one transaction; ids must equal the live set, else `ErrInvalidInput`).
- `UserStore.RemoveRoleFromAll(roleName string) ([]string, error)` returning affected user ids (`regexp_replace` on whole-word match, then trim).

- [ ] Model test: color `#FFF` invalid, `#ff00aa` valid; display name 65 runes invalid; `CustomRoleIdsFromRoles("system_user cr_abc cr_def")` → `[abc def]`.
- [ ] Storetests: `testCustomRoleSaveGetAll` (ordered by Position, deleted hidden), `testCustomRoleSetPositions` (reorder; missing id → `*store.ErrInvalidInput`), `testUserRolesLong` (user saved with 900-char roles reads back intact), `testRemoveRoleFromAll` (`cr_a` removed from `system_user cr_a cr_ab`, leaving `system_user cr_ab`).
- [ ] Implement, `make store-layers store-mocks`, `go test ./public/model -run CustomRole` and `go test ./channels/store/sqlstore -run 'CustomRole|UserStore'` → PASS. Commit.

### Task 3: App — role CRUD, assignment, hierarchy

**Files:** create `server/channels/app/custom_role.go`, `server/channels/app/custom_role_hierarchy.go` (+ `_test.go` each); modify `server/channels/app/user.go` (`UpdateUserRolesWithUser`), `server/i18n/en.json`, `tr.json`.

**Consumes:** Task 1 permissions, Task 2 store. **Produces:**
- `(a *App) GetCustomRoles() ([]*model.CustomRole, *model.AppError)` (Permissions filled from native roles).
- `(a *App) CreateCustomRole(rctx, r *model.CustomRole) (*model.CustomRole, *model.AppError)` — Position = end of list; creates the native role (`Name = RoleName`, `DisplayName`, scope `model.RoleScopeSystem`, `BuiltIn=false`, `SchemeManaged=false`) via the role store then the metadata row; rejects non-whitelisted permissions (400 `app.custom_role.permission_not_allowed.app_error`) and duplicate names (400 `app.custom_role.name_taken.app_error`).
- `(a *App) PatchCustomRole(rctx, id string, p *model.CustomRolePatch) (*model.CustomRole, *model.AppError)` — permissions go to the native role through the existing role patch path (cache invalidation + `role_updated` websocket event).
- `(a *App) ReorderCustomRoles(rctx, orderedIDs []string) ([]*model.CustomRole, *model.AppError)`.
- `(a *App) DeleteCustomRole(rctx, id string) *model.AppError` — soft-deletes both rows, `RemoveRoleFromAll`, updates sessions roles and sends `user_role_updated` to each affected user, re-compacts positions.
- `(a *App) SetUserCustomRoles(rctx, actorID, userID string, roleIDs []string) (*model.User, *model.AppError)` — target must not be guest/bot (400); for every added or removed role `CanAssignRole(actorID, roleID)` and `CanActOnUser(actorID, userID, "")` must hold (403 `app.custom_role.not_outranked.app_error`); keeps the user's non-`cr_` roles; goes through `UpdateUserRolesWithUser`.
- `UpdateUserRolesWithUser`: if `newRoles` has no `cr_` names, re-appends the user's current `cr_` names (so the Manage roles modal can't drop them); `SetUserCustomRoles` passes the full string and is unaffected.
- `(a *App) CanActOnUser(actorID, targetID, teamID string) bool` and `(a *App) CanAssignRole(actorID, roleID string) bool` — the spec's Hierarchy rules exactly (system admin; team admin of `teamID` when `teamID != ""`; self; outranks **every** target role; target without custom roles and actor with ≥1). Pure core `outranks(a, b *model.CustomRole) bool` and `canActOn(actor, target []*model.CustomRole) bool` so tests need no DB.
- `(a *App) ActionableUserIDs(actorID, teamID string, candidates []string) []string` — filter used by daily reports and the assignee picker.

- [ ] Unit tests on the pure core with this list (Position order): `Producer()`, `LeadAnim[Anim]`, `LeadProg[Prog]`, `Anim[Anim]`, `Prog[Prog]`, `Freelance()`:
  - LeadAnim → Anim ✓, → Prog ✗, → Freelance ✓, → LeadProg ✗, → LeadAnim ✗ (peer)
  - Producer → everyone below ✓; Anim → LeadAnim ✗
  - target {Anim, Prog}: LeadAnim ✗, Producer ✓ (every-role rule)
  - target {} : any actor with a role ✓, actor {} ✗
- [ ] App tests: `TestCreateCustomRole` (native role exists with the permissions; `create_post` → 400; duplicate name differing only by case → 400); `TestCustomRoleGrantsTeamPermission` (user with a role holding `manage_tasks` passes `SessionHasPermissionToTeam` in any team); `TestDeleteCustomRoleStripsUsers`; `TestUpdateUserRolesKeepsCustomRoles`; `TestCanAssignRole` (LeadAnim with `assign_custom_roles` gives Anim ✓, gives LeadAnim ✗, gives Prog ✗, removes Anim from a LeadProg holder ✗); `TestSetUserCustomRolesGuest` (400); team admin bypass (team admin without roles → `CanActOnUser` ✓ in that team, ✗ with another team id).
- [ ] Implement, i18n, run `go test ./channels/app -run 'CustomRole|CanActOn|CanAssignRole|UpdateUserRoles'` → PASS. Commit.

### Task 4: Enforce hierarchy on tasks and daily reports

**Files:** `server/channels/api4/task.go`, `server/channels/api4/daily_report.go` (+ `_test.go`), `server/channels/app/daily_report.go` (export/list filtering if done in app).

**Consumes:** `CanActOnUser`, `ActionableUserIDs`.

- [ ] Tests (api4): LeadAnim (role with `manage_tasks`, `manage_revisions`, `manage_daily_reports`) — create task with assignee Anim 201, with assignee Prog 403, with assignee self 201; patch assignee to LeadProg 403; same for a revision task; approve/reject Anim's report 200, Prog's 403; `GET /daily_reports` without `user_id` returns own + Anim reports, no Prog reports; `user_id=<Prog>` → 403; export CSV contains no Prog rows. Team admin without roles keeps every action (200/201).
- [ ] Implement: assignee check when `task.AssigneeId != ""` on create and when the patch changes it (403 `api.task.assignee_not_outranked.app_error`); `loadReviewableReport` checks `CanActOnUser(session user, report.UserId, report.TeamId)`; `dailyReportFilter` returns 403 for a `user_id` the actor cannot act on (unless self) and, when empty, list/export results are filtered with `ActionableUserIDs` plus self.
- [ ] Run `go test ./channels/api4 -run 'Task|DailyReport'` → PASS. Commit.

### Task 5: API and Go client

**Files:** create `server/channels/api4/custom_role.go` (+ `_test.go`), `server/public/model/client4_custom_role.go`; modify `server/channels/api4/api.go` (routes init), `server/public/model/audit_events.go`, `server/public/model/websocket_message.go` (`WebsocketEventCustomRolesChanged = "custom_roles_changed"`), i18n.

**Produces (routes):**
- `GET /custom_roles` — any session; `POST /custom_roles`, `PATCH /custom_roles/{custom_role_id}`, `DELETE /custom_roles/{custom_role_id}`, `PUT /custom_roles/order` `{ids}` — `manage_system`. Each write broadcasts `custom_roles_changed`.
- `PUT /users/{user_id}/custom_roles` `{role_ids}` — `assign_custom_roles` (system scope) + `SetUserCustomRoles`.
- `GET /teams/{team_id}/custom_roles/actionable_users` → `[]string` user ids in the team the caller may act on (for the assignee picker).
- Client4: `GetCustomRoles`, `CreateCustomRole`, `PatchCustomRole`, `DeleteCustomRole`, `ReorderCustomRoles`, `SetUserCustomRoles`, `GetActionableUserIds`.

- [ ] Tests: system admin CRUD + reorder round trip; regular user POST → 403; LeadAnim (with `assign_custom_roles`) PUT roles on Anim user adding `Anim` → 200, adding `LeadAnim` → 403, on a Prog user → 403; actionable users for LeadAnim in team = {self, Anim users, role-less users}.
- [ ] Implement with audit records like `task.go`; run `go test ./channels/api4 -run CustomRole` → PASS. Commit.

### Task 6: Webapp — System Console Roles page

**Files:** create `webapp/platform/types/src/custom_roles.ts`, `webapp/channels/src/components/admin_console/custom_roles/{custom_roles.tsx,custom_role_modal.tsx,custom_roles.scss,custom_roles.test.tsx}`; modify `webapp/platform/client/src/client4.ts`, `webapp/channels/src/components/admin_console/admin_definition.tsx` (new `custom_roles` entry under User Management next to `system_users`, system admin only), i18n en/tr.

**Produces:** `CustomRole` TS type mirroring the Go JSON; Client4 methods named as in Task 5 (camelCase).

- [ ] Jest: list renders roles in position order with color dot, department and member count; dragging row 3 above row 1 calls `reorderCustomRoles` with the new id order; modal validates color format and empty name, shows the four whitelisted permissions as checkboxes and sends only checked ones; delete asks for confirmation naming the member count.
- [ ] Implement (list with `@hello-pangea/dnd`, `GenericModal` form; department input with a datalist of existing departments; member count via the existing user search with role filter `cr_<id>`). Refetch on `custom_roles_changed`.
- [ ] `npm run check-types`, `npm test -- custom_roles` → PASS. Commit.

### Task 7: Webapp — user roles in the profile popover, assignee picker

**Files:** create `webapp/channels/src/components/profile_popover/profile_popover_custom_roles.tsx` (+ `.test.tsx`), `.../custom_roles_edit_modal.tsx`; modify `profile_popover.tsx`, the task assignee selector in `components/tasks/`, i18n en/tr.

- [ ] Jest: popover shows a chip per `cr_` role in the user's `roles` (name + color), ordered by position, nothing when none; "Edit roles" visible only with `ASSIGN_CUSTOM_ROLES` (system permission); modal lists only roles the viewer may give (roles below the viewer's best role by the outrank rule; all for system admins) and saves via `setUserCustomRoles`; assignee picker in a task shows only ids from `getActionableUserIds` (self always included).
- [ ] Implement; custom roles list loaded once per session and refreshed on `custom_roles_changed`.
- [ ] `npm run check-types`, `npm test -- profile_popover tasks` → PASS. Commit.

### Task 8: End-to-end check on the running server

- [ ] Rebuild server + webapp, deploy to the local container the way the previous features were deployed.
- [ ] In the browser: create Producer / Lead Animator[Animasyon] / Animator[Animasyon] / Programmer[Yazılım] roles, give them to three test users, log in as Lead Animator and confirm: Animator appears in the assignee picker, Programmer does not; Programmer's daily report is not listed; "Edit roles" offers only Animator. Log in as a team admin without roles: everything as before.
- [ ] Fix what fails (each fix gets a test in the owning task's file), commit.
