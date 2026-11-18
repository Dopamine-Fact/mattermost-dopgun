# Task conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In every task-list channel, each user message names one of the channel's tasks; a task's comments are those
messages; the Messages tab can be narrowed to one task.

**Architecture:** A message names its task in `Post.Props["task_id"]`. `App.CreatePost` enforces the rule for
user-created posts in a live task-list channel and copies the root's task onto replies. The task detail and the filtered
Messages view both read root posts by task from a new endpoint backed by an expression index. A migration turns old
comments of channel-linked tasks into posts and soft-deletes their echo copies. Channel-less tasks keep `TaskComments`.

**Tech Stack:** Go (Postgres, squirrel), React/TS/Redux, Jest.

**Spec:** `docs/superpowers/specs/2026-11-18-task-conversations-design.md`. Read it in full before Task 1; this plan
does not repeat its Decisions.

## Global Constraints

- **Branch:** `feature/task-conversations`, cut from `feature/episode-channels`. Change code in place; no parallel paths.
- **Go runner:** run Go in docker with `sh /c/Users/dopamine/AppData/Local/Temp/claude/b77d99a4e3601da8/18855b51-ad8f-4ec1-87db-74716ea63234/scratchpad/gorun.sh <dir under server/> "<cmd>"`, written `$G` below.
  - It needs `mattermost-postgres` running.
  - Tests run as `ENABLE_FULLY_PARALLEL_TESTS=true go test ./ -count=1 -parallel 4 -timeout 30m -run '<regex>'`.
  - Never run a whole `channels/app` or `channels/api4` package on this machine (it crashes Docker Desktop): always `-run`.
  - Go files are CRLF; edit them with the Edit tool.
- **Store:** methods take no `context.Context`. Regenerate layers and mocks with `make store-layers store-mocks` from
  `server/`; if mockery can't run, hand-edit the mocks in the generated style and ledger it.
- **Server i18n:** strings are inserted into `server/i18n/en.json` by hand, sorted by id, each with a `description`
  (`make i18n-extract` drops ids still in use on this fork; do not run it).
- **Webapp i18n:** `en.json` entries are `{defaultMessage, description}`, `tr.json` is flat. Edit both with a Python json
  round trip (`indent=2`, keep line endings). Never run `npm run i18n-extract`. Turkish: görev (task), Tümü (All),
  "Görev seç" (Pick a task), "Silinmiş görev" (Deleted task).
- **Migrations:** `000256_task_conversations` (transactional) and `000257_posts_task_id_index` (`-- morph:nontransactional`,
  one statement), postgres only, both listed in `server/channels/db/migrations/migrations.list`
  (`make migrations-extract`). 000255 and earlier must not change.
- **Live task-list channel** (one definition everywhere): the channel is not archived, a `TaskSection` has
  `ChannelId = channel.Id`, and the team has `TasksEnabled && RevisionsEnabled`.
- **Webapp checks:** tests `npx jest <paths>` from `webapp/channels`; lint
  `npx eslint --rule '@stylistic/linebreak-style: off' <files>`; types `npm run check-types`.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Planner's call, no Playwright spec:** as in the episode-channels plan; Task 10's dopgun walkthrough replaces it.

## Review Focus

