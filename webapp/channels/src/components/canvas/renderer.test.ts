// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DEFAULT_STYLE} from './model';
import type {CanvasElement} from './model';
import {build, fitSprite, shapeKey} from './renderer';

jest.mock('pixi.js', () => {
    class Point {
        x = 0;
        y = 0;
        set(x: number, y: number) {
            this.x = x;
            this.y = y;
        }
    }
    class Container {
        children: Container[] = [];
        position = new Point();
        addChild(...c: Container[]) {
            this.children.push(...c);
        }
    }
    class Sprite extends Container {
        texture: unknown;
        tint = 0;
        constructor(texture: unknown) {
            super();
            this.texture = texture;
        }
        setSize() {}
    }
    return {Container, Sprite, Graphics: Container, Text: Container, Texture: {WHITE: {}}};
});
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

describe('image elements', () => {
    test('placing the texture keeps the image where its element is', () => {
        const img: CanvasElement = {...DEFAULT_STYLE, id: 'i', type: 'image', x: 500, y: 300, w: 200, h: 100, z: 0, seed: 1, fileId: 'f'.repeat(26), name: 'a.png', aspect: 2};
        const obj = build(img);
        obj.position.set(500, 300);
        const sprite = obj.children.find((c) => c !== obj) ?? obj; // the draw pass's own sprite lookup

        fitSprite(sprite as Parameters<typeof fitSprite>[0], undefined, {x: 0, y: 0, w: 200, h: 100}, false);

        expect(obj.position).toMatchObject({x: 500, y: 300});
    });
});
