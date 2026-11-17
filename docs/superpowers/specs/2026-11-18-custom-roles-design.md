# Custom roles (Discord-like) — design

## Intent
The studio needs to control who can do what beyond "team admin or not": who sees which channels, who can write in them, who can assign tasks to whom, who manages daily reports, who adds revisions. Today one permission (`manage_team_tasks`, held only by team/system admins) gates tasks, daily reports and revisions together, and channel rights are the same for every member of a channel. Freelancers must be able to read some channels without writing in them.

## Goals
- Admins create any number of roles: name, color, position in one ordered list, optional department.
- A user can hold several roles; their rights are the union of their roles.
- Roles carry general permissions: manage tasks, manage daily reports, add revisions, assign roles.
- Hierarchy: acting on another person (assigning a task, approving/rejecting their daily report, giving/removing their roles) needs the permission **and** an outranking role in the same department (rules below).
- Per channel: a default setting plus per-role settings for view / post / upload files / react.
- Name color in the UI (phase 3).

## Non-goals
- Explicit "deny" overrides (see channel rules: a role setting replaces the default instead).
- Per-channel settings for anything beyond view / post / upload / react.
- Delegating role *definition* (create/edit/reorder roles, channel role settings) to non-admins: system admins only.
- Custom roles on guest accounts. Freelancers use normal accounts with a Freelance role (decided). Guests are never added to role-managed channels and are removed by the sync if present, because the guest flag grants posting through `channel_guest` and cannot be overridden by `crch_*` roles.
- Mobile app UI for managing roles (mobile still honors the permissions; see Approach).

## Anti-goals
- A freelancer who can write in a channel set to "view only" for them, in any client.
- Permissions drifting: a user keeping access after losing a role, or a channel showing a member who should not see it.
- Breaking today's behavior for teams that define no roles: team/system admins keep every right they have now.

## Approaches
1. **Build on Mattermost's own role engine (picked).** Role metadata and channel settings live in new tables; every change is translated into native role strings (`Users.Roles`, `ChannelMembers` roles) and channel memberships. All existing server checks, the webapp's permission-driven UI, mobile and websocket events keep working because they read native roles. Cost: the sync must be correct on every change and needs thorough tests.
2. **Separate permission engine evaluated at check time.** No sync, but the webapp and mobile compute rights from native roles, so the UI would be wrong (freelancer sees the post box, gets an error on send); every client-side permission check would need rewriting, and mobile is not ours. Rejected.
3. **Custom User Groups as roles.** Groups carry no permissions; all of approach 1's work would still be needed. Rejected.

## Rules

### Hierarchy
One ordered list of roles. Role A **outranks** role B when A is above B in the list **and** (A has no department, or B has no department, or A and B have the same department). *(Builder-check call: "B has no department" was added so a Lead Animator can act on a department-less Freelance.)*

