// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';

import type {Task, TaskSection} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {createTask} from 'actions/tasks';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import ChannelTabs from './channel_tabs';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
    createTask: jest.fn(() => () => Promise.resolve({data: {id: 'new'}})),
}));
jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('components/tasks/task_post_list', () => ({
    __esModule: true,
    default: ({taskId, channelId}: {taskId: string; channelId: string}) => <div>{`task posts ${taskId} ${channelId}`}</div>,
}));
jest.mock('components/canvas/canvas_board', () => ({
    __esModule: true,
    default: ({channelId, readOnly}: {channelId: string; readOnly: boolean}) => (
        <div>{`board ${channelId} ${readOnly ? 'readonly' : 'editable'}`}</div>
    ),
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
};
const renderTabs = (channelId: string, {canvasEnabled = true, revisionsEnabled = true, url = '/team-one/channels/trailer', permissions = ['create_post', 'manage_tasks', 'manage_revisions'], deleteAt = 0}: Options = {}) => renderWithContext(
    <ChannelTabs
        channelId={channelId}
        composer={<div>{'composer'}</div>}
    >
        <div>{'chat'}</div>
    </ChannelTabs>,
    {
        entities: {
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: revisionsEnabled, canvas_enabled: canvasEnabled})},
                myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
            },
            channels: {
                channels: {[channelId]: TestHelper.getChannelMock({id: channelId, team_id: 'team1', delete_at: deleteAt})},
                myMembers: {[channelId]: TestHelper.getChannelMembershipMock({channel_id: channelId, user_id: 'me', roles: ''})},
            },
            roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
            tasks: {byId: tasks, sectionsById: {sec1: section}},
        },
    },
    {history: createMemoryHistory({initialEntries: [url]})},
);
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

describe('ChannelTabs', () => {
    let getCanvas: jest.SpyInstance;
    const isCanvas = (yes: boolean) => getCanvas.mockImplementation(() => (yes ? Promise.resolve(canvas) : Promise.reject(Object.assign(new Error('not found'), {status_code: 404}))));
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
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks']);
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
        expect(screen.getByText('task posts t2 chan1')).toBeInTheDocument();
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
        expect(tabNames()).toEqual(['Messages', 'Revisions', 'Tasks', 'Canvas']);
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
        expect(screen.queryByText('chat')).not.toBeInTheDocument();
        expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/task_sections/sec1/video'));
        expect(screen.getByRole('button', {name: 'Logo too small'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Storyboard'})).toBeNull();
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
        expect(screen.queryByText('chat')).not.toBeInTheDocument();
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

    test('without manage_tasks the Tasks tab cannot add', () => {
        renderTabs('chan1', {permissions: ['create_post', 'manage_revisions']});
        fireEvent.click(screen.getByRole('tab', {name: 'Tasks'}));
        expect(screen.queryByRole('textbox', {name: 'New task title'})).toBeNull();
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

    test('?task= opens Tasks on that task', () => {
        renderTabs('chan1', {url: '/team-one/channels/trailer?task=t2'});
        expect(screen.getByRole('tab', {name: 'Tasks'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('complementary', {name: 'Task details'})).toBeInTheDocument();
    });

    test('a canvas channel switches between messages and the board', async () => {
        isCanvas(true);
        renderTabs('chan2');
        fireEvent.click(await screen.findByRole('tab', {name: 'Canvas'}));
        expect(screen.queryByText('chat')).not.toBeInTheDocument();
        expect(await screen.findByText('board chan2 editable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(screen.getByText('chat')).toBeInTheDocument();
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
