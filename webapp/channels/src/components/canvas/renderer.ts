// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getStrokePoints} from 'perfect-freehand';
import {Viewport} from 'pixi-viewport';
import {Application, Container, Graphics, Sprite, Text, Texture} from 'pixi.js';
import 'pixi.js/unsafe-eval'; // the server's CSP (script-src 'self') forbids eval; this swaps Pixi's generated code for static versions
import rough from 'roughjs';
import type {Drawable, Op, Options} from 'roughjs/bin/core';

import {bounds, dashPolyline, fitViewport, MAX_ZOOM, MIN_ZOOM, unionBounds} from './geometry';
import type {Bounds} from './geometry';
import {ImageTextures, loadTexture, textureKey, textureSize} from './image_textures';
import {FONT_FAMILIES, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH} from './model';
import type {Arrowhead, CanvasElement} from './model';
import {SCENE_FRAME, SCENE_HEADER, sceneParts} from './storyboard';

/** The board adds the scene owner's display name; the owner's colour arrives in stroke. */
export type DrawElement = CanvasElement & {ownerName?: string};

export type RemoteCursor = {userId: string; name: string; color: string; x: number; y: number};
export type RemoteSelection = {color: string; box: Bounds};

const SELECTION_COLOR = '#1c58d9';
const HANDLE_PX = 8;
const PLACEHOLDER_TINT = 0xe5e5e5;
const HAIRLINE = '#d9d9d9';
const SCENE_FONT = 20;
const FINAL_INSET = SCENE_FRAME + 4;
const generator = rough.generator();

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// Elements come from other clients: an unparsable colour would make Pixi throw.
const safeColor = (c: unknown) => (typeof c === 'string' && (/^#[0-9a-f]{6}$/i).test(c) ? c : undefined);

const pairs = (flat: unknown): Array<[number, number]> => {
    const pts = Array.isArray(flat) ? flat : [];
    const out: Array<[number, number]> = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
        out.push([num(pts[i]), num(pts[i + 1])]);
    }
    return out;
};

function trace(g: Graphics, ops: Op[]) {
    for (const {op, data} of ops) {
        if (op === 'move') {
            g.moveTo(data[0], data[1]);
        } else if (op === 'lineTo') {
            g.lineTo(data[0], data[1]);
        } else {
            g.bezierCurveTo(data[0], data[1], data[2], data[3], data[4], data[5]);
        }
    }
}

/** Flattens Rough.js ops into polylines, one per 'move', so they can be dashed. */
function sample(ops: Op[]): number[][] {
    const lines: number[][] = [];
    let cur: number[] = [];
    for (const {op, data} of ops) {
        if (op === 'move') {
            cur = [data[0], data[1]];
            lines.push(cur);
        } else if (op === 'lineTo') {
            cur.push(data[0], data[1]);
        } else {
            const [x0, y0] = cur.slice(-2);
            for (let i = 1; i <= 8; i++) {
                const t = i / 8;
                const u = 1 - t;
                const a = u * u * u;
                const b = 3 * u * u * t;
                const c = 3 * u * t * t;
                const d = t * t * t;
                cur.push((a * x0) + (b * data[0]) + (c * data[2]) + (d * data[4]), (a * y0) + (b * data[1]) + (c * data[3]) + (d * data[5]));
            }
        }
    }
    return lines;
}

function polyline(g: Graphics, pts: number[]) {
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i + 1 < pts.length; i += 2) {
        g.lineTo(pts[i], pts[i + 1]);
    }
}

function roundedRect(x: number, y: number, w: number, h: number) {
    const r = Math.min(32, Math.min(w, h) / 4);
    return `M ${x + r} ${y} L ${(x + w) - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${(y + h) - r} ` +
        `Q ${x + w} ${y + h} ${(x + w) - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${(y + h) - r} ` +
        `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`;
}

function roughShape(el: CanvasElement, o: Options): Drawable {
    const w = num(el.w);
    const h = num(el.h);
    if (el.type === 'rect') {
        const [x, y] = [Math.min(0, w), Math.min(0, h)];
        return el.roundness === 'round' ? generator.path(roundedRect(x, y, Math.abs(w), Math.abs(h)), o) : generator.rectangle(x, y, Math.abs(w), Math.abs(h), o);
    }
    if (el.type === 'ellipse') {
        return generator.ellipse(w / 2, h / 2, Math.abs(w), Math.abs(h), o);
    }
    return generator.linearPath(pairs(el.points ?? [0, 0, w, h]), o);
}

