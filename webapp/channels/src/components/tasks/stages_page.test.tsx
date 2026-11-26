// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';

import type {Department} from '@mattermost/types/custom_roles';
import type {Task, TaskSection, TaskStage} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {fetchTeamStages} from 'actions/tasks';

import {fireEvent, renderWithContext, screen, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import StagesPage from './stages_page';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
    fetchTeamStages: jest.fn(() => () => Promise.resolve({data: []})),
}));

const stage = (id: string, sectionId: string, sortOrder: number, taskIds: string[]): TaskStage => ({id, team_id: '', section_id: sectionId, name: `Stage ${id}`, sort_order: sortOrder, task_ids: taskIds, create_at: 1, update_at: 1, status: 'not_started', current: false});
const section = (id: string, name: string, channelId = ''): TaskSection => ({id, team_id: '', name, sort_order: 0, channel_id: channelId, video_file_id: '', create_at: 1, update_at: 1});
const doneTask = {id: 'done', team_id: '', section_id: 'sec1', status: 'done', approval_status: 'approved', sort_order: 1} as Task;

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
                    byId: {done: {...doneTask, team_id: teamId}},
                    sectionsById: {
                        sec1: {...section('sec1', '02KU01'), team_id: teamId},
                        sec2: {...section('sec2', '02KU02', 'chan2'), team_id: teamId},
                        sec3: {...section('sec3', '03KU01', 'chan3'), team_id: teamId},
                        plain: {...section('plain', 'Backlog'), team_id: teamId},
                    },
                    stagesById: {
                        a: {...stage('a', 'sec1', 1, ['done']), team_id: teamId},
                        b: {...stage('b', 'sec1', 2, []), team_id: teamId},
                    },
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

    test('a member of a department with stages_view sees one row per episode with its stages', async () => {
        renderPage('teamB', [], true);
        const row = (await screen.findByRole('heading', {name: '02KU01'})).closest('li') as HTMLElement;
        expect(fetchTeamStages).toHaveBeenCalledWith('teamB');

        expect(within(row).getByText('S02 · E01')).toBeInTheDocument();
        expect(within(row).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Stage a', 'Stage b']);
        expect(within(row).getByText('1/2 stages completed')).toBeInTheDocument();
        expect(within(row).getByText('Now: Stage b')).toBeInTheDocument();
        expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
        expect(within(row).getByText('50%')).toBeInTheDocument();
        expect(within(row).getByText('No video uploaded yet')).toBeInTheDocument();

        // Channel-linked sections are episodes even without stages; a plain section without stages is not.
        expect(screen.getByRole('heading', {name: '02KU02'}).closest('li')).toHaveTextContent('No stages yet.');
        expect(screen.queryByRole('heading', {name: 'Backlog'})).toBeNull();
    });

    test('season pills and the search box filter the episodes', () => {
        renderPage('teamC', ['manage_tasks']);
        const headings = () => screen.getAllByRole('heading', {level: 2}).map((h) => h.textContent);
        expect(headings()).toEqual(['02KU01', '02KU02', '03KU01']);

        fireEvent.click(screen.getByRole('button', {name: 'S03 1'}));
        expect(headings()).toEqual(['03KU01']);
        fireEvent.click(screen.getByRole('button', {name: 'S03 1'}));

        fireEvent.change(screen.getByRole('searchbox', {name: 'Search episodes...'}), {target: {value: 'ku02'}});
        expect(headings()).toEqual(['02KU02']);
    });
});
