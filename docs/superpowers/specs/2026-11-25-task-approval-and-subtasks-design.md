# Task approval chain and subtasks — design

Ported from Dopgun (`nextdopgun-backend/app/core/projects/tasks.py`, `api/projects/tasks.py`; desktop
`TaskBoardViewModel`). The user asked to start with these two of the Dopgun task rules missing here.

## Intent
A task moved to Done is not finished until a supervisor and then a director have approved it; an approved task is
locked. Work can be broken into subtasks one level deep, and a parent cannot be finished while a subtask is open.

## Rules

### Completion
A task is **complete** when `status = done` and `approval_status = approved`. Everything that asked "is it done?"
(the waits-for lock) asks "is it complete?" instead. The migration marks every task already in Done as approved, so
nothing changes for existing data.

### Approval chain
- Team toggle `Team.TaskApprovalEnabled` (`task_approval_enabled`, Team Settings › Episodes, under the task toggles).
- `Task.ApprovalStatus` (`approval_status`): `""` | `pending_supervisor` | `pending_director` | `approved` | `rejected`.
- Entering Done: `pending_supervisor` when the team's approval is on and the task is not a revision, otherwise
  `approved` at once. Leaving Done before approval clears it. A `rejected` task is cleared when it moves again.
- `POST /api/v4/tasks/{id}/approval` `{action}`:
  - `approve`: `pending_supervisor` → `pending_director` (needs `approve_task_supervisor`); `pending_director` →
    `approved` (needs `approve_task_director`). Refused while waits-for or subtasks are not complete.
  - `reject`: from either pending stage (that stage's permission) → `rejected`, status `in_progress`.
  - `revert`: `approved` → `""`, status `in_progress` (needs `approve_task_director`); refused while the parent is
    approved.
- While the team's approval is on, an approved task is locked: patch refuses changes to status, section, assignee
  and parent (400). With approval off, done is approved on arrival and stays freely editable, as before.
- Two new team permissions, `approve_task_supervisor` and `approve_task_director`: team admins get them (role
  defaults and a permissions migration), custom roles may carry them (whitelist + role editor).

### Subtasks
- `Task.ParentId` (`parent_id`): another task of the same team. One level: a parent has no parent, a task with
  subtasks cannot become a subtask. Revisions cannot be parents or subtasks. Set on create or by patch (`""` detaches).
- A parent cannot enter Done while a subtask is not complete. While a parent is in Done its subtasks cannot leave
  Done, and no open task can be attached to it.
- Deleting a parent detaches its subtasks (they stay, with `parent_id = ""`).

### Webapp
- Board and list hide subtasks by default; a "Show subtasks" toggle shows them as ordinary cards in their own
  column (drag order stays the stored `sort_order`) with a "↳ parent" label. Parents show `done/total` subtasks.
- Task detail: a Subtasks block (progress, list, add-a-subtask input); a subtask shows a link to its parent.
- Approval: a badge on cards and in the detail (Awaiting supervisor / Awaiting director / Rejected / Approved), and
  Approve / Reject / Revert buttons in the detail for users with the stage's permission. Approved tasks cannot be
  dragged.
- The client mirrors the server's rules to explain a refusal; the server is the authority.

## Approaches
1. **Columns on `Tasks` + one approval endpoint (picked).** Mirrors Dopgun's `done_approval_status` /
   `parent_task_id`, keeps a single task row and the existing `task_upserted` websocket event.
2. Approval as separate rows (an audit table of stages) — rejected: Dopgun keeps only the current stage; history is
   in the audit log already.
3. Approval through `PatchTask` (`approval_status` in the patch) — rejected: each stage needs its own permission and
   side effects; a dedicated action endpoint keeps patch simple.

## Calls (not asked)
- Revisions are exempt from approval (they have their own review flow).
- No notifications for approval steps in this pass.
- Subtasks may sit in another section than their parent (Dopgun allows it within a project; a team is the project here).
- Deleting a parent detaches instead of cascading (Dopgun cascades; detaching loses no work).
- Hierarchy (outranking) is not applied to approvals: the permission is enough, as in Dopgun.

## Out of scope
Custom board columns, filters, priority, private tasks, reminders (later items of the Dopgun comparison).
