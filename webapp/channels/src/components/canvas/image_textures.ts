// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Texture} from 'pixi.js';

import {Client4} from 'mattermost-redux/client';
import {getFileThumbnailUrl, getFilePreviewUrl, getFileUrl} from 'mattermost-redux/utils/file_utils';

export type TextureSize = 'thumb' | 'p256' | 'p512' | 'p1024';

// The server's thumbnail fits 120 x 100 with its aspect kept.
const THUMB_W = 120;
const THUMB_H = 100;
const PREVIEW_HEIGHTS = {p256: 256, p512: 512, p1024: 1024};

/** The smallest texture that is sharp at this on-screen height: the thumbnail up to its real height, else a preview bucket. */
export function textureSize(screenHeight: number, aspect = 1): TextureSize {
    if (screenHeight <= Math.min(THUMB_H, THUMB_W / aspect)) {
        return 'thumb';
    }
    if (screenHeight <= PREVIEW_HEIGHTS.p256) {
        return 'p256';
    }
    return screenHeight <= PREVIEW_HEIGHTS.p512 ? 'p512' : 'p1024';
}

export function textureKey(fileId: string, size: TextureSize): string {
    return `${fileId}:${size}`;
}

type Job = {key: string; fileId: string; size: TextureSize};

// Lazy cache of image textures: loads at most maxLoads at a time and frees what is no longer retained.
export class ImageTextures<T extends {destroy(destroySource?: boolean): void}> {
    private loaded = new Map<string, T>();
    private inFlight = new Set<string>();
    private queue: Job[] = [];
    private failed = new Set<string>();

    // null until the first retain(): every key is kept. Afterwards: the retain set plus keys get() asked for since.
    private kept: Set<string> | null = null;
    private destroyed = false;

    constructor(
        private load: (fileId: string, size: TextureSize) => Promise<T>,
        private onLoad: () => void,
        private maxLoads = 6,
    ) {}

    get(fileId: string, size: TextureSize): T | undefined {
        if (this.destroyed) {
            return undefined;
        }
        const key = textureKey(fileId, size);
        this.kept?.add(key);

        const texture = this.loaded.get(key);
        if (texture || this.failed.has(key) || this.inFlight.has(key) || this.queue.some((j) => j.key === key)) {
            return texture;
        }
        this.queue.push({key, fileId, size});
        this.pump();
        return undefined;
    }

    retain(keys: Set<string>): void {
        this.kept = new Set(keys);
        for (const [key, texture] of this.loaded) {
            if (!keys.has(key)) {
                texture.destroy(true);
                this.loaded.delete(key);
            }
        }
        for (const key of this.failed) {
            if (!keys.has(key)) {
                this.failed.delete(key);
            }
        }
        this.queue = this.queue.filter((j) => keys.has(j.key));
    }

    destroy(): void {
        this.destroyed = true;
        for (const texture of this.loaded.values()) {
            texture.destroy(true);
        }
        this.loaded.clear();
        this.queue = [];
    }

    private pump(): void {
        while (this.inFlight.size < this.maxLoads && this.queue.length) {
            const {key, fileId, size} = this.queue.shift()!;
            this.inFlight.add(key);
            this.load(fileId, size).then(
                (texture) => {
                    this.inFlight.delete(key);
                    if (this.destroyed || (this.kept && !this.kept.has(key))) {
                        texture.destroy(true);
                    } else {
                        this.loaded.set(key, texture);
                        this.onLoad();
                    }
                    this.pump();
                },
                () => {
                    this.inFlight.delete(key);
                    this.failed.add(key);
                    this.pump();
                },
            );
        }
    }
}

async function decode(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
}

async function fetchBitmap(url: string, resizeHeight: number): Promise<ImageBitmap> {
    const res = await fetch(url, Client4.getOptions({method: 'get'}));
    if (!res.ok) {
        throw new Error(`image ${res.status}`);
    }
    return createImageBitmap(await res.blob(), {resizeHeight, resizeQuality: 'high'});
}

// Previews are decoded at the bucket height (a full 1920 px preview is about 8 MB of GPU memory); the bitmap is freed with the texture.
export async function loadTexture(fileId: string, size: TextureSize): Promise<Texture> {
    if (size === 'thumb') {
        return Texture.from(await decode(getFileThumbnailUrl(fileId)));
    }
    const height = PREVIEW_HEIGHTS[size];
    let bitmap: ImageBitmap;
    try {
        bitmap = await fetchBitmap(getFilePreviewUrl(fileId), height);
    } catch {
        bitmap = await fetchBitmap(getFileUrl(fileId), height);
    }
    const texture = Texture.from(bitmap);
    texture.once('destroy', () => bitmap.close());
    return texture;
}
