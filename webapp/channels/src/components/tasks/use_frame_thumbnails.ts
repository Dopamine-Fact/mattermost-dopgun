// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useRef, useState} from 'react';

const THUMB_WIDTH = 320;

// useFrameThumbnails returns a JPEG data URL of the video's frame at each time (ms), grabbed by seeking a
// hidden copy of the video one time after another. Stills appear as they are ready.
// shortcut: stills are redrawn on every visit; store them on the server if long videos make this slow.
export function useFrameThumbnails(src: string, times: number[]): Record<number, string> {
    const [thumbs, setThumbs] = useState<Record<number, string>>({});
    const done = useRef(thumbs);
    done.current = thumbs;
    const key = [...new Set(times)].sort((a, b) => a - b).join(',');

    useEffect(() => {
        const missing = key.split(',').filter(Boolean).map(Number).filter((t) => !(t in done.current));
        if (!missing.length) {
            return undefined;
        }
        let cancelled = false;
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.src = src;
        const canvas = document.createElement('canvas');

        const grab = async () => {
            for (const t of missing) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => {
                    video.addEventListener('seeked', resolve, {once: true});
                    video.currentTime = t / 1000;
                });
                if (cancelled) {
                    return;
                }
                canvas.width = THUMB_WIDTH;
                canvas.height = Math.round((THUMB_WIDTH * video.videoHeight) / (video.videoWidth || 1)) || 180;
                canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
                const still = canvas.toDataURL('image/jpeg', 0.7);
                setThumbs((prev) => ({...prev, [t]: still}));
            }
        };
        video.addEventListener('loadeddata', grab, {once: true});

        return () => {
            cancelled = true;
            video.removeAttribute('src');
        };
    }, [src, key]);

    return thumbs;
}
