// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Texture} from 'pixi.js';

import {getFilePreviewUrl, getFileUrl} from 'mattermost-redux/utils/file_utils';

import {ImageTextures, loadTexture, textureKey, textureSize} from './image_textures';

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
        expect(cache.get('a', 'p512')).toBeUndefined();
        expect(cache.get('a', 'p512')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(1);

        const t = tex();
        pending[0].resolve(t);
        await flush();
        expect(onLoad).toHaveBeenCalledTimes(1);
        expect(cache.get('a', 'p512')).toBe(t);
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
        cache.get('a', 'p512');
        const t = tex();
        pending[0].resolve(t);
        await flush();

        cache.retain(new Set());
        expect(t.destroy).toHaveBeenCalledWith(true);
        expect(cache.get('a', 'p512')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('a load that finishes after release is destroyed, not cached', async () => {
        const {cache, onLoad, pending} = setup();
        cache.get('a', 'p512');
        cache.retain(new Set());
        const t = tex();
        pending[0].resolve(t);
        await flush();
        expect(t.destroy).toHaveBeenCalledWith(true);
        expect(onLoad).not.toHaveBeenCalled();
    });

    test('a release followed by a new get keeps the in-flight load', async () => {
        const {cache, pending} = setup();
        cache.get('a', 'p512');
        cache.retain(new Set());
        cache.get('a', 'p512');
        const t = tex();
        pending[0].resolve(t);
        await flush();
        expect(t.destroy).not.toHaveBeenCalled();
        expect(cache.get('a', 'p512')).toBe(t);
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
        cache.get('a', 'p512');
        pending[0].reject(new Error('x'));
        await flush();
        expect(cache.get('a', 'p512')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(1);
        expect(onLoad).not.toHaveBeenCalled();
    });

    test('destroy releases everything', async () => {
        const {cache, load, pending} = setup(1);
        cache.get('a', 'p512');
        cache.get('b', 'p512');
        const t = tex();
        pending[0].resolve(t);
        await flush();
        cache.destroy();
        expect(t.destroy).toHaveBeenCalledWith(true);
        expect(cache.get('a', 'p512')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(2);
    });
});

describe('textureSize', () => {
    test('picks the thumbnail only up to its real height', () => {
        expect(textureSize(100)).toBe('thumb');
        expect(textureSize(101)).toBe('p256');
        expect(textureSize(67, 16 / 9)).toBe('thumb'); // a 16:9 thumbnail is 120 x 67.5
        expect(textureSize(68, 16 / 9)).toBe('p256');
        expect(textureSize(100, 0.5)).toBe('thumb'); // a tall one is 50 x 100
    });

    test('decodes previews into height buckets', () => {
        expect(textureSize(256)).toBe('p256');
        expect(textureSize(257)).toBe('p512');
        expect(textureSize(512)).toBe('p512');
        expect(textureSize(513)).toBe('p1024');
        expect(textureSize(5000)).toBe('p1024');
    });
});

describe('loadTexture', () => {
    const FILE = 'f'.repeat(26);
    const blob = {} as Blob;
    let bitmap: {close: jest.Mock};
    let texture: {once: jest.Mock; destroy: () => void};

    beforeEach(() => {
        bitmap = {close: jest.fn()};
        const onDestroy: Array<() => void> = [];
        texture = {once: jest.fn((ev: string, fn: () => void) => ev === 'destroy' && onDestroy.push(fn)), destroy: () => onDestroy.forEach((fn) => fn())};
        jest.mocked(Texture.from).mockReturnValue(texture as unknown as Texture);
        global.fetch = jest.fn(() => Promise.resolve({ok: true, blob: () => Promise.resolve(blob)})) as unknown as typeof fetch;
        global.createImageBitmap = jest.fn(() => Promise.resolve(bitmap)) as unknown as typeof createImageBitmap;
    });

    test('decodes the preview at the bucket height and closes the bitmap when the texture is destroyed', async () => {
        expect(await loadTexture(FILE, 'p512')).toBe(texture);
        expect(global.fetch).toHaveBeenCalledWith(getFilePreviewUrl(FILE), expect.anything());
        expect(global.createImageBitmap).toHaveBeenCalledWith(blob, {resizeHeight: 512, resizeQuality: 'high'});
        expect(Texture.from).toHaveBeenCalledWith(bitmap);
        expect(bitmap.close).not.toHaveBeenCalled();
        texture.destroy();
        expect(bitmap.close).toHaveBeenCalledTimes(1);
    });

    test('falls back to the original once when the preview fails', async () => {
        jest.mocked(global.fetch).mockResolvedValueOnce({ok: false} as Response);
        await loadTexture(FILE, 'p256');
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenLastCalledWith(getFileUrl(FILE), expect.anything());
        expect(global.createImageBitmap).toHaveBeenCalledWith(blob, {resizeHeight: 256, resizeQuality: 'high'});

        jest.mocked(global.fetch).mockResolvedValue({ok: false} as Response);
        await expect(loadTexture(FILE, 'p256')).rejects.toThrow();
        expect(global.fetch).toHaveBeenCalledTimes(4);
    });
});
