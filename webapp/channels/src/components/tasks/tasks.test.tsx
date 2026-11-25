// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';

import type {Task} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import Tasks from './tasks';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
}));

const task = (id: string, videoFileId: string): Task => ({
    id,
    team_id: 'team1',
    section_id: 'sec1',
    title: id,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: 0,
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

const renderBoard = (taskId: string, permissions: string[]) => renderWithContext(
    <Tasks/>,
    {
        entities: {
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: true})},
                myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
            },
            roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
            tasks: {
                byId: {plain: task('plain', ''), revision: task('revision', 'file1')},
                sectionsById: {sec1: {id: 'sec1', team_id: 'team1', name: 'Trailer', sort_order: 0, channel_id: 'chan1', video_file_id: 'file1', create_at: 1, update_at: 1}},
            },
        },
    },
    {history: createMemoryHistory({initialEntries: [`/team-one/tasks?task=${taskId}`]})},
);

describe('Tasks', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
    });

    test('a revision opened from the board follows manage_revisions, a plain task manage_tasks', () => {
        const {unmount} = renderBoard('revision', ['manage_revisions']);
        expect(screen.getByRole('button', {name: 'Delete task'})).toBeInTheDocument();
        unmount();

        renderBoard('plain', ['manage_revisions']);
        expect(screen.queryByRole('button', {name: 'Delete task'})).toBeNull();
    });
});
