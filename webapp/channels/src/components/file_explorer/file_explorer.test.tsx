// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';
import {Route, useLocation} from 'react-router-dom';

import type {DriveItem} from '@mattermost/types/drive';
import type {FileInfo} from '@mattermost/types/files';

import {Client4} from 'mattermost-redux/client';

import {uploadFile} from 'actions/file_actions';
import {selectLhsItem} from 'actions/views/lhs';
import {openModal} from 'actions/views/modals';

import WebSocketClient from 'client/web_websocket_client';
import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import {clearClipboard} from './explorer_actions';
import FileExplorer, {FileExplorerView} from './file_explorer';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));
jest.mock('actions/file_actions', () => ({
    ...jest.requireActual('actions/file_actions'),
    uploadFile: jest.fn(),
}));
jest.mock('actions/views/lhs', () => ({
    ...jest.requireActual('actions/views/lhs'),
    selectLhsItem: jest.fn(() => ({type: 'MOCK_SELECT_LHS_ITEM'})),
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

const storeState = {
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
};
const renderAt = (path: string) => renderWithContext(
    <Route
        path='/:team/files/:channelName?/:folderId?'
        component={FileExplorer}
    />,
    storeState,
    {history: createMemoryHistory({initialEntries: [path]})},
);

// A channel tab hosting the explorer: the folder lives in ?folder=, the way ChannelTabs keeps it.
const EmbeddedExplorer = () => {
    const location = useLocation();
    return (
        <FileExplorerView
            channelName='town'
            folderId={new URLSearchParams(location.search).get('folder') ?? ''}
            urlFor={(name, folderId) => `/team/channels/${name}?folder=${folderId ?? ''}`}
            embedded={true}
        />
    );
};
const renderEmbedded = (path = '/team/channels/town') => {
    const history = createMemoryHistory({initialEntries: [path]});
    renderWithContext(<EmbeddedExplorer/>, storeState, {history});
    return history;
};

const cellNames = () => within(screen.getByRole('grid')).getAllByRole('gridcell').filter((c) => c.hasAttribute('tabindex')).map((c) => c.getAttribute('aria-label'));

describe('FileExplorer', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        (openModal as jest.Mock).mockClear();
        (WebSocketClient.addMessageListener as jest.Mock).mockClear();
        clearClipboard();
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
            access: '',
        });
        renderAt('/team/files/town');
        await waitFor(() => expect(cellNames()).toEqual(['Chat attachments', 'Alpha', 'Zeta', 'b.txt']));
    });

    test('Details header click sorts by size, folders first', async () => {
        jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({
            items: [fileItem('i1', fileInfo('f1', 'big.txt', 900)), fileItem('i2', fileInfo('f2', 'small.txt', 5)), folder('d1', 'Docs')],
            path: [],
            access: '',
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
        jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [folder('d1', 'Docs'), fileItem('i1', a), fileItem('i2', b)], path: [], access: ''});
        renderAt('/team/files/town');

        fireEvent.doubleClick(await screen.findByRole('gridcell', {name: 'b.txt'}));

        expect(openModal).toHaveBeenCalledWith(expect.objectContaining({
            dialogProps: expect.objectContaining({fileInfos: [a, b], startIndex: 1}),
        }));
    });

    test('drive_changed for the open folder reloads it', async () => {
        const list = jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [], path: [], access: ''});
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
    describe('embedded in a channel', () => {
        beforeEach(() => {
            jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [folder('d1', 'Docs')], path: [], access: ''});
        });

        test('embedded, opening a folder goes through the host URL', async () => {
            // useHistory is the global historyMock in tests (tests/react-router-dom_mock.ts).
            const push = (global as unknown as {historyMock: {push: jest.Mock}}).historyMock.push;
            push.mockClear();
            renderEmbedded();
            fireEvent.doubleClick(await screen.findByRole('gridcell', {name: 'Docs'}));
            expect(push).toHaveBeenCalledWith('/team/channels/town?folder=d1');
        });

        test('embedded, the channel tree is hidden', async () => {
            renderEmbedded();
            await screen.findByRole('gridcell', {name: 'Docs'});
            expect(screen.queryByRole('navigation', {name: 'Folders'})).toBeNull();
        });

        test('embedded, the address bar starts at the channel and Up stops there', async () => {
            renderEmbedded();
            await screen.findByRole('gridcell', {name: 'Docs'});
            const crumbs = screen.getByRole('navigation', {name: 'Location'});
            expect(crumbs).toHaveTextContent(/^Town$/);
            expect(screen.getByRole('button', {name: 'Up'})).toBeDisabled();
        });

        test('embedded, a folder link renders while its path loads, then Up leads to the channel root', async () => {
            jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items: [], path: [folder('d1', 'Docs')], access: ''});
            renderEmbedded('/team/channels/town?folder=d1');
            expect(await screen.findByText('Docs', {selector: '[aria-current=location]'})).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Up'})).toBeEnabled();
        });

        test('embedded, the recycle bin opens from the channel root', async () => {
            const push = (global as unknown as {historyMock: {push: jest.Mock}}).historyMock.push;
            push.mockClear();
            renderEmbedded();
            await screen.findByRole('gridcell', {name: 'Docs'});
            expect(cellNames()).toEqual(['Chat attachments', 'Docs', 'Recycle Bin']);
            fireEvent.doubleClick(screen.getByRole('gridcell', {name: 'Recycle Bin'}));
            expect(push).toHaveBeenCalledWith('/team/channels/town?folder=trash');
        });

        test('embedded, the sidebar keeps its current item', async () => {
            (selectLhsItem as jest.Mock).mockClear();
            renderEmbedded();
            await screen.findByRole('gridcell', {name: 'Docs'});
            expect(selectLhsItem).not.toHaveBeenCalled();
        });
    });

    describe('folder rules', () => {
        const mine = fileItem('i1', fileInfo('f1', 'a.txt', 10));
        const theirs = {...fileItem('i2', fileInfo('f2', 'b.txt', 10)), creator_id: 'u2'};
        const list = (items: DriveItem[], access: '' | 'write' | 'read', extra = {}) => jest.spyOn(Client4, 'getDriveFolder').mockResolvedValue({items, path: [], access, ...extra});
        const button = (name: string) => screen.getByRole('button', {name});

        test('a read-only folder disables New folder and Delete, even for my own file', async () => {
            list([mine], 'read');
            renderAt('/team/files/town');
            fireEvent.click(await screen.findByRole('gridcell', {name: 'a.txt'}));
            expect(button('New folder')).toBeDisabled();
            expect(button('Delete')).toBeDisabled();
            expect(button('Upload')).toBeDisabled();
        });

        test('a write folder lets me delete a colleague file', async () => {
            list([theirs], 'write');
            renderAt('/team/files/town');
            fireEvent.click(await screen.findByRole('gridcell', {name: 'b.txt'}));
            expect(button('Delete')).toBeEnabled();
            expect(button('New folder')).toBeEnabled();
        });

        test('without a rule I can still only change my own files', async () => {
            list([mine, theirs], '');
            renderAt('/team/files/town');
            fireEvent.click(await screen.findByRole('gridcell', {name: 'b.txt'}));
            expect(button('Delete')).toBeDisabled();
            fireEvent.click(screen.getByRole('gridcell', {name: 'a.txt'}));
            expect(button('Delete')).toBeEnabled();
        });

        test('a folder that carries rules cannot be deleted by a non-manager', async () => {
            list([{...folder('d1', 'BG'), write_departments: ['bg']}], 'write');
            renderAt('/team/files/town');
            fireEvent.click(await screen.findByRole('gridcell', {name: 'BG'}));
            expect(button('Delete')).toBeDisabled();
        });

        test('an empty mirror whose source is gone says so', async () => {
            list([], 'read', {path: [{...folder('m1', 'Mirror'), mirror_of: 'gone'}], source_missing: true});
            renderAt('/team/files/town/m1');
            await screen.findByText('The folder this one shows was deleted.');
        });

        test('a channel manager browsing a mirror still cannot create or delete', async () => {
            list([mine], 'read', {path: [{...folder('m1', 'Mirror'), mirror_of: 's1'}]});
            const admin = TestHelper.getUserMock({id: 'me', username: 'me', roles: 'system_user system_admin'});
            renderWithContext(
                <Route
                    path='/:team/files/:channelName?/:folderId?'
                    component={FileExplorer}
                />,
                {
                    entities: {
                        ...storeState.entities,
                        users: {currentUserId: 'me', profiles: {me: admin}},
                        roles: {roles: {system_admin: TestHelper.getRoleMock({name: 'system_admin', permissions: ['manage_channel_roles']})}},
                    },
                },
                {history: createMemoryHistory({initialEntries: ['/team/files/town/m1']})},
            );
            fireEvent.click(await screen.findByRole('gridcell', {name: 'a.txt'}));
            expect(button('New folder')).toBeDisabled();
            expect(button('Delete')).toBeDisabled();
        });
    });

    describe('file operations', () => {
        const mine = fileItem('i1', fileInfo('f1', 'a.txt', 10));
        const theirs = {...fileItem('i2', fileInfo('f2', 'b.txt', 10)), creator_id: 'u2'};
        const lastModal = () => (openModal as jest.Mock).mock.calls.at(-1)[0];

        beforeEach(() => {
            jest.spyOn(Client4, 'getDriveFolder').mockImplementation(async (_c, parentId = '') => (
                parentId ? {items: [], path: [folder('d1', 'Docs')], access: ''} : {items: [folder('d1', 'Docs'), mine, theirs], path: [], access: ''}
            ));
        });

        test('Ctrl+X then Ctrl+V in another folder moves the item', async () => {
            const move = jest.spyOn(Client4, 'moveDriveItems').mockResolvedValue({status: 'OK'});
            const first = renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            fireEvent.click(cell);
            fireEvent.keyDown(cell, {key: 'x', ctrlKey: true});
            first.unmount();

            // useHistory is mocked in unit tests, so open the other folder directly.
            renderAt('/team/files/town/d1');
            await screen.findByText('This folder is empty. Drop files here or use Upload.');
            fireEvent.keyDown(screen.getByRole('main'), {key: 'v', ctrlKey: true});

            await waitFor(() => expect(move).toHaveBeenCalledWith('c1', ['i1'], 'c1', 'd1'));
        });

        test('opening a folder moves keyboard focus to its first item, or to the empty list', async () => {
            const first = renderAt('/team/files/town');
            await waitFor(() => expect(screen.getByRole('gridcell', {name: 'Chat attachments'})).toHaveFocus());
            first.unmount();

            // useHistory is mocked in unit tests, so open the folder directly.
            renderAt('/team/files/town/d1');
            await screen.findByText('This folder is empty. Drop files here or use Upload.');
            await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
        });

        test('a chat attachment copied with Ctrl+C is pasted as a file id', async () => {
            jest.spyOn(Client4, 'getDriveChatFiles').mockResolvedValue([fileInfo('f9', 'chat.png', 10)]);
            const copy = jest.spyOn(Client4, 'copyDriveItems').mockResolvedValue({status: 'OK'});
            const first = renderAt('/team/files/town/chat');
            const cell = await screen.findByRole('gridcell', {name: 'chat.png'});
            fireEvent.click(cell);
            fireEvent.keyDown(cell, {key: 'c', ctrlKey: true});
            first.unmount();

            renderAt('/team/files/town');
            const docs = await screen.findByRole('gridcell', {name: 'Docs'});
            fireEvent.keyDown(docs, {key: 'v', ctrlKey: true});

            await waitFor(() => expect(copy).toHaveBeenCalledWith('c1', [], ['f9'], 'c1', ''));
        });

        test('Delete moves to the Recycle Bin and the toast can undo it', async () => {
            const del = jest.spyOn(Client4, 'deleteDriveItems').mockResolvedValue({status: 'OK'});
            const restore = jest.spyOn(Client4, 'restoreDriveItems').mockResolvedValue({status: 'OK'});
            renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            fireEvent.click(cell);
            fireEvent.keyDown(cell, {key: 'Delete'});

            await waitFor(() => expect(del).toHaveBeenCalledWith('c1', ['i1'], false));
            await waitFor(() => expect(lastModal().dialogProps.content.message).toBe('Moved 1 item to the Recycle Bin'));

            // InfoToast lays its first column out for an icon; without one the message wraps word by word.
            expect(React.isValidElement(lastModal().dialogProps.content.icon)).toBe(true);
            await act(async () => lastModal().dialogProps.content.undo());
            expect(restore).toHaveBeenCalledWith('c1', ['i1']);
        });

        test('Shift+Delete deletes permanently only after confirming', async () => {
            const del = jest.spyOn(Client4, 'deleteDriveItems').mockResolvedValue({status: 'OK'});
            renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            fireEvent.click(cell);
            fireEvent.keyDown(cell, {key: 'Delete', shiftKey: true});

            expect(del).not.toHaveBeenCalled();
            await act(async () => lastModal().dialogProps.onConfirm());
            expect(del).toHaveBeenCalledWith('c1', ['i1'], true);
        });

        test('a server error is shown as a toast', async () => {
            jest.spyOn(Client4, 'deleteDriveItems').mockRejectedValue(new Error('nope from server'));
            renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            fireEvent.click(cell);
            fireEvent.keyDown(cell, {key: 'Delete'});
            await waitFor(() => expect(lastModal().dialogProps.content.message).toBe('nope from server'));
            expect(React.isValidElement(lastModal().dialogProps.content.icon)).toBe(true);
        });

        test('context menu Rename is only enabled for items I may change', async () => {
            renderAt('/team/files/town');
            fireEvent.contextMenu(await screen.findByRole('gridcell', {name: 'b.txt'}));
            expect(screen.getByRole('menuitem', {name: 'Rename'})).toBeDisabled();

            fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'});
            fireEvent.contextMenu(screen.getByRole('gridcell', {name: 'a.txt'}));
            expect(screen.getByRole('menuitem', {name: 'Rename'})).toBeEnabled();
        });

        test('context menu Rename is disabled for a chat attachment', async () => {
            jest.spyOn(Client4, 'getDriveChatFiles').mockResolvedValue([fileInfo('f9', 'chat.png', 10)]);
            renderAt('/team/files/town/chat');
            fireEvent.contextMenu(await screen.findByRole('gridcell', {name: 'chat.png'}));
            expect(screen.getByRole('menuitem', {name: 'Rename'})).toBeDisabled();
            expect(screen.getByRole('menuitem', {name: 'Copy'})).toBeEnabled();
        });

        test('F2 then Enter renames the item', async () => {
            const rename = jest.spyOn(Client4, 'renameDriveItem').mockResolvedValue(mine);
            renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            fireEvent.click(cell);
            fireEvent.keyDown(cell, {key: 'F2'});

            const input = screen.getByRole('textbox', {name: 'Name'});
            fireEvent.change(input, {target: {value: 'new.txt'}});
            fireEvent.keyDown(input, {key: 'Enter'});

            await waitFor(() => expect(rename).toHaveBeenCalledWith('c1', 'i1', 'new.txt'));

            // Keyboard focus returns to the item, so the next shortcut still works.
            expect(input).not.toBeInTheDocument();
            expect(cell).toHaveFocus();
        });

        const dataTransfer = (files: File[] = []) => {
            const data: Record<string, string> = {};
            return {
                get types() {
                    return [...Object.keys(data), ...(files.length ? ['Files'] : [])];
                },
                files,
                items: files.map((f) => ({kind: 'file', getAsFile: () => f})),
                setData: (k: string, v: string) => {
                    data[k] = v;
                },
                getData: (k: string) => data[k],
                dropEffect: 'none',
                effectAllowed: 'all',
            };
        };

        test('dragging an item onto a folder moves it there', async () => {
            const move = jest.spyOn(Client4, 'moveDriveItems').mockResolvedValue({status: 'OK'});
            renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            const docs = screen.getByRole('gridcell', {name: 'Docs'});
            const dt = dataTransfer();

            fireEvent.dragStart(cell, {dataTransfer: dt});
            fireEvent.dragOver(docs, {dataTransfer: dt});
            fireEvent.drop(docs, {dataTransfer: dt});

            await waitFor(() => expect(move).toHaveBeenCalledWith('c1', ['i1'], 'c1', 'd1'));
        });

        test('dropping files from the computer on a folder uploads them there', async () => {
            (uploadFile as jest.Mock).mockImplementation(({file, onSuccess}) => () => {
                Promise.resolve().then(() => onSuccess({file_infos: [{id: `f-${file.name}`}]}));
                return {abort: jest.fn()};
            });
            const add = jest.spyOn(Client4, 'addDriveFile').mockResolvedValue({} as DriveItem);
            renderAt('/team/files/town');
            const docs = await screen.findByRole('gridcell', {name: 'Docs'});
            const dt = dataTransfer([new File(['x'], 'new.png')]);

            fireEvent.dragOver(docs, {dataTransfer: dt});
            expect(screen.getByText('Drop to upload to Town › Docs')).toBeInTheDocument();
            fireEvent.drop(docs, {dataTransfer: dt});

            await waitFor(() => expect(add).toHaveBeenCalledWith('c1', 'd1', 'f-new.png'));
            expect(await screen.findByRole('region', {name: 'Uploads'})).toHaveTextContent('new.png');
        });

        test('Ctrl+A selects everything and Escape clears it', async () => {
            renderAt('/team/files/town');
            const cell = await screen.findByRole('gridcell', {name: 'a.txt'});
            fireEvent.keyDown(cell, {key: 'a', ctrlKey: true});
            await waitFor(() => expect(screen.getAllByRole('gridcell', {selected: true})).toHaveLength(4));
            fireEvent.keyDown(cell, {key: 'Escape'});
            await waitFor(() => expect(screen.queryAllByRole('gridcell', {selected: true})).toHaveLength(0));
        });
    });
});
