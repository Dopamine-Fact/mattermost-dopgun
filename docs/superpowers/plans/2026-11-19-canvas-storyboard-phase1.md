# Canvas storyboard, phase 1: images and scene cards. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people drop many PNG/JPEG files on an episode canvas. Each file is laid out in filename order as a scene card with a frame in its owner's colour, a label, a done tick and a final-image strip. Every element records who created and last edited it.

**Architecture:**
- Two new element types, `scene` and `image`, go into the existing flat Yjs `elements` map. An image points at its card through `sceneId`.
- Files go up through the existing `Client4.uploadFile`. Only their ids go into the doc.
- Pure helpers carry the logic and are unit-tested:
  - `model.ts` handles fields, parsing, stamping and the parent/child relation;
  - `storyboard.ts` handles card geometry, layout and membership;
  - `canvas_uploads.ts` handles uploads;
  - `image_textures.ts` handles the texture cache.
- `renderer.ts` and `canvas_board.tsx` wire those helpers in.
- No server change.

**Tech Stack:** React 18, TypeScript, Yjs, PixiJS 8 + pixi-viewport, Jest + Testing Library, react-intl.

**Spec:** `docs/superpowers/specs/2026-11-19-canvas-storyboard-design.md`. Phase 1 covers the sections "Common element fields", "Scene card" and "Images".

## Global Constraints

- Work on branch `feature/canvas-storyboard`. Other sessions share this folder, so each commit `git add`s only the exact files its task names.
- `renderer.ts` (and possibly `canvas_board.tsx`) is being changed by the pen-fill fix on this branch. Before Task 5 or Task 6 starts, `git log` must show that fix committed, and `git status` must show no uncommitted change to those files.
- Run every command from `webapp/channels`. Tests use `npm test -- <path>`, lint uses `npx eslint <paths>` and types use `npm run check-types`.
- No image bytes in the Yjs doc (spec anti-goal). Elements stay small: ids, numbers, short strings.
- Keep a board with "a few hundred images" smooth. Draw from server previews, and from thumbnails when zoomed out. Load textures lazily and release them when they are far off screen.
- UI rules:
  - Compass icons from `@mattermost/compass-icons/components`;
  - `WithTooltip` for tooltips;
  - house controls as in `components/tasks/task_detail.tsx` (`select.form-control`);
  - every string goes through react-intl with a `description`.
- After editing strings, run `npm run i18n-extract`. Add Turkish strings to `src/i18n/tr.json` in key order, the way `tasks.*` keys are there.
- Read-only board users see everything. They cannot drop, tick, assign, edit labels or move.
- Personal colour in phase 1 is `colorFor(userId)` from `canvas_board.tsx`. Phase 2 replaces that lookup.

**Deviations from the spec, all small, flagged for the reviewer:**
- Elements also get `createdAt`, because the panel's "Created by X · date" needs a date.
- Images and scenes also store the file `name` (`name` / `finalName`), so the preview modal can be opened without a fetch.
- The owner's name is drawn in the card header instead of in a hover tooltip, so it is readable at any zoom and needs no tooltip layer over Pixi.

## Review Focus

1. **A file dropped on the canvas must not also reach the channel's own upload.** `file_upload.tsx` binds dragster drag events on the channel container. The canvas stops `dragenter` / `dragover` / `dragleave` / `drop` with native listeners. Task 6 tests this.
2. **A hostile or broken element from another client must not inject into a URL.** `fileId`, `finalFileId`, `sceneId` and `ownerId` must be 26-character Mattermost ids, or the element is skipped. Task 1 tests this.
3. **Duplicating or pasting a scene copies its images.** The copies must point at the copied card, not the original; otherwise deleting the original would delete the copy's images. Task 1 tests this.
4. **One Ctrl+Z undoes a whole bulk drop**, whether it held 1 file or 40. Task 6 tests this.
5. **Re-parenting only on a real move.** Dragging a card that lies over another card must not re-parent the card's own images. Dragging an image together with its own card must not detach it. Task 2 tests this.

---

## File map

