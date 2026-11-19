// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import * as Y from 'yjs';

import type {CanvasElement} from './model';
import {
    DEFAULT_STYLE,
    REMOTE,
    addElement,
    createCanvasDoc,
    deleteElements,
    duplicateElements,
    readElements,
    reorder,
    updateElements,
    updateInBatches,
    copyElements,
    setLocalAuthor,
    withChildren,
} from './model';

const rect = (id: string, props: Partial<CanvasElement> = {}): CanvasElement => ({
    ...DEFAULT_STYLE,
    id,
    type: 'rect',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 0,
    seed: 1,
    ...props,
});

describe('canvas model', () => {
    test('add, update and delete round-trip', () => {
        const {doc, elements} = createCanvasDoc();
        addElement(doc, rect('a', {points: [0, 0, 5, 5]}));
        expect(readElements(elements)).toEqual([rect('a', {points: [0, 0, 5, 5]})]);

        updateElements(doc, ['a'], {x: 5, fill: '#ff0000', points: undefined});
        expect(readElements(elements)).toEqual([rect('a', {x: 5, fill: '#ff0000'})]);

        deleteElements(doc, ['a']);
        expect(readElements(elements)).toEqual([]);
    });

    test('undo reverts local changes only, not remote ones', () => {
        const {doc, elements, undo} = createCanvasDoc();
        addElement(doc, rect('a'));

        const other = createCanvasDoc();
        addElement(other.doc, rect('b'));
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(other.doc), REMOTE);

        undo.undo();
        expect(readElements(elements).map((el) => el.id)).toEqual(['b']);
    });

    test('updateElements on two ids is one undo step', () => {
        const {doc, elements, undo} = createCanvasDoc();
        addElement(doc, rect('a'));
        addElement(doc, rect('b', {z: 1}));
        undo.stopCapturing();

        updateElements(doc, ['a', 'b'], {x: 50});
        expect(readElements(elements).map((el) => el.x)).toEqual([50, 50]);

        undo.undo();
        expect(readElements(elements).map((el) => el.x)).toEqual([0, 0]);
    });

    test('duplicateElements places offset copies with new ids and seeds on top', () => {
        const {doc, elements} = createCanvasDoc();
        addElement(doc, rect('a', {x: 1, z: 0}));
        addElement(doc, rect('b', {x: 2, z: 1}));
        addElement(doc, rect('c', {z: 5}));

        const ids = duplicateElements(doc, ['b', 'a']);
        expect(ids).toHaveLength(2);
        expect(ids).not.toContain('a');
        expect(ids).not.toContain('b');

        const all = readElements(elements);
        const copies = ids.map((id) => all.find((el) => el.id === id)!);
        expect(copies.map((el) => el.x)).toEqual([11, 12]);
        expect(copies.every((el) => el.seed !== 1)).toBe(true);
        expect(copies.every((el) => el.z > 5)).toBe(true);
        expect(all.slice(-2).map((el) => el.id)).toEqual(ids);
    });

    test('updateInBatches splits long patches into bounded transactions that undo as one step', () => {
        const {doc, elements, undo} = createCanvasDoc();
        const points = Array.from({length: 4000}, (_, i) => i);
        for (let i = 0; i < 40; i++) {
            addElement(doc, rect(`p${i}`, {type: 'pen', z: i, points}));
        }
        undo.stopCapturing();

        const sizes: number[] = [];
        doc.on('update', (u: Uint8Array) => sizes.push(u.length));
        updateInBatches(doc, readElements(elements).map((el) => ({id: el.id, w: 20, points: el.points!.map((v) => v * 2)})));
        expect(sizes.length).toBeGreaterThan(2);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(512 * 1024);
        expect(readElements(elements).every((el) => el.w === 20 && el.points![1] === 2)).toBe(true);

        undo.undo();
        expect(readElements(elements).every((el) => el.w === 10 && el.points![1] === 1)).toBe(true);
    });

    test('readElements skips malformed elements from a crafted update and keys elements by their map key', () => {
        // A peer that is not this client: anything a valid Yjs update can carry.
        const crafted = new Y.Doc();
        const raw = crafted.getMap<unknown>('elements');
        const el = (props: Record<string, unknown>) => new Y.Map(Object.entries({...rect('x'), ...props}));
        const {type, ...noType} = rect('x'); // eslint-disable-line @typescript-eslint/no-unused-vars
        raw.set('primitive', 5);
        raw.set('array', new Y.Array());
        raw.set('unknownType', el({type: 'star'}));
        raw.set('noType', new Y.Map(Object.entries(noType)));
        raw.set('nanX', el({x: NaN}));
        raw.set('infiniteW', el({w: Infinity}));
        raw.set('stringH', el({h: '10'}));
        raw.set('nullZ', el({z: null}));
        raw.set('pointsNotArray', el({type: 'pen', points: 'abc'}));
        raw.set('pointNotNumber', el({type: 'pen', points: [0, 'a']}));
        raw.set('textNotString', el({type: 'text', text: {length: 1e9}}));
        raw.set('good', el({id: 'spoofed', type: 'pen', points: [0, 0, 1, 1], z: 1}));

        const {doc, elements} = createCanvasDoc();
        addElement(doc, rect('mine'));
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(crafted), REMOTE);
        expect(readElements(elements).map((e) => e.id)).toEqual(['mine', 'good']);
    });

    describe('reorder', () => {
        const setup = () => {
            const {doc, elements} = createCanvasDoc();
            ['a', 'b', 'c', 'd'].forEach((id, z) => addElement(doc, rect(id, {z})));
            return {doc, order: () => readElements(elements).map((el) => el.id).join(' ')};
        };

        test.each([
            [['b'], 'forward', 'a c b d'],
            [['c'], 'backward', 'a c b d'],
            [['c'], 'front', 'a b d c'],
            [['b', 'c'], 'back', 'b c a d'],
            [['b', 'c'], 'forward', 'a d b c'],
            [['d'], 'forward', 'a b c d'],
        ] as const)('%j %s gives %s', (ids, op, expected) => {
            const {doc, order} = setup();
            reorder(doc, [...ids], op);
            expect(order()).toBe(expected);
        });
    });
});

