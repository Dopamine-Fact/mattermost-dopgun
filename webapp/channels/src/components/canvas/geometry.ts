// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {CanvasElement} from './model';

export type Point = {x: number; y: number};
export type Bounds = {x: number; y: number; w: number; h: number};
export type Handle = 'nw' | 'ne' | 'sw' | 'se';
export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

/** Height of the title strip drawn above a frame. */
export const FRAME_TITLE = 24;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function bounds(el: Pick<CanvasElement, 'x' | 'y' | 'w' | 'h'>): Bounds {
    return {x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h)};
}

export function unionBounds(els: CanvasElement[]): Bounds {
    if (!els.length) {
        return {x: 0, y: 0, w: 0, h: 0};
    }
    const bs = els.map(bounds);
    const x = Math.min(...bs.map((b) => b.x));
    const y = Math.min(...bs.map((b) => b.y));
    const right = Math.max(...bs.map((b) => b.x + b.w));
    const bottom = Math.max(...bs.map((b) => b.y + b.h));
    return {x, y, w: right - x, h: bottom - y};
}

function segmentDistance(p: Point, x0: number, y0: number, x1: number, y1: number) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = (dx * dx) + (dy * dy);
    const t = len2 ? clamp((((p.x - x0) * dx) + ((p.y - y0) * dy)) / len2, 0, 1) : 0;
    return Math.hypot(p.x - (x0 + (t * dx)), p.y - (y0 + (t * dy)));
}

function polylineDistance(el: CanvasElement, p: Point) {
    const pts = el.points ?? [0, 0, el.w, el.h];
    if (pts.length < 4) {
        return pts.length < 2 ? Infinity : Math.hypot(p.x - el.x - pts[0], p.y - el.y - pts[1]);
    }
    let d = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) {
        d = Math.min(d, segmentDistance(p, el.x + pts[i], el.y + pts[i + 1], el.x + pts[i + 2], el.y + pts[i + 3]));
    }
    return d;
}

const inBox = (p: Point, b: Bounds, pad: number) =>
    p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

function inEllipse(p: Point, b: Bounds, pad: number) {
    const rx = (b.w / 2) + pad;
    const ry = (b.h / 2) + pad;
    if (rx <= 0 || ry <= 0) {
        return false;
    }
    return (((p.x - b.x - (b.w / 2)) / rx) ** 2) + (((p.y - b.y - (b.h / 2)) / ry) ** 2) <= 1;
}

function hits(el: CanvasElement, p: Point, tolerance: number) {
    const b = bounds(el);
    const filled = el.fill !== 'transparent';
    switch (el.type) {
    case 'pen':
    case 'line':
    case 'arrow':
        return polylineDistance(el, p) <= tolerance;
    case 'rect':
        return inBox(p, b, tolerance) && (filled || !inBox(p, b, -tolerance));
    case 'ellipse':
        return inEllipse(p, b, tolerance) && (filled || !inEllipse(p, b, -tolerance));
    case 'frame': // by its edge or title only, so a press inside starts a marquee over what sits on it
        return (inBox(p, b, tolerance) && !inBox(p, b, -tolerance)) || inBox(p, {x: b.x, y: b.y - FRAME_TITLE, w: b.w, h: FRAME_TITLE}, 0);
    default:
        return inBox(p, b, tolerance);
    }
}

/** Returns the id of the topmost element under p. */
export function hitTest(els: CanvasElement[], p: Point, tolerance: number): string | undefined {
    let top: CanvasElement | undefined;
    for (const el of els) {
        if ((!top || el.z > top.z || (el.z === top.z && el.id > top.id)) && hits(el, p, tolerance)) {
            top = el;
        }
    }
    return top?.id;
}

/** Ids of the elements lying entirely inside rect. */
export function inRect(els: CanvasElement[], rect: Bounds): string[] {
    const r = bounds(rect);
    return els.filter((el) => {
        const b = bounds(el);
        return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
    }).map((el) => el.id);
}