| File | Responsibility |
|---|---|
| `src/components/canvas/model.ts` | Element types and fields, `parseElement` validation, author stamping, `withChildren`, cascading delete, `copyElements` |
| `src/components/canvas/storyboard.ts` (new) | Card geometry (`sceneParts`, `cardForImage`), bulk layout, stacking, natural sort, `sceneAt`, `membershipPatches` |
| `src/components/canvas/canvas_uploads.ts` (new) | Image type check and parallel uploads to the channel |
| `src/components/canvas/image_textures.ts` (new) | Lazy, size-aware texture cache with release and a load limit |
| `src/components/canvas/renderer.ts` | Draws scene cards and images; culls textures |
| `src/components/canvas/canvas_board.tsx` | Drop/paste import, upload chip, children follow moves, membership at drag end, tick, label edit, preview modal, read-only click-select |
| `src/components/canvas/canvas_properties.tsx` | Info section, owner picker, done toggle, read-only mode |
| `src/i18n/en.json`, `src/i18n/tr.json` | New strings |

Tests sit next to each file (`*.test.ts(x)`), following `model.test.ts` and `canvas_board.test.tsx`.

---

### Task 1: Model, part 1: new types, validation and author stamping

**Files:**
- Modify: `src/components/canvas/model.ts`
- Test: `src/components/canvas/model.test.ts`

**Interfaces:**
- Produces:
  - `ElementType` gains `'scene' | 'image'`.
  - `CanvasElement` gains these optional fields:
    - stamps: `createdBy?: string; createdAt?: number; updatedBy?: string; updatedAt?: number`;
    - scene: `label?: string; done?: boolean; ownerId?: string; finalFileId?: string; finalName?: string`;
    - image: `fileId?: string; name?: string; aspect?: number; sceneId?: string`.
  - `MAX_LABEL_LENGTH = 200`.
  - `setLocalAuthor(doc: Y.Doc, userId: string | undefined): void`.
  - `withChildren(els: CanvasElement[], ids: string[]): string[]`.
  - `copyElements(els: CanvasElement[], dx: number, dy: number, top: number): CanvasElement[]`.
  - `deleteElements` cascades.
  - `duplicateElements` copies children and remaps them.

- [ ] **Step 1: Write the failing tests** in `model.test.ts` (`describe('storyboard elements')`). Use a `scene(id, props)` / `image(id, props)` factory beside the existing `rect`. Ids are `'a'.repeat(26)`-style valid ids, plus an `ID = (c) => c.repeat(26)` helper.
  - `parses a scene and an image`: both round-trip through `addElement` / `readElements`.
  - `skips an image whose fileId is not an id`: `fileId: '../users/me'`, `fileId: 42`, and a missing `fileId` all read back as absent.
  - `skips elements with a malformed sceneId, ownerId or finalFileId` (one case each), and `skips a scene whose label is not a string or done not a boolean`.
  - `skips an element whose aspect is not a positive finite number`, covering `0`, `-1` and `NaN`.
  - `stamps created and updated with the local author`:
    - Call `setLocalAuthor(doc, 'u1')` and then `addElement`. Expect `createdBy === updatedBy === 'u1'` and `createdAt === updatedAt`, a number.
    - Then `setLocalAuthor(doc, 'u2')` and `updateElements(doc, [id], {x: 5})`. Expect `createdBy` `'u1'` and `updatedBy` `'u2'`.
  - `does not stamp an update that changes nothing`: `updateElements` with the current `x` leaves `updatedAt` unchanged. Use jest fake timers to tell the dates apart.
  - `writes no stamps without an author`: no `setLocalAuthor` call gives no `createdBy` key.
  - `withChildren adds the images of the given scenes, once`: `withChildren(els, [S, I1])`, where I1 and I2 are children of S, gives `[S, I1, I2]`.
  - `deleting a scene deletes its images in one undo step`:
    - after `deleteElements(doc, [S])`, S, I1 and I2 are gone and a free image stays;
    - `undo.undo()` brings all three back.
  - `copyElements remaps sceneId to the copied scene`:
    - copying `[S, I1]` gives an image whose `sceneId` is the new scene's id;
    - copying `[I1]` alone keeps `sceneId === S`;
    - the copies have new ids, `x + dx`, `z = top + 1 + i`, and no `createdBy` / `createdAt` / `updatedBy` / `updatedAt`.
  - `duplicateElements copies a scene with its images`: `duplicateElements(doc, [S])` adds 3 elements. Both copied images point at the copied scene.

- [ ] **Step 2: Run** `npm test -- src/components/canvas/model.test.ts`. Expected: FAIL. The new types are not in `TYPES` and the helpers are missing.

