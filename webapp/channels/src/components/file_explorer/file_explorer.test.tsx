// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';
import {Route} from 'react-router-dom';

import type {DriveItem} from '@mattermost/types/drive';
import type {FileInfo} from '@mattermost/types/files';

import {Client4} from 'mattermost-redux/client';

import {openModal} from 'actions/views/modals';

import WebSocketClient from 'client/web_websocket_client';
import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import FileExplorer from './file_explorer';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));
jest.mock('actions/views/modals', () => ({
    openModal: jest.fn(() => ({type: 'MOCK_OPEN_MODAL'})),
}));

const team = TestHelper.getTeamMock({id: 'team1', name: 'team', files_enabled: true});
const channel = (id: string, name: string, displayName: string, type: string, extra = {}) =>
    TestHelper.getChannelMock({id, team_id: type === 'D' ? '' : 'team1', name, display_name: displayName, type: type as 'O', ...extra});
const town = channel('c1', 'town', 'Town', 'O');
const secret = channel('c2', 'secret', 'Alpha secret', 'P');
const archived = channel('c3', 'old', 'Old', 'O', {delete_at: 5});
const dm = channel('c4', 'me__u2', 'u2', 'D');
const notMine = channel('c5', 'other', 'Other', 'O');

const fileInfo = (id: string, name: string, size: number, extra: Partial<FileInfo> = {}) =>
    TestHelper.getFileInfoMock({id, name, size, extension: name.split('.').pop(), channel_id: 'c1', user_id: 'me', ...extra});
const fileItem = (id: string, info: FileInfo): DriveItem => ({
    id,
    channel_id: 'c1',
    parent_id: '',
    type: 'file',
    name: info.name,
    file_id: info.id,
    creator_id: 'me',
    create_at: 1,
    update_at: 1,
    delete_at: 0,
    deleted_by: '',
    file_info: info,
});
const folder = (id: string, name: string): DriveItem => ({
    id,
    channel_id: 'c1',
    parent_id: '',
    type: 'folder',
    name,
    file_id: '',
    creator_id: 'me',
    create_at: 1,
    update_at: 1,
    delete_at: 0,
    deleted_by: '',
});

const renderAt = (path: string) => renderWithContext(
    <Route
        path='/:team/files/:channelName?/:folderId?'
        component={FileExplorer}
    />,
    {
        entities: {
            general: {config: {}},
            teams: {currentTeamId: 'team1', teams: {team1: team}},
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', username: 'me'})}},
            channels: {
                currentChannelId: 'c1',
                channels: {c1: town, c2: secret, c3: archived, c4: dm, c5: notMine},
                channelsInTeam: {team1: new Set(['c1', 'c2', 'c3', 'c5']), '': new Set(['c4'])},
                myMembers: Object.fromEntries(['c1', 'c2', 'c3', 'c4'].map((id) => [id, TestHelper.getChannelMembershipMock({channel_id: id, user_id: 'me'})])),
            },
        },
    },
    {history: createMemoryHistory({initialEntries: [path]})},
);

const cellNames = () => within(screen.getByRole('grid')).getAllByRole('gridcell').filter((c) => c.hasAttribute('tabindex')).map((c) => c.getAttribute('aria-label'));

describe('FileExplorer', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        (openModal as jest.Mock).mockClear();
        (WebSocketClient.addMessageListener as jest.Mock).mockClear();
    });

    test('root lists only open and private channels I belong to', async () => {
        renderAt('/team/files');
        await screen.findByRole('grid');
        expect(cellNames()).toEqual(['Alpha secret', 'Town']);
    });

    test('a channel lists Chat attachments first, then folders, then files', async () => {
        jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({
            items: [fileItem('i1', fileInfo('f1', 'b.txt', 10)), folder('d2', 'Zeta'), folder('d1', 'Alpha')],
            path: [],
        });
        renderAt('/team/files/town');
        await waitFor(() => expect(cellNames()).toEqual(['Chat attachments', 'Alpha', 'Zeta', 'b.txt']));
    });

    test('Details header click sorts by size, folders first', async () => {
        jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({
            items: [fileItem('i1', fileInfo('f1', 'big.txt', 900)), fileItem('i2', fileInfo('f2', 'small.txt', 5)), folder('d1', 'Docs')],
            path: [],
        });
        renderAt('/team/files/town');
        await screen.findByRole('gridcell', {name: 'big.txt'});

        fireEvent.click(screen.getByRole('button', {name: 'Details'}));
        fireEvent.click(screen.getByRole('button', {name: 'Size'}));

        await waitFor(() => expect(cellNames()).toEqual(['Chat attachments', 'Docs', 'small.txt', 'big.txt']));
    });

    test('double-clicking a file opens the preview with the folder files', async () => {
        const a = fileInfo('f1', 'a.png', 10);
        const b = fileInfo('f2', 'b.txt', 20);
        jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [folder('d1', 'Docs'), fileItem('i1', a), fileItem('i2', b)], path: []});
        renderAt('/team/files/town');

        fireEvent.doubleClick(await screen.findByRole('gridcell', {name: 'b.txt'}));

        expect(openModal).toHaveBeenCalledWith(expect.objectContaining({
            dialogProps: expect.objectContaining({fileInfos: [a, b], startIndex: 1}),
        }));
    });

    test('drive_changed for the open folder reloads it', async () => {
        const list = jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [], path: []});
        renderAt('/team/files/town');
        await screen.findByRole('gridcell', {name: 'Chat attachments'});
        const before = list.mock.calls.length;

        await act(async () => {
            (WebSocketClient.addMessageListener as jest.Mock).mock.calls.forEach(([listener]) => listener({
                event: 'drive_changed',
                data: {parent_ids: '[""]'},
                broadcast: {channel_id: 'c1'},
            }));
        });

        await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
    });
});