An actor may act on a target when the actor holds the needed permission and:
- the actor is a system admin or a team admin of the team concerned (admins bypass the hierarchy, keeping today's behavior), or
- the target is the actor (self-assigning a task), or
- one of the actor's roles outranks **every** role of the target, or
- the target has no custom role and the actor has at least one custom role.

*(Call: "every role", not "some role", so holding Lead + Intern cannot be used to let people below Lead act on someone.)* Peers (same role, or neither outranks the other) cannot act on each other.

Applies to: setting/changing a task's assignee to someone else; approving/rejecting a daily report; seeing/exporting someone else's daily reports; giving or removing a role (the actor must also outrank the *role* being given/removed, by the same rule applied role-to-role).

### Channel settings
A channel is **role-managed** once a system admin saves role settings for it. It has:
- a **default** level: none / view / view+post / view+post+upload / ... (four flags: view, post, upload, react; post/upload/react imply view),
- zero or more **per-role** settings with the same four flags.

A user's effective flags in a role-managed channel:
- if any of the user's roles has a setting in this channel → union of those roles' settings only (the default does not apply),
- else → the default.

Example: #review default = view+post, Freelance = view. A Freelance user reads only. A Freelance+Animator user also reads only, unless Animator gets its own setting there.

If the default or any per-role setting lacks *view*, the channel must be private: non-members read public channels through the team permission `read_public_channel` (`app/authorization.go:471`). Saving such settings on a public channel converts it to private, with a confirmation in the UI. The team's default channel (Town Square) cannot be role-managed (it cannot be private and non-guests cannot be removed from it). A channel cannot be both role-managed and group-constrained / access-policy controlled.

Membership in a role-managed channel is fully role-driven: team members with view are added, others removed; manual add/remove/leave is refused. Bots are exempt (never added or removed by the sync). Channel admins (`SchemeAdmin`) can still be promoted/demoted; the admin flag is kept and the member's flags are recomputed right after, so promotion never grants posting. System admins are exempt.

**Everything that writes into or reads from the channel follows its flags**, not just posts: for a revision channel, the Revisions tab, revision tasks and the video need *view*, and task comments (which post into the channel as the commenter, `app/task.go:474`) need *post*.

## Design

### Data
- **Native roles.** Each custom role is a row in `Roles`: `Name = "cr_" + <id>`, scope System, `BuiltIn = false`, `SchemeManaged = false`; its `Permissions` hold the role's general permissions. Allowed permissions are a fixed whitelist (the new task/report/revision/role permissions below); channel-level permissions like `create_post` are rejected so a global role can never grant posting everywhere.
- **New table `CustomRoles`**: `Id`, `RoleName` (→ `Roles.Name`), `DisplayName`, `Color` (`#rrggbb`), `Position` (int, lower = higher rank), `Department` (varchar, '' = none), `CreateAt`, `UpdateAt`, `DeleteAt`.
- **Assignment**: the role name is appended to `Users.Roles` (`system_user cr_abc… cr_def…`). No extra table; existing user-by-role queries work. `Users.Roles` is capped at 256 characters (`model/user.go:66`), about 7 custom roles; a migration widens it to 1024 and the model limit follows. The server keeps a user's `cr_*` roles when the System Console "Manage roles" modal rewrites the roles string (it rebuilds it from scratch today).
- **New table `ChannelRoleSettings`**: `ChannelId`, `CustomRoleId` ('' = channel default), `Flags` (int bitmask: view=1, post=2, upload=4, react=8), primary key `(ChannelId, CustomRoleId)`. A channel is role-managed when it has a default row.
- **Eight fixed native channel roles** for the flag combinations of post/upload/react (view is membership itself): `crch_` + flags, e.g. `crch_0` (read only), `crch_2` (post), `crch_14` (post+upload+react). Created by a migration, channel scope. Permission sets:
  - always: the read-side permissions of `channel_user` (`read_channel`, `read_channel_content`, read bookmarks, …),
  - post: `create_post`, `edit_post`, `delete_post` (own), `use_channel_mentions`, `use_group_mentions`,
  - upload: `upload_file`,
  - react: `add_reaction`, `remove_reaction`.
  Channel-management rights `channel_user` has today (rename, edit header, archive, manage members, manage bookmarks) are **not** given to members of role-managed channels; channel admins keep them through `channel_admin`.
- In a role-managed channel every non-admin member has `SchemeUser = false` and `ExplicitRoles = crch_<flags>`, so the existing permission checks give the right answer with no change. The existing update paths refuse `SchemeUser = false` (`app/channel.go:1536`, `:1559`) and `addUserToChannel` always sets `SchemeUser = true` (`app/channel.go:1927`), so the sync uses an internal path (like the import path's `allowSchemeUserUnset`) that creates/updates the member with the final roles in one write — never a moment with `channel_user`.

### Permissions
`manage_team_tasks` is split into team-scoped permissions:
- `manage_tasks` — create/edit/delete tasks and non-revision sections, assign tasks (assignee subject to hierarchy)
- `manage_daily_reports` — see/export others' reports and approve/reject them (both limited to people the actor may act on), edit the assignee list
- `manage_revisions` — create/patch/delete revision sections and revision channels, upload/replace the video, create/edit/delete/assign revision tasks (assignee subject to hierarchy). A task in a section with `ChannelId` set is a revision task and needs this permission, not `manage_tasks`.

and one system-scoped permission:
- `assign_custom_roles` — give/remove roles (hierarchy). System-scoped because roles are global and the endpoint has no team; granted to `system_admin` only by the migration, assignable to custom roles. Team admins do not get it (they cannot assign roles today either).

A permissions migration grants the three team permissions to `team_admin` and `system_admin` (whoever has `manage_team_tasks` today) and removes `manage_team_tasks`. Because custom roles are system-scoped, `SessionHasPermissionToTeam` already honors them in every team.

### Sync
One app function recomputes `(user, channel)` → membership + `ExplicitRoles`. Called:
- user's roles change → all role-managed channels in the user's teams,
- channel settings change → all members of that channel's team,
- role deleted → strip it from users, then as above,
- user joins a team → role-managed channels of that team.
Each run is idempotent; a full resync of one channel is exposed as an admin action for recovery. Changes go through the existing add/remove-member and update-member-roles paths so websocket events and caches are handled.

### Hierarchy checks
New `App.CanActOnUser(actorID, targetID, teamID)` (team needed for the team-admin bypass) and `App.CanAssignRole(actorID, roleID)` implementing the rules above, called from the task and revision assignee paths, daily report list/export/approve/reject, and role assignment endpoints.

### API
- `GET/POST /custom_roles`, `PATCH/DELETE /custom_roles/{id}`, `PUT /custom_roles/order` — system admin (GET: any logged-in user, needed for colors).
- `PUT /users/{id}/custom_roles` `{role_ids}` — `assign_custom_roles` + hierarchy per added/removed role.
- `GET/PUT /channels/{id}/role_settings` — system admin; `POST /channels/{id}/role_settings/resync` — system admin.

### Webapp
- System Console → User Management → **Roles**: draggable list (name, color dot, department, member count); create/edit form with color, department (free text with suggestions from existing departments) and permission checkboxes.
- User's roles: chips in the profile popover; an edit control there for users with `assign_custom_roles` (only roles they may give are selectable).
- Channel settings modal → **Roles** tab (system admins): default level + a row per role with the four checkboxes; public→private warning.
- Existing UI gated on `manage_team_tasks` switches to the matching new permission.
- Phase 3: display-name color from the user's highest role in posts, member lists and mentions.

## Phases
1. Roles, permission split, hierarchy, department, System Console Roles page, assigning roles.
2. Channel settings, the eight channel roles, sync, channel Roles tab.
3. Name colors.

## Left to the builder
Exact migration numbers; how `SchemeAdmin` members interact with `SchemeUser = false` in every member-listing query; UI copy; batching the sync for large teams.