/** Drags a corner of the element's box by (dx, dy), scaling its points with it. */
export function resize(el: CanvasElement, handle: Handle, dx: number, dy: number): Partial<CanvasElement> {
    const b = bounds(el);
    const left = handle.includes('w') ? b.x + dx : b.x;
    const right = handle.includes('e') ? b.x + b.w + dx : b.x + b.w;
    const top = handle.includes('n') ? b.y + dy : b.y;
    const bottom = handle.includes('s') ? b.y + b.h + dy : b.y + b.h;
    const sx = b.w ? (right - left) / b.w : 1;
    const sy = b.h ? (bottom - top) / b.h : 1;

    // Map every point X to left + (X - b.x) * sx, which also handles negative w/h and flips.
    const patch: Partial<CanvasElement> = {
        x: left + ((el.x - b.x) * sx),
        y: top + ((el.y - b.y) * sy),
        w: el.w * sx,
        h: el.h * sy,
    };
    if (el.points) {
        patch.points = el.points.map((v, i) => v * (i % 2 ? sy : sx));
    }
    return patch;
}

const ALIGN_X: Partial<Record<AlignMode, number>> = {left: 0, center: 0.5, right: 1};
const ALIGN_Y: Partial<Record<AlignMode, number>> = {top: 0, middle: 0.5, bottom: 1};

/** New positions that align each element to the selection's union bounds. */
export type ResizePatch = Partial<CanvasElement> & {id: string};

/** Scales every element with the selection's box as one corner of it is dragged. */
export function resizeAll(orig: CanvasElement[], handle: Handle, dx: number, dy: number) {
    const u = unionBounds(orig);
    const box = resize({...orig[0], ...u, points: undefined}, handle, dx, dy);
    const sx = u.w ? box.w! / u.w : 1;
    const sy = u.h ? box.h! / u.h : 1;
    return orig.map((el): ResizePatch => ({
        id: el.id,
        x: box.x! + ((el.x - u.x) * sx),
        y: box.y! + ((el.y - u.y) * sy),
        w: el.w * sx,
        h: el.h * sy,
        points: el.points?.map((v, i) => v * (i % 2 ? sy : sx)),
    }));
}

export function align(els: CanvasElement[], mode: AlignMode): Record<string, {x: number; y: number}> {
    const u = unionBounds(els);
    const fx = ALIGN_X[mode];
    const fy = ALIGN_Y[mode];
    const out: Record<string, {x: number; y: number}> = {};
    for (const el of els) {
        const b = bounds(el);
        const dx = fx === undefined ? 0 : (u.x + (u.w * fx)) - (b.x + (b.w * fx));
        const dy = fy === undefined ? 0 : (u.y + (u.h * fy)) - (b.y + (b.h * fy));
        out[el.id] = {x: el.x + dx, y: el.y + dy};
    }
    return out;
}

/** Splits a flat polyline into the "on" pieces of a repeating on/off dash pattern. */
export function dashPolyline(points: number[], pattern: number[]): number[][] {
    if (points.length < 4) {
        return [];
    }
    if (!pattern.length || pattern.some((len) => !(len > 0))) {
        return [points.slice()];
    }
    const out: number[][] = [];
    let k = 0;
    let left = pattern[0];
    let on = true;
    let cur = [points[0], points[1]];
    for (let i = 0; i + 3 < points.length; i += 2) {
        const [x0, y0, x1, y1] = points.slice(i, i + 4);
        const len = Math.hypot(x1 - x0, y1 - y0);
        let t = 0;
        while (len - t > left) {
            t += left;
            const px = x0 + (((x1 - x0) * t) / len);
            const py = y0 + (((y1 - y0) * t) / len);
            if (on) {
                cur.push(px, py);
                out.push(cur);
            } else {
                cur = [px, py];
            }
            on = !on;
            k = (k + 1) % pattern.length;
            left = pattern[k];
        }
        left -= len - t;
        if (on) {
            cur.push(x1, y1);
        }
    }
    if (on && cur.length >= 4) {
        out.push(cur);
    }
    return out;
}

/** Scale and centre that fit box b into the view with padding on every side. */
export function fitViewport(b: Bounds, viewW: number, viewH: number, padding = 40): {scale: number; cx: number; cy: number} {
    const sx = b.w > 0 ? (viewW - (2 * padding)) / b.w : Infinity;
    const sy = b.h > 0 ? (viewH - (2 * padding)) / b.h : Infinity;
    return {scale: clamp(Math.min(sx, sy), MIN_ZOOM, MAX_ZOOM), cx: b.x + (b.w / 2), cy: b.y + (b.h / 2)};
}