- [ ] **Step 3: Implement in `model.ts`**
  - Add `'scene'` and `'image'` to `ElementType` and `TYPES`.
  - Validation in `parseElement`:
    - `const isId = (v: unknown) => typeof v === 'string' && /^[a-z0-9]{26}$/.test(v)`;
    - `fileId` is required for `image`;
    - `sceneId`, `ownerId` and `finalFileId` are optional, but must pass `isId` when present;
    - `label` and `name` / `finalName` must be strings when present;
    - `done` must be a boolean when present;
    - `aspect` must be finite and > 0 when present;
    - the stamp fields must be the right type when present.
  - Stamping:
    - a module `WeakMap<Y.Doc, string>` holds the local author;
    - `writeElement` sets the four stamps when the doc has an author;
    - `updateElements` sets `updatedBy` / `updatedAt` on an element only when at least one key really changed.
  - `copyElements`:
    - drops the four stamps;
    - assigns `generateId()` and `randomSeed()`;
    - remaps `sceneId` through the old→new id map built from the copied set.
  - `duplicateElements(doc, ids, offset)` becomes `writeInBatches(doc, copyElements(pick(withChildren(all, ids)), offset, offset, top))` and returns the ids of the copies of `ids` only. Children are copied but not returned, so the selection stays on the copied cards.
  - `deleteElements` deletes `withChildren(readElements(elements), ids)` inside its one transaction.

- [ ] **Step 4: Run** `npm test -- src/components/canvas/model.test.ts src/components/canvas/canvas_board.test.tsx`. Expected: PASS, including the existing board tests.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/model.ts src/components/canvas/model.test.ts
git commit -m "Canvas: scene and image elements, author stamps, card children"
```

---

### Task 2: Storyboard geometry and layout

**Files:**
- Create: `src/components/canvas/storyboard.ts`
- Test: `src/components/canvas/storyboard.test.ts`

**Interfaces:**
- Consumes: `CanvasElement` and `MAX_LABEL_LENGTH` (Task 1), and `Bounds`, `Point`, `bounds` from `geometry.ts`.
- Produces:
  - Constants:
    - `SCENE_HEADER = 48`, `SCENE_PAD = 16`;
    - `FINAL_FRACTION = 1 / 3` (share of the body below the header);
    - `SCENE_FRAME = 8` (frame stroke width);
    - `CARD_IMAGE_H = 400`, `ROW_CARDS = 10`, `GAP_RATIO = 0.1`, `STACK_OFFSET = 24`.
  - `sceneParts(s: Bounds): {header: Bounds; tick: Bounds; body: Bounds; image: Bounds; final: Bounds}`
  - `cardForImage(img: Bounds): Bounds`
  - `layoutScenes(aspects: number[], at: Point): Array<{scene: Bounds; image: Bounds}>`
  - `stackInScene(scene: Bounds, existing: number, aspects: number[]): Bounds[]`
  - `sortByName<T extends {name: string}>(items: T[]): T[]`, a natural, case-insensitive sort that returns a new array.
  - `labelFor(name: string): string`, the name without its last extension, cut to `MAX_LABEL_LENGTH`.
  - `sceneAt(els: CanvasElement[], p: Point, exclude?: Set<string>): CanvasElement | undefined`, the topmost scene by z, then id, whose bounds contain p.
  - `membershipPatches(els: CanvasElement[], movedIds: string[], p: Point, topZ: number): Array<{id: string; sceneId?: string; z?: number}>`

- [ ] **Step 1: Write the failing tests** (`describe('storyboard')`). Compare numbers with `toBeCloseTo`.
  - `sceneParts splits a card`. For `{x: 0, y: 0, w: 832, h: 696}`:
    - header `{0, 0, 832, 48}`;
    - tick `{784, 0, 48, 48}`;
    - body `{0, 48, 832, 648}`;
    - final `{0, 480, 832, 216}`;
    - image `{16, 64, 800, 400}`.
  - `cardForImage is the inverse`: `cardForImage({x: 16, y: 64, w: 800, h: 400})` equals `{0, 0, 832, 696}`.
  - `layoutScenes lays cards left to right at a common height`:
    - aspects `[2, 1]` at `{0, 0}` give images `{16, 64, 800, 400}` and `{917.6, 64, 400, 400}`;
    - the second card's x is `832 + 69.6`.
  - `layoutScenes wraps after 10 cards`: 11 aspects of `1`; the 11th card is at `x = 0`, `y = 696 + 69.6`.
  - `layoutScenes treats a missing aspect as square`: aspect `0` or `NaN` gives a 400×400 image.
  - `stackInScene offsets each image`: with existing `1` and two aspects, the images start at `sceneParts(s).image` origin + 24 and + 48, at height `sceneParts(s).image.h`.
  - `sortByName is natural`: `['SC10.png', 'sc2.png', 'SC1.png']` gives `SC1, sc2, SC10`.
  - `labelFor strips the extension`: `'SC012.final.png'` gives `'SC012.final'`, and `'noext'` gives `'noext'`.
  - `sceneAt returns the topmost card`: with two overlapping scenes the higher z wins, and a scene in `exclude` is skipped.
  - `membershipPatches`, with scenes A and B, image `i` in A, and free image `f`:
    - dropping `i` inside B gives `[{id: i, sceneId: B, z: topZ + 1}]` when `i.z < B.z`, and no `z` when `i` is already above B;
    - dropping `i` on empty board gives `[{id: i, sceneId: undefined}]`;
    - dropping `i` inside A gives `[]`;
    - dropping `f` inside A gives `[{id: f, sceneId: A, …}]`;
    - moving `[A]` (its images follow) with p inside B gives `[]`, because cards never join cards;
    - moving `[A, i]` with p inside B gives `[]`: `i` moves with its card, so it is not re-parented.

- [ ] **Step 2: Run** `npm test -- src/components/canvas/storyboard.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `storyboard.ts`** with the signatures above.
  - `sortByName` uses `a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'})`.
  - Layout:
    - the gap is `GAP_RATIO × card height`;
    - the row height is the card height (all cards share `CARD_IMAGE_H`);
    - `at` is the first card's top-left.
  - `membershipPatches`:
    - consider only `image` elements in `movedIds` whose `sceneId` is not itself in `movedIds`;
    - the target is `sceneAt(els, p, new Set(movedIds))`.

