// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Department, Rank} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import TeamDepartmentsTab from './team_departments_tab';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

const rank = (id: string, departmentId: string, name: string, position: number, permissions: string[] = [], memberIds: string[] = []): Rank => ({
    id,
    role_name: 'rk_' + id,
    team_id: 'team1',
    department_id: departmentId,
    display_name: name,
    color: '#aa0000',
    position,
    permissions,
    member_count: position + 1,
    member_ids: memberIds,
    create_at: 1,
    update_at: 1,
    delete_at: 0,
});

const department = (id: string, name: string, ranks: Rank[], isStudio = false): Department => ({
    id,
    team_id: 'team1',
    name,
    color: '#123456',
    position: isStudio ? 0 : 1,
    is_studio: isStudio,
    create_at: 1,
    update_at: 1,
    delete_at: 0,
    ranks,
});

// carol is Producer and Lead; alice and bob are Mid; dave has no rank
const departments = [
    department('s', 'Stüdyo geneli', [rank('p', 's', 'Producer', 0, [], ['u3'])], true),
    department('d1', 'Animasyon', [rank('l', 'd1', 'Lead', 0, ['manage_revisions'], ['u3']), rank('m', 'd1', 'Mid', 1, [], ['u1', 'u2'])]),
];

const people = [
    TestHelper.getUserMock({id: 'u1', username: 'alice'}),
    TestHelper.getUserMock({id: 'u2', username: 'bob'}),
    TestHelper.getUserMock({id: 'u3', username: 'carol'}),
    TestHelper.getUserMock({id: 'u4', username: 'dave'}),
    TestHelper.getUserMock({id: 'b1', username: 'robot', is_bot: true}),
    TestHelper.getUserMock({id: 'g1', username: 'guest', roles: 'system_guest'}),
    TestHelper.getUserMock({id: 'x1', username: 'gone', delete_at: 1}),
];

const rankRow = async (name: string) => (await screen.findByDisplayValue(name)).closest('li') as HTMLElement;

const team = TestHelper.getTeamMock({id: 'team1'});
const props = {
    team,
    areThereUnsavedChanges: false,
    showTabSwitchError: false,
    setAreThereUnsavedChanges: jest.fn(),
    setShowTabSwitchError: jest.fn(),
};

const renderTab = () => renderWithContext(<TeamDepartmentsTab {...props}/>);

