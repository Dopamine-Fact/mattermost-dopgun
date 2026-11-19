// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Client4} from 'mattermost-redux/client';

import {isImageFile, uploadImages, UPLOAD_CONCURRENCY} from './canvas_uploads';

jest.mock('mattermost-redux/client');

const uploadFile = Client4.uploadFile as jest.Mock;

const file = (name: string, type = 'image/png') => new File(['x'], name, {type});
const info = (name: string) => ({file_infos: [{id: `id-${name}`, name}], client_ids: []});

describe('canvas_uploads', () => {
    beforeEach(() => {
        uploadFile.mockReset();
    });

    test('isImageFile accepts png and jpeg only', () => {
        expect(isImageFile(file('a.png', 'image/png'))).toBe(true);
        expect(isImageFile(file('a.jpg', 'image/jpeg'))).toBe(true);
        for (const type of ['image/gif', 'image/webp', 'application/pdf', '']) {
            expect(isImageFile(file('a', type))).toBe(false);
        }
    });

    test('uploads each file to the channel', async () => {
        uploadFile.mockImplementation((fd: FormData) => Promise.resolve(info((fd.get('files') as File).name)));
        const files = [file('a.png'), file('b.png')];

        const res = await uploadImages('chan1', files, jest.fn());

        expect(uploadFile).toHaveBeenCalledTimes(2);
        for (const [fd] of uploadFile.mock.calls) {
            expect(fd.get('channel_id')).toBe('chan1');
            expect(fd.getAll('files')).toHaveLength(1);
        }
        expect(res.uploaded.map((u) => u.info.name)).toEqual(['a.png', 'b.png']);
        expect(res.failed).toEqual([]);
    });

    test('keeps input order whatever order uploads finish in', async () => {
        const resolvers: Array<() => void> = [];
        uploadFile.mockImplementation((fd: FormData) => new Promise((resolve) => {
            resolvers.push(() => resolve(info((fd.get('files') as File).name)));
        }));
        const files = [file('a.png'), file('b.png'), file('c.png')];

        const p = uploadImages('chan1', files, jest.fn());
        resolvers.reverse().forEach((r) => r());
        const res = await p;

        expect(res.uploaded.map((u) => u.file)).toEqual(files);
    });

    test('reports failures and continues', async () => {
        const files = [file('a.png'), file('b.png'), file('c.png')];
        uploadFile.mockImplementation((fd: FormData) => {
            const name = (fd.get('files') as File).name;
            return name === 'b.png' ? Promise.reject(new Error('too big')) : Promise.resolve(info(name));
        });

        const res = await uploadImages('chan1', files, jest.fn());

        expect(res.failed).toEqual([files[1]]);
        expect(res.uploaded.map((u) => u.file)).toEqual([files[0], files[2]]);
    });

    test('counts a response without file_infos as a failure', async () => {
        uploadFile.mockResolvedValue({file_infos: [], client_ids: []});
        const files = [file('a.png')];

        const res = await uploadImages('chan1', files, jest.fn());

        expect(res).toEqual({uploaded: [], failed: files});
    });

    test('never runs more than 3 at once', async () => {
        let inFlight = 0;
        let max = 0;
        uploadFile.mockImplementation(async (fd: FormData) => {
            inFlight++;
            max = Math.max(max, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight--;
            return info((fd.get('files') as File).name);
        });

        await uploadImages('chan1', Array.from({length: 8}, (_, i) => file(`${i}.png`)), jest.fn());

        expect(UPLOAD_CONCURRENCY).toBe(3);
        expect(max).toBe(3);
    });

    test('reports progress', async () => {
        const files = [file('a.png'), file('b.png'), file('c.png')];
        uploadFile.mockImplementation((fd: FormData) => {
            const name = (fd.get('files') as File).name;
            return name === 'b.png' ? Promise.reject(new Error('x')) : Promise.resolve(info(name));
        });
        const onProgress = jest.fn();

        await uploadImages('chan1', files, onProgress);

        expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    test('empty input resolves without progress', async () => {
        const onProgress = jest.fn();
        expect(await uploadImages('chan1', [], onProgress)).toEqual({uploaded: [], failed: []});
        expect(onProgress).not.toHaveBeenCalled();
    });
});
