// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import * as Y from 'yjs';

import {generateId} from 'utils/utils';

export type ElementType = 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

export type Arrowhead = 'none' | 'arrow' | 'triangle' | 'bar';

export type ElementStyle = {
    stroke: string;

    /** 'transparent' or a colour */
    fill: string;
    fillStyle: 'solid' | 'hachure' | 'cross-hatch';
    strokeWidth: 1 | 2 | 4;
    strokeStyle: 'solid' | 'dashed' | 'dotted';
    roughness: 0 | 1 | 2;
    roundness: 'sharp' | 'round';

    /** integer 0–100 */
    opacity: number;
    startArrow: Arrowhead;
    endArrow: Arrowhead;
    fontSize: 16 | 20 | 28 | 36;
    fontFamily: 'normal' | 'code';
    textAlign: 'left' | 'center' | 'right';
};

export type CanvasElement = ElementStyle & {
    id: string;
    type: ElementType;
    x: number;
    y: number;
    w: number;
    h: number;

    /** flat [x0, y0, x1, y1, …] relative to x, y */
    points?: number[];
    text?: string;
    z: number;

    /** Rough.js seed, a random int picked at creation */
    seed: number;
};

export const DEFAULT_STYLE: ElementStyle = {
    stroke: '#000000',
    fill: 'transparent',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    roundness: 'round',
    opacity: 100,
    startArrow: 'none',
    endArrow: 'arrow',
    fontSize: 20,
    fontFamily: 'normal',
    textAlign: 'left',
};

/** CSS font stacks for ElementStyle.fontFamily, shared by the renderer and the text editor. */
export const FONT_FAMILIES: Record<ElementStyle['fontFamily'], string> = {normal: '"Open Sans", sans-serif', code: 'Menlo, Consolas, monospace'};

export const LOCAL = Symbol('local');
export const REMOTE = Symbol('remote');

type Elements = Y.Map<Y.Map<unknown>>;

const getElements = (doc: Y.Doc): Elements => doc.getMap<Y.Map<unknown>>('elements');

export const randomSeed = () => Math.floor(Math.random() * (2 ** 31));

export function createCanvasDoc(): {doc: Y.Doc; elements: Elements; undo: Y.UndoManager} {
    const doc = new Y.Doc();
    const elements = getElements(doc);

    // Consecutive LOCAL writes within captureTimeout (500 ms) merge into one step; callers end a gesture with undo.stopCapturing().
    const undo = new Y.UndoManager(elements, {trackedOrigins: new Set([LOCAL])});
    return {doc, elements, undo};
}

/** Longest text an element may hold: the editor's maxLength and the renderer's clamp for text from other clients. */
export const MAX_TEXT_LENGTH = 20000;

const TYPES = new Set<unknown>(['pen', 'rect', 'ellipse', 'line', 'arrow', 'text']);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** The doc is written by every member's client: skip a value the board could not draw or measure instead of throwing on it. */
function parseElement(id: string, value: unknown): CanvasElement | undefined {
    if (!(value instanceof Y.Map)) {
        return undefined;
    }
    const el = value.toJSON() as CanvasElement;
    if (!TYPES.has(el.type) || ![el.x, el.y, el.w, el.h, el.z].every(finite)) {
        return undefined;
    }
    if (el.points !== undefined && !(Array.isArray(el.points) && el.points.every(finite))) {
        return undefined;
    }
    if (el.text !== undefined && typeof el.text !== 'string') {
        return undefined;
    }
    return {...el, id};
}

export function readElements(elements: Elements): CanvasElement[] {
    const out: CanvasElement[] = [];
    elements.forEach((value, id) => {
        const el = parseElement(id, value);
        if (el) {
            out.push(el);
        }
    });
    return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : Number(a.id > b.id)));
}

function writeElement(elements: Elements, el: CanvasElement) {
    elements.set(el.id, new Y.Map(Object.entries(el).filter(([, v]) => v !== undefined)));
}

export function addElement(doc: Y.Doc, el: CanvasElement) {
    doc.transact(() => writeElement(getElements(doc), el), LOCAL);
}