function arrowhead(g: Graphics, kind: Arrowhead, pts: number[], atEnd: boolean, width: number, color: string) {
    if (kind === 'none' || pts.length < 4) {
        return;
    }
    const n = pts.length;
    const [tx, ty, fx, fy] = atEnd ? [pts[n - 2], pts[n - 1], pts[n - 4], pts[n - 3]] : [pts[0], pts[1], pts[2], pts[3]];
    const len = Math.hypot(tx - fx, ty - fy);
    if (!len) {
        return;
    }
    const size = Math.min(10 + (width * 3), len / 2);
    const [bx, by] = [(fx - tx) / len, (fy - ty) / len]; // unit vector pointing back along the line
    const side = (a: number) => [tx + (size * ((bx * Math.cos(a)) - (by * Math.sin(a)))), ty + (size * ((bx * Math.sin(a)) + (by * Math.cos(a))))];
    const [l, r] = [side(0.45), side(-0.45)];
    const stroke = {width, color, cap: 'round', join: 'round'} as const;
    if (kind === 'arrow') {
        g.moveTo(l[0], l[1]).lineTo(tx, ty).lineTo(r[0], r[1]).stroke(stroke);
    } else if (kind === 'triangle') {
        g.poly([tx, ty, l[0], l[1], r[0], r[1]]).fill(color).stroke(stroke);
    } else {
        g.moveTo(tx - ((by * size) / 2), ty + ((bx * size) / 2)).lineTo(tx + ((by * size) / 2), ty - ((bx * size) / 2)).stroke(stroke);
    }
}

/** Shortens a Text with an ellipsis until it is at most maxW wide. */
function fitText(t: Text, maxW: number) {
    let s = t.text;
    while (t.width > maxW && s) {
        s = s.slice(0, Math.max(0, Math.floor((s.length * maxW) / t.width) - 1));
        t.text = s ? `${s}…` : '';
    }
}

/** The local box an element's sprite fills: the whole image, or a scene's final strip. */
function spriteSlot(el: CanvasElement): Bounds {
    const local = bounds({x: 0, y: 0, w: num(el.w), h: num(el.h)});
    if (el.type === 'image') {
        return local;
    }
    const f = sceneParts(local).final;
    return {x: f.x + FINAL_INSET, y: f.y + FINAL_INSET, w: Math.max(0, f.w - (2 * FINAL_INSET)), h: Math.max(0, f.h - (2 * FINAL_INSET))};
}

/** Shows the texture in the slot (contain when asked), or a grey placeholder filling the slot while there is none. */
export function fitSprite(sprite: Sprite, texture: Texture | undefined, slot: Bounds, contain: boolean) {
    sprite.texture = texture ?? Texture.WHITE;
    sprite.tint = texture ? 0xffffff : PLACEHOLDER_TINT;
    let {x, y, w, h} = slot;
    if (texture && contain && texture.width > 0 && texture.height > 0) {
        const s = Math.min(w / texture.width, h / texture.height);
        x += (w - (texture.width * s)) / 2;
        y += (h - (texture.height * s)) / 2;
        w = texture.width * s;
        h = texture.height * s;
    }
    sprite.position.set(x, y);
    sprite.setSize(w, h);
}