describe('TeamDepartmentsTab', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue(departments);
        jest.spyOn(Client4, 'getProfilesInTeam').mockResolvedValue(people);
    });

    test('each rank lists the people holding it', async () => {
        renderTab();

        const mid = await rankRow('Mid');
        expect(await within(mid).findByText('alice')).toBeInTheDocument();
        expect(within(mid).getByText('bob')).toBeInTheDocument();
        expect(within(await rankRow('Lead')).getByText('carol')).toBeInTheDocument();
    });

    test('the picker offers active members who do not hold the rank', async () => {
        renderTab();

        const mid = await rankRow('Mid');
        await within(mid).findByText('alice');
        const options = within(within(mid).getByRole('combobox', {name: 'Add person to Mid'})).getAllByRole('option').slice(1);
        expect(options.map((o) => o.textContent)).toEqual(['carol', 'dave']);
    });

    test('adding a person replaces their rank in that department and keeps the others', async () => {
        const set = jest.spyOn(Client4, 'setMemberRanks').mockResolvedValue({} as never);
        renderTab();

        const mid = await rankRow('Mid');
        await within(mid).findByText('alice');
        fireEvent.change(within(mid).getByRole('combobox', {name: 'Add person to Mid'}), {target: {value: 'u3'}});

        await waitFor(() => expect(set).toHaveBeenCalledWith('team1', 'u3', ['p', 'm']));
    });

    test('removing a person takes only that rank away', async () => {
        const set = jest.spyOn(Client4, 'setMemberRanks').mockResolvedValue({} as never);
        renderTab();

        fireEvent.click(await within(await rankRow('Lead')).findByRole('button', {name: 'Remove carol from Lead'}));

        await waitFor(() => expect(set).toHaveBeenCalledWith('team1', 'u3', ['p']));
    });

    test('a refused change shows the error under the card', async () => {
        jest.spyOn(Client4, 'setMemberRanks').mockRejectedValue(new Error('You do not outrank this rank'));
        renderTab();

        fireEvent.click(await within(await rankRow('Lead')).findByRole('button', {name: 'Remove carol from Lead'}));

        expect(await screen.findByText('You do not outrank this rank')).toBeInTheDocument();
    });

    test('renders Stüdyo geneli first, without a delete button', async () => {
        renderTab();

        await waitFor(() => expect(screen.getAllByRole('textbox', {name: 'Department name'}).map((i) => (i as HTMLInputElement).value)).toEqual(['Stüdyo geneli', 'Animasyon']));
        expect(screen.queryByRole('button', {name: 'Delete Stüdyo geneli'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Delete Animasyon'})).toBeInTheDocument();
        expect(screen.getByText('2 members')).toBeInTheDocument(); // Mid
    });

    test('ticking a permission saves the rank at once', async () => {
        const patch = jest.spyOn(Client4, 'patchRank').mockResolvedValue(departments[1].ranks[0]);
        renderTab();

        fireEvent.click(await screen.findByRole('checkbox', {name: 'Tasks: Lead'}));

        await waitFor(() => expect(patch).toHaveBeenCalledWith('team1', 'l', {permissions: ['manage_revisions', 'manage_tasks']}));
    });

    test('a rejected save unticks the box and shows the error under the card', async () => {
        jest.spyOn(Client4, 'patchRank').mockRejectedValue(new Error('No permission'));
        renderTab();

        const box = await screen.findByRole('checkbox', {name: 'Tasks: Lead'});
        fireEvent.click(box);

        expect(await screen.findByText('No permission')).toBeInTheDocument();
        expect(box).not.toBeChecked();
    });

    test('"Add rank" creates a rank in that department', async () => {
        const create = jest.spyOn(Client4, 'createRank').mockResolvedValue(rank('n', 'd1', 'New rank', 2));
        renderTab();

        fireEvent.click(await screen.findByRole('button', {name: 'Add rank to Animasyon'}));

        await waitFor(() => expect(create).toHaveBeenCalledWith('team1', 'd1', {display_name: 'New rank', color: '#888888', permissions: []}));
    });

    test('a second new rank or department gets a free default name', async () => {
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue([
            ...departments,
            department('d2', 'New department', [rank('n', 'd2', 'New rank', 0)]),
        ]);
        const createRank = jest.spyOn(Client4, 'createRank').mockResolvedValue(rank('x', 'd2', 'New rank 2', 1));
        const createDepartment = jest.spyOn(Client4, 'createDepartment').mockResolvedValue(department('d3', 'New department 2', []));

        // its own team: the department cache is per team and module-wide, so team1 already holds the shorter list
        renderWithContext(
            <TeamDepartmentsTab
                {...props}
                team={TestHelper.getTeamMock({id: 'team2'})}
            />,
        );

        fireEvent.click(await screen.findByRole('button', {name: 'Add rank to New department'}));
        fireEvent.click(screen.getByRole('button', {name: 'Department'}));

        await waitFor(() => expect(createRank).toHaveBeenCalledWith('team2', 'd2', expect.objectContaining({display_name: 'New rank 2'})));
        await waitFor(() => expect(createDepartment).toHaveBeenCalledWith('team2', expect.objectContaining({name: 'New department 2'})));
    });

    test('deleting a department asks first', async () => {
        const remove = jest.spyOn(Client4, 'deleteDepartment').mockResolvedValue({status: 'OK'});
        renderTab();

        fireEvent.click(await screen.findByRole('button', {name: 'Delete Animasyon'}));
        expect(remove).not.toHaveBeenCalled();

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Delete Animasyon?')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: 'Delete'}));

        await waitFor(() => expect(remove).toHaveBeenCalledWith('team1', 'd1'));
    });

    test('the delete dialog says how many members lose a rank', async () => {
        renderTab();

        fireEvent.click(await screen.findByRole('button', {name: 'Delete Animasyon'}));
        expect(within(await screen.findByRole('dialog')).getByText(/3 members lose their rank/)).toBeInTheDocument(); // Lead 1 + Mid 2
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Cancel'}));

        fireEvent.click(screen.getByRole('button', {name: 'Delete Mid'}));
        await waitFor(() => expect(within(screen.getByRole('dialog')).getByText(/2 members lose it/)).toBeInTheDocument());
    });
});
