# Canvas storyboard — design

## Intent
Every episode channel already has a canvas (`actions/tasks.ts` creates it with the episode). The studio wants that canvas to
replace Miro as the episode's storyboard / comp board:

- lay out the scene images (layouts) in order, stack linked scenes on top of each other, and put the finished PNG under each;
- see at a glance **whose** scene each one is (a frame in that person's colour) and **which are done** (green tick);
- drop comp notes as sticky notes, one colour per person, so the colour says who wrote it;
- tag each other on notes and scenes and get notified;
- give the director (Şahan hoca) one place to see how far every episode is — on the canvas and in the sidebar.

Live cursors with names and the free pen (colour + 3 widths), arrows and text already exist and are not part of this work.

## Goals
1. **Images and scene cards** — drop many PNG/JPEG at once, laid out in filename order as scene cards; free move and overlap;
   frame colour from the scene's owner; scene label and done tick; a "final" slot under each scene; who created / last edited.
2. **Sticky notes and mentions** — sticky tool (click-drag to size), personal colour, author shown; `@` mentions in stickies
   and scene owner assignments post a message in the episode channel that jumps to the element.
3. **Progress** — done / total scenes per canvas, shown at the top of the canvas and next to the episode channel in the sidebar.
4. **Stickers** — place emoji (custom emoji included) and GIFs on the board; GIFs animate.

Each phase ships and merges on its own, in this order.

## Non-goals
- An overview page of all episodes (the sidebar covers "see every episode at once").
- Linking scene owners or ticks to the task system.
- Comment threads on elements; Miro import.
- Deleting uploaded files when their element is deleted (undo must be able to bring them back).

## Anti-goals
- Image bytes inside the Yjs document (the doc syncs in ≤ 8 MB updates and is replayed on every load).
- A board that becomes sluggish with a full episode on it (a few hundred images).
- Mention spam: re-saving a note must not notify the same people again.

## Approaches (picked: 1 for the board model, existing upload for files)
**Board model**
1. **New element types in the existing flat `elements` Y.Map (picked).** `scene`, `image`, `sticky`, `sticker` sit beside
   pen/rect/…; an image points at its scene with `sceneId`. Selection, move, undo, sync, z-order, copy/paste keep working.
2. Nested Y.Maps (a scene owning its images) — rejected: rewrites geometry, hit-testing and selection for one feature.
3. Scene cards as an HTML layer over Pixi — rejected: pan/zoom sync with hundreds of cards is fragile and slow.

**Image storage**
1. **The existing upload (`Client4.uploadFile` with the canvas channel id), referenced by `fileId` (picked).** Files that are
   never posted are already readable by anyone who may read the channel (`api4/file.go` getFile/thumbnail/preview: creator
   *or* channel read permission), and the server already makes thumbnails and previews.
2. A canvas-only upload endpoint plus a `CanvasFiles` table — rejected: no permission gap to close, more code.
3. Data URLs in the doc — rejected (anti-goal).

**Progress** — the board is opaque Yjs to the server, so the editing client reports `{done, total}`; the server stores it on
the `Canvases` row and broadcasts it. (Decoding Yjs in Go was rejected: no maintained Go port.)

**Mentions** — posted as an ordinary channel message by the mentioning user through the existing create-post path, so desktop /
push notifications, mention badges and the Mentions list all work unchanged. (DM from a bot and board-only highlights were
rejected by the user.)

## Design

### Common element fields (phase 1)
Every element gains `createdBy`, `updatedBy` (user ids) and `updatedAt` (ms). `addElement`, `updateElements`,
`writeInBatches`, `updateInBatches` and `duplicateElements` stamp them with the local user. Older elements without them show
nothing. `parseElement` accepts the new types and validates their new fields the same defensive way it does today.

### Scene card (phase 1)
```
┌─[ SC012 ]──────────────── ✔ ─┐  ← frame: owner's colour (or the scene's own colour when unassigned)
│  ┌───────┐                    │
│  │layout │┐                   │
│  └───────┘│┐  stacked linked  │
│    └──────┘│  scenes          │
│      └─────┘                  │
├───────────────────────────────┤
│  Final: [finished PNG]         │
└───────────────────────────────┘
```
- `scene` fields: `label` (string), `done` (bool), `ownerId?` (user id), `stroke` (frame colour used when no owner),
  `finalFileId?`. *My call:* no separate scene note — "tagging on a scene" is the owner assignment plus stickies placed on
  the card, so there is one note editor (the sticky) and one mention path.
- The frame is drawn thick (clearly visible zoomed out) in the owner's personal colour, read at render time — if the owner
  changes colour, their frames follow. Hovering the frame or the owner chip shows the owner's name.
- Header: the label (double-click to edit) and a tick toggle; done shows a green tick. Anyone who may edit the board may tick,
  assign or edit.
- Owner is picked from channel members in the properties panel (with "none"); assigning posts a mention (see Mentions).
- Bounds (*my call*, the Miro frame model the studio already knows): the card's `x, y, w, h` are stored and it has its own
  resize handles. Bulk drop sizes a new card to fit its image plus padding, header and final strip; after that the card only
  changes size when someone resizes it. Images inside may be moved and resized (the existing resize handles) and may overlap
  the card's edge.
- Membership is decided when a drag ends, by the pointer position against the cards' bounds at that moment (cards do not
  change size during a drag): released inside another card → joins it; released outside every card → free image
  (`sceneId` cleared); released inside its own card → stays. Each drag is one undo step.
- Moving a card moves its images in the same transaction (one undo step). Deleting a card deletes its images.
- Final slot: one finished image per scene (`finalFileId`), dropped onto the strip; dropping again replaces it (undoable).
  *My call:* one final per scene — the user's reference shows one; revisit if they need several.

