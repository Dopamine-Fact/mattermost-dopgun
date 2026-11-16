# Canvas channels — design

## Intent
A team can have whiteboard channels: ordinary chat channels with a **Messages | Canvas** tab bar. The canvas is a light, Excalidraw-like board that several people edit at once and see each other's cursors. Teams turn the feature on or off. No Excalidraw/tldraw: too heavy.

## Approaches
1. **PixiJS renderer + Yjs document, synced through Mattermost (picked).** Yjs merges per field, gives per-user undo and presence; Pixi only draws the Yjs state. The Go server stores and relays opaque Yjs updates — no separate sync server.
2. Element-level last-writer-wins over REST — rejected: concurrent edits to one shape lose fields; per-user undo and reconnect catch-up would be hand-written.
3. Fabric.js / Konva — rejected by the user in favour of PixiJS and full control.

## Design
- **Team toggle:** `Team.CanvasEnabled` (`canvas_enabled`) in team settings, independent of tasks. Off: no menu entry, no Canvas tab, server refuses canvas writes (403).
- **Create:** Add Channels → "Create canvas channel" (anyone who may create a public channel): name → create channel, then register it as a canvas; on failure delete the channel.
- **Storage:** `Canvases` (one row per canvas channel: per-channel `LastSeq`, optional snapshot) and `CanvasUpdates` (Yjs updates, per-channel gapless `Seq`).
- **Sync:** client posts batched Yjs updates (≤ every 50 ms) over REST; the server assigns `Seq` and broadcasts `canvas_updated` to the channel. A client that sees a seq gap or reconnects fetches `state?after=<lastSeq>`. After 200 updates past the snapshot, a client uploads a full snapshot and the server drops covered updates.
- **Presence:** Yjs awareness (cursor, name, colour, selection) over a client→server websocket action `canvas_awareness`, broadcast to the channel, never stored.
- **Board (v1 tools):** select/move/resize (shift-click and marquee multi-select), hand, pen, rectangle, ellipse, line, arrow, text, eraser, per-user undo/redo. The board bundle (Pixi + Rough.js) is lazy-loaded when the Canvas tab opens.
- **Properties side panel** (left, shown while a drawing tool is active or something is selected; edits the selection and becomes the default for new elements; only sections that apply to the selected types are shown):
  - Stroke colour, background colour (incl. transparent), fill style (solid / hachure / cross-hatch)
  - Stroke width (thin / bold / extra bold), stroke style (solid / dashed / dotted)
  - Sloppiness (architect / artist / cartoonist — hand-drawn look via Rough.js with a per-element seed, so every client draws the same wobble)
  - Edges (sharp / round) for rectangles; arrowheads (none / arrow / triangle / bar) for start and end of lines and arrows
  - Font size (S / M / L / XL), font family (normal / code), text align for text
  - Opacity slider (0–100)
  - Layers: send to back, send backward, bring forward, bring to front
  - Align (left / centre / right / top / middle / bottom) when 2+ elements are selected
  - Actions: duplicate, delete
- **Navigation:** pan with the hand tool, Space + drag, middle mouse or wheel/trackpad scroll; zoom with Ctrl + wheel / trackpad pinch around the pointer. Bottom-left bar: zoom out, zoom % (click resets to 100%), zoom in, undo, redo. Zoom range 10 %–3000 %. Shortcuts: Ctrl + = / Ctrl + −, Ctrl + 0 (reset), Shift + 1 (fit all), Shift + 2 (fit selection).
- **Keyboard:** tool keys (V H P R O L A T E and 1–9), Delete, Ctrl + Z / Ctrl + Shift + Z, Ctrl + D (duplicate), Ctrl + C / Ctrl + V (within the board), arrow keys nudge 1 px (Shift: 10 px), Ctrl + [ / ] layer back / forward, Escape clears selection.

## Out of scope
Images, export, rotation, grouping, element links/locking, handwritten font, sticky notes, remembering each user's viewport, deleting canvas rows when a channel is archived/deleted, mobile.