function buildScene(el: DrawElement, stroke: string): Container {
    const b = bounds({x: 0, y: 0, w: num(el.w), h: num(el.h)});
    const parts = sceneParts(b);
    const g = new Graphics();
    const half = SCENE_FRAME / 2;
    g.rect(b.x, b.y, b.w, b.h).fill('#ffffff');
    g.rect(b.x + half, b.y + half, Math.max(0, b.w - SCENE_FRAME), Math.max(0, b.h - SCENE_FRAME)).stroke({width: SCENE_FRAME, color: stroke});
    g.moveTo(b.x + SCENE_FRAME, b.y + SCENE_HEADER).lineTo((b.x + b.w) - SCENE_FRAME, b.y + SCENE_HEADER);
    g.moveTo(b.x + SCENE_FRAME, parts.final.y).lineTo((b.x + b.w) - SCENE_FRAME, parts.final.y);
    g.stroke({width: 1, color: HAIRLINE});

    const midY = b.y + ((SCENE_HEADER + SCENE_FRAME) / 2); // the header's middle, below the top frame
    const tx = parts.tick.x + ((parts.tick.w - SCENE_FRAME) / 2);
    if (el.done) {
        g.circle(tx, midY, 12).fill('#3db887');
        g.moveTo(tx - 6, midY).lineTo(tx - 2, midY + 4).lineTo(tx + 6, midY - 5).stroke({width: 3, color: '#ffffff', cap: 'round', join: 'round'});
    } else {
        g.circle(tx, midY, 11).stroke({width: 2, color: '#b3b3b3'});
    }

    const slot = spriteSlot(el);
    let sprite: Sprite | undefined;
    if (el.finalFileId) {
        sprite = new Sprite(Texture.WHITE); // the texture pass fills in the final
        fitSprite(sprite, undefined, slot, true);
    } else {
        const corners = [slot.x, slot.y, slot.x + slot.w, slot.y, slot.x + slot.w, slot.y + slot.h, slot.x, slot.y + slot.h, slot.x, slot.y];
        dashPolyline(corners, [8, 6]).forEach((piece) => polyline(g, piece));
        g.stroke({width: 1.5, color: '#c4c4c4'});
    }

    const textX = b.x + SCENE_FRAME + 8;
    const textEnd = parts.tick.x - 4; // keeps the label and owner clear of the tick
    const label = new Text({text: String(el.label ?? '').slice(0, MAX_LABEL_LENGTH), style: {fontFamily: FONT_FAMILIES.normal, fontSize: SCENE_FONT, fill: '#3f4350'}});
    label.anchor.set(0, 0.5);
    label.position.set(textX, midY);
    fitText(label, Math.max(0, textEnd - textX));
    const ownerX = textX + label.width + (label.text ? 12 : 0);
    const owner = new Text({text: String(el.ownerName ?? '').slice(0, MAX_LABEL_LENGTH), style: {fontFamily: FONT_FAMILIES.normal, fontSize: SCENE_FONT, fill: stroke}});
    owner.anchor.set(0, 0.5);
    owner.position.set(ownerX, midY);
    fitText(owner, Math.max(0, textEnd - ownerX));

    const root = new Container();
    root.addChild(g, label, owner);
    if (sprite) {
        root.addChild(sprite);
    }
    return root;
}

/** Builds the display object for one element, in coordinates relative to (el.x, el.y). */
export function build(el: DrawElement): Container {
    const stroke = safeColor(el.stroke) ?? '#000000';
    if (el.type === 'scene') {
        return buildScene(el, stroke);
    }
    if (el.type === 'image') {
        const sprite = new Sprite(Texture.WHITE); // the texture pass fills in the image
        fitSprite(sprite, undefined, spriteSlot(el), false);
        const root = new Container(); // fitSprite positions the sprite in its slot, so the root carries the element's x/y
        root.addChild(sprite);
        return root;
    }
    if (el.type === 'text') {
        const fontSize = num(el.fontSize, 20);
        return new Text({
            text: String(el.text ?? '').slice(0, MAX_TEXT_LENGTH), // other clients' text is not bounded by our editor
            style: {fontFamily: FONT_FAMILIES[el.fontFamily] ?? FONT_FAMILIES.normal, fontSize, fill: stroke, align: el.textAlign, lineHeight: fontSize * 1.25},
        });
    }

    const g = new Graphics();
    const width = clamp(num(el.strokeWidth, 2), 0.5, 16);
    if (el.type === 'pen') {
        // Stroke the smoothed centre line: filling perfect-freehand's outline lets earcut fill the inside of a loop that crosses itself.
        const pts = getStrokePoints(pairs(el.points), {size: width * 4.25, streamline: 0.5, last: true}).flatMap((p) => p.point);
        if (pts.length >= 4) {
            polyline(g, pts);
            g.stroke({width: width * 2.5, color: stroke, cap: 'round', join: 'round'});
        } else if (pts.length === 2) {
            g.circle(pts[0], pts[1], width * 1.25).fill(stroke); // a click without a drag leaves a dot
        }
        return g;
    }

    const fill = safeColor(el.fill);
    const roughness = clamp(num(el.roughness, 1), 0, 2);
    const dashed = el.strokeStyle === 'dashed' || el.strokeStyle === 'dotted';
    const drawable = roughShape(el, {
        seed: num(el.seed, 1),
        roughness,
        stroke,
        strokeWidth: width,
        fill,
        fillStyle: el.fillStyle,
        disableMultiStroke: dashed,
        preserveVertices: roughness === 0,
    });
    const strokeStyle = {width, color: stroke, cap: 'round', join: 'round'} as const;
    const pattern = el.strokeStyle === 'dotted' ? [1.5, 6 + width] : [8, 8 + width];
    for (const set of drawable.sets) {
        if (set.type === 'fillPath' && fill) {
            trace(g, set.ops);
            g.fill(fill);
        } else if (set.type === 'fillSketch' && fill) {
            trace(g, set.ops);
            g.stroke({width: drawable.options.fillWeight, color: fill});
        } else if (set.type === 'path' && dashed) {
            sample(set.ops).flatMap((line) => dashPolyline(line, pattern)).forEach((piece) => polyline(g, piece));
            g.stroke(strokeStyle);
        } else if (set.type === 'path') {
            trace(g, set.ops);
            g.stroke(strokeStyle);
        }
    }
    if (el.type === 'line' || el.type === 'arrow') {
        const pts = pairs(el.points ?? [0, 0, el.w, el.h]).flat();
        arrowhead(g, el.startArrow, pts, false, width, stroke);
        arrowhead(g, el.endArrow, pts, true, width, stroke);
    }
    return g;
}

