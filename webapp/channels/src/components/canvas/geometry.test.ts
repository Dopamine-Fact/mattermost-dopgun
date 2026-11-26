// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {align, bounds, dashPolyline, fitViewport, hitTest, inRect, resize, unionBounds} from './geometry';
import type {CanvasElement} from './model';
import {DEFAULT_STYLE} from './model';

const el = (id: string, props: Partial<CanvasElement> = {}): CanvasElement => ({
    ...DEFAULT_STYLE,
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    z: 0,
    seed: 1,
    ...props,
});

describe('canvas geometry', () => {
    test('bounds normalise negative sizes', () => {
        expect(bounds(el('a', {x: 10, y: 10, w: -5, h: -20}))).toEqual({x: 5, y: -10, w: 5, h: 20});
        expect(unionBounds([el('a'), el('b', {x: 150, y: -10, w: 10, h: 10})])).toEqual({x: 0, y: -10, w: 160, h: 110});
    });

    test('a frame is hit by its edge and title, not its inside', () => {
        const frame = [el('f', {type: 'frame', fill: '#ffffff'})];
        expect(hitTest(frame, {x: 50, y: 50}, 2)).toBeUndefined();
        expect(hitTest(frame, {x: 0, y: 50}, 2)).toBe('f');
        expect(hitTest(frame, {x: 50, y: -10}, 2)).toBe('f');
    });

    test('hitTest picks the topmost of two overlapping rects', () => {
        const els = [el('top', {z: 1, fill: '#ff0000'}), el('bottom', {z: 0, fill: '#ff0000'})];
        expect(hitTest(els, {x: 50, y: 50}, 2)).toBe('top');
    });

    test('a point inside an unfilled rect misses, inside a filled one hits', () => {
        expect(hitTest([el('a')], {x: 50, y: 50}, 2)).toBeUndefined();
        expect(hitTest([el('a')], {x: 1, y: 50}, 2)).toBe('a');
        expect(hitTest([el('a', {fill: '#ff0000'})], {x: 50, y: 50}, 2)).toBe('a');
    });

    test('pen segments hit within the tolerance', () => {
        const pen = el('p', {type: 'pen', x: 10, y: 10, w: 100, h: 0, points: [0, 0, 100, 0]});
        expect(hitTest([pen], {x: 60, y: 13}, 5)).toBe('p');
        expect(hitTest([pen], {x: 60, y: 13}, 2)).toBeUndefined();
    });

    test('inRect returns the elements fully inside', () => {
        expect(inRect([el('a'), el('b', {x: 90})], {x: -1, y: -1, w: 120, h: 120})).toEqual(['a']);
    });

    test('resize se by (+10, +10) doubles a 10x10 pen', () => {
        const pen = el('p', {type: 'pen', x: 5, y: 5, w: 10, h: 10, points: [0, 0, 10, 10, 4, 6]});
        expect(resize(pen, 'se', 10, 10)).toEqual({x: 5, y: 5, w: 20, h: 20, points: [0, 0, 20, 20, 8, 12]});
        expect(resize(pen, 'nw', 5, 5)).toEqual({x: 10, y: 10, w: 5, h: 5, points: [0, 0, 5, 5, 2, 3]});
    });

    test('align left moves both rects to the smaller x', () => {
        expect(align([el('a', {x: 30, y: 5}), el('b', {x: 10, y: 50})], 'left')).toEqual({a: {x: 10, y: 5}, b: {x: 10, y: 50}});
    });

    test('dashPolyline splits a line into dashes', () => {
        expect(dashPolyline([0, 0, 30, 0], [8, 6])).toEqual([[0, 0, 8, 0], [14, 0, 22, 0], [28, 0, 30, 0]]);
        expect(dashPolyline([0, 0, 10, 0, 10, 10], [8, 6])).toEqual([[0, 0, 8, 0], [10, 4, 10, 10]]);
    });

    test('fitViewport fits the box with padding', () => {
        expect(fitViewport({x: 0, y: 0, w: 1000, h: 500}, 800, 600)).toEqual({scale: (800 - 80) / 1000, cx: 500, cy: 250});
        expect(fitViewport({x: 0, y: 0, w: 0, h: 0}, 800, 600).scale).toBe(30);
    });
});
