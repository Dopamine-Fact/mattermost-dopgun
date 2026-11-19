// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DEFAULT_STYLE} from './model';
import type {CanvasElement} from './model';
import {shapeKey} from './renderer';

jest.mock('pixi.js', () => ({}));
jest.mock('pixi.js/unsafe-eval', () => ({}));
jest.mock('pixi-viewport', () => ({}));

describe('shapeKey', () => {
    const el: CanvasElement = {...DEFAULT_STYLE, id: 'a', type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 0, seed: 1};

    test('ignores position, stacking and the author stamps, which are never drawn', () => {
        const moved = {...el, x: 5, y: 6, z: 3, createdBy: 'u', createdAt: 1, updatedBy: 'v', updatedAt: 2};
        expect(shapeKey(moved)).toBe(shapeKey(el));
    });

    test('changes with what is drawn', () => {
        expect(shapeKey({...el, w: 11})).not.toBe(shapeKey(el));
        expect(shapeKey({...el, stroke: '#ff0000'})).not.toBe(shapeKey(el));
    });
});
