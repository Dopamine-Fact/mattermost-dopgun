// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AlignMode, Bounds, Point} from './geometry';
import {align, bounds} from './geometry';
import type {CanvasElement} from './model';
import {MAX_LABEL_LENGTH} from './model';

export const SCENE_HEADER = 48;
export const SCENE_PAD = 16;
export const FINAL_FRACTION = 1 / 3;
export const SCENE_FRAME = 8;
export const CARD_IMAGE_H = 400;
export const ROW_CARDS = 10;
export const GAP_RATIO = 0.1;
export const STACK_OFFSET = 24;

/** A stacked image's least height, so a card at its minimum size (no room for an image) still shows what was dropped. */
export const MIN_STACK_H = 32;

const safeAspect = (a: number) => (Number.isFinite(a) && a > 0 ? a : 1);

export function sceneParts(s: Bounds) {
    const header = {x: s.x, y: s.y, w: s.w, h: SCENE_HEADER};
    const tick = {x: s.x + (s.w - SCENE_HEADER), y: s.y, w: SCENE_HEADER, h: SCENE_HEADER};
    const body = {x: s.x, y: s.y + SCENE_HEADER, w: s.w, h: s.h - SCENE_HEADER};
    const finalH = body.h * FINAL_FRACTION;
    const final = {x: body.x, y: body.y + (body.h - finalH), w: body.w, h: finalH};
    const image = {
        x: body.x + SCENE_PAD,
        y: body.y + SCENE_PAD,
        w: body.w - (2 * SCENE_PAD),
        h: (body.h - finalH) - (2 * SCENE_PAD),
    };
    return {header, tick, body, image, final};
}

export function cardForImage(img: Bounds): Bounds {
    const bodyH = (img.h + (2 * SCENE_PAD)) / (1 - FINAL_FRACTION);
    return {
        x: img.x - SCENE_PAD,
        y: img.y - SCENE_PAD - SCENE_HEADER,
        w: img.w + (2 * SCENE_PAD),
        h: SCENE_HEADER + bodyH,
    };
}

export function layoutScenes(aspects: number[], at: Point): Array<{scene: Bounds; image: Bounds}> {
    const cardH = cardForImage({x: 0, y: 0, w: 0, h: CARD_IMAGE_H}).h;
    const gap = GAP_RATIO * cardH;
    let x = at.x;
    return aspects.map((a, i) => {
        const col = i % ROW_CARDS;
        if (col === 0) {
            x = at.x;
        }
        const y = at.y + (Math.floor(i / ROW_CARDS) * (cardH + gap));
        const scene = cardForImage({x: x + SCENE_PAD, y: y + SCENE_HEADER + SCENE_PAD, w: safeAspect(a) * CARD_IMAGE_H, h: CARD_IMAGE_H});
        x += scene.w + gap;
        return {scene, image: sceneParts(scene).image};
    });
}

export function stackInScene(scene: Bounds, existing: number, aspects: number[]): Bounds[] {
    const img = sceneParts(scene).image;
    const h = Math.max(img.h, MIN_STACK_H);
    return aspects.map((a, k) => ({
        x: img.x + ((existing + k) * STACK_OFFSET),
        y: img.y + ((existing + k) * STACK_OFFSET),
        w: safeAspect(a) * h,
        h,
    }));
}

export function sortByName<T extends {name: string}>(items: T[]): T[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
}

export function labelFor(name: string): string {
    const dot = name.lastIndexOf('.');
    return (dot > 0 ? name.slice(0, dot) : name).slice(0, MAX_LABEL_LENGTH);
}

export function sceneAt(els: CanvasElement[], p: Point, exclude?: Set<string>): CanvasElement | undefined {
    let best: CanvasElement | undefined;
    for (const e of els) {
        if (e.type !== 'scene' || exclude?.has(e.id)) {
            continue;
        }
        const b = bounds(e);
        if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) {
            continue;
        }
        if (!best || e.z > best.z || (e.z === best.z && e.id > best.id)) {
            best = e;
        }
    }
    return best;
}

export function membershipPatches(els: CanvasElement[], movedIds: string[], p: Point, topZ: number): Array<{id: string; sceneId?: string; z?: number}> {
    const moved = new Set(movedIds);
    const target = sceneAt(els, p, moved);
    const patches: Array<{id: string; sceneId?: string; z?: number}> = [];
    let z = topZ;
    for (const id of movedIds) {
        const img = els.find((e) => e.id === id);
        if (!img || img.type !== 'image' || (img.sceneId && moved.has(img.sceneId)) || img.sceneId === target?.id) {
            continue;
        }
        if (!target) {
            patches.push({id, sceneId: undefined});
        } else if (img.z > target.z) {
            patches.push({id, sceneId: target.id});
        } else {
            z += 1;
            patches.push({id, sceneId: target.id, z});
        }
    }
    return patches;
}

/** Aligns the elements; a card's images move with it, and an image whose card is aligned too is not aligned on its own. */
export function alignWithImages(els: CanvasElement[], ids: string[], mode: AlignMode): Array<{id: string; x: number; y: number}> {
    const selected = new Set(ids);
    const cards = new Map(els.filter((e) => e.type === 'scene').map((e) => [e.id, e]));
    const cardOf = (e: CanvasElement) => (e.type === 'image' && e.sceneId ? cards.get(e.sceneId) : undefined);
    const moved = align(els.filter((e) => selected.has(e.id) && !selected.has(cardOf(e)?.id ?? '')), mode);
    const out = Object.entries(moved).map(([id, p]) => ({id, ...p}));
    for (const e of els) {
        const card = cardOf(e);
        const to = card && moved[card.id];
        if (card && to && !moved[e.id]) {
            out.push({id: e.id, x: e.x + (to.x - card.x), y: e.y + (to.y - card.y)});
        }
    }
    return out;
}

/** A copied image without its card joins the card under its centre, as an image dropped there would; copies sit above every card. */
export function joinCards(copies: CanvasElement[], els: CanvasElement[]): Array<{id: string; sceneId: string}> {
    return copies.flatMap((e) => {
        if (e.type !== 'image' || e.sceneId) {
            return [];
        }
        const b = bounds(e);
        const card = sceneAt(els, {x: b.x + (b.w / 2), y: b.y + (b.h / 2)});
        return card ? [{id: e.id, sceneId: card.id}] : [];
    });
}
