# Canvas Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-team canvas channels: a chat channel with a Messages | Canvas tab bar holding a real-time collaborative whiteboard.

**Architecture:** A Yjs document is the canvas state; a PixiJS renderer only draws it. The Go server stores Yjs updates with a per-channel gapless sequence and relays them over the Mattermost websocket; presence (cursors) travels as Yjs awareness over a websocket action. The webapp wraps the channel center in `CanvasTabs`, mirroring `RevisionTabs`.

**Tech Stack:** Go + Postgres, React/Redux, `pixi.js` v8, `pixi-viewport` v6, `perfect-freehand`, `roughjs` v4 (generator only, for sloppiness and hachure fills), `yjs`, `y-protocols` (awareness), `lib0` (base64, comes with yjs), jest.

**Spec:** `docs/superpowers/specs/2026-11-16-canvas-channels-design.md`

## Global Constraints

- Canvas is on only when `team.canvas_enabled`; independent of `tasks_enabled`.
- New migration `000248_create_canvases` (247 is taken); add both files to `server/channels/db/migrations/migrations.list`.
- After changing a store interface run `make store-layers` and `make store-mocks` (never hand-edit retrylayer/timerlayer/mocks). Never `go mod tidy`.
- Limits (in `model/canvas.go`): `CanvasUpdateMaxBytes = 512 * 1024`, `CanvasSnapshotMaxBytes = 20 * 1024 * 1024`, `CanvasAwarenessMaxBytes = 64 * 1024` (decoded bytes).
- Client timings: update flush ≤ every 50 ms, awareness send ≤ every 50 ms, gap refetch after 2 s, compaction after 200 updates past the snapshot, POST retry backoff 1 s doubling to 30 s.
- npm packages installed with `--save-exact`, latest stable at install time within the majors above.
- Pixi and Rough.js must not be in the main bundle: the board is loaded with `React.lazy(() => import('./canvas_board'))`.
- Zoom range 0.1–30 (10 %–3000 %); zoom buttons and Ctrl + = / − step by ×1.1 around the viewport centre; wheel zoom is around the pointer.
- Style option values (stored in the doc, so fixed now): colours are 6 stroke presets + 6 background presets + `'transparent'`; `strokeWidth` 1 | 2 | 4; `roughness` 0 | 1 | 2; `fontSize` 16 | 20 | 28 | 36; `opacity` integer 0–100.
- CRLF files keep CRLF. Server `en.json` via `make i18n-extract` with descriptions; `tr.json` new keys appended. Webapp i18n via extract, every string has a description.
- No commits (user's rule).
- Go tests run in the same Docker setup as TestTasks (`golang:1.26.10`, `mm-gomod`/`mm-gobuild` volumes, `-w /src/server`).

## Review Focus

- Two clients edit concurrently, one goes offline mid-drag, comes back: both end with identical elements and nothing typed during the outage is lost (unsent updates stay queued and retry).
- Updates committed out of order or missed while the websocket was down: a client must never compact while it has a seq gap, and compaction must never drop an update the snapshot doesn't contain.
- A non-member, a member of another team, or anyone when `canvas_enabled` is false must not read or write a canvas (403); an archived channel refuses writes.
- Oversized update / snapshot / awareness payloads are refused (413/400) without crashing the board.
- Channels that are not canvases render exactly as before (no tab bar, no extra requests when the team flag is off).
- A mixed selection (e.g. a pen stroke and a rectangle) in the side panel: only shared sections appear, a property with differing values highlights no option, and changing it sets it on every selected element in one undo step.

---

### Task 1: Server — model, migration, store

**Files:**
- Create: `server/public/model/canvas.go`, `server/channels/db/migrations/postgres/000248_create_canvases.{up,down}.sql`, `server/channels/store/sqlstore/canvas_store.go`, `server/channels/store/storetest/canvas_store.go`, `server/channels/store/sqlstore/canvas_store_test.go`
- Modify: `server/public/model/team.go` (+ `TeamPatch`, `Patch`, the map at ~line 93/119), `server/channels/store/store.go`, `server/channels/store/sqlstore/store.go`, `server/channels/store/sqlstore/team_store.go` (beside `RevisionsEnabled` at lines ~235/299/302/340), `server/channels/db/migrations/migrations.list`, `server/channels/store/storetest/store.go`
- Regenerate: retrylayer, timerlayer, mocks

**Interfaces:**
- Produces:
  - `Team.CanvasEnabled bool \`json:"canvas_enabled"\``, `TeamPatch.CanvasEnabled *bool`
  - `type Canvas struct { ChannelId, TeamId, CreatorId string; LastSeq, SnapshotSeq, CreateAt, UpdateAt int64 }` (json snake_case; snapshot bytes not on this struct)
  - `type CanvasUpdate struct { Seq int64 \`json:"seq"\`; Data []byte \`json:"data"\` }` (`[]byte` → base64 in JSON)
  - `type CanvasState struct { Snapshot []byte \`json:"snapshot,omitempty"\`; SnapshotSeq int64 \`json:"snapshot_seq"\`; Updates []*CanvasUpdate \`json:"updates"\`; LastSeq int64 \`json:"last_seq"\` }`
  - `type CanvasSnapshot struct { Data []byte \`json:"data"\`; UptoSeq int64 \`json:"upto_seq"\` }`
  - `CanvasStore` on `Store.Canvas()`:
    - `Save(canvas *model.Canvas) (*model.Canvas, error)` — conflict on existing ChannelId → `store.NewErrConflict`
    - `Get(channelID string) (*model.Canvas, error)` — `store.NewErrNotFound`
    - `AppendUpdate(channelID, userID string, data []byte) (int64, error)` — one tx: `UPDATE Canvases SET LastSeq = LastSeq + 1, UpdateAt = ? WHERE ChannelId = ? RETURNING LastSeq`, then insert the row with that seq (row lock ⇒ per-channel seqs are gapless and commit in order)
    - `GetState(channelID string, afterSeq int64) (*model.CanvasState, error)` — if `afterSeq < SnapshotSeq`: snapshot + updates with `Seq > SnapshotSeq`; else no snapshot, updates with `Seq > afterSeq`; ordered by Seq
    - `SaveSnapshot(channelID string, data []byte, uptoSeq int64) (bool, error)` — one tx: update snapshot only `WHERE SnapshotSeq < uptoSeq AND LastSeq >= uptoSeq`; if a row changed, delete updates with `Seq <= uptoSeq`; returns whether it was applied

- [ ] **Step 1: Store tests** in `storetest/canvas_store.go` (`TestCanvasStore`, registered like the task store):
  - save twice same channel → second is conflict; `Get` unknown → not found.
  - three `AppendUpdate` → seqs `1, 2, 3`; another channel starts at `1`.
  - `GetState(ch, 0)` → 3 updates, no snapshot, `LastSeq == 3`; `GetState(ch, 2)` → only seq 3.
  - `SaveSnapshot(ch, []byte("s"), 2)` → true; `GetState(ch, 0)` → snapshot `"s"`, `SnapshotSeq 2`, updates `[3]`; `GetState(ch, 2)` → no snapshot, `[3]`.
  - `SaveSnapshot(ch, …, 2)` again → false; `SaveSnapshot(ch, …, 9)` (beyond LastSeq) → false.
  - team round-trip keeps `CanvasEnabled = true`.
- [ ] **Step 2: Run** `go test ./channels/store/sqlstore -run TestCanvasStore` — fails (no store).
- [ ] **Step 3: Implement** model, migration, store, team column. Migration up:
  ```sql
  ALTER TABLE teams ADD COLUMN IF NOT EXISTS canvasenabled boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS canvases (channelid varchar(26) PRIMARY KEY, teamid varchar(26) NOT NULL, creatorid varchar(26) NOT NULL,
    lastseq bigint NOT NULL DEFAULT 0, snapshotseq bigint NOT NULL DEFAULT 0, snapshotdata bytea, createat bigint NOT NULL, updateat bigint NOT NULL);
  CREATE TABLE IF NOT EXISTS canvasupdates (channelid varchar(26) NOT NULL, seq bigint NOT NULL, userid varchar(26) NOT NULL,
    data bytea NOT NULL, createat bigint NOT NULL, PRIMARY KEY (channelid, seq));
  ```
  Down drops both tables and the column. Then `make store-layers store-mocks`.
- [ ] **Step 4: Run** the store test and `go vet ./channels/store/... ./public/model/` — pass.

### Task 2: Server — app, REST API, websocket

**Files:**
- Create: `server/channels/app/canvas.go`, `server/channels/api4/canvas.go`, `server/channels/api4/canvas_test.go`, `server/channels/wsapi/canvas.go`
- Modify: `server/channels/api4/api.go` (call `api.InitCanvas()`), `server/channels/wsapi/api.go` (call `api.InitCanvas()`), `server/public/model/websocket_message.go`, `server/public/model/client4.go`, `server/i18n/en.json`, `server/i18n/tr.json`

**Interfaces:**
- Consumes: Task 1 store and model.
- Produces:
  - Events `WebsocketEventCanvasUpdated = "canvas_updated"` (data: `channel_id`, `seq` int64, `data` base64 string), `WebsocketEventCanvasAwareness = "canvas_awareness"` (data: `channel_id`, `user_id`, `data` base64 string). Both channel-scoped.
  - App: `CreateCanvas(rctx, teamID, channelID, userID string) (*model.Canvas, *model.AppError)`, `GetCanvas(rctx, channelID)`, `GetCanvasState(rctx, channelID string, afterSeq int64)`, `AppendCanvasUpdate(rctx, channelID, userID string, data []byte, connectionID string) (int64, *model.AppError)` (publishes `canvas_updated` with `omitConnectionId = connectionID`), `SaveCanvasSnapshot(rctx, channelID string, snap *model.CanvasSnapshot) (bool, *model.AppError)`, `PublishCanvasAwareness(channelID, userID string, data []byte)` (omit sender user, like `PublishUserTyping`).
  - Routes:
    | Method & path | Permission | Result |
    |---|---|---|
    | `POST /api/v4/teams/{team_id}/canvases` body `{channel_id}` | `manage_public_channel_properties` / `manage_private_channel_properties` on the channel (by type) | 201 `Canvas` |
    | `GET /api/v4/channels/{channel_id}/canvas` | `read_channel` | `Canvas` / 404 |
    | `GET /api/v4/channels/{channel_id}/canvas/state?after=N` | `read_channel` | `CanvasState` |
    | `POST /api/v4/channels/{channel_id}/canvas/updates` body `{data}` | `create_post` | `{"seq": N}` |
    | `PUT /api/v4/channels/{channel_id}/canvas/snapshot` body `CanvasSnapshot` | `create_post` | `{"applied": bool}` |
  - Websocket action `canvas_awareness` `{channel_id, data}` — `read_channel` check, payload ≤ `CanvasAwarenessMaxBytes`, skipped when server busy (copy `userTyping`).
  - Client4: `CreateCanvas`, `GetCanvas`, `GetCanvasState`, `PostCanvasUpdate`, `SaveCanvasSnapshot` (used by tests).
  - Errors (en + tr): `app.canvas.disabled.app_error` (403), `app.canvas.invalid_channel.app_error` (400), `app.canvas.not_found.app_error` (404), `app.canvas.too_large.app_error` (413), `app.canvas.archived.app_error` (400).

- [ ] **Step 1: Tests** `TestCanvas` in `api4/canvas_test.go`:
  - team flag off → create 403; on → create for `th.BasicChannel` 201; again → 400; channel of another team → 400; archived channel → 400.
  - `GetCanvas` on a plain channel → 404.
  - two `PostCanvasUpdate` → seqs 1, 2; `GetCanvasState(after=1)` → only seq 2 with identical bytes.
  - a websocket client of `th.BasicUser2` (member) receives `canvas_updated` with `seq` and base64 `data`; the posting connection does not (pass its connection id header).
  - update over `CanvasUpdateMaxBytes` → 413; snapshot over `CanvasSnapshotMaxBytes` → 413.
  - non-member (`th.CreateUser` + login) → state 403, update 403.
  - flag turned off after creation → update 403, snapshot 403; archived channel → update 400.
  - `SaveCanvasSnapshot{upto_seq: 2}` → applied true; state(after=0) returns snapshot and no updates.
  - websocket action `canvas_awareness` from user1 reaches user2 with `user_id` = user1; from a non-member → error.
- [ ] **Step 2: Run** `go test ./channels/api4 -run TestCanvas` — fails.
- [ ] **Step 3: Implement.** App writes check: canvas exists, `team.CanvasEnabled`, `channel.DeleteAt == 0`, size limit. Reads check only canvas exists and channel permission. Read bodies with `http.MaxBytesReader` sized from the limit ×4/3 + 1 KB (base64). Then `make i18n-extract`, add descriptions, append tr strings.
- [ ] **Step 4: Run** TestCanvas, TestTasks (team model touched) and `go vet ./channels/app/ ./channels/api4/ ./channels/wsapi/ ./public/model/` — pass.

### Task 3: Webapp — types, client, websocket events, team toggle

**Files:**
- Create: `webapp/platform/types/src/canvas.ts`
- Modify: `webapp/platform/types/src/teams.ts`, `webapp/platform/client/src/client4.ts`, `webapp/platform/client/src/websocket_events.ts`, `websocket_messages.ts`, `websocket_message.ts`
- Modify: `webapp/channels/src/components/team_settings/team_info_tab/team_info_tab.tsx` (+ a `CheckboxSettingItem` beside `TeamTasksSection`)
- Modify: `webapp/channels/package.json` (`yjs`, `y-protocols`, `pixi.js`, `pixi-viewport`, `perfect-freehand`, `roughjs`), `webapp/channels/jest.config.js` (add `yjs|lib0|y-protocols` to `transformIgnorePatterns`)
- Test: `team_info_tab.test.tsx`

**Interfaces:**
- Produces: `Team.canvas_enabled: boolean`; `Canvas`, `CanvasState = {snapshot?: string; snapshot_seq: number; updates: Array<{seq: number; data: string}>; last_seq: number}` (data base64); `Client4.createCanvas(teamId, channelId): Promise<Canvas>`, `getCanvas(channelId): Promise<Canvas>`, `getCanvasState(channelId, after = 0): Promise<CanvasState>`, `postCanvasUpdate(channelId, data: string): Promise<{seq: number}>`, `saveCanvasSnapshot(channelId, data: string, uptoSeq: number): Promise<{applied: boolean}>`; `WebSocketEvents.CanvasUpdated = 'canvas_updated'`, `CanvasAwareness = 'canvas_awareness'`.

- [ ] **Step 1: Test** — team settings show "Enable canvas channels"; toggling and saving calls `patchTeam` with `canvas_enabled: true`; reset restores it.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement**; `npm install --save-exact` the six packages in `webapp/channels`. Update `Team` fixtures (`canvas_enabled: false`).
- [ ] **Step 4: Run** test + `npx tsc -b` — pass.

### Task 4: Webapp — canvas model and sync provider (no Pixi)

**Files:**
- Create: `webapp/channels/src/components/canvas/model.ts`, `sync.ts`, `geometry.ts`
- Test: `model.test.ts`, `sync.test.ts`, `geometry.test.ts`

**Interfaces:**
- Consumes: Task 3 client methods and events.
- Produces:
  - `model.ts`:
    - `type ElementType = 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text'`
    - `type ElementStyle = {stroke: string; fill: string /* 'transparent' or colour */; fillStyle: 'solid' | 'hachure' | 'cross-hatch'; strokeWidth: 1 | 2 | 4; strokeStyle: 'solid' | 'dashed' | 'dotted'; roughness: 0 | 1 | 2; roundness: 'sharp' | 'round'; opacity: number; startArrow: Arrowhead; endArrow: Arrowhead; fontSize: 16 | 20 | 28 | 36; fontFamily: 'normal' | 'code'; textAlign: 'left' | 'center' | 'right'}` with `type Arrowhead = 'none' | 'arrow' | 'triangle' | 'bar'`; `DEFAULT_STYLE` (black stroke, transparent fill, hachure, 2, solid, roughness 1, round, 100, `startArrow 'none'`, `endArrow 'arrow'`, 20, normal, left); a `line` element is always created with `endArrow 'none'` (the panel can still add heads).
    - `type CanvasElement = ElementStyle & {id: string; type: ElementType; x: number; y: number; w: number; h: number; points?: number[] /* flat [x0,y0,x1,y1…] relative to x,y */; text?: string; z: number; seed: number /* Rough.js seed, random int at creation */}`
    - `LOCAL = Symbol('local')`, `REMOTE = Symbol('remote')`; `createCanvasDoc(): {doc: Y.Doc; elements: Y.Map<Y.Map<unknown>>; undo: Y.UndoManager}` (undo tracks `LOCAL` only)
    - `addElement(doc, el)`, `updateElements(doc, ids: string[], patch: Partial<CanvasElement>)`, `deleteElements(doc, ids)`, `duplicateElements(doc, ids, offset = 10): string[]` (new ids, new seeds, placed on top), `reorder(doc, ids, op: 'back' | 'backward' | 'forward' | 'front')`, `readElements(elements): CanvasElement[]` sorted by `z` then id — every write is one `doc.transact(…, LOCAL)` (one undo step).
    - `reorder`: front/back set `z` to max+1…/min−1… keeping the selection's relative order; forward/backward swap each selected element's `z` with the next/previous unselected one in the sorted list.
  - `geometry.ts`: `bounds(el): {x, y, w, h}` (normalised for negative w/h), `unionBounds(els)`, `hitTest(els, p, tolerance): string | undefined` (topmost; pen/line/arrow by segment distance, shapes by outline or by area when `fill !== 'transparent'`, text by box), `inRect(els, rect): string[]`, `resize(el, handle: 'nw'|'ne'|'sw'|'se', dx, dy): Partial<CanvasElement>` (scales `points`), `align(els, mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): Record<string, {x: number; y: number}>` (to the selection's union bounds), `dashPolyline(points: number[], pattern: number[]): number[][]` (splits a flat polyline into dash segments; dashed `[8, 6]`×strokeWidth, dotted `[1, 4]`×strokeWidth), `fitViewport(b, viewW, viewH, padding = 40): {scale: number; cx: number; cy: number}` (scale clamped to 0.1–30).
  - `sync.ts`: `class CanvasSync { constructor(doc: Y.Doc, channelId: string, deps: SyncDeps); start(): Promise<void>; destroy(): void; status: 'loading' | 'synced' | 'offline'; onStatus?: (s) => void; awareness: Awareness }` with `type SyncDeps = {client: Pick<Client4, 'getCanvasState' | 'postCanvasUpdate' | 'saveCanvasSnapshot'>; ws: {addMessageListener, removeMessageListener, addReconnectListener, removeReconnectListener, sendMessage}; userId: string}` (production passes `Client4` and the default `WebSocketClient`).
  - Sync rules: apply remote data with origin `REMOTE`; track a set of received seqs and `lastSeq` = highest contiguous; seq gap lasting 2 s or a reconnect → `getCanvasState(channelId, lastSeq)`; local updates queued, merged with `Y.mergeUpdates`, posted at most every 50 ms; failed post keeps the queue and retries with backoff (status `offline`); own post's returned seq counts as received; compaction when `lastSeq - snapshotSeq >= 200` and no gap and empty queue → `saveCanvasSnapshot(base64(Y.encodeStateAsUpdate(doc)), lastSeq)`; awareness local changes sent as `canvas_awareness` (throttled 50 ms), remote applied; `destroy` clears local awareness state and listeners. Base64 via `lib0/buffer` `toBase64`/`fromBase64`.

- [ ] **Step 1: Tests**
  - model: add/update/delete round-trip; `undo.undo()` reverts only `LOCAL` changes, not a `REMOTE` applied update; `updateElements` on two ids is undone by one `undo()`; `duplicateElements` returns 2 new ids with `x + 10`, different seeds, z above all; with z order `a b c d`: `reorder([b], 'forward')` → `a c b d`, `reorder([c], 'front')` → `a b d c`, `reorder([b, c], 'back')` → `b c a d`.
  - geometry: `hitTest` picks the topmost of two overlapping rects; a point inside an unfilled rect misses, inside a filled one hits; a point 3 px from a pen segment hits with tolerance 5 and misses with 2; `resize` 'se' by (+10,+10) on a 10×10 pen doubles its points; `align` 'left' moves both rects to the smaller x; `dashPolyline([0,0,30,0], [8,6])` → segments `[0,0,8,0]`, `[14,0,22,0]`, `[28,0,30,0]`; `fitViewport` of a 1000×500 box in an 800×600 view gives scale `(800-80)/1000`.
  - sync, with an in-memory fake server (assigns seqs, fans out to fake websockets except the sender):
    - two docs: A adds a rect, B moves another concurrently → after flush both `readElements` are equal.
    - post rejects twice then succeeds → element arrives at B; status went `offline` → `synced`.
    - B misses seq 2 (fake drops it) and gets 3 → after 2 s (fake timers) B calls `getCanvasState(ch, 1)` and converges.
    - reconnect listener → `getCanvasState(ch, lastSeq)` called.
    - 200 updates → exactly one `saveCanvasSnapshot` with `uptoSeq` = lastSeq; not called while a gap is open.
    - remote awareness message → `awareness.getStates()` contains B's cursor.
- [ ] **Step 2: Run** `npx jest components/canvas` — fails.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** tests + `tsc` — pass.

### Task 5: Webapp — Pixi board, tools and navigation

**Files:**
- Create: `webapp/channels/src/components/canvas/renderer.ts`, `canvas_board.tsx`, `canvas_toolbar.tsx`, `canvas_footer.tsx`, `canvas.scss`
- Test: `canvas_board.test.tsx` (mocks `./renderer`)

**Interfaces:**
- Consumes: Task 4 `createCanvasDoc`, `CanvasSync`, model ops, geometry.
- Produces:
  - `class CanvasRenderer { static create(host: HTMLElement): Promise<CanvasRenderer>; draw(els: CanvasElement[], selected: string[]): void; drawCursors(cursors: Array<{userId, name, color, x, y}>): void; toWorld(clientX, clientY): {x, y}; toScreen(x, y): {x, y}; setPanMode(on: boolean): void; getZoom(): number; setZoom(scale: number): void; zoomBy(factor: number): void /* around viewport centre */; fitTo(b: {x, y, w, h}): void /* uses fitViewport */; onViewportChange?: () => void; destroy(): void }`
  - Renderer details: Pixi `Application` + `pixi-viewport` with `wheel({trackpadPinch: true, wheelZoom: false})` (scroll pans, Ctrl + wheel / pinch zooms at the pointer; verify the option names against the installed version), `drag({mouseButtons: 'middle'})` always plus left-button drag in pan mode, `pinch()`, `clampZoom({minScale: 0.1, maxScale: 30})`. One `Graphics`/`Text` per element id, rebuilt only when that element's fields changed. Shapes, lines and arrows come from Rough.js `rough.generator()` with the element's `seed`, `roughness`, `fill`, `fillStyle`, `strokeWidth` and rounded corners for `roundness: 'round'`; its ops (move / lineTo / bcurveTo) are replayed onto Pixi `Graphics`; dashed/dotted strokes sample the ops into polylines and use `dashPolyline`. Pen via perfect-freehand `getStroke(points)` filled as a polygon. Arrowheads drawn at the end segments per `startArrow`/`endArrow`. Element `alpha = opacity / 100`. Selection: dashed bounding box with four corner handles; marquee rectangle while dragging on empty space.
  - `CanvasBoard({channelId, readOnly}: {channelId: string; readOnly: boolean})` default export — owns doc, sync, renderer and `style: ElementStyle` (starts as `DEFAULT_STYLE`, used for new elements); tool state `'select' | 'hand' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'eraser'`; pointer handlers use geometry for hit/drag/resize/marquee; shift-click toggles selection; text editing via an absolutely positioned `<textarea>` placed with `toScreen` and scaled by zoom; pointer moves set awareness `cursor` (world coords); status chip shows `offline`. `readOnly` (no `create_post`) keeps only hand, zoom and the footer zoom controls.
  - Keys: `V H P R O L A T E` and `1`–`9` (same order) pick tools; Space held = temporary pan; Delete/Backspace remove; Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo/redo; Ctrl+D duplicate; Ctrl+C / Ctrl+V copy/paste inside the board (in-memory, pasted at the pointer); arrows nudge 1 px, Shift+arrows 10 px; Ctrl+= / Ctrl+− zoom ×1.1 / ÷1.1; Ctrl+0 zoom 1; Shift+1 fit all; Shift+2 fit selection; Escape clears selection. Keys are ignored while the textarea or any input is focused.
  - `canvas_toolbar.tsx`: top-centre tool buttons with key hints. `canvas_footer.tsx`: bottom-left `[−] [NN%] [+]  [undo] [redo]`; clicking the percentage sets zoom 1; undo/redo disabled when the stack is empty.
  - During a drag the element updates in the doc on every pointermove (sync batches them).

- [ ] **Step 1: Tests** (renderer mocked, `getZoom` returns 1):
  - toolbar renders all 9 tools; pressing `R` then a pointer drag from (10,10) to (60,40) adds one `rect` with `w 50, h 30` and `DEFAULT_STYLE` fields; `Delete` with it selected removes it; `Ctrl+Z` brings it back.
  - Ctrl+D creates a second rect at `x + 10`; `ArrowRight` moves the selection by 1, `Shift+ArrowRight` by 10.
  - footer: `+` calls `zoomBy(1.1)`, `−` calls `zoomBy(1 / 1.1)`, clicking `100%` calls `setZoom(1)`; `Shift+1` calls `fitTo` with the union bounds of all elements.
  - pressing `R` while the text textarea is focused does not change the tool.
  - `readOnly` shows only the hand tool and the zoom controls.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, `tsc`, eslint, stylelint — clean.

### Task 6: Webapp — properties side panel

**Files:**
- Create: `webapp/channels/src/components/canvas/canvas_properties.tsx`
- Modify: `canvas_board.tsx`, `canvas.scss`
- Test: `canvas_properties.test.tsx`

**Interfaces:**
- Consumes: Task 4 `ElementStyle`, `updateElements`, `duplicateElements`, `deleteElements`, `reorder`, `align`; Task 5 board selection and `style` state.
- Produces: `CanvasProperties({types, values, onChange, onAction}: {types: ElementType[] /* active tool's type, or the selected elements' types */; values: Partial<ElementStyle> /* key absent when the selection disagrees */; onChange: (patch: Partial<ElementStyle>) => void; onAction: (a: 'duplicate' | 'delete' | 'back' | 'backward' | 'forward' | 'front' | AlignMode) => void; selectionCount: number})`.
  - Sections and when they show (a section shows only if every type in `types` supports it): stroke colour (all); background + fill style (`rect`, `ellipse`); stroke width (all but `text`); stroke style and sloppiness (`rect`, `ellipse`, `line`, `arrow`); edges (`rect`); arrowheads start/end (`line`, `arrow`); font size, font family, text align (`text`); opacity (all). Layers and actions (duplicate, delete) only when `selectionCount > 0`; align only when `selectionCount >= 2`.
  - Board wiring: `onChange` → `updateElements(selectedIds, patch)` when something is selected (one undo step) and always merges into `style`; actions map to the model ops; the panel is a left-side floating card, hidden when the tool is `select`/`hand`/`eraser` and nothing is selected, and in `readOnly`.
  - Buttons are `aria-pressed` toggles grouped with `role='radiogroup'` labels so tests and screen readers can address them; the colour row has a native `<input type='color'>` for custom colours.

- [ ] **Step 1: Tests**
  - `types=['rect']` shows background, fill style and edges, not arrowheads or font; `types=['arrow']` shows arrowheads, not background; `types=['pen', 'rect']` hides background, edges and sloppiness.
  - `values={strokeWidth: 4}` marks "Extra bold" pressed; `values={}` marks no stroke width pressed.
  - clicking "Dashed" calls `onChange({strokeStyle: 'dashed'})`; moving the opacity slider to 50 calls `onChange({opacity: 50})`.
  - `selectionCount=1` shows layer buttons and hides align; `selectionCount=2` shows align; "Bring to front" calls `onAction('front')`.
  - board (renderer mocked): with two rects selected, choosing a red stroke updates both in the doc and one `Ctrl+Z` reverts both; with nothing selected, choosing "Cartoonist" then drawing a rect gives it `roughness: 2`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, `tsc`, eslint, stylelint, webapp i18n extract (all labels translatable with descriptions) — clean.

### Task 7: Webapp — Canvas tab and "Create canvas channel"

**Files:**
- Create: `webapp/channels/src/components/canvas/canvas_tabs.tsx`, `canvas_channel_modal.tsx`, `webapp/channels/src/actions/canvas.ts`
- Modify: `webapp/channels/src/components/channel_view/channel_view.tsx` (wrap the existing `<RevisionTabs>` in `<CanvasTabs channelId=…>`), `sidebar_browse_or_add_channel_menu.tsx` (item after "Create revision channel"), `utils/constants.tsx` (`ModalIdentifiers.CANVAS_CHANNEL_MODAL`), `webapp/channels/src/i18n/en.json`
- Test: `canvas_tabs.test.tsx`, `canvas_channel_modal.test.tsx`, `actions/canvas.test.ts`, `sidebar_browse_or_add_channel_menu.test.tsx`

**Interfaces:**
- Consumes: Task 3 client, Task 5 `CanvasBoard`.
- Produces: `CanvasTabs({channelId, children})`; `createCanvasChannel(teamId: string, displayName: string): ActionFuncAsync<Channel>` — `createChannel({team_id, name: cleanUpUrlable(displayName) || generateId(), display_name, type: 'O'}, me)` then `Client4.createCanvas`; on failure `deleteChannel` and return `{error}`.
  - `CanvasTabs`: when `team.canvas_enabled`, calls `Client4.getCanvas(channelId)` on channel change (404 ⇒ not a canvas, render children only; no request when the flag is off); tabs reuse the `RevisionTabs__tab` classes; Canvas tab renders `<Suspense><LazyCanvasBoard channelId readOnly={!canPost}/></Suspense>`; `?canvas=1` opens the Canvas tab.

- [ ] **Step 1: Tests**
  - tabs: flag off → children only and `getCanvas` not called; flag on + 404 → children only; flag on + canvas → "Messages" / "Canvas" tabs, clicking Canvas renders the (mocked) board and hides children.
  - action: `createCanvas` rejects → `deleteChannel` called, `{error}` returned; success returns the channel.
  - modal: Create disabled until a name; success navigates to `/{team}/channels/{name}?canvas=1` and closes; error shown.
  - menu: "Create canvas channel" only when `canvas_enabled` and the user has `create_public_channel`.
- [ ] **Step 2: Run** — fail.
- [ ] **Step 3: Implement**; webapp i18n extract with descriptions.
- [ ] **Step 4: Run** all canvas, revision and sidebar tests, `tsc`, eslint, stylelint — clean apart from known warnings.

### Task 8: End-to-end check

- [ ] Rebuild server (migration 248 runs on start) and webpack; restart the server.
- [ ] Browser: enable canvas in team settings → Add Channels → Create canvas channel → Canvas tab opens. In two windows (two users): draw pen, rect, ellipse, arrow, text; move/resize; both see each other's cursors and changes within ~100 ms; undo in one window only undoes its own change.
- [ ] Side panel: change stroke, background + hachure, dashed, cartoonist, round edges, arrowheads, font size, opacity on a selection; window B shows the same wobble (same seed) and styles. Layer buttons and align on 2+ elements work; Ctrl+D, Ctrl+C/V, arrow-key nudge work.
- [ ] Navigation: trackpad scroll pans, pinch / Ctrl+wheel zooms at the pointer, Space+drag and middle-drag pan, footer − / % / + and Ctrl+0, Shift+1, Shift+2 behave; zoom stops at 10 % and 3000 %.
- [ ] Network offline in window A for 10 s while drawing, then online → B receives everything, A receives B's changes.
- [ ] Draw > 200 strokes → reload → board identical (compaction happened: `CanvasUpdates` row count dropped).
- [ ] Check the main bundle doesn't contain Pixi (network tab: Pixi chunk loads only when the Canvas tab opens).
- [ ] Turn the flag off → tab and menu item gone, a write returns 403.
