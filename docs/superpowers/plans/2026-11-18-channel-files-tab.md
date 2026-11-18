# Channel Files Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Files" tab in episode channels that shows the file explorer for that channel, in place.

**Architecture:** Split `file_explorer.tsx` into a view that takes its channel, folder and URL builder as props, plus the
route page that feeds it from `useParams` and keeps the page-only effects. `ChannelTabs` lazy-loads the view as a new
tab and keeps the folder in `?folder=`.

**Tech Stack:** React, react-router v5, Redux, Jest + Testing Library, SCSS.

**Spec:** `docs/superpowers/specs/2026-11-18-channel-files-tab-design.md`

## Global Constraints

- Webapp only; no server or API change.
- Talk to the user in Turkish. Never run `make i18n-extract`; no new i18n id is needed (the tab reuses `file_explorer.title`, tr "Dosyalar").
- The route page's URLs (`/<team>/files/<channel>/<folder>`) and behaviour stay as they are.
- Checks from `webapp/channels`: `TZ=UTC timeout 280 npx jest src/components/file_explorer src/components/channel_view src/components/tasks`, `npx tsc --noEmit -p .`, `npx eslint <changed files> | grep -v linebreak`, `npx stylelint <changed scss>`.

## Review Focus

1. Back/forward in the tab: after opening two folders, browser Back returns to the previous folder inside the Files tab.
2. A `?folder=` link on a team with files off, or on a channel without a tab bar, falls back to Messages.
3. Switching channels while on Files: the next channel opens on Messages, not on the old channel's folder.
4. Recycle bin and chat attachments in the tab: the address bar starts at the channel and Up/Backspace stop at the channel root.
5. The sidebar's current item does not jump to "Files" when the tab opens.

---

### Task 1: Embeddable explorer view

**Files:**
- Modify: `webapp/channels/src/components/file_explorer/file_explorer.tsx`
- Test: `webapp/channels/src/components/file_explorer/file_explorer.test.tsx`

**Interfaces:**
- Produces: named export `FileExplorerView` from `components/file_explorer/file_explorer` with props
  `{channelName?: string; folderId: string; urlFor: (channelName: string, folderId?: string) => string; embedded?: boolean}`.
  The default export stays the route page.
- The page builds `urlFor = (c, f) => [`/${team.name}/files`, c, f].filter(Boolean).join('/')` and keeps
  `selectLhsItem(Files)`, the files-off redirect and the unknown-channel redirect.
- `embedded`: no `ExplorerTree`, no "Files" root crumb (the channel crumb is first), `upTo` is undefined at the
  channel root.

- [ ] **Step 1: Write the failing tests** (render `FileExplorerView` inside a `Route` with a memory history, channel `town`):
  - `'embedded, opening a folder goes through the host URL'`: `urlFor = (c, f) => `/team-one/channels/${c}?folder=${f ?? ''}``; double-click folder → `history.location.search === '?folder=<folder id>'`.
  - `'embedded, the channel tree is hidden'`: `queryByRole('navigation', {name: 'Folders'})` is null.
  - `'embedded, the address bar starts at the channel and Up stops there'`: first crumb is the channel's display name, no "Files" crumb; Up button disabled at root.
  - `'embedded, the sidebar keeps its current item'`: rendering does not dispatch `selectLhsItem` (mock `actions/views/lhs`).
- [ ] **Step 2: Run** `TZ=UTC npx jest src/components/file_explorer`. Expected: the 4 new tests FAIL (no `FileExplorerView` export), existing tests pass.
- [ ] **Step 3: Implement.** Replace every URL built from `baseUrl`/`channelUrl` with `urlFor`; render the tree only when not embedded.
- [ ] **Step 4: Run** the file_explorer suite, tsc and eslint on the two files. Expected: all pass, no new lint errors.
- [ ] **Step 5: Commit** "Make the file explorer embeddable in a channel".

### Task 2: Files tab in ChannelTabs

**Files:**
- Modify: `webapp/channels/src/components/channel_view/channel_tabs.tsx`
- Modify: `webapp/channels/src/components/file_explorer/file_explorer.scss` (`.ChannelFiles__panel {display: flex; min-height: 0; flex: 1;}` and its `.FileExplorer {flex: 1;}`)
- Test: `webapp/channels/src/components/channel_view/channel_tabs.test.tsx`

**Interfaces:**
- Consumes: `FileExplorerView` from Task 1, loaded with `React.lazy` like `LazyCanvasBoard`.
- `Tab` gains `'files'`. The tab shows when `(section || isCanvas) && team.files_enabled`, after Canvas, labelled with `file_explorer.title`.
- `?folder=<id>` (present, even empty) opens Files at that folder; priority after revision, task and canvas links.
  The tab's `urlFor` is `(_, f) => `${location.pathname}?folder=${f ?? ''}``; the panel is `<div className='ChannelFiles__panel' role='tabpanel'>` with `key={channelId}`.

- [ ] **Step 1: Write the failing tests** (mock `components/file_explorer/file_explorer` with a stub `FileExplorerView` that prints `channelName` and `folderId`; add `files_enabled` to `renderTabs` options):
  - `'a channel with a tab bar gets a Files tab when the team has files on'`, and none when off.
  - `'?folder= opens the Files tab at that folder'` (url `/team-one/channels/trailer?folder=f1` → stub shows `trailer f1`).
  - `'?folder= falls back to Messages when files are off'`.
- [ ] **Step 2: Run** the channel_view suite. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the tab, the link handling and the panel style.
- [ ] **Step 4: Run** the Checks (all three suites, tsc, eslint, stylelint). Expected: all pass.
- [ ] **Step 5: Commit** "Add a Files tab to episode channels".

### Task 3: Live check

- [ ] **Step 1:** `npm run build`, deploy the way earlier work did, open http://localhost:8066 channel `ep01-walkthrough`, Files tab.
- [ ] **Step 2:** Check: create a folder, open it, upload a file, preview it, Back returns to the root, the recycle bin opens, the sidebar's current item is unchanged, another channel opens on Messages.
- [ ] **Step 3:** Fix anything found with a failing test first; commit.
