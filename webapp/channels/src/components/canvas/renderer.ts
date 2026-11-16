// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getStroke} from 'perfect-freehand';
import {Viewport} from 'pixi-viewport';
import {Application, Container, Graphics, Text} from 'pixi.js';
import 'pixi.js/unsafe-eval'; // the server's CSP (script-src 'self') forbids eval; this swaps Pixi's generated code for static versions
import rough from 'roughjs';
import type {Drawable, Op, Options} from 'roughjs/bin/core';

import {dashPolyline, fitViewport, MAX_ZOOM, MIN_ZOOM, unionBounds} from './geometry';
import type {Bounds} from './geometry';
import {FONT_FAMILIES, MAX_TEXT_LENGTH} from './model';
import type {Arrowhead, CanvasElement} from './model';

export type RemoteCursor = {userId: string; name: string; color: string; x: number; y: number};
export type RemoteSelection = {color: string; box: Bounds};

const SELECTION_COLOR = '#1c58d9';
const HANDLE_PX = 8;
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

/** Builds the display object for one element, in coordinates relative to (el.x, el.y). */
function build(el: CanvasElement): Graphics | Text {
    const stroke = safeColor(el.stroke) ?? '#000000';
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
        const outline = getStroke(pairs(el.points), {size: width * 4.25, thinning: 0.6, smoothing: 0.5, streamline: 0.5, last: true});
        if (outline.length > 2) {
            g.poly(outline.flat()).fill(stroke);
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

// Everything but position and stacking; a points checksum stands in for the (possibly long) points array.
function shapeKey(el: CanvasElement) {
    const {x, y, z, points, ...rest} = el; // eslint-disable-line @typescript-eslint/no-unused-vars
    const pts = Array.isArray(points) ? `${points.length}:${points.reduce((s: number, v) => s + num(v), 0)}` : '';
    return JSON.stringify(rest) + pts;
}

type Item = {key: string; obj: Graphics | Text};
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
        this.app.renderer.off('resize', this.handleResize);
        this.viewport.destroy({children: true}); // first, while the ticker and event system it unhooks from still exist
        this.app.destroy({removeView: true}, {children: true});
    }

    draw(els: CanvasElement[], selected: string[], marquee?: Bounds) {
        const seen = new Set<string>();
        els.forEach((el, i) => {
            seen.add(el.id);
            const key = shapeKey(el);
            let item = this.items.get(el.id);
            if (!item || item.key !== key) {
                item?.obj.destroy();
                let obj: Graphics | Text;
                try {
                    obj = build(el);
                } catch {
                    obj = new Graphics(); // a malformed element draws nothing rather than breaking the board
                }
                if (obj instanceof Text) {
                    obj.resolution = this.textResolution;
                }
                this.viewport.addChild(obj);
                item = {key, obj};
                this.items.set(el.id, item);
            }
            item.obj.position.set(num(el.x), num(el.y));
            item.obj.alpha = clamp(num(el.opacity, 100), 0, 100) / 100;
            item.obj.zIndex = i;
        });
        for (const [id, item] of this.items) {
            if (!seen.has(id)) {
                item.obj.destroy();
                this.items.delete(id);
            }
        }
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
        for (const {obj} of this.items.values()) {
            if (obj instanceof Text) {
                obj.resolution = res;
            }
        }
    };

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