- [ ] **Step 4: Run** the test from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/storyboard.ts src/components/canvas/storyboard.test.ts
git commit -m "Canvas: scene card geometry, bulk layout and drag-end membership"
```

---

### Task 3: Image uploads

**Files:**
- Create: `src/components/canvas/canvas_uploads.ts`
- Test: `src/components/canvas/canvas_uploads.test.ts`

**Interfaces:**
- Consumes: `Client4.uploadFile(formData)` from `mattermost-redux/client`, which returns `FileUploadResponse` (`{file_infos, client_ids}`), and `generateId` from `utils/utils`.
- Produces:
  - `isImageFile(f: File): boolean`, true for `image/png` and `image/jpeg`;
  - `UPLOAD_CONCURRENCY = 3`;
  - `type Uploaded = {file: File; info: FileInfo}`;
  - `uploadImages(channelId: string, files: File[], onProgress: (done: number, total: number) => void): Promise<{uploaded: Uploaded[]; failed: File[]}>`.

- [ ] **Step 1: Write the failing tests**, with `jest.mock('mattermost-redux/client')`:
  - `isImageFile accepts png and jpeg only`, with `image/gif`, `image/webp`, `application/pdf` and `''` as negatives;
  - `uploads each file to the channel`: each call's FormData has `channel_id` = the channel and one `files` entry;
  - `keeps input order whatever order uploads finish in`: resolve the mocked promises in reverse;
  - `reports failures and continues`: the 2nd file rejects, so `failed` is `[file2]` and `uploaded` holds files 1 and 3;
  - `never runs more than 3 at once`: count the in-flight mocked calls;
  - `reports progress`: `onProgress` is called with `(1, 3)`, `(2, 3)` and `(3, 3)`, failures counted as done.

- [ ] **Step 2: Run** `npm test -- src/components/canvas/canvas_uploads.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** A small worker pool of `UPLOAD_CONCURRENCY` async loops over a shared index. The FormData carries `channel_id`, `client_ids` (`generateId()`) and `files` (file, `file.name`). The result info is `res.file_infos[0]`. The server enforces `MaxFileSize`, so its rejection just lands in `failed`.

