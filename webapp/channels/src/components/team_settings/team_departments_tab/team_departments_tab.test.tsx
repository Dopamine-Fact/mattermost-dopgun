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

const rank = (id: string, departmentId: string, name: string, position: number, permissions: string[] = []): Rank => ({
    id,
    role_name: 'rk_' + id,
    team_id: 'team1',
    department_id: departmentId,
    display_name: name,
    color: '#aa0000',
    position,
    permissions,
    member_count: position + 1,
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

const departments = [
    department('s', 'Stüdyo geneli', [rank('p', 's', 'Producer', 0)], true),
    department('d1', 'Animasyon', [rank('l', 'd1', 'Lead', 0, ['manage_revisions']), rank('m', 'd1', 'Mid', 1)]),
];

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
});
