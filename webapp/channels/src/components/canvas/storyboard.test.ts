// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {CanvasElement} from './model';
import {cardForImage, labelFor, layoutScenes, membershipPatches, sceneAt, sceneParts, sortByName, stackInScene} from './storyboard';

const el = (id: string, type: CanvasElement['type'], x: number, y: number, w: number, h: number, z: number, sceneId?: string) =>
    ({id, type, x, y, w, h, z, sceneId}) as CanvasElement;

function expectBounds(b: {x: number; y: number; w: number; h: number}, x: number, y: number, w: number, h: number) {
    expect(b.x).toBeCloseTo(x);
    expect(b.y).toBeCloseTo(y);
    expect(b.w).toBeCloseTo(w);
    expect(b.h).toBeCloseTo(h);
}

describe('storyboard', () => {
    it('sceneParts splits a card', () => {
        const p = sceneParts({x: 0, y: 0, w: 832, h: 696});
        expectBounds(p.header, 0, 0, 832, 48);
        expectBounds(p.tick, 784, 0, 48, 48);
        expectBounds(p.body, 0, 48, 832, 648);
        expectBounds(p.final, 0, 480, 832, 216);
        expectBounds(p.image, 16, 64, 800, 400);
    });

    it('cardForImage is the inverse', () => {
        expectBounds(cardForImage({x: 16, y: 64, w: 800, h: 400}), 0, 0, 832, 696);
    });

    it('layoutScenes lays cards left to right at a common height', () => {
        const [a, b] = layoutScenes([2, 1], {x: 0, y: 0});
        expectBounds(a.image, 16, 64, 800, 400);
        expectBounds(b.image, 917.6, 64, 400, 400);
        expect(b.scene.x).toBeCloseTo(832 + 69.6);
    });

    it('layoutScenes wraps after 10 cards', () => {
        const cards = layoutScenes(new Array(11).fill(1), {x: 0, y: 0});
        expect(cards[10].scene.x).toBeCloseTo(0);
        expect(cards[10].scene.y).toBeCloseTo(696 + 69.6);
    });

    it('layoutScenes treats a missing aspect as square', () => {
        for (const a of [0, NaN]) {
            expectBounds(layoutScenes([a], {x: 0, y: 0})[0].image, 16, 64, 400, 400);
        }
    });

    it('stackInScene offsets each image', () => {
        const s = {x: 100, y: 200, w: 832, h: 696};
        const img = sceneParts(s).image;
        const [a, b] = stackInScene(s, 1, [2, 1]);
        expectBounds(a, img.x + 24, img.y + 24, 2 * img.h, img.h);
        expectBounds(b, img.x + 48, img.y + 48, img.h, img.h);
    });

    it('stackInScene keeps images visible in a minimum-size card', () => {
        const [a] = stackInScene({x: 0, y: 0, w: 96, h: 96}, 0, [2]);
        expect(a.h).toBe(32);
        expect(a.w).toBe(64);
    });

    it('sortByName is natural', () => {
        const items = ['SC10.png', 'sc2.png', 'SC1.png'].map((name) => ({name}));
        expect(sortByName(items).map((i) => i.name)).toEqual(['SC1.png', 'sc2.png', 'SC10.png']);
    });

    it('labelFor strips the extension', () => {
        expect(labelFor('SC012.final.png')).toBe('SC012.final');
        expect(labelFor('noext')).toBe('noext');
    });

    describe('scene membership', () => {
        const A = el('A', 'scene', 0, 0, 100, 100, 1);
        const B = el('B', 'scene', 200, 0, 100, 100, 5);
        const i = el('i', 'image', 10, 10, 20, 20, 3, 'A');
        const f = el('f', 'image', 500, 500, 20, 20, 0);
        const els = [A, B, i, f];
        const inB = {x: 250, y: 50};

        it('sceneAt returns the topmost card', () => {
            const top = el('T', 'scene', 0, 0, 100, 100, 5);
            const p = {x: 50, y: 50};
            expect(sceneAt([A, top], p)?.id).toBe('T');
            expect(sceneAt([A, top], p, new Set(['T']))?.id).toBe('A');
            expect(sceneAt([A, B], {x: 150, y: 50})).toBeUndefined();
        });

        it('moves an image into another card, raising it only when needed', () => {
            expect(membershipPatches(els, ['i'], inB, 9)).toEqual([{id: 'i', sceneId: 'B', z: 10}]);
            const above = el('i', 'image', 10, 10, 20, 20, 7, 'A');
            expect(membershipPatches([A, B, above], ['i'], inB, 9)).toEqual([{id: 'i', sceneId: 'B'}]);
        });

        it('releases an image dropped on empty board', () => {
            expect(membershipPatches(els, ['i'], {x: 900, y: 900}, 9)).toEqual([{id: 'i', sceneId: undefined}]);
        });

        it('leaves an image dropped on its own card', () => {
            expect(membershipPatches(els, ['i'], {x: 50, y: 50}, 9)).toEqual([]);
        });

        it('adopts a free image', () => {
            expect(membershipPatches(els, ['f'], {x: 50, y: 50}, 9)).toEqual([{id: 'f', sceneId: 'A', z: 10}]);
        });

        it('never joins cards to cards or re-parents images that move with their card', () => {
            expect(membershipPatches(els, ['A'], inB, 9)).toEqual([]);
            expect(membershipPatches(els, ['A', 'i'], inB, 9)).toEqual([]);
        });
    });
});