- [ ] **Step 4: Run** the test from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/canvas_uploads.ts src/components/canvas/canvas_uploads.test.ts
git commit -m "Canvas: parallel PNG/JPEG uploads to the canvas channel"
```

---

### Task 4: Texture cache

**Files:**
- Create: `src/components/canvas/image_textures.ts`
- Test: `src/components/canvas/image_textures.test.ts`

**Interfaces:**
- Produces:
  - `type TextureSize = 'thumb' | 'preview'`;
  - `THUMB_MAX_PX = 160`;
  - `textureSize(screenHeight: number): TextureSize`, which gives `'thumb'` when `screenHeight <= THUMB_MAX_PX`;
  - `textureKey(fileId: string, size: TextureSize): string`, which gives `` `${fileId}:${size}` ``;
  - `class ImageTextures<T extends {destroy(destroySource?: boolean): void}>`:
    - `constructor(load: (fileId: string, size: TextureSize) => Promise<T>, onLoad: () => void, maxLoads = 6)`;
    - `get(fileId: string, size: TextureSize): T | undefined`;
    - `retain(keys: Set<string>): void`;
    - `destroy(): void`.
  - `loadTexture(fileId: string, size: TextureSize): Promise<Texture>`, the real Pixi loader. It is not unit-tested: jsdom cannot decode images.

- [ ] **Step 1: Write the failing tests** with a fake `load`, which returns deferred promises of `{destroy: jest.fn()}`:
  - `get starts one load and returns the texture once loaded`:
    - the first `get` returns `undefined` and calls `load` once;
    - a second `get` before it resolves does not call `load` again;
    - after it resolves, `onLoad` has been called and `get` returns the texture.
  - `limits concurrent loads`: 10 `get`s with `maxLoads` 6 give 6 `load` calls; resolving one starts the 7th.
  - `retain releases textures not kept`: `retain(new Set())` calls `destroy(true)` on a loaded texture, and the next `get` loads again.
  - `a load that finishes after release is destroyed, not cached`.
  - `queued loads that are no longer retained never start`.
  - `a failed load is not retried`: `get` returns `undefined` and `load` is not called again.
  - `destroy releases everything`.
  - `textureSize`: `160` gives `'thumb'` and `161` gives `'preview'`.

- [ ] **Step 2: Run** `npm test -- src/components/canvas/image_textures.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Keep three structures: a `Map<key, T>` of loaded textures, a `Set` of in-flight keys and a FIFO queue.
  - `loadTexture` builds `new Image()`:
    - `src` is `getFileThumbnailUrl` or `getFilePreviewUrl` (from `mattermost-redux/utils/file_utils`);
    - it awaits `img.decode()`, and if the preview fails it retries once with `getFileUrl`;
    - it returns `Texture.from(img)`.

- [ ] **Step 4: Run** the test from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/image_textures.ts src/components/canvas/image_textures.test.ts
git commit -m "Canvas: lazy, size-aware image texture cache"
```

---

### Task 5: Renderer, drawing scene cards and images

Wait for the pen-fill fix first (see Global Constraints). `renderer.ts` has no unit tests and the board tests mock it, so this task is verified by type check, lint and a manual run.

**Files:**
- Modify: `src/components/canvas/renderer.ts`

**Interfaces:**
- Consumes: `sceneParts`, `SCENE_FRAME` (Task 2); `ImageTextures`, `loadTexture`, `textureSize`, `textureKey` (Task 4).
- Produces:
  - `export type DrawElement = CanvasElement & {ownerName?: string}`;
  - `draw(els: DrawElement[], selected: string[], marquee?: Bounds)`, with the same call shape as today.

- [ ] **Step 1: Make `build` return a `Container`.** Text and Graphics stay as they are. Fix `updateTextResolution` and `Item` to find the `Text` inside.

- [ ] **Step 2: Draw `scene`** in local coordinates. The elements, in drawing order:
  - a white fill;
  - the frame: `SCENE_FRAME` wide, in `el.stroke` (the board puts the owner colour there, see Task 7);
  - a hairline under the header and above the final strip;
  - the label `Text` (≤ `MAX_LABEL_LENGTH` chars), left in the header;
  - `ownerName` `Text` in the frame colour, right of the label;
  - the tick in `sceneParts().tick`: a green filled circle with a white check when `done`, otherwise a grey outline circle;
  - a final-strip `Sprite` fitted (contain) into `sceneParts().final` when `finalFileId` is set; when it is not set, a light dashed outline.

- [ ] **Step 3: Draw `image`** as a `Sprite` sized to `w × h`. While its texture is missing it shows a light-grey placeholder rect.

- [ ] **Step 4: Texture culling.** After each `draw` and on viewport `moved` / `zoomed`:
  - take the visible world bounds grown by one view size on every side;
  - for every image and final whose bounds intersect them, set the sprite texture from `textures.get(fileId, textureSize(screenHeight))`;
  - all others get the placeholder;
  - call `textures.retain(keys used)`.
  - Keep the last `draw` arguments, so `onLoad` can re-run the texture pass without a React render.
  - Shape keys exclude textures, so a load never rebuilds Graphics.
  - `destroy()` also destroys the cache.

- [ ] **Step 5: Verify**
  - Run `npm run check-types` and `npx eslint src/components/canvas`. Expected: no errors.
  - Run `npm test -- src/components/canvas`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/components/canvas/renderer.ts
git commit -m "Canvas renderer: scene cards, images and culled textures"
```

