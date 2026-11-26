// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React, {useEffect} from 'react';

import type {Task, TaskSection} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {createTask} from 'actions/tasks';

import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import ChannelTabs from './channel_tabs';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
    fetchTeamStages: jest.fn(() => () => Promise.resolve({data: []})),
    createTask: jest.fn(() => () => Promise.resolve({data: {id: 'new'}})),
}));
jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('components/tasks/task_post_list', () => ({
    __esModule: true,
    default: ({taskId, channelId, startAtEnd}: {taskId: string; channelId: string; startAtEnd?: boolean}) => <div>{`task posts ${taskId} ${channelId}${startAtEnd ? ' from the end' : ''}`}</div>,
}));
jest.mock('components/canvas/canvas_board', () => ({
    __esModule: true,
    default: ({channelId, readOnly}: {channelId: string; readOnly: boolean}) => (
        <div>{`board ${channelId} ${readOnly ? 'readonly' : 'editable'}`}</div>
    ),
}));

jest.mock('actions/file_actions', () => ({
    ...jest.requireActual('actions/file_actions'),
    uploadFile: jest.fn(() => () => ({abort: jest.fn()})),
}));

const mockExplorerRenders: string[] = [];
let mockExplorerUploads: {enqueue: (files: Array<{file: File; relPath: string}>, channelId: string, folderId: string) => Promise<void>} | undefined;
jest.mock('components/file_explorer/file_explorer', () => ({
    __esModule: true,
    FileExplorerView: ({channelName, folderId, hostUploads}: {channelName: string; folderId: string; hostUploads?: typeof mockExplorerUploads}) => {
        mockExplorerRenders.push(`${channelName} [${folderId}]`);
        mockExplorerUploads = hostUploads;
        return <div>{`files ${channelName} [${folderId}]`}</div>;
    },
}));

const canvas = {id: 'cv1', channel_id: 'chan1', team_id: 'team1', creator_id: 'me', last_seq: 0, snapshot_seq: 0, create_at: 1, update_at: 1};
const section: TaskSection = {id: 'sec1', team_id: 'team1', name: 'Trailer', sort_order: 0, channel_id: 'chan1', video_file_id: 'file1', create_at: 1, update_at: 1};
const task = (id: string, title: string, sectionId: string, videoFileId: string): Task => ({
    id,
    team_id: 'team1',
    section_id: sectionId,
    title,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: 1200,
    video_file_id: videoFileId,
    creator_id: 'me',
    create_at: 1,
    update_at: 1,
    department_id: '',
    waits_for: [],
    folder_id: '',
    parent_id: '',
    approval_status: '',
});
const tasks = {
    t1: task('t1', 'Logo too small', 'sec1', 'file1'),
    t2: task('t2', 'Storyboard', 'sec1', ''),
    t3: task('t3', 'Unrelated', '', ''),
};

type Options = {
    canvasEnabled?: boolean;
    revisionsEnabled?: boolean;
    url?: string;
    permissions?: string[];
    deleteAt?: number;
    filesEnabled?: boolean;
    history?: ReturnType<typeof createMemoryHistory>;
    chat?: React.ReactNode;
};
const renderTabs = (channelId: string, {canvasEnabled = true, revisionsEnabled = true, url = '/team-one/channels/trailer', permissions = ['create_post', 'manage_tasks', 'manage_revisions'], deleteAt = 0, filesEnabled = false, history = createMemoryHistory({initialEntries: [url]}), chat = <div>{'chat'}</div>}: Options = {}) => renderWithContext(
    <ChannelTabs
        channelId={channelId}
        composer={<div>{'composer'}</div>}
    >
        {chat}
    </ChannelTabs>,
    {
        entities: {
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: revisionsEnabled, canvas_enabled: canvasEnabled, files_enabled: filesEnabled})},
                myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
            },
            channels: {
                channels: {[channelId]: TestHelper.getChannelMock({id: channelId, name: 'trailer', team_id: 'team1', delete_at: deleteAt})},
                channelsInTeam: {team1: new Set([channelId])},
                myMembers: {[channelId]: TestHelper.getChannelMembershipMock({channel_id: channelId, user_id: 'me', roles: ''})},
            },
            roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
            tasks: {byId: tasks, sectionsById: {sec1: section}, stagesById: {st1: {id: 'st1', team_id: 'team1', section_id: 'sec1', name: 'Layout stage', sort_order: 1, task_ids: [], create_at: 1, update_at: 1, status: 'not_started', current: true}}},
        },
    },
    {history},
);
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

