// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DriveItem, DriveTaskFile} from '@mattermost/types/drive';

import {Client4} from 'mattermost-redux/client';

import {renderHookWithContext, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import {useExplorerData} from './use_explorer_data';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

const town = TestHelper.getChannelMock({id: 'c1', team_id: 'team1', name: 'town', display_name: 'Town', type: 'O'});
const state = {
    entities: {
        general: {config: {}},
        teams: {currentTeamId: 'team1', teams: {team1: TestHelper.getTeamMock({id: 'team1'})}},
        users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me'})}},
        channels: {
            currentChannelId: 'c1',
            channels: {c1: town},
            channelsInTeam: {team1: new Set(['c1'])},
            myMembers: {c1: TestHelper.getChannelMembershipMock({channel_id: 'c1', user_id: 'me'})},
        },
    },
};

const taskFile = (id: string, userId: string): DriveTaskFile => ({...TestHelper.getFileInfoMock({id, name: `${id}.png`, user_id: userId}), task_id: 't1'});
const folder: DriveItem = {id: 'd1', channel_id: 'c1', parent_id: '', type: 'folder', name: 'Ep', file_id: '', creator_id: 'me', create_at: 1, update_at: 1, delete_at: 0, deleted_by: ''};

const load = async (access: '' | 'write' | 'read', path: DriveItem[] = []) => {
    jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [folder], path, access, task_files: [taskFile('mine', 'me'), taskFile('theirs', 'u2')]});
    const {result} = renderHookWithContext(() => useExplorerData('c1', 'd1'), state);
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    return result.current.items;
};

describe('useExplorerData task files', () => {
    test('are listed after the drive items, keyed task:<id>, with their task', async () => {
        const items = await load('');
        expect(items.map((e) => [e.key, e.kind])).toEqual([['d1', 'folder'], ['task:mine', 'task_file'], ['task:theirs', 'task_file']]);
        expect(items[1].taskId).toBe('t1');
        expect(items[1].fileInfo?.id).toBe('mine');
    });

    test('follow the folder access and the uploader like drive files', async () => {
        expect((await load('')).slice(1).map((e) => e.canModify)).toEqual([true, false]);
        expect((await load('write')).slice(1).map((e) => e.canModify)).toEqual([true, true]);
        expect((await load('read')).slice(1).map((e) => e.canModify)).toEqual([false, false]);
    });

    test('are read-only inside a mirror', async () => {
        const items = await load('write', [{...folder, mirror_of: 's1'}]);
        expect(items.slice(1).map((e) => e.canModify)).toEqual([false, false]);
    });
});