---

### Task 6: Board, importing images by drop and paste

**Files:**
- Modify: `src/components/canvas/canvas_board.tsx`, `src/components/canvas/canvas.scss` (chip only)
- Test: `src/components/canvas/canvas_board.test.tsx`

**Interfaces:**
- Consumes:
  - `isImageFile`, `uploadImages` (Task 3);
  - `layoutScenes`, `stackInScene`, `sortByName`, `labelFor`, `sceneAt`, `sceneParts` (Task 2);
  - `setLocalAuthor` (Task 1).
- Produces: `importFiles(files: File[], at: Point)`, internal to `Board`.

- [ ] **Step 1: Write the failing tests** in `canvas_board.test.tsx`:
  - Mock setup:
    - `jest.mock('./canvas_uploads', …)` keeps the real `isImageFile`;
    - `uploadImages` resolves `{uploaded, failed}` built from the files, with `info = {id, width, height, name}`.
    - The ids must be valid 26-character ids, or `parseElement` drops the elements (for example `String(n).repeat(26)`).
  - Use `fireEvent.drop(surface, {dataTransfer: {files, types: ['Files']}})` at `clientX` / `clientY`. Tests:
  - `dropping images creates one card and one image each, in name order`:
    - drop `SC10.png` (200×100) and `SC2.png` (100×100);
    - this gives 2 scenes with labels `SC2`, `SC10`, left to right from the drop point;
    - each image's `sceneId` is its card, `fileId` is the info id and `aspect` is 2 or 1;
    - all scenes have `createdBy` `'user1'`.
  - `images are drawn above their cards`: each image `z` > its scene `z`.
  - `one undo removes the whole drop`: Ctrl+Z after a drop of 3 files leaves no elements.
  - `dropping on a card stacks the images into it`: the new image has that card's `sceneId` and `x = sceneParts(card).image.x + 24`.
  - `dropping on a card's final strip sets its final`: `finalFileId` and `finalName` are set, and no image element is added.
  - `non-images are refused with a message`: dropping a `.pdf` creates nothing, `uploadImages` is not called, and the "skipped" message shows.
  - `failed uploads are reported and skipped`: one failed file yields 1 card and the failure message names the file.
  - `read-only users cannot drop`: in `renderBoard(true)` a drop creates nothing and the event is not default-prevented.
  - `a drop does not reach the channel's file upload`: a native `drop` listener on `document.body` added before the drop is not called.
  - `pasting image files imports them`: `fireEvent.paste(root, {clipboardData: {files: [png], types: ['Files']}})` creates a card.
  - `pasting without files still pastes copied elements`: select, Ctrl+C, then a `paste` event with empty files duplicates the selection.

- [ ] **Step 2: Run** `npm test -- src/components/canvas/canvas_board.test.tsx`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement in `canvas_board.tsx`**
  - `useEffect(() => setLocalAuthor(doc, userId), [doc, userId])`.
  - Drag and drop: native listeners on the surface (via an effect) for `dragenter` / `dragover` / `dragleave` / `drop`.
    - When the drag carries `Files` and the board is editable: `preventDefault()`, `stopPropagation()`, and `dropEffect = 'copy'`.
    - On `drop`, call `importFiles([...files], renderer.toWorld(clientX, clientY))`.
  - Paste: a native `paste` listener on the root.
    - With files: stop the event and call `importFiles` at `pointerRef.current`, or the view centre.
    - Without files: call the existing internal `paste()`.
    - The Ctrl+V keydown branch no longer calls `paste()` and no longer prevents default.
  - `importFiles(files, at)`:
    1. Split the files with `isImageFile`. Report non-images.
    2. Resolve the target:
       - a card whose `sceneParts().final` contains `at` → only the first image becomes the final;
       - else `sceneAt(els, at)` → stack the images into that card;
       - else → bulk layout.
    3. Sort the files with `sortByName`, then upload them with `uploadImages` while showing the progress chip.
    4. Build every element from the successful uploads. Scene z comes before image z; the scene `stroke` is `style.stroke`, and the fill is `#ffffff`.
    5. Write them with a single `discrete(() => writeInBatches(doc, all))`, or `discrete(() => updateElements(…))` for a final.
  - Chip: one chip under the existing status chip, `role='status'`.
    - While uploading it reads `Uploading images {done}/{total}…`.
    - The skipped and failed messages stay until the dismiss button (`CloseIcon`, `WithTooltip`) is pressed.

