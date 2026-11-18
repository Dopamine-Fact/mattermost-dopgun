# Episode template rules — design

## Intent

Each new episode channel gets default folders and tasks from the team's templates (Team Settings › Episodes). Today a
template is plain text: one folder path or one task title per line. The studio works as a pipeline of departments
(Background hands layouts to Animation, Storyboard must finish before Animatic), so the templates should carry the
pipeline's rules too, set by hand in a panel:

- which departments see a folder, and which may change its contents;
- a folder that shows another folder's contents read-only (Animasyon/Layout shows Background/Layout: Animation can
  open and download the layouts, never change them; "if something is missing, the Background team handles it");
- a default task assigned to a department (anyone in it can pick it up) or to a person;
- a task's deadline;
- tasks that cannot start before others are done.

## Goals

- **Folder panel** replacing the "Default episode folders" text box in Team Settings › Episodes: a tree of folders,
  each with three settings:
  - **Who sees it:** everyone, or chosen departments.
  - **Who may change its contents:** chosen departments among those who see it, or nobody (visible, read-only).
  - **Contents:** its own files, or **mirrors** another folder of the same episode (live, read-only: never a copy).
- **Task panel** replacing the "Default episode tasks" text box: a list of tasks, each with:
  - **Assignee:** nobody, a department (department pool), or a person.
  - **Deadline:** N days after the episode opens (optional).
  - **Waits for:** other tasks of the template.
- Creating an episode applies the template in **one server call**, rules included.
- The server enforces the folder rules in the drive (explorer and drive API) and the task lock in task updates.

## Non-goals

- Rules reaching existing episodes. A template change affects only episodes created afterwards; each new episode's
  folders and tasks carry a copy of the rules.
- Editing a folder's rules inside an episode after it is created (a later phase, if wanted).
- Hiding files at the Mattermost file layer (approach A below). A channel member holding a file's link, or channel file
  search, can still reach a file in a folder they cannot see.
- Mirrors across episodes or channels.
- Deadlines that move with dependencies.

## Anti-goals

- A half-created episode whose folders exist without their rules (anyone could see or fill a restricted folder).
- A mirror that can be written through: changing the mirror would change the source owned by another department.
- A folder nobody can open: channel managers always see and change everything.
- Losing today's templates: existing text templates become rule-less entries automatically.

## Decisions (the user's)

1. Mirror = live, read-only view of another folder of the same episode; visible only to the departments it names.
2. Folder visibility and write access are configurable per folder, set by hand in a panel in Team Settings › Episodes,
   where the default folders setting is now.
3. Rules apply to newly created episodes only.
4. Department assignment = **pool**: the task belongs to the department; anyone in it sees it as "unassigned, your
   department's" and claims it, which makes them the assignee.
5. Deadline = **N days after the episode opens**, fixed at creation; a late predecessor does not move it.
6. Dependency = **lock**: a task cannot move to In progress or Done, nor be claimed, until every task it waits for is
   Done. Task managers (`manage_tasks`) can override the lock. A predecessor reopened later does not push back a
   successor that already started.
7. Enforcement level = **drive level** (approach B).
8. Order: folder rules first (part 1), task rules second (part 2); each ships on its own.
9. A write rule makes the folder the department's: anyone in a write department may change **any** item in it
   (rename, move, delete, restore), whoever uploaded it. Where no write rule applies, today's own-items rule stays.
10. Task managers can change a task's department and its "waits for" list on existing tasks, from the task detail.

## Approaches considered

- **A. Full enforcement** — folder rules also guard Mattermost's file download, preview and channel file search.
  Real secrecy, but changes core file permissions (largest, riskiest, merge conflicts with upstream).
- **B. Drive-level enforcement (chosen)** — rules are enforced by the server in the drive API: listing, upload, create,
  rename, move, copy, delete, restore, download-as-zip, trash. The goal is order between departments, not secrecy. A
  can be layered on B later.
- **C. UI-only** — rules stored, enforced only in the explorer. Rejected: anyone could bypass with the API, and the
  anti-goal "nobody else breaks my folder" would not hold.

Also chosen (my call, reasoned with the user): the server seeds episodes instead of the browser, because seeding rules,
departments and dependencies over many client calls can stop half-way.

## How it works

### Department membership

A person is in department D when their team member roles hold a rank of D (team departments design). A person can be
in several departments. Folder rules list department ids.

### Part 1 — folders