1. **Reply to an old untagged message** in a task-list channel is accepted with no task. Test: Task 2 `TestTaskPostRuleReplies`.
2. **Bots, webhooks, plugins and system messages** still post into task-list channels with no task. Test: Task 2 `TestTaskPostRuleExempt`.
3. **Team turns revisions off** (or the channel's section is deleted): users post freely again. Test: Task 2 `TestTaskPostRuleOff`.
4. **Echo matching:** a revision link the same user pasted by hand outside a comment's 5 s window is not deleted, and two comments seconds apart delete only echoes. Test: Task 1 `TestTaskConversationsMigration`.
5. **Edit drops the task:** a full update whose props lack `task_id` is rejected; a message-only patch passes. Test: Task 2 `TestTaskPostRuleEdit`.

---

### Task 1: Store and migrations

**Files:**
- Create: `server/channels/db/migrations/postgres/000256_task_conversations.{up,down}.sql`,
  `000257_posts_task_id_index.{up,down}.sql`; modify `migrations.list`
- Modify: `server/channels/store/store.go` (TaskStore), `sqlstore/task_store.go`, `storetest/task_store.go`, generated layers and mocks
- Create: `server/channels/store/sqlstore/task_conversations_migration_test.go`

**Produces:**
- `TaskStore.GetSectionByChannel(channelId string) (*model.TaskSection, error)` returns a `store.NewErrNotFound` when none.
- `TaskStore.GetPostIdsForTask(taskId, channelId string, before int64, limit int) ([]string, error)`: root posts
  (`RootId = ''`), `DeleteAt = 0`, `Props->>'task_id' = taskId`, `ChannelId = channelId` only when non-empty,
  `CreateAt < before` only when `before > 0`, ordered `CreateAt DESC`, `LIMIT limit`.

- [ ] **Step 1: Write the failing store tests** in `storetest/task_store.go`:
  `testTaskStoreGetSectionByChannel` (finds the linked section; not-found error for an unknown channel) and
  `testTaskStoreGetPostIdsForTask` (save 3 roots and 1 reply with task A in channel C, 1 root with task A in channel D,
  1 deleted root and 1 root with task B: `("A","",0,10)` returns the 4 roots newest first; `("A","C",0,10)` returns
  3; `limit 2` returns 2; `before` = the second-newest's CreateAt returns the older ones).
- [ ] **Step 2: Write the failing migration test** `TestTaskConversationsMigration`, in the style of
  `task_video_versions_migration_test.go` (seed, run `000256` up twice, assert):
  - Revision section S1 with channel C1; revision R (VideoFileId set) with comments c1 (user U, CreateAt 1000,
    one FileInfo) and c2 (U, 3000); ordinary task T in S1 with comment c3; task N in a section without a channel with comment c4.
  - Echo posts in C1 by U, Type '', Message containing `?revision=<R.Id>`, at CreateAt 1100 and 3050; a hand-pasted
    post by U with the same link at 20000.
  - After: posts with ids `substr(md5(c.Id || ':post'),1,26)` exist for c1, c2, c3 (channel C1, UserId, CreateAt,
    Message, `Props = {"task_id": <task>}`, c1's FileIds); exactly one each after two runs; c1's FileInfo has the new
    PostId and ChannelId C1; both echoes have `DeleteAt > 0`; the hand-pasted post has `DeleteAt = 0`; TaskComments
    keeps only c4; `Channels.TotalMsgCount` and a member's `MsgCount` of C1 both grew by 3 (unread unchanged).
- [ ] **Step 3: Run them.** `$G channels/store/sqlstore "... -run 'TestTaskStore|TestTaskConversationsMigration'"`.
  Expected: FAIL (methods and migration file missing).
- [ ] **Step 4: Write `000256` up**, in this order:
  1. `CREATE INDEX IF NOT EXISTS idx_tasksections_channelid ON TaskSections (ChannelId) WHERE ChannelId <> '';`
  2. Soft-delete echoes: `UPDATE Posts SET DeleteAt = <now ms>, UpdateAt = <now ms> WHERE Id IN (SELECT DISTINCT ON (tc.Id) p.Id ...)`
     joining TaskComments → Tasks → TaskSections (ChannelId <> '') → Posts on same channel, same UserId, `Type = ''`,
     `DeleteAt = 0`, `CreateAt BETWEEN tc.CreateAt AND tc.CreateAt + 5000`, `Message LIKE '%?revision=' || t.Id || '%'`,
     `ORDER BY tc.Id, p.CreateAt`. Now in ms: `(extract(epoch from now()) * 1000)::bigint`.
  3. One statement with data-modifying CTEs: insert a post per comment of a channel-linked task
     (`ON CONFLICT (Id) DO NOTHING RETURNING ChannelId`), count per channel, and add that count to
     `Channels.TotalMsgCount`/`TotalMsgCountRoot` and every `ChannelMembers.MsgCount`/`MsgCountRoot` of the channel.
     Fill every `Posts` column that has no default (read the Posts DDL); `UpdateAt = CreateAt`, `Props` via
     `json_build_object('task_id', t.Id)`.
  4. `UPDATE FileInfo` setting `PostId` and `ChannelId` for each file id in those comments' `FileIds` (`jsonb_array_elements_text(FileIds::jsonb)`).
  5. `DELETE FROM TaskComments` of channel-linked tasks.
  Down: `SELECT 1; -- moved comments stay posts` plus `DROP INDEX IF EXISTS idx_tasksections_channelid;`.
- [ ] **Step 5: Write `000257`**: up `-- morph:nontransactional` then
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_task_id ON Posts ((Props->>'task_id'), CreateAt) WHERE DeleteAt = 0 AND Props->>'task_id' IS NOT NULL;`;
  down the same header and `DROP INDEX CONCURRENTLY IF EXISTS idx_posts_task_id;`. Run `make migrations-extract`.
- [ ] **Step 6: Implement the two store methods**, add them to the interface, regenerate layers and mocks.
- [ ] **Step 7: Run Step 3 again.** Expected: PASS.
- [ ] **Step 8: Commit** "Move channel task comments into posts and look posts up by task".

### Task 2: The rule in `CreatePost`, replies, edits and commands

**Files:**
- Create: `server/channels/app/task_post.go`, `server/channels/app/task_post_test.go`
- Modify: `server/channels/app/post.go` (CreatePost after root verification; UpdatePost before save),
  `server/channels/app/command.go` (`HandleCommandResponsePost`), `server/public/model/command_args.go`, `server/i18n/en.json`

**Consumes:** `TaskStore.GetSectionByChannel` (Task 1).

**Produces:**
- `func (a *App) channelTaskSection(rctx request.CTX, channel *model.Channel) *model.TaskSection`: the section when the
  channel is a live task-list channel (Global Constraints), else nil. `shortcut: one indexed TaskSections lookup per user post; add a cache if post latency shows it`.
- `func (a *App) applyTaskPostRule(rctx request.CTX, post *model.Post, channel *model.Channel, rootPost *model.Post) *model.AppError`:
  a reply takes its root's `task_id` (overwriting any sent) and is otherwise free; a root post in a live task-list
  channel needs a string `task_id` naming a task whose `SectionId` is the channel's section.
- Errors (400): `app.post.task_required.app_error` ("Pick a task for this message."), `app.post.task_invalid.app_error`
  ("This task is not in this channel's task list."), `app.post.task_change.app_error` ("A message's task can't be changed.").
- `model.CommandArgs.TaskId string` (`json:"task_id"`), copied onto the response post when it has none.

- [ ] **Step 1: Write the failing tests** in `task_post_test.go` (setup with `Setup(t).InitBasic(t)`, a team with
  tasks and revisions enabled, a section linked to `th.BasicChannel`, task T in it, task X in another section):
  - `TestTaskPostRule`: `CreatePostAsUser` without `task_id` → `app.post.task_required.app_error`; with X →
    `app.post.task_invalid.app_error`; with T → saved and `GetProp("task_id") == T.Id`; a post in `th.BasicChannel2` (no section) without a task → saved.
  - `TestTaskPostRuleReplies`: a reply to a T post sending `task_id = X` is saved with T; a reply to a root saved
    before the section existed (create it first) is saved with no task.
  - `TestTaskPostRuleExempt`: a bot user's post, a post with `FromIncomingWebhook`, `FromPlugin`, and a
    `PostTypeJoinChannel` system post, all without a task, are saved.
  - `TestTaskPostRuleOff`: with `RevisionsEnabled=false`, and separately after the section is deleted, a post without a task is saved.
  - `TestTaskPostRuleEdit`: `PatchPost` of a T post with only `Message` passes; `UpdatePost` with props lacking
    `task_id` (SafeUpdate false) and with `task_id = X` → `app.post.task_change.app_error`.
  - `TestTaskPostRuleCommand`: `ExecuteCommand` `/me waves` with `TaskId: T.Id` posts with T; without it → `app.post.task_required.app_error`.
- [ ] **Step 2: Run** `$G channels/app "... -run 'TestTaskPostRule'"`. Expected: FAIL (undefined functions / no rule).
- [ ] **Step 3: Implement** `task_post.go`; call `applyTaskPostRule` in `CreatePost` right after root verification,
  only when `post.Type == ""` and `!a.isIntegrationPostAuthor(rctx, user, flags)`; in `UpdatePost`, after props are
  merged, reject when `newPost.GetProp("task_id") != oldPost.GetProp("task_id")`; add `CommandArgs.TaskId` and copy it
  in `HandleCommandResponsePost` after `SetProps`; add the three strings.
- [ ] **Step 4: Run Step 2 again**, then the existing post tests that the rule could break:
  `-run 'TestCreatePost|TestUpdatePost|TestPatchPost|TestHandleCommandResponsePost'`. Expected: PASS.
- [ ] **Step 5: Commit** "Require a task on messages in task-list channels".

### Task 3: Task comments become posts on the server

**Files:**
- Modify: `server/channels/app/task.go`, `server/channels/api4/task.go`, `server/channels/api4/post.go` (deletePost),
  `server/i18n/en.json`; tests in `app/task_test.go`, `api4/task_test.go`, `api4/post_test.go`

**Consumes:** `GetPostIdsForTask` (Task 1).

**Produces:**
- `CreateTaskComment` returns 400 `app.task.comment.use_channel.app_error` ("Comment on this task in its channel.")
  when the task's section has a `ChannelId`. The revision-comment echo and the `app.task.revision_comment` string are removed.
- `func (a *App) GetTaskPosts(rctx request.CTX, task *model.Task, userID, channelID string, before int64, perPage int) (*model.PostList, *model.AppError)`:
  ids from the store, posts from `Post().GetPostsByIds`, dropping posts in channels `userID` cannot read, prepared with `PreparePostListForClient`.
- Route `GET /api/v4/tasks/{task_id}/posts?channel_id=&before=&per_page=` (team member via `loadTask`; per_page default 60, max 200).
- `deletePost` lets anyone with the task's permission (`taskPermission`) on its team delete a post whose `task_id` names an existing task.

- [ ] **Step 1: Write the failing tests:**
  - app `TestCreateTaskCommentChannelLinked`: a comment on a task in a channel-linked section → `app.task.comment.use_channel.app_error`;
    a comment on a channel-less task is saved and posts nothing to any channel.
  - api4 `TestGetTaskPosts`: two T roots and one reply in the channel → 2 posts, newest first in `Order`; `per_page=1` → 1;
    after the channel is made private and the caller removed from it → 0 posts, status 200.
  - api4 `TestDeleteTaskPostAsManager`: a user with `manage_tasks` (not `delete_others_posts`) deletes another user's T
    post → 200; a user with neither → 403; a post with no task by someone else → 403.
- [ ] **Step 2: Run** `$G channels/app "... -run TestCreateTaskCommentChannelLinked"` and
  `$G channels/api4 "... -run 'TestGetTaskPosts|TestDeleteTaskPostAsManager'"`. Expected: FAIL.
- [ ] **Step 3: Implement**, add the route and strings, delete the echo code and its string.
- [ ] **Step 4: Run Step 2 again**, plus `-run 'TestTaskComment|TestCreateTaskComment|TestDeletePost'` in both packages. Expected: PASS.
- [ ] **Step 5: Commit** "Serve a task's messages and route its comments to the channel".

### Task 4: Webapp data layer

**Files:**
- Modify: `webapp/platform/types/src/integrations.ts` (`CommandArgs.task_id?: string`),
  `webapp/platform/client/src/client4.ts`, `webapp/channels/src/actions/tasks.ts`,
  `webapp/channels/src/packages/mattermost-redux/src/selectors/entities/tasks.ts`, `components/channel_view/channel_tabs.tsx`
- Test: `selectors/entities/tasks.test.ts` (create if missing), `actions/tasks.test.ts`

**Produces:**
- `Client4.getTaskPosts(taskId: string, options: {channelId?: string; before?: number; perPage?: number}): Promise<PostList>`.
- `fetchTaskPosts(taskId: string, options): ActionFuncAsync<PostList>`, which stores the posts with `receivedPosts`.
- `getTaskSectionForChannel(state, channelId): TaskSection | undefined` (live task-list rule: section's team has
  `tasks_enabled && revisions_enabled`). `channel_tabs.tsx` uses it instead of its inline find.
- `makeGetTaskRootPosts(): (state, taskId: string, channelId?: string) => Post[]`: loaded posts with that
  `props.task_id`, `root_id === ''`, `delete_at === 0`, in the channel when given, oldest first.

- [ ] **Step 1: Failing tests:** the section selector returns the linked section and `undefined` when the team has
  `revisions_enabled: false`; `makeGetTaskRootPosts` excludes a reply, a deleted post and another task's post and
  sorts by `create_at`; `fetchTaskPosts` puts the returned posts into `state.entities.posts.posts`.
- [ ] **Step 2: Run** `npx jest src/packages/mattermost-redux/src/selectors/entities/tasks.test.ts src/actions/tasks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run Step 2 again** plus `src/components/channel_view`. Expected: PASS. Then lint and types.
- [ ] **Step 5: Commit** "Load a task's messages in the webapp".

### Task 5: Task picker in the composer

**Files:**
- Create: `webapp/channels/src/components/advanced_text_editor/use_task_picker.tsx` (+ `.test.tsx`),
  `webapp/channels/src/components/channel_view/task_filter_context.ts`
- Modify: `advanced_text_editor.tsx` (hook call next to `usePriority`, control in `AdvancedTextEditor__labels`,
  `isDraftSendable`), `use_submit.tsx` (draft reset after send), `actions/views/create_comment.tsx` (`submitCommand` args), i18n

**Consumes:** `getTaskSectionForChannel` (Task 4).

**Produces:**
- `TaskFilterContext = React.createContext<string>('')`: the Messages filter's task id ('' = All).
- `useTaskPicker(draft: PostDraft, handleDraftChange, channelId: string, rootId: string): {control: React.ReactNode; isTaskSendable: boolean}`.
  For a root draft in a live task-list channel it renders a `<select>` ("Pick a task" + the section's tasks by title)
  writing `draft.props.task_id`; `isTaskSendable` is false until the picked id is one of the section's tasks. When
  `TaskFilterContext` is non-empty it sets the draft's task to it. Replies and other channels get `{control: null, isTaskSendable: true}`.
- After a send, the new empty draft keeps `props.task_id`. Slash commands send `task_id: draft.props?.task_id`.

- [ ] **Step 1: Failing tests** (`use_task_picker.test.tsx`, render the hook through a small component):
  no control and sendable for a channel without a section and for a reply; for a task-list channel, not sendable
  until a task is picked and `handleDraftChange` receives `props.task_id`; a filter context of T sets T.
  In `create_comment.test.tsx` (existing): `submitCommand` passes `task_id` from the draft to `executeCommand`.
- [ ] **Step 2: Run** `npx jest src/components/advanced_text_editor src/actions/views/create_comment.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**; add en/tr strings `advanced_text_editor.task_picker.placeholder` and `.label`.
- [ ] **Step 4: Run Step 2 again.** Expected: PASS. Lint and types.
- [ ] **Step 5: Commit** "Pick a task before sending in task-list channels".

### Task 6: Task label on messages and `?task=` links

**Files:**
- Create: `webapp/channels/src/components/tasks/task_post_label.tsx` (+ `.test.tsx`)
- Modify: `components/post/post_component.tsx` (next to `{priority}`), `components/channel_view/channel_tabs.tsx`, i18n

**Produces:** `TaskPostLabel({post: Post})`: the task's title from `getTask`, or "Deleted task" (not clickable) when
it is not in the store. Clicking goes to the post's channel with `?revision=<id>` when the task has a
`video_file_id`, else `?task=<id>`. `channel_tabs.tsx` opens the Tasks tab on that task for `?task=`, the way it does for `?revision=`.
`shortcut: a task not yet loaded shows as deleted until fetchTeamTasks finishes`.

- [ ] **Step 1: Failing tests:** label shows the title and links to `?task=`; a revision links to `?revision=`;
  an unknown id shows "Deleted task" with no link; `channel_tabs` with `?task=T` shows T's detail on the Tasks tab.
- [ ] **Step 2: Run** `npx jest src/components/tasks/task_post_label.test.tsx src/components/channel_view`. Expected: FAIL.
- [ ] **Step 3: Implement**; strings `tasks.postLabel.deleted` and `tasks.postLabel.open`.
- [ ] **Step 4: Run Step 2 again.** Expected: PASS. Lint and types.
- [ ] **Step 5: Commit** "Show each message's task".

### Task 7: One task's messages and the Messages filter

**Files:**
- Create: `webapp/channels/src/components/tasks/task_post_list.tsx` (+ `.test.tsx`)
- Modify: `components/channel_view/channel_view.tsx` (pass the composer separately), `channel_tabs.tsx`, i18n

**Consumes:** `fetchTaskPosts`, `makeGetTaskRootPosts` (Task 4), `TaskFilterContext` (Task 5).

**Produces:**
- `TaskPostList({taskId: string; channelId?: string})`: fetches 60 at a time; renders the posts oldest first with
  `PostComponent` at `Locations.SEARCH` (reply count; opening one shows the thread in the RHS); a "Load older"
  button while the last page was full; nothing when empty.
- `ChannelTabs` takes `composer: React.ReactNode` beside `children` (the post view). On the Messages tab of a task-list
  channel it shows a filter `<select>` (Tümü/All + the section's tasks); with a task chosen the panel is
  `TaskPostList(taskId, channelId)` instead of `children`; the composer stays below either way, inside a
  `TaskFilterContext.Provider`. A channel without tabs renders exactly as before.

- [ ] **Step 1: Failing tests:** `TaskPostList` calls `getTaskPosts` with `perPage: 60`, shows posts oldest first,
  shows "Load older" after a full page and passes `before` = the oldest `create_at`; `ChannelTabs` with the filter
  on T renders `TaskPostList` and the composer, on All renders `children` and the composer.
- [ ] **Step 2: Run** `npx jest src/components/tasks/task_post_list.test.tsx src/components/channel_view`. Expected: FAIL.
- [ ] **Step 3: Implement**; strings `channel_tabs.filter.all`, `channel_tabs.filter.label`, `tasks.posts.loadOlder`.
- [ ] **Step 4: Run Step 2 again.** Expected: PASS. Lint and types.
- [ ] **Step 5: Commit** "Filter a channel's messages by task".

### Task 8: Task detail conversation and delete rights in the post menu

**Files:**
- Create: `webapp/channels/src/components/tasks/task_post_composer.tsx` (+ `.test.tsx`)
- Modify: `components/tasks/task_comments.tsx` (+ test), `task_detail.tsx`, the webapp's `canDeletePost` helper (find it from the post dot menu), i18n

**Consumes:** `TaskPostList` (Task 7).

**Produces:**
- `TaskComments` gains `channelId?: string` (`TaskDetail` passes the task's section's `channel_id`). With a channel: the
  old comments read-only (no form), then `TaskPostList(taskId)`, then `TaskPostComposer`. Without: `TaskPostList(taskId)`,
  then today's comments and form. (Planner's call: this order matches when a task moved, instead of interleaving two lists.)
- `TaskPostComposer({taskId: string; channelId: string})`: a member gets a textarea, file input and Send; files go up
  with `Client4.uploadFile` to the channel, then `createPost({channel_id, message, props: {task_id}, file_ids}, fileInfos)`.
  A non-member of a public channel gets "Join the channel to comment" (`joinChannel`); otherwise the note
  "Only members of this channel can see and join its conversation." (fetch the channel with `getChannel` to tell public from private).
- `canDeletePost` is also true for a post whose `props.task_id` names a loaded task the user may manage
  (`manage_revisions` when it has `video_file_id`, else `manage_tasks`, on the team).

- [ ] **Step 1: Failing tests:** a channel-linked task shows `TaskPostList` and the composer and no old-comment form;
  sending calls `createPost` with `props.task_id` and the channel; a file is uploaded first and its id sent; a
  non-member of an open channel sees the join button and joining calls `joinChannel`; a channel-less task still
  posts through `createTaskComment`; `canDeletePost` is true for a task manager on another user's task post.
- [ ] **Step 2: Run** `npx jest src/components/tasks <canDeletePost test file>`. Expected: FAIL.
- [ ] **Step 3: Implement**; strings `tasks.conversation.join`, `tasks.conversation.private`, `tasks.conversation.send`, `tasks.conversation.placeholder`.
- [ ] **Step 4: Run Step 2 again** plus `src/components/post src/components/dot_menu`. Expected: PASS. Lint and types.
- [ ] **Step 5: Commit** "Talk about a task from its detail".

### Task 9: Forwarding into a task-list channel

**Files:** Modify `webapp/channels/src/components/forward_post_modal/index.tsx` (+ test), `actions/views/posts.ts` (`forwardPost`), i18n

**Produces:** `forwardPost(post, channel, message = '', taskId = '')` sets `props.task_id` when given. The modal, once a
channel is chosen, finds its section with `getTaskSectionForChannel` (fetching the channel's team tasks with
`fetchTeamTasks` when that team's sections are not loaded) and, if there is one, shows a required task `<select>`;
Forward stays disabled until a task is picked.

- [ ] **Step 1: Failing tests:** choosing a task-list channel shows the select and disables Forward; picking T
  enables it and `forwardPost` receives T; a plain channel shows no select.
- [ ] **Step 2: Run** `npx jest src/components/forward_post_modal src/actions/views/posts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; string `forward_post_modal.task.label`.
- [ ] **Step 4: Run Step 2 again.** Expected: PASS. Lint and types.
- [ ] **Step 5: Commit** "Pick a task when forwarding into a task-list channel".

### Task 10: Deploy and walk through on dopgun

- [ ] **Step 1:** Before deploying, record on dopgun: TaskComments rows of channel-linked tasks, echo posts
  (`Message LIKE '%?revision=%'`, `Type = ''`, not deleted) per revision channel. Save the counts in the ledger.
- [ ] **Step 2:** Build the server (`$G . "go build -o bin/mattermost.new ./cmd/mattermost"`) and the webapp, swap the
  binary (`docker stop dopgun-server`, mv, `docker start`), ping `http://localhost:8066/api/v4/system/ping`.
  Expected: migrations 256 and 257 applied; TaskComments of channel-linked tasks 0; posts with `task_id` grew by the
  recorded comment count; recorded echoes now deleted; `idx_posts_task_id` exists and is valid.
- [ ] **Step 3:** In "EP01 Walkthrough": Send is disabled until a task is picked; a message shows its task label; the
  task's detail lists it; a comment written in the detail appears in Messages; the filter shows only that task;
  a thread reply has the task; `/me` with a task picked posts; a revision's old comments show once.
- [ ] **Step 4:** Run the full webapp jest union used before (tasks, channel_view, advanced_text_editor, post,
  forward_post_modal, team_settings, redux tasks) and the Go `-run` sets of Tasks 1–3. Ledger the counts.