- [ ] **Step 4: Run** the board tests. Expected: PASS, the old ones included.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/canvas_board.tsx src/components/canvas/canvas_board.test.tsx src/components/canvas/canvas.scss
git commit -m "Canvas: drop or paste PNG/JPEG files as scene cards"
```

---

### Task 7: Board, card interactions

**Files:**
- Modify: `src/components/canvas/canvas_board.tsx`
- Test: `src/components/canvas/canvas_board.test.tsx`

**Interfaces:**
- Consumes:
  - `withChildren`, `copyElements` (Task 1);
  - `membershipPatches`, `sceneParts` (Task 2);
  - `DrawElement` (Task 5);
  - `openModal` from `actions/views/modals`, `FilePreviewModal`, `ModalIdentifiers`, and `getFileUrl`.
- Produces: `export function forDrawing(els: CanvasElement[], users: Record<string, UserProfile>): DrawElement[]`. A scene with `ownerId` gets `stroke = colorFor(ownerId)` and `ownerName = username`; every other element passes through unchanged.

- [ ] **Step 1: Write the failing tests**, with scenes and images seeded through `addElement` on the board's `doc`:
  - `dragging a card moves its images with it, as one undo step`.
  - `arrow keys move a card with its images`.
  - `dragging an image into another card re-parents it`; `dragging it to empty board frees it`; `one undo restores both its position and its sceneId`.
  - `resizing a card does not scale its images`: drag the `se` handle and the image's `w` is unchanged.
  - `clicking the tick toggles done`: one click in `sceneParts(card).tick` sets `done: true`, and Ctrl+Z clears it.
  - `double-clicking the header edits the label`: the textarea opens with the label, and typing then Escape writes `label`, cut to `MAX_LABEL_LENGTH`.
  - `double-clicking an image opens the file preview`: mock `actions/views/modals`; `openModal` is called with `modalId: ModalIdentifiers.FILE_PREVIEW_MODAL` and `fileInfos[0].link === getFileUrl(fileId)`.
  - `copy and paste of a card copies its images, attached to the copy`.
  - `an owned card is drawn in the owner's colour with their name`: the last `mockRenderer.draw` call has the scene with `stroke: colorFor('user2')` and `ownerName: 'bob'`. Add `user2`/`bob` to the test state.
  - `read-only users select by clicking`: in `renderBoard(true)`, pointerdown and pointerup at the same spot on an image selects it, and a drag of more than 4 px does not. This feeds the panel in Task 8.
  - `read-only users can open an image's original`: a double-click on an image calls `openModal`, while a double-click on a header opens no editor.

- [ ] **Step 2: Run** the board tests. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - The move gesture's `orig`, the arrow-key nudge and `copy()` all use `pick(withChildren(elsRef.current, ids))`. Resize keeps using only the selection.
  - `paste()` uses `copyElements`.
  - In `onPointerUp`, for `kind === 'move'`, before `endGesture()`, run `updateInBatches(doc, membershipPatches(elsRef.current, <selected ids>, <pointer world p>, topZ()))`. This keeps it in the same undo step.
  - Tick: in the select tool's pointerdown, when the hit element is a scene and `p` lies in `sceneParts(el).tick`, run `discrete(() => updateElements(doc, [id], {done: !el.done}))`, select the card, and start no gesture.
  - Double-click:
    - **header:** `Editing` gains `field?: 'label'`; `commitText` writes `{label}` for it; the textarea is positioned at the header with font size 20;
    - **image, or a final strip with `finalFileId`:** dispatch `openModal` with the `image_block.tsx` dialogProps shape, `postId: ''`, `fileInfos: [{has_preview_image: false, link: getFileUrl(id), extension: <from name>, name}]`.
  - Pass `forDrawing(els, users)` to `renderer.draw`.
  - Read-only:
    - on pointerdown remember the screen point, before the existing `pan` early return;
    - on pointerup within 4 px, `select(hit ? [hit] : [])`;
    - `onDoubleClick` opens the preview for read-only users too; editing a label still needs the select tool.

