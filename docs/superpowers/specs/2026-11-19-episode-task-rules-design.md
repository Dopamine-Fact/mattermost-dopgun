# Episode task rules — design

Builds on: `2026-11-19-episode-template-rules-design.md` (part 1, folder rules, is built; this is its part 2, plus
task folders).

## Intent

Each new episode channel gets its default tasks from the team's task template (Team Settings › Episodes). Today the
template is a text box, one task title per line, and every seeded task is unassigned, undated and independent. The
studio works as a pipeline of departments, so the template should carry the pipeline: who does each task, by when,
what it waits for, and which drive folder its files belong in. Everything is set once, in the template; each new
episode copies it.

## Goals

- **Task panel** replacing the "Default episode tasks" text box: a list of tasks (add, reorder, delete), each with
  - **Department:** none, or one department (the task's pool).
  - **Person:** none, or one person; the picker lists the chosen department's members first, but anyone in the team
    may be picked.
  - **Deadline:** N days after the episode opens (optional, 0–365).
  - **Waits for:** other tasks of the template.
  - **Folder:** none, or one folder of the team's episode folder template.
- **Seeding:** creating an episode turns each entry into a task with its department, assignee, due date, waits-for
  and folder, in the existing one-call `CreateEpisode`.
- **Pool and claim:** a task with a department and no person is "unassigned, <department>'s"; anyone in that
  department can take it ("Take it"), which makes them the assignee.
- **Lock:** a task cannot move to In progress or Done, nor be claimed, while any task it waits for is not Done.
- **Task folder (virtual):** files attached to a task's messages are listed inside the task's drive folder, next to
  the folder's own files. They can be renamed and deleted there (the change reaches the message), not moved.

## Non-goals

- Changing a task's folder after seeding, or giving non-episode tasks a folder.
- Copying or moving attachments into the folder (rejected approaches 1 and 2 below).
- Rules reaching existing episodes; a template change affects only episodes created afterwards.
- Deadlines that move with dependencies.
- Hiding pool tasks: every team member still sees every task, as today.

## Anti-goals

- Losing today's templates: existing text lines become entries with no rules.
- A task file appearing in a folder that the person cannot see.
- A task file whose folder entry and message attachment disagree (one record, never two).
- A dependency cycle that locks tasks forever.

## Decisions (the user's)

From the part-1 conversation, still standing:

1. Department assignment = **pool**: the task belongs to the department; a member claims it.
2. Deadline = **N days after the episode opens**, fixed at creation; a late predecessor does not move it.
3. Dependency = **lock**: no In progress / Done / claim until every task it waits for is Done. Task managers
   (`manage_tasks`) override the lock. A predecessor reopened later does not push back a successor that has started.
4. Rules apply to newly created episodes only.
5. Task managers can change a task's department and waits-for on existing tasks, from the task detail.

From this conversation:

6. Assignment is picked as department **and** person (person optional; empty person = pool).
7. A task's folder is chosen **once, in the template**, not at each upload.
8. Task files appear in the folder as a **virtual listing** (approach 3): not copies, not drive items.
9. Virtual task files are **not read-only**: rename and delete work in the folder and act on the message's
   attachment itself. Moving them to another folder is not needed.
10. Scope (my recommendation, taken when the user said "continue"): department, waits-for, claim and lock apply to
    every task except revisions; the task folder exists only on seeded episode tasks.

## Approaches considered (for task files in folders)

1. **Copy into the folder when the message is sent.** Reuses `copyDriveFile`; the copy becomes a normal drive file.
   Costs double storage, and the folder copy outlives a deleted message.
2. **Drive item pointing at the attachment.** One copy of the bytes, but drive's "every item owns its bytes" rule
   breaks, and delete / trash / move each need a "which one is deleted" answer.
3. **Virtual listing (chosen).** Listing a folder adds the attachments of the posts of the tasks whose folder it is.
   No new rows and nothing to keep in sync; rename and delete act on the attachment itself, so folder and message
   always agree. A file cannot be moved to another folder (that would need a per-file record, i.e. approach 2), and
   it disappears from the folder with its message.

## How it works

### Template

`Team.EpisodeTasks` becomes a JSON list, read like `EpisodeFolders` (JSON, or else the old one-title-per-line text):

```
{key, title, department_id?, assignee_id?, due_days?, waits_for: [key], folder?: path}
```

- `key` is a client-made id, unique in the list; `waits_for` names other keys.
- `folder` is a path of the folder template, never a mirror (mirrors are read-only views of another folder).
- Validation: at most 100 entries; title rules as today; department ids belong to the team; `waits_for` names other
  entries, no duplicates, no cycles; `due_days` 0–365; `folder` names an existing non-mirror folder entry. The size
  limit moves to the folder template's (`TeamEpisodeFoldersMaxRunes`), since entries carry ids.
- Deleting a department or renaming/removing a folder in the template leaves entries pointing at nothing: the panel
  shows them as "missing" and saving clears them (the same way the folder panel handles a deleted department).

### Task model

`Task` gains:

- `department_id` — the pool; '' for none. A claimed pool task keeps it.
- `waits_for` — task ids of the same section.
- `folder_id` — the drive folder of the episode channel; '' for none. Set on create only.

`TaskPatch` gains `department_id` and `waits_for` (task managers only; decision 5). The server rejects a `waits_for`
that names a task of another section, the task itself, or makes a cycle. Deleting a task removes it from every
`waits_for`.

### Seeding (`CreateEpisode`)

- Folders are seeded first (as today), producing a map from template path to drive folder id.
- Tasks are then created in template order with department, assignee and folder id (from the map; a folder that
  failed to seed leaves `folder_id` empty).
- `due_at` = the day `due_days` after today, in the creating user's timezone, stored like every other due date (that
  day's local midnight, the webapp's date convention); no `due_days` = no due date.