**Template.** The team's episode folder template becomes structured data: a list of entries
`{path, view_departments[], write_departments[] | "none", mirror_of: path?}`. An empty `view_departments` means
everyone; `write_departments` defaults to the view list (everyone who sees it may change it, today's behavior).
Today's text lines convert to entries without rules. Validation keeps today's limits (100 folders, valid names), plus:
`write_departments` ⊆ `view_departments` (when restricted); `mirror_of` names another entry of the template, not itself,
not a mirror, not one of its own ancestors or descendants; a mirror has no write departments and no subfolders.

**Seeding.** A new endpoint creates the episode (channel, task section, folders, tasks) from the template in one call;
the client's `createEpisode` action calls it instead of creating folders and tasks itself. Folders get their rules at
creation.

**Stored rules.** A drive folder keeps its own view and write department lists and its mirror source (folder id).
Files and folders created inside a folder have no rules of their own; they follow their folder.

**Effective access**, for a person in a channel they can read (today's checks still come first):

- Channel managers (`manage_channel_roles`, today's bypass in `DriveCan`) see and change everything.
- A folder is **visible** when every folder on its path, itself included, is visible to them: each either has no view
  list, or lists one of their departments.
- Contents of a visible folder may be **changed** (upload, create, rename, move in or out, delete, restore) when the
  nearest folder on the path with a write rule allows one of their departments; they may then change any item there,
  not only their own (decision 9). The channel's upload permission is still required. No write rule anywhere means
  today's rules (upload permission, own items).
- A **mirror** lists its source's contents. Opening, previewing, downloading and copying them *out* is allowed to
  anyone who sees the mirror, even without seeing the source. Nothing can be written into a mirror or changed through
  it. A deleted source leaves the mirror empty with a note.
- The channel root, Chat attachments and items outside any restricted folder behave as today.
- The Recycle Bin lists an item only to people who could see it where it was.

**Live updates.** `drive_changed` for a source folder also names its mirrors, so an open mirror reloads.

**Panel.** In Team Settings › Episodes, in place of the text box: the folder tree (add, rename, delete, drag to nest),
and for the selected folder the three settings — Who sees it (Everyone / department chips), Who may change it
(department chips among the viewers / Nobody), Contents (Own files / Mirror of: folder picker). The explorer shows a
lock on read-only folders and a mirror icon on mirrors.

### Part 2 — tasks

**Template.** The task template becomes a list of entries `{key, title, assignee: none | department id | user id,
due_days?, waits_for: keys[]}`. Today's lines convert to entries with no assignee, deadline or dependency. Validation:
100 tasks; `waits_for` names other entries and has no cycles; due_days 0–365.

**Task model.** A task gains `department_id` (the pool it belongs to) and `waits_for` (task ids of the same section).
A claimed pool task keeps its department and gains an assignee.

**Seeding.** `due_at` = end of the day `due_days` after the episode opens, in the creating user's timezone.
`waits_for` keys become the new tasks' ids.

**Editing later.** Task managers can change `department_id` and `waits_for` on existing tasks from the task detail
(decision 10); the server rejects a `waits_for` that names a task of another section or makes a cycle.

**Claim.** Anyone in the task's department may set themselves as assignee of an unassigned pool task (a "Take it"
button). Re-assigning to someone else stays with today's task permissions.

**Lock.** The server refuses moving a task to In progress or Done, and refuses a claim, while any task it waits for
is not Done, unless the actor has `manage_tasks`. Tasks show "Waiting for: Storyboard" with a lock icon; the lock lifts
when the last predecessor is Done. Deleting a predecessor drops it from `waits_for`.

**Visibility.** Pool tasks appear in their department members' lists with the department chip and "unassigned".

**Panel.** In place of the tasks text box: a list of tasks (add, reorder, delete), each with an assignee picker
(Nobody / department / person), a "days after opening" number, and a "waits for" multi-picker of the other tasks.

## Left to the builder

- Storage shape of the templates (new team columns with JSON, or reusing the current columns with a format marker)
  and of folder rules (columns on drive items or a side table), as long as old templates convert without loss.
- How the seeding endpoint reports a partial failure (today's `failed` list) — but it must not leave a restricted
  folder without its rules.
- Panel layout details, icons, copy, i18n ids (with `description`s; never run `make i18n-extract`).
- Whether listing applies the visibility filter in SQL or in the app.

## Calls I made (check these)

- Channel managers bypass every folder rule.
- Visibility narrows down the path: a subfolder cannot be visible to someone who cannot see its parent.
- The nearest write rule on the path wins for changing contents.
- Copying out of a mirror is allowed (it is a read); moving out is not.
- Stüdyo geneli is an ordinary department in these rules: listing it is how producers get access (no implicit bypass).
- Recycle Bin items are visible only to people who could see them in place.
- Deadline counted to the end of the day in the episode creator's timezone.
- The template folder/task limits stay at 100 entries.
- Folders that carry rules (seeded from the template) can be renamed, moved or deleted only by channel managers; they
  are the episode's pipeline skeleton. Rules are stored on the folder, so they come back with it from the Recycle Bin.
  A copy of a rule folder is a plain folder. A move to another team drops its rules (department ids are per team).
- A mirror shows its source's whole subtree. Access through a mirror is judged on the mirror's path, plus the own view
  rule of any source subfolder below the source (so a Background-only subfolder inside the source stays hidden). Drive
  calls made through a mirror therefore carry the mirror they came through.
- The seeding endpoint covers channel, task section, folders and tasks. The client still uploads the section video and
  creates the canvas afterwards, and still deletes the channel if either fails, as today.
- Pool tasks are not hidden from anyone: every team member still sees every task, as today. Department members get
  them in their own view as "unassigned, your department's".
