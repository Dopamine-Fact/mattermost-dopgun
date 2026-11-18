# Task conversations in task-list channels

Status: draft, for review
Builds on: `2026-11-18-episode-channels-design.md` (branch `feature/episode-channels`)

## Intent and why

In episode channels the talk about a piece of work scatters: some of it is in the channel, some is in the task's
comments, and nothing ties the two together. The team wants one conversation: every message in an episode channel
belongs to a task, a task's comments are exactly the channel messages about it, and the channel can be narrowed to one
task's conversation.

## The rule

In every channel that has a task list (a task section linked to the channel, `TaskSection.ChannelId` — today that is
every revision channel and every episode channel), **a user's message must name one of that channel's tasks**. There is
no free chat in these channels.

## Goals

1. **Composer task picker.** The Messages tab's composer has a task picker showing the channel's tasks (its section's
   tasks: ordinary tasks and revisions). Send is disabled until a task is picked. The picked task stays picked for the
   next message in that channel (part of the draft), so a run of messages about one task needs one pick.
2. **Same record.** A channel message about a task *is* that task's comment. There is no second copy. Editing,
   deleting, reactions and file attachments are the normal post features and show identically in both places.
3. **Task comments read and write posts.** For a task in a channel-linked section, the task detail's comment area lists
   that task's posts (oldest first, like today) and its comment box creates a post in the channel with the task set.
4. **Every message shows its task.** In the channel, each post that names a task shows the task title as a small label
   next to the author; clicking it opens the task's detail (the Revisions tab for a revision, the Tasks tab otherwise).
5. **Filter.** The Messages tab has a filter: "All" (default, the normal channel view) or one task. With a task chosen,
   the tab shows only that task's posts, newest at the bottom, with the composer preset to that task.
6. **Server enforcement.** The server rejects a user post in a task-list channel that does not name a task of that
   channel's section, so the rule holds for every client and the API.
7. **Migration.** Existing `TaskComments` of tasks in channel-linked sections become posts in that channel (author,
   time, message and files kept), and are then removed from `TaskComments`. The old echo copies of those comments
   are deleted (see Decisions).

## Approaches

- **A. The post is the comment (chosen).** Every message in a task-list channel carries `props.task_id`; the task's
  comments are a query over posts. One record, so nothing can drift, and every post feature (edit, reactions, files,
  mentions, unreads) works in both places for free. Costs a server rule, a migration of old comments, and a new query.
- **B. One thread per task.** Each task's card post is a thread root and its comments are replies. Needs no new post
  field, but with Collapsed Reply Threads replies leave the channel stream, so "All" would no longer show the talk.
- **C. Two records kept in sync.** Keep `TaskComments` and copy each way. Least server change, but it is the scattering
  the team wants gone: two copies drift on edit and delete, and there is no single place to react or reply.

## Decisions (from the conversation)

- Same record, not a copy (user).
- The rule applies to every task-list channel, revision and episode alike (user). There is no separate "episode" flag.
- Approach A, the post is the comment (user); the threads approach was rejected because with Collapsed Reply Threads on,
  replies leave the main stream and the "All" view would lose the conversations.

## Decisions I made (correct any of these)

- **Where the task lives on a post:** `Post.Props["task_id"]`, the key the revision card posts already use.
- **Replies inherit.** A thread reply takes its root post's `task_id`; the server sets it, the client never needs to
  pick one for a reply. A reply to a root with no task (an old message) is allowed without one.
- **Exempt posts.** The rule covers posts a user sends through the API (`POST /posts`, scheduled posts when they fire,
  and the new task-comment path). System messages (join/leave, header changes), the revision card posts the server
  makes, bot and webhook posts, and plugin posts are not checked.
- **The task cannot change after posting.** Editing a post keeps its `task_id`; a patch that tries to change or remove
  it is rejected. Moving a message to another task means deleting and re-posting.
- **Which tasks a post may name:** only tasks whose section is linked to this channel. A task moved out of the section
  (not possible for revisions; possible for ordinary tasks) keeps its old posts; they still show its label and still
  filter in that channel.
- **When the rule is off:** the server enforces it only while the channel is a live task-list channel: the team has
  tasks enabled (revisions enabled too, for a revision section), the linked section exists, and the channel is not
  archived. Otherwise the channel behaves like any other, so no channel can end up with nobody able to post.