- `waits_for` keys are turned into the new tasks' ids after all tasks exist (one patch per task that waits). An
  entry whose predecessor failed to seed drops that predecessor.
- A failed task is reported in `failed`, as today.

### Claim

A new action: a member of the task's department sets themselves as the assignee of an unassigned pool task. Allowed
with no other task permission; refused while the task is locked (unless `manage_tasks`). Department membership is the
same as the drive rules use (a rank of the department among the person's team roles). Assigning someone else stays
with today's task permissions.

### Lock

`PatchTask` refuses `status` → In progress / Done, and the claim refuses, while any `waits_for` task is not Done,
unless the actor has `manage_tasks`. The list and the detail show "Waiting for: Storyboard, Layout" with a lock icon;
the lock lifts as soon as the last one is Done. Moving a predecessor back from Done does not touch a successor that
has already started.

### Task files in folders

Listing a drive folder (`ListDriveFolder`, and through a mirror whose source is that folder) also returns
`task_files`: the file attachments of the posts (task conversation posts, `props.task_id`) of the tasks whose
`folder_id` is that folder, newest first, each with the task it came from.

- They are listed only if the folder is visible to the viewer (the folder rules already decide the listing).
- Open, preview, download, and copy *out* work as for chat attachments today.
- **Rename** changes the attachment's file name (`FileInfo.Name`), so the message shows the new name too.
- **Delete** removes the attachment from its message through a normal post edit (the message text stays; a message
  left with no text and no files is deleted). It does not go to the drive Recycle Bin; the post's edit history keeps
  the earlier version, from which it can be restored as any edited post.
- **Move** is refused for task files (move in or out); the explorer hides the action for them.
- **Who may rename/delete:** the folder's rules, as for its own files: with a write rule, anyone in a write
  department, any file; without one, the uploader; channel managers always.
- Deleting the message removes the file from the folder.
- The explorer shows them after the folder's own files, with a task chip that opens the task.
- Download-as-zip of the folder includes them.
- When a post with files is created, edited or deleted under a task with a folder, `drive_changed` is published for
  that folder (and its mirrors), so an open explorer refreshes.

### Panel

In place of the tasks text box, a list like the folder panel: each row has the title, and when selected the
department picker, the person picker, "days after opening", a "waits for" multi-picker of the other tasks, and a
folder picker (the folder template's own-files folders). Old text templates load as rows with only titles.

### Task UI

- List and detail show the department chip, "unassigned" for pool tasks, and the lock line.
- "Take it" button on an unassigned pool task for members of its department.
- Task managers can edit department and waits-for in the detail.
- The detail shows the task's folder as a link that opens it in the channel's Files tab.

## Constraints

- Run `make i18n-extract` after editing `i18n/en.json` (server/AGENTS.md); every new string gets a `description`.
- Store methods take `request.CTX`, not `context.Context`.
- A new migration adds the task columns (after `000260`).

## Left to the builder

- Storage of `waits_for` (a column holding a JSON id list, or a side table).
- The SQL behind `task_files` (posts by `props.task_id` joined to file infos, or via the existing task-posts query).
- Panel layout, icons, copy, i18n ids.
- How the client places task files in the explorer's existing file grid and sort.

## Calls I made (check these)

- A task folder must be an own-files folder, not a mirror.
- Task files are listed in the folder only, not in its subfolders, and not in the folder's mirrors' subfolders.
- A task file shows in the folder even if its uploader is not in the folder's write departments (it is the task's
  folder, chosen in the template); it is still only visible to people who see the folder.
- Deleting a task file from the folder skips the Recycle Bin; recovery is through the post's edit history.
- The person picker allows anyone in the team, with the chosen department's members first.
- A task with a person but no department is an ordinary assigned task (no pool).
- Folder is not editable after seeding (non-goal); department and waits-for are (decision 5).
- **Lock gates starting only.** The check applies to a task in To do: moving it to In progress or Done, or claiming
  it. A task already In progress or Done is never locked, so a reopened predecessor does not block a started
  successor from finishing (decision 3).
- **Lock override** uses the permission that already lets the actor change that task's status for others
  (`manage_tasks`; `manage_revisions` for revisions).
- **Which files count:** every post in the folder's channel whose `props.task_id` is a task with that `folder_id`,
  replies included (they inherit `task_id`). Only posts in the folder's own channel count, so a task moved to another
  section keeps showing its old episode files in the old folder and nothing from elsewhere; the viewer already reads
  that channel to list its drive, so no private file leaks.
- **Moving a task to another section** drops its `waits_for` links in both directions.
- **Seeding and ranks:** the template stands in for the assignment rank check (`CanActOnUser`); the template was set
  by someone allowed to edit team settings. Each seeded assignee gets the usual assignment DM from the system bot
  (not when the episode creator is the assignee).
