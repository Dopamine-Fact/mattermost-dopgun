// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {ImageTextures, textureKey, textureSize} from './image_textures';

jest.mock('pixi.js', () => ({Texture: {from: jest.fn()}}));

type Fake = {destroy: jest.Mock};

function setup(maxLoads = 6) {
    const pending: Array<{fileId: string; resolve: (t: Fake) => void; reject: (e: Error) => void}> = [];
    const load = jest.fn((fileId: string) => new Promise<Fake>((resolve, reject) => {
        pending.push({fileId, resolve, reject});
    }));
    const onLoad = jest.fn();
    const cache = new ImageTextures<Fake>(load, onLoad, maxLoads);
    return {cache, load, onLoad, pending};
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const tex = (): Fake => ({destroy: jest.fn()});

describe('ImageTextures', () => {
    test('get starts one load and returns the texture once loaded', async () => {
        const {cache, load, onLoad, pending} = setup();
        expect(cache.get('a', 'preview')).toBeUndefined();
        expect(cache.get('a', 'preview')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(1);

        const t = tex();
        pending[0].resolve(t);
        await flush();
        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(cache.get('a', 'preview')).toBe(t);
    });

    test('limits concurrent loads', async () => {
        const {cache, load, pending} = setup(6);
        for (let i = 0; i < 10; i++) {
            cache.get(`f${i}`, 'thumb');
        }
        expect(load).toHaveBeenCalledTimes(6);
        pending[0].resolve(tex());
        await flush();
        expect(load).toHaveBeenCalledTimes(7);
    });

    test('retain releases textures not kept', async () => {
        const {cache, load, pending} = setup();
        cache.get('a', 'preview');
        const t = tex();
        pending[0].resolve(t);
        await flush();

        cache.retain(new Set());
        expect(t.destroy).toHaveBeenCalledWith(true);
        expect(cache.get('a', 'preview')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('a load that finishes after release is destroyed, not cached', async () => {
        const {cache, onLoad, pending} = setup();
        cache.get('a', 'preview');
        cache.retain(new Set());
        const t = tex();
        pending[0].resolve(t);
        await flush();
        expect(t.destroy).toHaveBeenCalledWith(true);
        expect(onLoad).not.toHaveBeenCalled();
    });

    test('a release followed by a new get keeps the in-flight load', async () => {
        const {cache, pending} = setup();
        cache.get('a', 'preview');
        cache.retain(new Set());
        cache.get('a', 'preview');
        const t = tex();
        pending[0].resolve(t);
        await flush();
        expect(t.destroy).not.toHaveBeenCalled();
        expect(cache.get('a', 'preview')).toBe(t);
    });

    test('queued loads that are no longer retained never start', async () => {
        const {cache, load, pending} = setup(1);
        cache.get('a', 'thumb');
        cache.get('b', 'thumb');
        cache.retain(new Set([textureKey('a', 'thumb')]));
        pending[0].resolve(tex());
        await flush();
        expect(load).toHaveBeenCalledTimes(1);
    });

    test('a failed load is not retried', async () => {
        const {cache, load, onLoad, pending} = setup();
        cache.get('a', 'preview');
        pending[0].reject(new Error('x'));
        await flush();
        expect(cache.get('a', 'preview')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(1);
        expect(onLoad).not.toHaveBeenCalled();
    });

    test('destroy releases everything', async () => {
        const {cache, load, pending} = setup(1);
        cache.get('a', 'preview');
        cache.get('b', 'preview');
        const t = tex();
        pending[0].resolve(t);
        await flush();
        cache.destroy();
        expect(t.destroy).toHaveBeenCalledWith(true);
        expect(cache.get('a', 'preview')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(2);
    });
});

describe('textureSize', () => {
    test('switches at 160px', () => {
        expect(textureSize(160)).toBe('thumb');
        expect(textureSize(161)).toBe('preview');
    });
});
