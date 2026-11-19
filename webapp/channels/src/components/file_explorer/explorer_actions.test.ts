// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Client4} from 'mattermost-redux/client';
import {getFileDownloadUrl} from 'mattermost-redux/utils/file_utils';

import {TestHelper} from 'utils/test_helper';

import {clearClipboard, copy, cut, deleteTaskFiles, download, dragParts, getClipboard, paste, renameEntry, uniqueName} from './explorer_actions';
import type {ExplorerEntry} from './use_explorer_data';

const info = (id: string) => TestHelper.getFileInfoMock({id, name: `${id}.txt`, extension: 'txt'});
const driveFile = (id: string): ExplorerEntry => ({
    key: id,
    kind: 'file',
    name: `${id}.txt`,
    fileInfo: info(`f-${id}`),
    driveItem: {id, channel_id: 'c1', parent_id: '', type: 'file', name: `${id}.txt`, file_id: `f-${id}`, creator_id: 'me', create_at: 1, update_at: 1, delete_at: 0, deleted_by: ''},
    readOnly: false,
    canModify: true,
});
const chatFile = (id: string): ExplorerEntry => ({key: `chat:${id}`, kind: 'file', name: `${id}.txt`, fileInfo: info(id), readOnly: true, canModify: false});

describe('explorerActions', () => {
    let click: jest.SpyInstance;
    beforeEach(() => {
        jest.restoreAllMocks();
        clearClipboard();
        click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    test('paste after cut moves the items and empties the clipboard', async () => {
        const move = jest.spyOn(Client4, 'moveDriveItems').mockResolvedValue({status: 'OK'});
        cut('c1', [driveFile('i1')]);
        await paste('c2', 'p2');
        expect(move).toHaveBeenCalledWith('c1', ['i1'], 'c2', 'p2');
        expect(getClipboard()).toBeUndefined();
    });

    test('paste after copy sends drive items and chat files and keeps the clipboard', async () => {
        const copyCall = jest.spyOn(Client4, 'copyDriveItems').mockResolvedValue({status: 'OK'});
        copy('c1', [driveFile('i1'), chatFile('f9')]);
        await paste('c1', '');
        expect(copyCall).toHaveBeenCalledWith('c1', ['i1'], ['f9'], 'c1', '');
        expect(getClipboard()?.mode).toBe('copy');
    });

    test('download of one file uses its download URL, several use a zip', async () => {
        const zip = jest.spyOn(Client4, 'downloadDriveZip').mockResolvedValue(new Blob(['z']));
        window.URL.createObjectURL = jest.fn(() => 'blob:zip');
        window.URL.revokeObjectURL = jest.fn();

        await download('c1', [driveFile('i1')]);
        expect(zip).not.toHaveBeenCalled();
        expect((click.mock.contexts[0] as HTMLAnchorElement).href).toContain(getFileDownloadUrl('f-i1'));

        await download('c1', [driveFile('i1'), driveFile('i2')]);
        expect(zip).toHaveBeenCalledWith('c1', ['i1', 'i2']);
    });

    test('uniqueName adds a number like Windows does', () => {
        expect(uniqueName('New folder', [])).toBe('New folder');
        expect(uniqueName('New folder', ['new folder', 'New folder (2)'])).toBe('New folder (3)');
    });
});

describe('task files', () => {
    const taskFile = (id: string): ExplorerEntry => ({key: `task:${id}`, kind: 'task_file', name: `${id}.png`, fileInfo: info(id), taskId: 't1', readOnly: false, canModify: true});

    beforeEach(() => {
        jest.restoreAllMocks();
        clearClipboard();
    });

    test('rename goes to the task file call, a drive item to the drive one', async () => {
        const rename = jest.spyOn(Client4, 'renameDriveTaskFile').mockResolvedValue(info('x'));
        const driveRename = jest.spyOn(Client4, 'renameDriveItem').mockResolvedValue({} as never);
        await renameEntry('c1', taskFile('f1'), 'new.png');
        expect(rename).toHaveBeenCalledWith('c1', 'f1', 'new.png');
        expect(driveRename).not.toHaveBeenCalled();
        await renameEntry('c1', driveFile('i1'), 'n.txt');
        expect(driveRename).toHaveBeenCalledWith('c1', 'i1', 'n.txt');
    });

    test('delete calls the task file call for each and never the drive delete', async () => {
        const del = jest.spyOn(Client4, 'deleteDriveTaskFile').mockResolvedValue({status: 'OK'});
        const driveDelete = jest.spyOn(Client4, 'deleteDriveItems').mockResolvedValue({status: 'OK'});
        await deleteTaskFiles('c1', [taskFile('f1'), taskFile('f2')]);
        expect(del.mock.calls).toEqual([['c1', 'f1'], ['c1', 'f2']]);
        expect(driveDelete).not.toHaveBeenCalled();
    });

    test('copy sends them as chat file ids', async () => {
        const copyCall = jest.spyOn(Client4, 'copyDriveItems').mockResolvedValue({status: 'OK'});
        copy('c1', [driveFile('i1'), taskFile('f1')]);
        await paste('c1', '');
        expect(copyCall).toHaveBeenCalledWith('c1', ['i1'], ['f1'], 'c1', '');
    });

    test('a drag takes the drive items only and is copy-only when a drive item cannot change', () => {
        const locked = {...driveFile('i2'), canModify: false};
        expect(dragParts([driveFile('i1'), taskFile('f1'), chatFile('c9')])).toEqual({itemIds: ['i1'], chatFileIds: ['c9'], copyOnly: false});
        expect(dragParts([locked, taskFile('f1')]).copyOnly).toBe(true);
        expect(dragParts([taskFile('f1')])).toEqual({itemIds: [], chatFileIds: [], copyOnly: false});
    });
});
