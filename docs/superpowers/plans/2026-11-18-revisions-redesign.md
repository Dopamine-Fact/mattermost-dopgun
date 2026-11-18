# Revisions Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Revisions tab as two columns, with a searchable revision list on the left and video plus create form (or revision detail) on the right, matching the user's mockup.

**Architecture:** `components/tasks/revisions.tsx` keeps its data logic (versions, revision rule, frame stepping, seek) and gets a new two-column render. `channel_tabs.tsx` passes the existing `TaskDetail` element into `Revisions` as a `detail` prop instead of rendering it beside it. Webapp only; the reference image is sent as the new revision's first task comment through the existing `Client4.createTaskComment`.

**Tech Stack:** React, react-intl, SCSS (tasks.scss), Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-18-revisions-redesign-design.md`

## Global Constraints

- No server, API or schema changes. A revision stays pinned to one moment (`video_time`).
- Every new string gets an entry in `webapp/channels/src/i18n/en.json` (`{defaultMessage, description}`) and `tr.json` (formal Turkish), inserted by hand in sorted order. Never run i18n-extract.
- Colours come from existing tokens: `--button-bg`, `--center-channel-*`, `--error-text`, `--task-status-color` via the `TaskStatus--<status>` classes.
- Menus use `components/menu` (`Menu.Container`, `Menu.Item`); icons come from `@mattermost/compass-icons/components`.
- Checks run from `webapp/channels`: `TZ=UTC timeout 280 npx jest src/components/tasks src/components/channel_view`, `npx tsc --noEmit -p .`, `npx eslint <files> | grep -v linebreak-style`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push without the user's yes.

## Review Focus

1. A viewer who can't manage revisions sees no create button, no form and no ⋮ menu, but can still search, filter, open a revision and watch.
2. A rejected reference image (wrong type, over 10 MB) shows an error and is not attached. A failed comment upload after a successful create keeps the revision and says the image failed.
3. Search and filter with no matches show "No revisions match", not the "No revisions yet" hint.
4. Opening a revision from an older version still switches the video to that version and seeks (existing test kept).
5. Closing the detail (its ✕, or Delete) brings the form back for managers.

---

### Task 1: List column

**Files:**
- Modify: `webapp/channels/src/components/tasks/revisions.tsx`
- Modify: `webapp/channels/src/components/tasks/task_utils.ts` (add `revisionStatusMessages`)
- Modify: `webapp/channels/src/components/tasks/tasks.scss` (replace the `.TaskRevisions` block)
- Modify: `webapp/channels/src/i18n/en.json`, `tr.json`
- Test: `webapp/channels/src/components/tasks/revisions.test.tsx`

**Interfaces:**
- Produces: `revisionStatusMessages` in `task_utils.ts`, with the same keys as `statusMessages`: `tasks.revisions.status.todo` "Revision requested" / "Revizyon İstendi", `.in_progress` "In review" / "İnceleniyor", `.done` "Done" / "Tamamlandı".
- Produces: the root `.TaskRevisions` with children `.TaskRevisions__side` (list) and `.TaskRevisions__stage` (right column, filled in Task 2).

- [ ] **Step 1: Write the failing tests** in `revisions.test.tsx`:
  - `'searching keeps only revisions whose title matches'`: type `b` into textbox "Search revisions". Only "Revision b" stays.
  - `'the status filter keeps one status'`: select `done` in combobox "Status". Only the done revision stays; the card shows its pill "Done".
  - `'no match says so'`: search `zzz`. The text "No revisions match" shows and the "No revisions yet" hint doesn't.
  - `'a card shows its version, date and status pill'`: a todo revision shows "Revision requested" and "v2".
  - `'managers can delete from the card menu; others get no menu'`: the button "Revision options" opens a menu, and "Delete" dispatches `deleteTask('a')` (mock it like `createTask`). With `canManage={false}` there is no "Revision options" button.
- [ ] **Step 2: Run them.** Expected: the 5 new tests FAIL (no search box, no menu).
- [ ] **Step 3: Implement the left column.**
  - Header: `h2` "Revisions", subtitle "All revisions made on this channel's video", and a "Create revision" button (managers only) that calls `onSelect('')`.
  - `search` and `statusFilter` state. `shown = revisions.filter(title includes search, case-insensitive; and statusFilter === '' or status === statusFilter)`.
  - Card `li.TaskRevisions__card` with `TaskStatus--${status}`:
    - a still button with a play glyph and `formatVideoTime`;
    - a title button;
    - always a version badge `v{n}`, its title tooltip only when the version isn't the selected one;
    - the date `formatDate(create_at, {dateStyle: 'medium', timeStyle: 'short'})`;
    - a pill `.TaskRevisions__pill` with `revisionStatusMessages`;
    - a ⋮ `Menu.Container` (managers) with one Delete item dispatching `deleteTask(id)` and, when it was selected, `onSelect('')`.
  - The status change control leaves the card; it lives in the detail now.
- [ ] **Step 4: Update the existing tests** that relied on the removed `StatusSelect` on cards. Run the whole file. Expected: all PASS.
- [ ] **Step 5: Commit** with the message "Revisions list column: search, status filter, pills and card menu".

### Task 2: Stage column: video, moment bar, filmstrip, create form

**Files:** `revisions.tsx`, `tasks.scss`, `en.json`, `tr.json`, `revisions.test.tsx`

**Interfaces:**
- Consumes: `useFrameThumbnails(src, times)`, `Client4.createTaskComment(taskId, message, files)`.
- Produces: `Revisions` renders `.TaskRevisions__stage` = version row + video + `.TaskRevisions__moment` + `.TaskRevisions__strip` + `.TaskRevisions__panel`. The panel holds the form (Task 3 swaps in the detail).

- [ ] **Step 1: Write the failing tests:**
  - `'the form pins the current moment when asked and creates the revision there'`:
    - set the video time to 3.5 s and click "Use current time";
    - move the time to 9 s, type "Logo too small" into "Revision description" and click "Create revision";
    - expect `createTask` with `video_time: 3500` and `title: 'Logo too small'`;
    - the counter shows `14 / 500` before submit.
  - `'without a pinned moment the revision takes the player time'`: video at 2 s. Expect `video_time: 2000`.
  - `'a reference image is sent as the first comment of the new revision'`:
    - mock `Client4.createTaskComment`;
    - choose a `new File(['x'], 'ref.png', {type: 'image/png'})` in "Reference image";
    - submit;
    - expect `createTaskComment('new', '', [file])` before `onSelect('new')`.
  - `'a non-image or a file over 10 MB is refused'`: a `text/plain` file shows "PNG, JPG or WEBP up to 10 MB" as an alert, and the submit sends no comment.
  - `'Cancel clears the form'`: text and image are gone.
  - `'clicking the filmstrip seeks'`:
    - the video duration is 10 s;
    - click the strip at 50% of its width (mock `getBoundingClientRect` to `{left: 0, width: 200}`, `clientX: 100`);
    - `currentTime` becomes 5.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - State `duration` comes from `onLoadedMetadata`; `now` comes from `onTimeUpdate`/`onSeeked` in ms; `pinned: number | null`.
  - The moment box shows `formatVideoTime(pinned ?? now)`. "Use current time" sets `pinned = now`.
  - Strip times: 10 even points `(i + 0.5) * duration / 10` in ms, rounded, fed to the same `useFrameThumbnails` call as the cards (one hidden video). The marker is at `(pinned ?? now) / duration`.
  - The form has:
    - a textarea, `maxLength={500}`, required, with a counter;
    - a file input `accept='image/png,image/jpeg,image/webp'` plus a drop zone (`onDragOver` preventDefault, `onDrop` takes the first file);
    - validation: type in that list and `size <= 10 * 1024 * 1024`;
    - an object-URL preview with ✕, revoked on change and unmount.
  - Submit:
    1. `createTask({..., title, video_time: pinned ?? now})`.
    2. If there is an image, `await Client4.createTaskComment(id, '', [image])`. On failure, show "The revision was created but the image could not be attached".
    3. Clear the form and `onSelect(id)`.
  - Cancel clears the form.
  - Moves the version picker, upload button and replace error into the stage header; the frame hint becomes the video's `title`.
- [ ] **Step 4: Update the existing add tests** (old placeholder and "Add revision" button). Run the file. Expected: all PASS.
- [ ] **Step 5: Commit** with the message "Revisions stage: moment bar, filmstrip and create form with reference image".

### Task 3: Detail in place of the form

**Files:**
- Modify: `webapp/channels/src/components/channel_view/channel_tabs.tsx:213-233`
- Modify: `revisions.tsx`, `revisions.test.tsx`, `channel_tabs.test.tsx`

**Interfaces:**
- Produces: `Revisions` prop `detail?: React.ReactNode`. When set, it replaces the form in `.TaskRevisions__panel`.
- For a non-manager with no detail, the panel shows "Select a revision".

- [ ] **Step 1: Write the failing tests:**
  - revisions: `'a passed detail replaces the form'` (render with `detail={<div>detail here</div>}`; "detail here" shows and textbox "Revision description" is absent);
  - revisions: `'viewers with nothing selected are asked to pick a revision'`;
  - channel_tabs: on the revisions tab, the selected revision's detail renders inside `.TaskRevisions__panel`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `detail={detail}` to `Revisions` and drop the sibling `{detail}` in the revisions branch only.
- [ ] **Step 4: Run the tasks and channel_view jest suites, tsc and eslint on the changed files.** Expected: all pass, no new lint errors.
- [ ] **Step 5: Commit** with the message "Show a revision's detail in place of the create form".

### Task 4: Look and live check

**Files:** `tasks.scss` (polish only), `RevisionTabs__main` if the stage needs full height.

- [ ] **Step 1: Make the styles match the mockup.**
  - The side is about 420px wide and the stage takes the rest.
  - Cards are rows: a 96×54 still, then text, then the pill and ⋮.
  - Stage: the video and the panel sit side by side above 1200px wide and stack below; the strip is under the video.
  - Under 900px the side and the stage stack.
- [ ] **Step 2: Build and check.**
  - Run `npm run build` in `webapp/channels`.
  - Open `http://localhost:8066/dopaminefact/channels/ep01-walkthrough` → Revisions.
  - Check search, filter, card menu, pin, strip seek, create with an image, opening a revision, and closing the detail. Delete only the revision this check created, and ask first.
  - Expected: all behave as the spec says, with no console errors.
- [ ] **Step 3: Commit** with the message "Revisions redesign styles".
