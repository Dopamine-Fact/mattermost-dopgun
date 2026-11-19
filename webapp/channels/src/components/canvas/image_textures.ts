// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Texture} from 'pixi.js';

import {getFileThumbnailUrl, getFilePreviewUrl, getFileUrl} from 'mattermost-redux/utils/file_utils';

export type TextureSize = 'thumb' | 'preview';

export const THUMB_MAX_PX = 160;

export function textureSize(screenHeight: number): TextureSize {
    return screenHeight <= THUMB_MAX_PX ? 'thumb' : 'preview';
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

export async function loadTexture(fileId: string, size: TextureSize): Promise<Texture> {
    if (size === 'thumb') {
        return Texture.from(await decode(getFileThumbnailUrl(fileId)));
    }
    try {
        return Texture.from(await decode(getFilePreviewUrl(fileId)));
    } catch {
        return Texture.from(await decode(getFileUrl(fileId)));
    }
}
