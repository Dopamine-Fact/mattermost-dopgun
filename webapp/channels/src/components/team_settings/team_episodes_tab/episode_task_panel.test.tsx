// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import React, {useState} from 'react';

import {renderWithContext, userEvent} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import type {EpisodeFolder} from './episode_folders';
import EpisodeTaskPanel from './episode_task_panel';
import type {EpisodeTask} from './episode_tasks';

const BG = 'b'.repeat(26);
const RANK = 'rk_' + 'r'.repeat(26);
const ALICE = 'a'.repeat(26);
const BOB = 'c'.repeat(26);

jest.mock('components/profile_popover/use_custom_roles', () => ({
    ...jest.requireActual('components/profile_popover/use_custom_roles'),
    useTeamDepartments: () => [
        {id: 'b'.repeat(26), name: 'BG', color: '#000', ranks: [{role_name: 'rk_' + 'r'.repeat(26)}]},
    ],
}));

const folders: EpisodeFolder[] = [{path: 'BG'}, {path: 'Mirror', mirror_of: 'BG'}, {path: 'Anim'}];

describe('EpisodeTaskPanel', () => {
    const state = {
        entities: {
            users: {
                profiles: {
                    [ALICE]: TestHelper.getUserMock({id: ALICE, username: 'alice'}),
                    [BOB]: TestHelper.getUserMock({id: BOB, username: 'bob'}),
                },
                profilesInTeam: {team_id: new Set([BOB, ALICE])},
            },
            teams: {
                membersInTeam: {
                    team_id: {
                        [ALICE]: TestHelper.getTeamMembershipMock({team_id: 'team_id', user_id: ALICE, roles: `team_user ${RANK}`}),
                        [BOB]: TestHelper.getTeamMembershipMock({team_id: 'team_id', user_id: BOB, roles: 'team_user'}),
                    },
                },
            },
        },
    };

    const setup = (list: EpisodeTask[] = []) => {
        const onChange = jest.fn();
        const Live = () => {
            const [value, setValue] = useState(list);
            return (
                <EpisodeTaskPanel
                    teamId='team_id'
                    tasks={value}
                    folders={folders}
                    onChange={(next) => {
                        onChange(next);
                        setValue(next);
                    }}
                />
            );
        };
        renderWithContext(<Live/>, state as never);
        return onChange;
    };
    const options = (select: HTMLElement) => Array.from(select.querySelectorAll('option')).map((o) => o.textContent);

    test('adding a task makes a "New task" row', async () => {
        const onChange = setup();
        await userEvent.click(screen.getByRole('button', {name: 'Add task'}));

        expect(screen.getByRole('button', {name: 'New task'})).toBeInTheDocument();
        expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({title: 'New task'})]);
    });

    test('department select lists departments; person select lists the department members first', async () => {
        const onChange = setup([{key: 'a', title: 'A'}]);
        await userEvent.click(screen.getByRole('button', {name: 'A'}));
        await userEvent.selectOptions(screen.getByLabelText('Department'), BG);

        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A', department_id: BG}]);
        expect(options(screen.getByLabelText('Department'))).toEqual(['Any department', 'BG']);
        expect(options(screen.getByLabelText('Person'))).toEqual(['Unassigned', 'alice', 'bob']);
    });

    test('days after opening accepts 0 to 365', async () => {
        const onChange = setup([{key: 'a', title: 'A'}]);
        await userEvent.click(screen.getByRole('button', {name: 'A'}));
        const input = screen.getByLabelText('Days after opening');

        await userEvent.type(input, '0');
        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A', due_days: 0}]);
        await userEvent.clear(input);
        await userEvent.type(input, '366');
        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A', due_days: 36}]);
        await userEvent.clear(input);
        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A'}]);
    });

    test('waits for lists the other tasks and disables a choice that would make a cycle', async () => {
        setup([{key: 'a', title: 'A', waits_for: ['b']}, {key: 'b', title: 'B'}, {key: 'c', title: 'C'}]);
        await userEvent.click(screen.getByRole('button', {name: 'B'}));

        expect(screen.queryByRole('checkbox', {name: 'B'})).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', {name: 'A'})).toBeDisabled();
        expect(screen.getByRole('checkbox', {name: 'C'})).toBeEnabled();
    });

    test('folder select lists own-files folders, not mirrors', async () => {
        const onChange = setup([{key: 'a', title: 'A'}]);
        await userEvent.click(screen.getByRole('button', {name: 'A'}));

        expect(options(screen.getByLabelText('Folder'))).toEqual(['No folder', 'Anim', 'BG']);
        await userEvent.selectOptions(screen.getByLabelText('Folder'), 'BG');
        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A', folder: 'BG'}]);
    });

    test('a stale folder shows as Missing folder and a dangling waits-for as Missing task', async () => {
        const onChange = setup([{key: 'a', title: 'A', folder: 'Old', waits_for: ['zz']}]);
        await userEvent.click(screen.getByRole('button', {name: 'A'}));

        expect(options(screen.getByLabelText('Folder'))).toContain('Missing folder');
        await userEvent.click(screen.getByRole('checkbox', {name: 'Missing task'}));
        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A', folder: 'Old'}]);
    });

    test('deleting a task removes it from the other tasks waits-for', async () => {
        const onChange = setup([{key: 'a', title: 'A', waits_for: ['b']}, {key: 'b', title: 'B'}]);
        await userEvent.click(screen.getByRole('button', {name: 'Delete B'}));

        expect(onChange).toHaveBeenLastCalledWith([{key: 'a', title: 'A'}]);
    });

    test('a department the team no longer has shows as Deleted department', async () => {
        setup([{key: 'a', title: 'A', department_id: 'd'.repeat(26)}]);
        await userEvent.click(screen.getByRole('button', {name: 'A'}));

        expect(options(screen.getByLabelText('Department'))).toContain('Deleted department');
    });
});