describe('storyboard elements', () => {
    const ID = (c: string) => c.repeat(26);
    const scene = (id: string, props: Partial<CanvasElement> = {}) => rect(id, {type: 'scene', label: 'Scene', done: false, ...props});
    const image = (id: string, props: Partial<CanvasElement> = {}) => rect(id, {type: 'image', fileId: ID('f'), name: 'a.png', aspect: 1.5, ...props});
    const S = ID('s');
    const I1 = ID('i');
    const I2 = ID('j');
    const FREE = ID('k');

    const read = (props: Partial<CanvasElement>, make = scene) => {
        const {doc, elements} = createCanvasDoc();
        addElement(doc, make('a', props));
        return readElements(elements);
    };

    test('parses a scene and an image', () => {
        const {doc, elements} = createCanvasDoc();
        const s = scene(S, {ownerId: ID('o'), finalFileId: ID('f'), finalName: 'x.png'});
        const i = image(I1, {sceneId: S, z: 1});
        addElement(doc, s);
        addElement(doc, i);
        expect(readElements(elements)).toEqual([s, i]);
    });

    test('skips an image whose fileId is not an id', () => {
        expect(read({fileId: '../users/me'}, image)).toEqual([]);
        expect(read({fileId: 42 as unknown as string}, image)).toEqual([]);
        expect(read({fileId: undefined}, image)).toEqual([]);
    });

    test('skips elements with a malformed sceneId, ownerId or finalFileId', () => {
        expect(read({sceneId: '../x'}, image)).toEqual([]);
        expect(read({ownerId: 'nope'})).toEqual([]);
        expect(read({finalFileId: 'nope'})).toEqual([]);
    });

    test('skips a scene whose label is not a string or done not a boolean', () => {
        expect(read({label: 5 as unknown as string})).toEqual([]);
        expect(read({done: 'yes' as unknown as boolean})).toEqual([]);
    });

    test('skips an element whose aspect is not a positive finite number', () => {
        for (const aspect of [0, -1, NaN]) {
            expect(read({aspect}, image)).toEqual([]);
        }
    });

    test('stamps created and updated with the local author', () => {
        const {doc, elements} = createCanvasDoc();
        setLocalAuthor(doc, 'u1');
        addElement(doc, rect('a'));
        const el = readElements(elements)[0];
        expect(el.createdBy).toBe('u1');
        expect(el.updatedBy).toBe('u1');
        expect(typeof el.createdAt).toBe('number');
        expect(el.updatedAt).toBe(el.createdAt);

        setLocalAuthor(doc, 'u2');
        updateElements(doc, ['a'], {x: 5});
        const after = readElements(elements)[0];
        expect(after.createdBy).toBe('u1');
        expect(after.updatedBy).toBe('u2');
    });

    test('does not stamp an update that changes nothing', () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(1000);
            const {doc, elements} = createCanvasDoc();
            setLocalAuthor(doc, 'u1');
            addElement(doc, rect('a'));
            jest.setSystemTime(2000);
            updateElements(doc, ['a'], {x: 0});
            expect(readElements(elements)[0].updatedAt).toBe(1000);
            updateElements(doc, ['a'], {x: 1});
            expect(readElements(elements)[0].updatedAt).toBe(2000);
        } finally {
            jest.useRealTimers();
        }
    });

    test('writes no stamps without an author', () => {
        const {doc, elements} = createCanvasDoc();
        addElement(doc, rect('a'));
        expect('createdBy' in readElements(elements)[0]).toBe(false);
    });

    const board = () => [scene(S), image(I1, {sceneId: S, z: 1}), image(I2, {sceneId: S, z: 2}), image(FREE, {z: 3})];

    test('withChildren adds the images of the given scenes, once', () => {
        expect(withChildren(board(), [S, I1])).toEqual([S, I1, I2]);
    });

    test('deleting a scene deletes its images in one undo step', () => {
        const {doc, elements, undo} = createCanvasDoc();
        board().forEach((el) => addElement(doc, el));
        undo.stopCapturing();
        deleteElements(doc, [S]);
        expect(readElements(elements).map((el) => el.id)).toEqual([FREE]);
        undo.undo();
        expect(readElements(elements).map((el) => el.id).sort()).toEqual([S, I1, I2, FREE].sort());
    });

    test('copyElements remaps sceneId to the copied scene', () => {
        const stamped = board().map((el) => ({...el, createdBy: 'u', createdAt: 1, updatedBy: 'u', updatedAt: 1}));
        const [s, i1] = stamped;
        const both = copyElements([s, i1], 5, 6, 10);
        expect(both.map((el) => el.id)).not.toContain(S);
        expect(both[1].sceneId).toBe(both[0].id);
        expect(both[0].x).toBe(5);
        expect(both.map((el) => el.z)).toEqual([11, 12]);
        expect(both[0]).not.toHaveProperty('createdBy');
        expect(both[0]).not.toHaveProperty('updatedAt');

        expect(copyElements([i1], 0, 0, 0)[0].sceneId).toBeUndefined(); // its card is not copied with it
    });

    test('duplicateElements copies a scene with its images', () => {
        const {doc, elements} = createCanvasDoc();
        board().forEach((el) => addElement(doc, el));
        const ids = duplicateElements(doc, [S]);
        expect(ids).toHaveLength(1);
        const all = readElements(elements);
        expect(all).toHaveLength(7);
        const copies = all.filter((el) => el.type === 'image' && el.sceneId === ids[0]);
        expect(copies).toHaveLength(2);
    });
});
