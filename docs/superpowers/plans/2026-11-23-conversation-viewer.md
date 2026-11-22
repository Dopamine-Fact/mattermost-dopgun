# Conversation Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A System Console page where a System Admin picks a user and reads that user's DMs, group messages and channels.

**Architecture:** Webapp only. One page component calls existing APIs through `Client4` directly and keeps results in local
state (never in the redux channel/post stores), like `breaks_report.tsx`. One new `Client4` method.

**Tech Stack:** React, TypeScript, react-intl, Jest + Testing Library (`tests/react_testing_utils`).

**Spec:** `docs/superpowers/specs/2026-11-23-conversation-viewer-design.md`

## Global Constraints

- Page URL `user_management/conversations`, sidebar title "Conversations", `isHidden: it.not(it.isSystemAdmin)`, placed right after `breaks_report`.
- Page size for posts: 60.
- No redux writes for channels/posts; no join, no view/mark-read calls.
- Messages shown as plain text (`white-space: pre-wrap`), attachments as a file count, oldest at top.
- Every en.json entry has a `description`; tr.json gets the Turkish string for each new id.

## Review Focus

- A DM with yourself (`a__a`) → label is the user's own name, not empty.
- A DM whose other user's profile isn't loaded yet → shows the user id until the profile arrives, then the name.
- Switching user while a channel is open → the open conversation and its posts are cleared.
- "Load older" when the last page returned fewer than 60 posts → button hidden.
- `getPosts` returns extra thread posts in `posts` that are not in `order` → only posts in `order` are shown.

---

### Task 1: Conversation viewer page

**Files:**
- Modify: `webapp/platform/client/src/client4.ts` (next to `getAppUsage`, ~line 5290)
- Create: `webapp/channels/src/components/admin_console/conversation_viewer/conversation_viewer.tsx`
- Test: `webapp/channels/src/components/admin_console/conversation_viewer/conversation_viewer.test.tsx`

**Interfaces:**
- Produces: `Client4.getChannelsForUser(userId: string): Promise<Channel[]>` → `GET ${this.getUserRoute(userId)}/channels`.
- Produces: `export default function ConversationViewer()` (no props).
- Consumes: `Client4.autocompleteUsers(term, '', '')` (`.users`), `Client4.getPosts(channelId, 0, 60, true, false)`,
  `Client4.getPostsBefore(channelId, oldestPostId, 0, 60, true, false)`, `getMissingProfilesByIds`, `displayUsername`,
  `getTeammateNameDisplaySetting`, `getUsers`, `AdminHeader`.

Behavior:
- Search input labelled "User"; typing calls `autocompleteUsers` (debounce optional); results are buttons with the user's display name. Picking one sets the user, clears the open channel and posts, calls `getChannelsForUser`.
- Channel list sorted by `last_post_at` desc. Label: type `D` → other id from `name.split('__')` (the one ≠ selected user, or the user itself for a self-DM), shown via `displayUsername` once loaded, id until then; dispatch `getMissingProfilesByIds` for those ids. Type `G` → `display_name`. `O`/`P` → `display_name`.
- Clicking a channel loads posts; render `order` reversed (oldest first) as rows: sender name, `new Date(create_at).toLocaleString()`, message, and "N files" when `file_ids?.length`. Posts whose `type` starts with `system_` get a dimmed class. Dispatch `getMissingProfilesByIds` for senders.
- "Load older" button visible when the last fetch returned 60 posts; prepends older posts.

- [ ] **Step 1: Write the failing tests** in `conversation_viewer.test.tsx` (pattern: `breaks_report.test.tsx`, `jest.spyOn(Client4, ...)`):
  - `lists the picked user's conversations, most recent first, DMs by the other person` — autocomplete returns `ali`(u1); channels `[{id:'c1',type:'O',display_name:'General',last_post_at:1}, {id:'c2',type:'D',name:'u1__u2',last_post_at:5}]`; after clicking `ali`, buttons read `['ayse','General']` in that order.
  - `opens a conversation oldest first with sender and file count` — `getPosts` returns `{order:['p2','p1'], posts:{p1:{id:'p1',user_id:'u1',message:'selam',create_at:1,file_ids:[]}, p2:{...user_id:'u2',message:'merhaba',file_ids:['f']}, p9:{id:'p9',message:'thread extra'}}}`; texts appear `selam` before `merhaba`, `1 files` shown, `thread extra` not shown; `getPosts` called with `('c2', 0, 60, true, false)`.
  - `load older prepends older posts and hides when fewer than 60 come back` — first page has 60 posts → button present; `getPostsBefore` called with `('c2', <oldest id>, 0, 60, true, false)` returning 1 post → that post is first and the button is gone.
  - `self DM is labelled with the user's own name` — channel `u1__u1` → button `ali`.
  - `picking another user clears the open conversation`.
- [ ] **Step 2: Run** `cd webapp/channels && npx jest src/components/admin_console/conversation_viewer` — expected FAIL (module not found).
- [ ] **Step 3: Implement** `Client4.getChannelsForUser` and `ConversationViewer` as above, strings via `defineMessages` with ids `admin.conversation_viewer.*` (title "Conversations", user "User", empty "No conversations.", loadOlder "Load older", files "{count} files", noMessages "No messages.").
- [ ] **Step 4: Run** the same jest command — expected PASS.
- [ ] **Step 5: Commit** `Add conversation viewer page`.

### Task 2: Register the page and add strings

**Files:**
- Modify: `webapp/channels/src/components/admin_console/admin_definition.tsx` (import near line 49, entry after `breaks_report` ~line 529)
- Modify: `webapp/channels/src/i18n/en.json`, `webapp/channels/src/i18n/tr.json`

**Interfaces:**
- Consumes: `ConversationViewer` from Task 1.

- [ ] **Step 1:** Add `conversation_viewer` entry: `url: 'user_management/conversations'`, title id `admin.sidebar.conversations` "Conversations", `isHidden: it.not(it.isSystemAdmin)`, `schema: {id: 'ConversationViewer', component: ConversationViewer}`.
- [ ] **Step 2: Run** `cd webapp/channels && npm run i18n-extract`, then fill each new id's `description` in en.json and add tr.json strings ("Yazışmalar", "Kullanıcı", "Yazışma yok.", "Daha eski", "{count} dosya", "Mesaj yok.").
- [ ] **Step 3: Run** `npm run i18n-extract:check` — expected no diff output.
- [ ] **Step 4: Commit** `Register conversation viewer in the System Console`.

### Task 3: Verify

- [ ] **Step 1: Run** `cd webapp/channels && npx jest src/components/admin_console/conversation_viewer src/components/admin_console/admin_definition` — expected PASS.
- [ ] **Step 2: Run** `npx tsc -b` from `webapp/channels` and `npx eslint` on the changed files — expected no errors.
