// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {renderHook, act} from '@testing-library/react';

import {useFrameThumbnails} from './use_frame_thumbnails';

describe('useFrameThumbnails', () => {
    test('grabs one still per revision time, seeking a hidden copy of the video', async () => {
        const seeks: number[] = [];
        let video: HTMLVideoElement | undefined;
        const create = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = create(tag);
            if (tag === 'video') {
                video = el as HTMLVideoElement;
                Object.defineProperty(el, 'videoWidth', {value: 640});
                Object.defineProperty(el, 'videoHeight', {value: 360});
                Object.defineProperty(el, 'currentTime', {set: (t: number) => {
                    seeks.push(t);
                    setTimeout(() => el.dispatchEvent(new Event('seeked')));
                }});
            }
            return el;
        });
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage: jest.fn()} as any);
        jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function(this: HTMLCanvasElement) {
            return `still-${seeks[seeks.length - 1]}-${this.width}x${this.height}`;
        });

        const {result} = renderHook(() => useFrameThumbnails('/video', [1200, 83500, 1200]));
        expect(video?.src).toContain('/video');

        await act(async () => {
            video!.dispatchEvent(new Event('loadeddata'));
            await new Promise((r) => setTimeout(r, 20));
        });

        expect(seeks).toEqual([1.2, 83.5]);
        expect(jest.mocked(document.createElement).mock.calls.filter(([tag]) => tag === 'video')).toHaveLength(1);
        expect(result.current).toEqual({1200: 'still-1.2-320x180', 83500: 'still-83.5-320x180'});
    });
});
