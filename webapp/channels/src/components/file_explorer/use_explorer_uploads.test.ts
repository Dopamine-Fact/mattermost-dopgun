// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {act, waitFor} from '@testing-library/react';

import type {DriveItem} from '@mattermost/types/drive';

import {Client4} from 'mattermost-redux/client';

import {uploadFile} from 'actions/file_actions';

import {renderHookWithContext} from 'tests/react_testing_utils';

import {useExplorerUploads} from './use_explorer_uploads';

jest.mock('actions/file_actions', () => ({
    uploadFile: jest.fn(),
}));

const mockUpload = uploadFile as jest.Mock;

describe('useExplorerUploads', () => {
    beforeEach(() => {
        mockUpload.mockImplementation(({file, onSuccess, onError}) => () => {
            Promise.resolve().then(() => (file.name === 'big.png' ? onError('File is too large') : onSuccess({file_infos: [{id: `f-${file.name}`}]})));
            return {abort: jest.fn()};
        });
        jest.spyOn(Client4, 'createDriveFolder').mockImplementation(async (channelId, parentId, name) => ({id: `id-${name}`} as DriveItem));
        jest.spyOn(Client4, 'addDriveFile').mockResolvedValue({} as DriveItem);
    });

    afterEach(() => jest.restoreAllMocks());

    const file = (name: string) => new File(['x'], name, {type: 'image/png'});

    test('creates the dropped folders, parents first, then uploads into the deepest one', async () => {
        const onComplete = jest.fn();
        const {result} = renderHookWithContext(() => useExplorerUploads(onComplete));

        await act(async () => {
            await result.current.enqueue([
                {file: file('c.png'), relPath: 'A/B/c.png'},
                {file: file('d.png'), relPath: 'A/B/d.png'},
            ], 'c1', 'root');
        });

        expect((Client4.createDriveFolder as jest.Mock).mock.calls).toEqual([['c1', 'root', 'A'], ['c1', 'id-A', 'B']]);
        expect(Client4.addDriveFile).toHaveBeenCalledWith('c1', 'id-B', 'f-c.png');
        expect(Client4.addDriveFile).toHaveBeenCalledWith('c1', 'id-B', 'f-d.png');
        expect((Client4.createDriveFolder as jest.Mock).mock.invocationCallOrder[1]).toBeLessThan(mockUpload.mock.invocationCallOrder[0]);
        expect(result.current.uploads.map((u) => u.status)).toEqual(['done', 'done']);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('a failed upload shows its error and the others continue', async () => {
        const {result} = renderHookWithContext(() => useExplorerUploads());

        await act(async () => {
            await result.current.enqueue([
                {file: file('big.png'), relPath: 'big.png'},
                {file: file('ok.png'), relPath: 'ok.png'},
            ], 'c1', '');
        });

        await waitFor(() => expect(result.current.uploads.map((u) => [u.name, u.status, u.error])).toEqual([
            ['big.png', 'error', 'File is too large'],
            ['ok.png', 'done', undefined],
        ]));
        expect(Client4.addDriveFile).toHaveBeenCalledTimes(1);
        expect(Client4.addDriveFile).toHaveBeenCalledWith('c1', '', 'f-ok.png');
    });

    test('cancelling a queued upload skips it', async () => {
        const {result} = renderHookWithContext(() => useExplorerUploads());

        let done: Promise<void> | undefined;
        act(() => {
            done = result.current.enqueue([{file: file('a.png'), relPath: 'a.png'}, {file: file('b.png'), relPath: 'b.png'}], 'c1', '');
        });
        act(() => result.current.cancel(result.current.uploads[1].id));
        await act(async () => {
            await done;
        });

        expect(result.current.uploads.map((u) => u.status)).toEqual(['done', 'cancelled']);
        expect(Client4.addDriveFile).toHaveBeenCalledTimes(1);
    });
});