- **Where the task detail reads comments from:** posts naming the task (any channel) merged with its `TaskComments`
  rows, oldest first. New comments go to the task's current channel as posts if its section has one, otherwise to
  `TaskComments`. A task moved between sections therefore never loses its history.
- **Every way a user creates a post is covered:** the composer, file-only posts, slash commands that post (`/me`,
  `/shrug`, ...), and forwarding into the channel. The check lives in the app layer for user-created posts (not only the
  `POST /posts` handler), and the webapp passes the picked task with commands and asks for one when forwarding.
- **Deleting someone else's message:** anyone with `manage_tasks` (or `manage_revisions` for a revision) keeps today's
  right to delete any comment on those tasks, now applied to the posts that name them. Normal post deletion rules apply
  otherwise.
- **Replies in the task views:** the filtered Messages view and the task detail show root posts like the channel does,
  each with its reply count; opening one shows the thread in the right-hand panel. Replies are not flattened into the
  list.
- **Private channels:** the task detail shows channel posts only to those who can read the channel. Someone who cannot
  sees a short note in place of them (and, for a public channel, the join button below).
- **Old messages.** Messages posted before this change, with no task, stay where they are and show in "All" only.
- **Deleting a task** leaves its posts in the channel; their label falls back to "Deleted task" and clicking does
  nothing. (Deleting the posts with the task would silently erase conversation.)
- **Channel-less tasks** (team board tasks in sections without a channel) keep today's `TaskComments` exactly as they
  are.
- **Old echo posts are deleted by the migration (user).** Each existing "X commented on revision Y: …" copy would
  duplicate the comment the migration turns into a post, so the migration soft-deletes it (sets `DeleteAt`). The echo
  carries no marker, so it is matched to its comment by the facts `CreateTaskComment` wrote: same channel (the
  revision's), same `UserId`, an empty post `Type`, a `Message` containing the link `?revision=<task_id>`, and a
  `CreateAt` within a few seconds after the comment's. Only matched posts are deleted, at most one per comment; a
  revision link a person pasted by hand never matches a comment's time window.
- **The revision comment echo goes away.** Today a comment on a revision posts "X commented on revision Y: …" into the
  channel. That comment is now itself the channel post, so the echo is removed. The revision card post on creation
  stays, and it already carries `task_id`, so it shows in that revision's filter.
- **Who can comment from the task detail:** the same people who can post in the channel (`create_post` there). A team
  member who is not in the channel sees the comments (public channel, read access) and, in place of the comment box, a
  "Join the channel to comment" button.
- **Notifications** come for free: mentions, unreads and push notifications work as for any post.
- **Mobile.** The mobile app has no task picker, so mobile users cannot start a new message in these channels; they can
  reply in a thread (the reply inherits the task). Accepted for now.

## Non-goals

- A task picker in the mobile app.
- Changing the task of an existing post.
- Moving comments of channel-less tasks into posts.
- Free chat in task-list channels, or a per-channel switch to turn the rule off.
- Threads as task conversations.

## Anti-goals (would make this a failure even if it works)

- Any comment or message lost or duplicated by the migration.
- A message in a task-list channel that no client can see under its task.
- The "All" view behaving differently from today's channel view (same post list, same features), apart from the labels.

## Constraints

- Store methods take `request.CTX`, not `context.Context`.
- Every new en.json string carries a `description`; do not run `npm run i18n-extract` (it empties en.json on Windows);
  server strings go through `make i18n-extract`, which drops ids still in use here, so they are inserted by hand.
- Postgres only. The task filter query must be indexed: an expression index on `Posts (ChannelId, (Props->>'task_id'))`
  for non-deleted posts, created in the same migration.
- The migration is idempotent and safe on a large `Posts` table; files move by setting each `FileInfo`'s `PostId` and
  `ChannelId` to the new post.

## What is left to the builder

- The exact endpoint shape for one task's posts (for example `GET /api/v4/tasks/{task_id}/posts?before=&per_page=`)
  and whether the filtered view reuses an existing post component for each item.
- How the picker sits in the composer (the post-priority label in `advanced_text_editor` is the nearest pattern: it
  rides on the draft and becomes post metadata).
- How the task label is drawn on posts (a post-header component, the way post priority labels are).
- The error text for a rejected post, and how the webapp shows it.