// Everything but position, stacking and the author stamps (never drawn, and a move restamps every frame); a points checksum
// stands in for the (possibly long) points array. Only whether a final is set counts: the texture pass re-targets the sprite.
export function shapeKey(el: DrawElement) {
    const {x, y, z, points, finalFileId, createdBy, createdAt, updatedBy, updatedAt, ...rest} = el; // eslint-disable-line @typescript-eslint/no-unused-vars
    const pts = Array.isArray(points) ? `${points.length}:${points.reduce((s: number, v) => s + num(v), 0)}` : '';
    return JSON.stringify(rest) + pts + (finalFileId ? ':final' : '');
}

// shown: the sprite's last real texture, kept on screen (and retained) while a texture of another size loads.
type Item = {key: string; obj: Container; texts: Text[]; sprite?: Sprite; shown?: {fileId: string; key: string; texture: Texture}};

// Graphics only free their context when asked; texture stays false, as cached textures are shared.
const DESTROY_ITEM = {children: true, context: true};
type CursorItem = {root: Container; label: Text; badge: Graphics; name: string; color: string};

/** Draws the board with Pixi inside a pan/zoom viewport. Coordinates from toScreen are relative to the host element. */
export class CanvasRenderer {
    onViewportChange?: () => void;

    private viewport: Viewport;
    private overlay = new Graphics();
    private cursorLayer = new Container();
    private items = new Map<string, Item>();
    private cursorItems: CursorItem[] = [];
    private cursors: RemoteCursor[] = [];
    private remoteSelections: RemoteSelection[] = [];
    private selected: CanvasElement[] = [];
    private marquee?: Bounds;
    private textResolution = 0;
    private dragPaused = false;
    private els: DrawElement[] = [];
    private textureFrame = 0;
    private textures = new ImageTextures<Texture>(loadTexture, () => {
        // Deferred to a frame: the cache calls this mid-queue, and a throw here would stall its loads.
        this.textureFrame ||= requestAnimationFrame(() => {
            this.textureFrame = 0;
            this.placeTextures();
        });
    });

    static async create(host: HTMLElement): Promise<CanvasRenderer> {
        const app = new Application();
        await app.init({resizeTo: host, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1, background: '#ffffff'});
        return new CanvasRenderer(app, host);
    }

    private constructor(private app: Application, host: HTMLElement) {
        host.appendChild(app.canvas);
        this.viewport = new Viewport({
            screenWidth: app.screen.width,
            screenHeight: app.screen.height,
            events: app.renderer.events,
            ticker: app.ticker,
            passiveWheel: false, // so Ctrl + wheel zooms the board, not the page
        });
        this.viewport.sortableChildren = true;
        this.viewport.
            drag({mouseButtons: 'middle', disableOneFingerDrag: true}).
            pinch().
            wheel({trackpadPinch: true, wheelZoom: false}).
            clampZoom({minScale: MIN_ZOOM, maxScale: MAX_ZOOM});
        this.viewport.on('moved', this.changed);
        this.viewport.on('zoomed', this.changed);
        this.viewport.on('zoomed-end', this.updateTextResolution);
        app.stage.addChild(this.viewport, this.overlay, this.cursorLayer);
        app.renderer.on('resize', this.handleResize);
        this.updateTextResolution();
    }

    destroy() {
        cancelAnimationFrame(this.textureFrame);
        this.app.renderer.off('resize', this.handleResize);
        this.viewport.destroy({children: true}); // first, while the ticker and event system it unhooks from still exist
        this.app.destroy({removeView: true}, {children: true});
        this.textures.destroy(); // last: destroying sprites never destroys their (shared) textures
    }