// The chat is kept mounted under another tab, so a remount (which loses its scroll position) shows up as a second mount.
const mountCounter = () => {
    const mounts = jest.fn();
    const Chat = () => {
        useEffect(() => mounts(), []);
        return <div>{'chat'}</div>;
    };
    return {mounts, chat: <Chat/>};
};
const chatHidden = () => screen.getByText('chat').closest('[inert]') !== null;

describe('ChannelTabs', () => {
    let getCanvas: jest.SpyInstance;
    const isCanvas = (yes: boolean) => getCanvas.mockImplementation(() => Promise.resolve(yes ? canvas : null));
    beforeEach(() => {
        getCanvas = jest.spyOn(Client4, 'getCanvas');
        isCanvas(false);
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
        jest.spyOn(Client4, 'getTaskSectionVideos').mockResolvedValue([]);
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test('a revision channel shows Messages, Revisions, Tasks', async () => {
        renderTabs('chan1');
        await waitFor(() => expect(getCanvas).toHaveBeenCalledWith('chan1'));
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks', 'Timeline', 'Stages']);
        expect(screen.getByRole('tab', {name: 'Messages'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('chat')).toBeInTheDocument();
    });

    test('the Messages filter shows one task\'s messages above the composer', () => {
        renderTabs('chan1');
        const filter = screen.getByRole('combobox', {name: 'Filter by task'});
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Logo too small', 'Storyboard']);
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.getByText('composer')).toBeInTheDocument();

        fireEvent.change(filter, {target: {value: 't2'}});
        expect(screen.queryByText('chat')).toBeNull();
        expect(screen.getByText('task posts t2 chan1 from the end')).toBeInTheDocument();
        expect(screen.getByText('composer')).toBeInTheDocument();

        fireEvent.change(filter, {target: {value: ''}});
        expect(screen.getByText('chat')).toBeInTheDocument();
    });

    test('a channel without tabs keeps its chat and composer and has no filter', async () => {
        renderTabs('chan2');
        await waitFor(() => expect(getCanvas).toHaveBeenCalledWith('chan2'));
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.getByText('composer')).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    test('a canvas channel shows Messages, Canvas', async () => {
        isCanvas(true);
        renderTabs('chan2');
        expect(await screen.findByRole('tab', {name: 'Canvas'})).toBeInTheDocument();
        expect(tabNames()).toEqual(['Messages', 'Canvas']);
    });

    test('an episode shows all four', async () => {
        isCanvas(true);
        renderTabs('chan1');
        expect(await screen.findByRole('tab', {name: 'Canvas'})).toBeInTheDocument();
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks', 'Timeline', 'Stages', 'Canvas']);
    });

    test('a plain channel has no tab bar', async () => {
        renderTabs('chan2');
        await waitFor(() => expect(getCanvas).toHaveBeenCalledWith('chan2'));
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    test('with canvases and revisions off nothing is asked and no tab bar shows', () => {
        renderTabs('chan1', {canvasEnabled: false, revisionsEnabled: false});
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(getCanvas).not.toHaveBeenCalled();
    });

    test('shows no canvas tab while the probe is in flight', () => {
        getCanvas.mockReturnValue(new Promise(() => {}));
        renderTabs('chan2');
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    test('the Revisions tab shows the video and its revisions', () => {
        renderTabs('chan1');
        fireEvent.click(screen.getByRole('tab', {name: 'Revisions'}));
        expect(chatHidden()).toBe(true);
        expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/task_sections/sec1/video'));
        expect(screen.getByRole('button', {name: 'Logo too small'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Storyboard'})).toBeNull();
    });

    test('a picked revision opens its detail in the Revisions panel', () => {
        renderTabs('chan1');
        fireEvent.click(screen.getByRole('tab', {name: 'Revisions'}));
        fireEvent.click(screen.getByRole('button', {name: 'Logo too small'}));
        const panel = document.querySelector('.TaskRevisions__panel') as HTMLElement;
        expect(within(panel).getByRole('complementary', {name: 'Task details'})).toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: 'Revision description'})).toBeNull();
    });

    test('arrow keys step the video right after the Revisions tab is clicked', () => {
        jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        renderTabs('chan1');
        const tab = screen.getByRole('tab', {name: 'Revisions'});
        fireEvent.click(tab);
        tab.focus();

        const video = document.querySelector('video')!;
        let time = 0;
        Object.defineProperty(video, 'currentTime', {get: () => time,
            set: (t: number) => {
                time = t;
            }});
        fireEvent.keyDown(tab, {key: 'ArrowRight'});
        expect(time).toBeCloseTo(1 / 30);
    });

    test('the Tasks tab lists only ordinary tasks of this section', () => {
        renderTabs('chan1');
        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        expect(chatHidden()).toBe(true);
        expect(screen.getByText('Storyboard')).toBeInTheDocument();
        expect(screen.queryByText('Logo too small')).toBeNull();
        expect(screen.queryByText('Unrelated')).toBeNull();

        fireEvent.click(screen.getByText('Storyboard'));
        expect(screen.getByRole('complementary', {name: 'Task details'})).toBeInTheDocument();
    });

    test('Add task on the Tasks tab creates in this section', () => {
        renderTabs('chan1');
        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        const input = screen.getAllByRole('textbox', {name: 'New task title'})[0];
        fireEvent.change(input, {target: {value: 'Layout'}});
        fireEvent.blur(input);
        expect(createTask).toHaveBeenCalledWith({team_id: 'team1', title: 'Layout', status: 'todo', section_id: 'sec1'});
    });

    test('the Tasks menu opens the list or the board', () => {
        renderTabs('chan1');
        expect(screen.getByRole('button', {name: 'List'})).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', {name: 'Board'}));
        expect(screen.getByRole('tab', {name: 'Tasks'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', {name: 'Board'})).toHaveAttribute('aria-pressed', 'true');
        expect(document.querySelector('.TaskBoard')).not.toBeNull();
        expect(screen.getByText('Storyboard')).toBeInTheDocument();
        expect(screen.queryByText('Logo too small')).toBeNull();

        // Leaving and clicking Tasks again keeps the last view.
        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        expect(document.querySelector('.TaskBoard')).not.toBeNull();

        fireEvent.click(screen.getByRole('button', {name: 'List'}));
        expect(document.querySelector('.TaskBoard')).toBeNull();
        expect(screen.getAllByRole('textbox', {name: 'New task title'}).length).toBeGreaterThan(0);
    });

    test('the Timeline tab shows this section only and cannot edit sections', () => {
        renderTabs('chan1');
        fireEvent.click(screen.getByRole('tab', {name: 'Timeline'}));
        expect(chatHidden()).toBe(true);
        expect(screen.getByText('1 task has no dates and is not shown here.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: 'New section name'})).toBeNull();
        expect(screen.queryByRole('textbox', {name: 'Section name'})).toBeNull();
    });

    test('without manage_tasks the Tasks tab cannot add', () => {
        renderTabs('chan1', {permissions: ['create_post', 'manage_revisions']});
        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        expect(screen.queryByRole('textbox', {name: 'New task title'})).toBeNull();

        // Nor, outside a department allowed to, does it see the stages.
        expect(screen.queryByRole('tab', {name: 'Stages'})).toBeNull();
    });

    test('the Stages tab shows the episode\'s stages without a section picker', () => {
        renderTabs('chan1');
        fireEvent.click(screen.getByRole('tab', {name: 'Stages'}));
        expect(screen.getByRole('textbox', {name: 'Stage name'})).toHaveValue('Layout stage');
        expect(screen.queryByRole('combobox', {name: /Section/})).toBeNull();
    });

    test('?revision= opens Revisions; ?canvas=1 opens Canvas', async () => {
        const {unmount} = renderTabs('chan1', {url: '/team-one/channels/trailer?revision=t1'});
        expect(screen.getByRole('tab', {name: 'Revisions'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('complementary', {name: 'Task details'})).toBeInTheDocument();
        unmount();

        isCanvas(true);
        renderTabs('chan1', {url: '/team-one/channels/trailer?canvas=1'});
        expect(await screen.findByText('board chan1 editable')).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: 'Canvas'})).toHaveAttribute('aria-selected', 'true');
    });

    test('a channel with a tab bar gets a Files tab when the team has files on', () => {
        const {unmount} = renderTabs('chan1', {filesEnabled: true});
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks', 'Timeline', 'Stages', 'Files']);
        unmount();

        renderTabs('chan1');
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks', 'Timeline', 'Stages']);
    });

    test('?folder= opens the Files tab at that folder', async () => {
        renderTabs('chan1', {filesEnabled: true, url: '/team-one/channels/trailer?folder=f1'});
        expect(screen.getByRole('tab', {name: 'Files'})).toHaveAttribute('aria-selected', 'true');
        expect(await screen.findByText('files trailer [f1]')).toBeInTheDocument();
    });

    test('the Files tab opens the channel root through the address bar', async () => {
        renderTabs('chan1', {filesEnabled: true});
        fireEvent.click(screen.getByRole('tab', {name: 'Files'}));
        expect(await screen.findByText('files trailer []')).toBeInTheDocument();
        expect((global as unknown as {historyMock: {push: jest.Mock}}).historyMock.push).toHaveBeenCalledWith('/team-one/channels/trailer?folder=');
    });

    test('an archived episode channel has no Files tab, since the explorer does not list it', () => {
        renderTabs('chan1', {filesEnabled: true, deleteAt: 5});
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks', 'Timeline', 'Stages']);
    });

    test('leaving the Files tab drops ?folder= from the address', async () => {
        const push = (global as unknown as {historyMock: {push: jest.Mock}}).historyMock.push;
        renderTabs('chan1', {filesEnabled: true, url: '/team-one/channels/trailer?folder=f1'});
        await screen.findByText('files trailer [f1]');
        push.mockClear();
        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(push).toHaveBeenCalledWith('/team-one/channels/trailer', {channelTab: 'messages'});
    });

    test('leaving the Files tab for Tasks lands on Tasks once the address drops ?folder=', async () => {
        const push = (global as unknown as {historyMock: {push: jest.Mock}}).historyMock.push;
        const history = createMemoryHistory({initialEntries: ['/team-one/channels/trailer?folder=f1']});
        renderTabs('chan1', {filesEnabled: true, history});
        await screen.findByText('files trailer [f1]');
        push.mockClear();

        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        act(() => history.push(...(push.mock.lastCall as [string, unknown])));

        expect(screen.getByRole('tab', {name: 'Tasks'})).toHaveAttribute('aria-selected', 'true');
    });

    test('switching channels while on Files never shows the next channel files', async () => {
        const history = createMemoryHistory({initialEntries: ['/team-one/channels/trailer?folder=f1']});
        const sectionTwo = {...section, id: 'sec2', channel_id: 'chan2'};
        const tabs = (channelId: string) => (
            <ChannelTabs
                channelId={channelId}
                composer={<div>{'composer'}</div>}
            >
                <div>{'chat'}</div>
            </ChannelTabs>
        );
        const {rerender} = renderWithContext(
            tabs('chan1'),
            {
                entities: {
                    users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                    teams: {
                        currentTeamId: 'team1',
                        teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: true, files_enabled: true})},
                        myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
                    },
                    channels: {
                        channels: {
                            chan1: TestHelper.getChannelMock({id: 'chan1', name: 'trailer', team_id: 'team1'}),
                            chan2: TestHelper.getChannelMock({id: 'chan2', name: 'teaser', team_id: 'team1'}),
                        },
                        channelsInTeam: {team1: new Set(['chan1', 'chan2'])},
                        myMembers: {
                            chan1: TestHelper.getChannelMembershipMock({channel_id: 'chan1', user_id: 'me', roles: ''}),
                            chan2: TestHelper.getChannelMembershipMock({channel_id: 'chan2', user_id: 'me', roles: ''}),
                        },
                    },
                    roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions: ['create_post']})}},
                    tasks: {byId: tasks, sectionsById: {sec1: section, sec2: sectionTwo}},
                },
            },
            {history},
        );
        await screen.findByText('files trailer [f1]');
        mockExplorerRenders.length = 0;

        act(() => {
            history.push('/team-one/channels/teaser');
            rerender(tabs('chan2'));
        });

        expect(screen.getByRole('tab', {name: 'Messages'})).toHaveAttribute('aria-selected', 'true');
        expect(mockExplorerRenders).toEqual([]);
    });

    test('an upload keeps its progress panel after leaving the Files tab', async () => {
        renderTabs('chan1', {filesEnabled: true, url: '/team-one/channels/trailer?folder='});
        await screen.findByText('files trailer []');

        act(() => {
            mockExplorerUploads!.enqueue([{file: new File(['x'], 'clip.mov'), relPath: 'clip.mov'}], 'chan1', '');
        });
        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));

        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Uploads'})).toHaveTextContent('clip.mov');
    });

    test('?folder= falls back to Messages when files are off', () => {
        renderTabs('chan1', {url: '/team-one/channels/trailer?folder=f1'});
        expect(screen.getByRole('tab', {name: 'Messages'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('chat')).toBeInTheDocument();
    });

    test('?task= opens Tasks on that task', () => {
        renderTabs('chan1', {url: '/team-one/channels/trailer?task=t2'});
        expect(screen.getByRole('tab', {name: 'Tasks'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('complementary', {name: 'Task details'})).toBeInTheDocument();
    });

    test('the filter keeps a task moved out of the section while this channel has messages about it', () => {
        renderWithContext(
            <ChannelTabs
                channelId='chan1'
                composer={<div>{'composer'}</div>}
            >
                <div>{'chat'}</div>
            </ChannelTabs>,
            {
                entities: {
                    users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                    teams: {
                        currentTeamId: 'team1',
                        teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: true})},
                        myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
                    },
                    channels: {
                        channels: {chan1: TestHelper.getChannelMock({id: 'chan1', team_id: 'team1'})},
                        myMembers: {chan1: TestHelper.getChannelMembershipMock({channel_id: 'chan1', user_id: 'me', roles: ''})},
                    },
                    posts: {
                        posts: {p1: TestHelper.getPostMock({id: 'p1', channel_id: 'chan1', props: {task_id: 't3'}})},
                        postsInChannel: {chan1: [{order: ['p1'], recent: true, oldest: false}]},
                    },
                    roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions: ['create_post']})}},
                    tasks: {byId: tasks, sectionsById: {sec1: section}},
                },
            },
        );
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Logo too small', 'Storyboard', 'Unrelated']);
    });

    test('following the same task link again reopens it', () => {
        const url = '/team-one/channels/trailer?task=t2';
        const history = createMemoryHistory({initialEntries: [url]});
        renderWithContext(
            <ChannelTabs
                channelId='chan1'
                composer={<div>{'composer'}</div>}
            >
                <div>{'chat'}</div>
            </ChannelTabs>,
            {
                entities: {
                    users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                    teams: {
                        currentTeamId: 'team1',
                        teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: true})},
                        myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
                    },
                    channels: {
                        channels: {chan1: TestHelper.getChannelMock({id: 'chan1', team_id: 'team1'})},
                        myMembers: {chan1: TestHelper.getChannelMembershipMock({channel_id: 'chan1', user_id: 'me', roles: ''})},
                    },
                    roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions: ['create_post']})}},
                    tasks: {byId: tasks, sectionsById: {sec1: section}},
                },
            },
            {history},
        );
        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(screen.getByRole('tab', {name: 'Messages'})).toHaveAttribute('aria-selected', 'true');

        act(() => history.push(url));
        expect(screen.getByRole('tab', {name: 'Tasks'})).toHaveAttribute('aria-selected', 'true');
    });

    test('a canvas channel switches between messages and the board', async () => {
        isCanvas(true);
        renderTabs('chan2');
        fireEvent.click(await screen.findByRole('tab', {name: 'Canvas'}));
        expect(chatHidden()).toBe(true);
        expect(screen.queryByText('composer')).toBeNull();
        expect(await screen.findByText('board chan2 editable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(chatHidden()).toBe(false);
        expect(screen.getByText('composer')).toBeInTheDocument();
    });

    test('the chat is not remounted when the canvas tab appears or when coming back from another tab', async () => {
        isCanvas(true);
        const {mounts, chat} = mountCounter();
        renderTabs('chan2', {chat});
        fireEvent.click(await screen.findByRole('tab', {name: 'Canvas'}));
        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(mounts).toHaveBeenCalledTimes(1);
    });

    test('the chat is not remounted when coming back from the Tasks tab', () => {
        const {mounts, chat} = mountCounter();
        renderTabs('chan1', {chat});
        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(mounts).toHaveBeenCalledTimes(1);
    });

    test('the board is read-only without create_post', async () => {
        isCanvas(true);
        renderTabs('chan2', {url: '/team-one/channels/board?canvas=1', permissions: []});
        expect(await screen.findByText('board chan2 readonly')).toBeInTheDocument();
    });

    test('the board is read-only in an archived channel', async () => {
        isCanvas(true);
        renderTabs('chan2', {url: '/team-one/channels/board?canvas=1', deleteAt: 5});
        expect(await screen.findByText('board chan2 readonly')).toBeInTheDocument();
    });
});