export function updateElements(doc: Y.Doc, ids: string[], patch: Partial<CanvasElement>) {
    const elements = getElements(doc);
    doc.transact(() => {
        for (const id of ids) {
            const m = elements.get(id);
            if (!m) {
                continue;
            }
            for (const [key, value] of Object.entries(patch)) {
                if (key === 'id') {
                    continue;
                }
                if (value === undefined) {
                    m.delete(key);
                } else if (m.get(key) !== value) {
                    m.set(key, value);
                }
            }
        }
    }, LOCAL);
}

export function deleteElements(doc: Y.Doc, ids: string[]) {
    const elements = getElements(doc);
    doc.transact(() => ids.forEach((id) => elements.delete(id)), LOCAL);
}

/** Copies the elements on top of everything, keeping their relative order; returns the new ids in that order. */
export function duplicateElements(doc: Y.Doc, ids: string[], offset = 10): string[] {
    const elements = getElements(doc);
    const all = readElements(elements);
    const selected = new Set(ids);
    const top = all.length ? all[all.length - 1].z : 0;
    const copies = all.filter((el) => selected.has(el.id)).map((el, i) => ({
        ...el,
        id: generateId(),
        seed: randomSeed(),
        x: el.x + offset,
        y: el.y + offset,
        z: top + 1 + i,
    }));
    writeInBatches(doc, copies);
    return copies.map((el) => el.id);
}

// Upper bound on an element's encoded size: Yjs spends at most 9 bytes per number, 4 per character, and well under 512 on the rest.
const estimateBytes = (el: Partial<CanvasElement>) => 512 + ((el.points?.length ?? 0) * 9) + ((el.text?.length ?? 0) * 4);

/** Half the 512 KB a sync post carries, so each transaction posts on its own; the undo capture window still merges them into one step. */
const TRANSACTION_MAX_BYTES = 256 * 1024;

function inBatches<T extends Partial<CanvasElement>>(doc: Y.Doc, items: T[], write: (item: T) => void) {
    let batch: T[] = [];
    let size = 0;
    const flush = () => {
        if (batch.length) {
            const pending = batch;
            doc.transact(() => pending.forEach(write), LOCAL);
        }
        batch = [];
        size = 0;
    };
    for (const item of items) {
        const bytes = estimateBytes(item);
        if (batch.length && size + bytes > TRANSACTION_MAX_BYTES) {
            flush();
        }
        batch.push(item);
        size += bytes;
    }
    flush();
}

/** Writes new elements in transactions small enough for one sync post, e.g. a large paste. */
export function writeInBatches(doc: Y.Doc, els: CanvasElement[]) {
    const elements = getElements(doc);
    inBatches(doc, els, (el) => writeElement(elements, el));
}

/** Applies a patch per element (each carrying its id) in transactions small enough for one sync post, e.g. a resize of long strokes. */
export function updateInBatches(doc: Y.Doc, patches: Array<Partial<CanvasElement> & {id: string}>) {
    inBatches(doc, patches, (p) => updateElements(doc, [p.id], p));
}

export function reorder(doc: Y.Doc, ids: string[], op: 'back' | 'backward' | 'forward' | 'front') {
    const elements = getElements(doc);
    const all = readElements(elements);
    const selected = new Set(ids);
    const picked = all.filter((el) => selected.has(el.id));
    if (!picked.length) {
        return;
    }

    const newZ = new Map<string, number>();
    if (op === 'front') {
        picked.forEach((el, i) => newZ.set(el.id, all[all.length - 1].z + 1 + i));
    } else if (op === 'back') {
        picked.forEach((el, i) => newZ.set(el.id, (all[0].z - picked.length) + i));
    } else {
        // Move each selected element one place past its unselected neighbour, then hand out the old z values in the new order.
        const order = [...all];
        const step = op === 'forward' ? 1 : -1;
        const start = op === 'forward' ? order.length - 2 : 1;
        for (let i = start; i >= 0 && i < order.length; i -= step) {
            if (selected.has(order[i].id) && !selected.has(order[i + step].id)) {
                [order[i], order[i + step]] = [order[i + step], order[i]];
            }
        }
        const zs = all.map((el) => el.z);
        const distinct = new Set(zs).size === zs.length;
        order.forEach((el, i) => newZ.set(el.id, distinct ? zs[i] : i));
    }

    doc.transact(() => {
        for (const el of all) {
            const z = newZ.get(el.id);
            if (z !== undefined && z !== el.z) {
                elements.get(el.id)!.set('z', z);
            }
        }
    }, LOCAL);
}