    draw(els: DrawElement[], selected: string[], marquee?: Bounds) {
        const seen = new Set<string>();
        els.forEach((el, i) => {
            seen.add(el.id);
            const key = shapeKey(el);
            let item = this.items.get(el.id);
            if (!item || item.key !== key) {
                item?.obj.destroy(DESTROY_ITEM);
                let obj: Container;
                try {
                    obj = build(el);
                } catch {
                    obj = new Graphics(); // a malformed element draws nothing rather than breaking the board
                }
                const texts = obj instanceof Text ? [obj] : obj.children.filter((c): c is Text => c instanceof Text);
                texts.forEach((t) => {
                    t.resolution = this.textResolution;
                });
                this.viewport.addChild(obj);
                item = {key, obj, texts, sprite: obj instanceof Sprite ? obj : obj.children.find((c): c is Sprite => c instanceof Sprite)};
                this.items.set(el.id, item);
            }
            item.obj.position.set(num(el.x), num(el.y));
            item.obj.alpha = clamp(num(el.opacity, 100), 0, 100) / 100;
            item.obj.zIndex = i;
        });
        for (const [id, item] of this.items) {
            if (!seen.has(id)) {
                item.obj.destroy(DESTROY_ITEM);
                this.items.delete(id);
            }
        }
        this.els = els;
        this.placeTextures();
        const sel = new Set(selected);
        this.selected = els.filter((el) => sel.has(el.id));
        this.marquee = marquee;
        this.drawOverlay();
    }

    drawRemoteSelections(selections: RemoteSelection[]) {
        this.remoteSelections = selections;
        this.drawOverlay();
    }

    drawCursors(cursors: Array<{userId: string; name: string; color: string; x: number; y: number}>) {
        this.cursors = cursors;
        while (this.cursorItems.length > cursors.length) {
            this.cursorItems.pop()!.root.destroy({children: true});
        }
        cursors.forEach((c, i) => {
            let item = this.cursorItems[i];
            if (!item) {
                const root = new Container();
                const badge = new Graphics();
                const label = new Text({text: '', style: {fontFamily: FONT_FAMILIES.normal, fontSize: 12, fill: '#ffffff'}});
                label.position.set(14, 18);
                root.addChild(badge, label);
                this.cursorLayer.addChild(root);
                item = {root, badge, label, name: '', color: ''};
                this.cursorItems.push(item);
            }
            const color = safeColor(c.color) ?? SELECTION_COLOR;
            if (item.name !== c.name || item.color !== color) {
                item.name = c.name;
                item.color = color;
                item.label.text = c.name;
                item.badge.clear().
                    poly([0, 0, 0, 16, 4.5, 12, 11, 12]).fill(color).stroke({width: 1, color: '#ffffff'}).
                    roundRect(10, 16, item.label.width + 8, item.label.height + 4, 4).fill(color);
            }
        });
        this.placeCursors();
    }

    toWorld(clientX: number, clientY: number) {
        const rect = this.app.canvas.getBoundingClientRect();
        const p = this.viewport.toWorld(clientX - rect.left, clientY - rect.top);
        return {x: p.x, y: p.y};
    }

    toScreen(x: number, y: number) {
        const p = this.viewport.toScreen(x, y);
        return {x: p.x, y: p.y};
    }

    // Outside pan mode one finger draws instead of panning; mouseButtons only filters mouse pointers.
    setPanMode(on: boolean) {
        this.viewport.drag({mouseButtons: on ? 'all' : 'middle', disableOneFingerDrag: !on});
        this.pauseDrag(this.dragPaused);
    }

    /** Stops drag panning while the board runs a gesture, which a stylus would otherwise also pan with. */
    pauseDrag(on: boolean) {
        this.dragPaused = on;
        if (on) {
            this.viewport.plugins.pause('drag');
        } else {
            this.viewport.plugins.resume('drag');
        }
    }

    getZoom() {
        return this.viewport.scale.x;
    }

    setZoom(scale: number) {
        this.viewport.setZoom(clamp(scale, MIN_ZOOM, MAX_ZOOM), true);
        this.changed();
        this.updateTextResolution();
    }

    zoomBy(factor: number) {
        this.setZoom(this.getZoom() * factor);
    }

