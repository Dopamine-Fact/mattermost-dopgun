// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';

import type {Department} from '@mattermost/types/custom_roles';
import type {TaskStage} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {fetchTeamStages} from 'actions/tasks';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import StagesPage from './stages_page';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
    fetchTeamStages: jest.fn(() => () => Promise.resolve({data: []})),
}));

const stage: TaskStage = {id: 'st1', team_id: '', section_id: 'sec1', name: 'Layout', sort_order: 1, task_ids: [], create_at: 1, update_at: 1, status: 'not_started', current: true};

// Each test uses its own team: departments are cached per team across renders.
const renderPage = (teamId: string, permissions: string[], stagesView?: boolean) => {
    jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue([
        {id: 'd1', team_id: teamId, name: 'Layout', stages_view: stagesView, ranks: [{id: 'r1', role_name: 'rk_r1', department_id: 'd1'}]} as unknown as Department,
    ]);
    return renderWithContext(
        <StagesPage/>,
        {
            entities: {
                users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                teams: {
                    currentTeamId: teamId,
                    teams: {[teamId]: TestHelper.getTeamMock({id: teamId, name: 'team-one', tasks_enabled: true})},
                    myMembers: {[teamId]: TestHelper.getTeamMembershipMock({team_id: teamId, user_id: 'me', roles: 'team_user rk_r1'})},
                },
                roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
                tasks: {
                    byId: {},
                    sectionsById: {sec1: {id: 'sec1', team_id: teamId, name: 'Episode 1', sort_order: 0, channel_id: '', video_file_id: '', create_at: 1, update_at: 1}},
                    stagesById: {st1: {...stage, team_id: teamId}},
                },
            },
        },
        {history: createMemoryHistory({initialEntries: ['/team-one/stages']})},
    );
};

describe('StagesPage', () => {
    test('a member whose department may not see stages gets a notice and loads nothing', async () => {
        renderPage('teamA', [], false);
        expect(await screen.findByText('Your department cannot see the stages.')).toBeInTheDocument();
        expect(screen.queryByText('Episode 1')).toBeNull();
        expect(fetchTeamStages).not.toHaveBeenCalledWith('teamA');
    });

    test('a member of a department with stages_view sees each section\'s stages', async () => {
        renderPage('teamB', [], true);
        expect(await screen.findByRole('heading', {name: 'Episode 1'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: 'Layout'})).toBeInTheDocument();
        expect(fetchTeamStages).toHaveBeenCalledWith('teamB');
    });

    test('task managers always see the stages', () => {
        renderPage('teamC', ['manage_tasks']);
        expect(screen.getByRole('heading', {name: 'Episode 1'})).toBeInTheDocument();
    });
});