- [ ] **Step 4: Run** the board tests. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/canvas_board.tsx src/components/canvas/canvas_board.test.tsx
git commit -m "Canvas: cards carry their images, drag-end membership, tick, label and preview"
```

---

### Task 8: Properties panel, info, owner and done

**Files:**
- Modify: `src/components/canvas/canvas_properties.tsx`, `src/components/canvas/canvas_board.tsx` (wiring)
- Modify: `src/i18n/en.json` (via `npm run i18n-extract`), `src/i18n/tr.json`
- Test: `src/components/canvas/canvas_properties.test.tsx`, `src/components/canvas/canvas_board.test.tsx`

**Interfaces:**
- Consumes:
  - `getProfilesInChannel(channelId, 0, 200)` (`mattermost-redux/actions/users`);
  - `makeGetProfilesInChannel()` (`mattermost-redux/selectors/entities/users`);
  - `Client4.getFileInfo(fileId)`, which returns `FileInfo` (`user_id` is the uploader);
  - `Timestamp` from `components/timestamp`.
- Produces: new optional `CanvasProperties` props:
  - `readOnly?: boolean`;
  - `info?: {createdBy?: string; createdAt?: number; updatedBy?: string; updatedAt?: number; uploadedBy?: string}`;
  - `scene?: {ownerId?: string; done: boolean; members: UserProfile[]}`;
  - `onSceneChange?: (patch: {ownerId?: string; done?: boolean}) => void`, where `ownerId: undefined` means "none".

- [ ] **Step 1: Write the failing tests**
  - `canvas_properties.test.tsx`:
    - `shows created and edited lines`: the text matches `Created by alice` and `Last edited by bob`;
    - `shows Uploaded by for an image`;
    - `picks an owner from members, with None`: changing the select calls `onSceneChange({ownerId: 'user2'})`, and choosing None calls it with `{ownerId: undefined}`;
    - `toggles done`;
    - `read-only shows info, owner and done without controls`: no `select`, no checkbox, no style section, and the owner's name and "Done" are shown as text.
  - `canvas_board.test.tsx`:
    - `the panel shows the selected card's owner picker and changes it in one undo step`;
    - `read-only users see the info panel for a selected card`;
    - `info shows the image uploader from its file info`: mock `Client4.getFileInfo` to resolve `{user_id: 'user2'}`.

- [ ] **Step 2: Run** `npm test -- src/components/canvas/canvas_properties.test.tsx src/components/canvas/canvas_board.test.tsx`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - Panel sections:
    - `scene`: the existing stroke colours (label "Frame colour", the colour used when there is no owner), an Owner `select.form-control` (None + members sorted by display name), a Done checkbox, Layers and Actions;
    - `image`: opacity, Layers and Actions;
    - with one element selected: the info section;
    - with `readOnly`: render only info plus the owner name and done state as text.
  - Board wiring:
    - load members once on mount when not read-only;
    - show the panel when `!readOnly || (picked.length === 1 && ['scene', 'image'].includes(picked[0].type))`;
    - `onSceneChange` runs `discrete(() => updateElements(doc, selRef.current, patch))`;
    - the uploader comes from one `Client4.getFileInfo` call per selected image id, kept in component state; errors are ignored.
  - Strings, each with a `description`. `tr.json` gets the Turkish for every new key.
    - `canvas.properties.owner` "Owner"
    - `canvas.properties.noOwner` "None"
    - `canvas.properties.done` "Done"
    - `canvas.properties.frame` "Frame colour"
    - `canvas.properties.created` "Created by {name} · {date}"
    - `canvas.properties.edited` "Last edited by {name} · {date}"
    - `canvas.properties.uploaded` "Uploaded by {name}"
    - Task 6's `canvas.board.uploading`, `canvas.board.notImages` (plural), `canvas.board.uploadFailed` and `canvas.board.dismiss`
    - Task 7's `canvas.board.labelInput` "Scene label"
  - Run `npm run i18n-extract`.

- [ ] **Step 4: Verify**
  - Run `npm test -- src/components/canvas`, `npm run check-types`, `npx eslint src/components/canvas` and `npm run i18n-extract:check`. Expected: all clean.
  - Manual check against a dev server:
    - drop 12 PNGs named `SC1`…`SC12` and confirm there are 2 rows, in order;
    - drag an image between cards;
    - tick a card;
    - assign an owner and confirm the frame colour and name;
    - zoom out and confirm thumbnails load and the board stays smooth;
    - double-click an image and confirm the original opens;
    - in a read-only session, select a card and see the info.

- [ ] **Step 5: Commit**
```bash
git add src/components/canvas/canvas_properties.tsx src/components/canvas/canvas_properties.test.tsx src/components/canvas/canvas_board.tsx src/components/canvas/canvas_board.test.tsx src/i18n/en.json src/i18n/tr.json
git commit -m "Canvas panel: created/edited info, scene owner and done, read-only info"
```