    fitTo(b: Bounds) {
        const {scale, cx, cy} = fitViewport(b, this.viewport.screenWidth, this.viewport.screenHeight);
        this.viewport.setZoom(scale);
        this.viewport.moveCenter(cx, cy);
        this.changed();
        this.updateTextResolution();
    }

    private handleResize = (width: number, height: number) => {
        this.viewport.resize(width, height);
        this.changed();
    };

    private changed = () => {
        this.placeTextures();
        this.drawOverlay();
        this.placeCursors();
        this.onViewportChange?.();
    };

    // Text is rasterised: re-render it sharper when zoomed in, capped to bound texture memory.
    private updateTextResolution = () => {
        const res = Math.min(4, Math.max(1, Math.ceil(this.getZoom()))) * (window.devicePixelRatio || 1);
        if (res === this.textResolution) {
            return;
        }
        this.textResolution = res;
        for (const {texts} of this.items.values()) {
            texts.forEach((t) => {
                t.resolution = res;
            });
        }
    };

    // Gives sprites near the view their texture and the rest the placeholder, then frees what no sprite uses.
    // Every sprite is re-assigned before retain(), so none keeps a texture that retain() destroys.
    private placeTextures() {
        const v = this.viewport.getVisibleBounds();
        const view = {x: v.x - (v.width / 2), y: v.y - (v.height / 2), w: v.width * 2, h: v.height * 2}; // half a view on each side
        const zoom = this.getZoom();
        const used = new Set<string>();
        for (const el of this.els) {
            const item = this.items.get(el.id);
            if (!item?.sprite) {
                continue;
            }
            const fileId = el.type === 'image' ? el.fileId : el.finalFileId;
            const slot = spriteSlot(el);
            const x = num(el.x) + slot.x;
            const y = num(el.y) + slot.y;
            let texture: Texture | undefined;
            if (fileId && x < view.x + view.w && view.x < x + slot.w && y < view.y + view.h && view.y < y + slot.h) {
                // An image's sprite fills its box; a final is contained in its strip, so the strip's shape stands in for the file's.
                const size = textureSize(slot.h * zoom, el.type === 'image' ? num(el.aspect, slot.w / slot.h) : slot.w / slot.h);
                const key = textureKey(fileId, size);
                texture = this.textures.get(fileId, size);
                used.add(key);
                const shown = item.shown;
                if (texture) {
                    item.shown = {fileId, key, texture};
                } else if (shown?.fileId === fileId && !shown.texture.destroyed) {
                    texture = shown.texture; // the other size, until the wanted one loads
                    used.add(shown.key);
                }
            }
            if (!texture) {
                item.shown = undefined;
            }
            fitSprite(item.sprite, texture, slot, el.type === 'scene');
        }
        this.textures.retain(used);
    }

    private placeCursors() {
        this.cursors.forEach((c, i) => {
            const p = this.viewport.toScreen(num(c.x), num(c.y));
            this.cursorItems[i].root.position.set(p.x, p.y);
        });
    }

    private screenBox(b: Bounds) {
        const p = this.viewport.toScreen(b.x, b.y);
        const zoom = this.getZoom();
        return {x: p.x, y: p.y, w: b.w * zoom, h: b.h * zoom};
    }

    private drawOverlay() {
        const o = this.overlay.clear();
        for (const {color, box} of this.remoteSelections) {
            const r = this.screenBox(box);
            o.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4).stroke({width: 1.5, color: safeColor(color) ?? SELECTION_COLOR});
        }
        if (this.selected.length) {
            const r = this.screenBox(unionBounds(this.selected));
            const corners = [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h];
            dashPolyline([...corners, r.x, r.y], [4, 4]).forEach((piece) => polyline(o, piece));
            o.stroke({width: 1, color: SELECTION_COLOR});
            for (let i = 0; i < corners.length; i += 2) {
                o.rect(corners[i] - (HANDLE_PX / 2), corners[i + 1] - (HANDLE_PX / 2), HANDLE_PX, HANDLE_PX).fill('#ffffff').stroke({width: 1, color: SELECTION_COLOR});
            }
        }
        if (this.marquee) {
            const m = this.marquee;
            const r = this.screenBox({x: Math.min(m.x, m.x + m.w), y: Math.min(m.y, m.y + m.h), w: Math.abs(m.w), h: Math.abs(m.h)});
            o.rect(r.x, r.y, r.w, r.h).fill({color: SELECTION_COLOR, alpha: 0.08}).stroke({width: 1, color: SELECTION_COLOR});
        }
    }
}