### Images (phase 1)
- `image` fields: `fileId`, `sceneId?`, plus the natural aspect ratio. Coordinates are absolute board coordinates.
- **Bulk drop** (file drop or paste of PNG/JPEG onto empty board): upload all, sort by filename with natural order
  (`localeCompare(…, {numeric: true})`, so SC2 < SC10), create one scene card per file left to right from the drop point,
  scaled to a common height, with a gap between cards. *My calls:* label = filename without extension (editable — the studio's
  names carry the scene number); rows wrap after 10 cards; gap ≈ 10 % of the card height.
- Dropping files onto an existing card adds them to that card (stacked with a small offset). Dropping onto a card's final strip
  sets the final.
- Moving images between cards and out of them follows the drag-end rule above (a free image is allowed, e.g. a reference
  picture).
- Uploads: show local progress on the board; elements are written only after the upload succeeds; a failed file is reported
  and skipped. Non-images and unsupported types are refused with a message. The server's `MaxFileSize` applies.
- Rendering: draw from the server preview (`/files/{id}/preview`), not the original; double-click opens the original in the
  existing file preview modal. Textures are loaded lazily for what is on screen and released when far off screen, so a few
  hundred images stay smooth. Previews are JPEG: transparent PNGs show on white, which is fine on the white board.
- Info: selecting a scene, image or sticky shows "Created by X · date / Last edited by Y · date" in the properties panel; for
  images the uploader comes from `FileInfo.CreatorId`. The panel is hidden for read-only users today
  (`canvas_board.tsx`); for them it shows only this info section (and the scene's owner and done state), read-only.

### Sticky notes (phase 2)
- Toolbar button (shortcut `N`); click-drag sets the size (click alone gives a default size). No limit on count.
- `sticky` fields: `fill`, `text`, font size; text wraps inside and the note grows down when text overflows.
- Default fill = the author's personal colour; changeable per note from the same palette.
- The author's avatar sits in the bottom-right corner (from `createdBy`), so similar colours never mix people up.

### Personal colour (phase 2; phase 1 uses it for frames with the existing hash colour as fallback)
- Stored in the user's own `User.Props["canvas_color"]` (props are visible to other users, preferences are not — frames and
  stickies must show *other* people's colours). Set from a "My colour" picker on the canvas (fixed palette of ~12 light,
  distinct colours, readable with dark text).
- Used for: the user's cursor, default sticky fill, and frames of scenes they own. Unset → today's `colorFor(userId)`.
- *Changed from the conversation:* I said "user preferences"; props are the same experience but readable by others.

### Mentions (phase 2)
- Typing `@` in a sticky (the board's text overlay) opens the webapp's existing at-mention suggestions (channel members).
  Plain text elements do not mention.
- When an edit is committed, compare the @usernames before and after; for the newly added ones who are channel members, post
  one message as the editing user in the episode channel:
  `@ayse @mert — mentioned you on the canvas: “excerpt…” [Show](…?canvas=1&element=<id>)`.
  Removing and re-adding the same person in one edit session does not post twice; re-saving unchanged text posts nothing.
- Assigning a scene owner posts `@ayse — assigned you scene SC012 [Show](…)` (not when the user assigns themself).
- `?canvas=1&element=<id>` opens the Canvas tab, zooms to the element and flashes it. A missing element just opens the canvas.

### Progress (phase 3)
- Migration: `Canvases.ScenesTotal`, `Canvases.ScenesDone` (int, default 0).
- `PUT /api/v4/channels/{id}/canvas/progress {total, done}` — same permission as posting canvas updates; validates
  `0 ≤ done ≤ total ≤ 100000`; stores and broadcasts `canvas_progress {channel_id, total, done}` to the channel.
- `GET /api/v4/teams/{id}/canvases/progress` — progress of the canvases in channels the user is a member of, for the sidebar
  on load.
- Client: on doc change (debounced ~2 s) count `scene` elements and done ones; send when they differ from the last known
  server value. Concurrent editors converge because each reports its view of the merged doc. Note: the number only changes
  when someone edits the board, so it can never be "stale" relative to an unedited board.
- The director is a member of every episode channel (confirmed by the user), so the sidebar is enough to see all episodes;
  no auto-join or unjoined-channel view is needed.
- Canvas header: `████████░░░░ 38/60 scenes · 63 %`. Sidebar: a thin bar + % under the episode channel name, only when
  `total > 0`.

### Stickers (phase 4)
- Toolbar button opens the existing emoji picker (system + custom emoji) and, when the server's GIF picker is enabled, the
  existing GIF picker. The pick is placed at the view centre as a `sticker` element (`emoji` name or GIF URL), resizable.
- GIFs animate on the board; this needs a GIF texture loader for Pixi (new dependency, e.g. `@pixi/gif` — check the version
  matches the board's Pixi). Animations pause when off screen.

## Constraints
- Existing canvas sync limits: ≤ 512 KB per post, 8 MB per update; new fields must keep elements small (no image bytes).
- Server: store methods use `request.CTX`, not `context.Context`; after `i18n/en.json` edits run `make i18n-extract` and fill
  descriptions; never `go mod tidy` (use `make modules-tidy`).
- Webapp: Compass UI for new controls, compass-icons for icons, `WithTooltip` for tooltips; all strings i18n'd (en + tr).
- Read-only board users see everything but cannot tick, assign, drop or edit.

## Left to the builder
Exact sizes, paddings, palette values, icons, sidebar bar styling; texture loading / culling strategy (within the "few hundred
images stay smooth" goal); upload parallelism; how the suggestion box is attached to the board's text editor; test split.
Each phase gets its own tests following the canvas tests already there (`model.test.ts`, `canvas_board.test.tsx`,
`sync.test.ts`, `api4/canvas_test.go`, store tests).
