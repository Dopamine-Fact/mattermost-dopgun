// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Department, Rank} from '@mattermost/types/custom_roles';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';

import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import CustomRolesEditModal from './custom_roles_edit_modal';
import ProfilePopoverCustomRoles from './profile_popover_custom_roles';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

const rank = (id: string, departmentId: string, name: string, position: number): Rank => ({
    id,
    role_name: 'rk_' + id,
    team_id: 'team1',
    department_id: departmentId,
    display_name: name,
    color: '#00aa' + position + position,
    position,
    permissions: [],
    member_count: 0,
    member_ids: [],
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

const producer = rank('p', 's', 'Producer', 0);
const lead = rank('l', 'd1', 'Lead', 0);
const anim = rank('a', 'd1', 'Animator', 1);
const leadModel = rank('m', 'd2', 'Lead Modeler', 0);
const modeler = rank('o', 'd2', 'Modeler', 1);
const departments = [
    department('s', 'Stüdyo geneli', [producer], true),
    department('d1', 'Animasyon', [lead, anim]),
    department('d2', 'Modelleme', [leadModel, modeler]),
];

// The per-team cache loads once for the whole file, so every test shares this list.
jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue(departments);

const viewer = TestHelper.getUserMock({id: 'viewer', roles: 'system_user'});

const stateFor = (current: UserProfile, targetRanks: string, viewerPermissions: string[] = []) => ({
    entities: {
        users: {
            currentUserId: current.id,
            profiles: {[current.id]: current},
        },
        teams: {
            currentTeamId: 'team1',
            teams: {team1: TestHelper.getTeamMock({id: 'team1'})},
            myMembers: {team1: {team_id: 'team1', user_id: current.id, roles: 'team_user rk_l'}},
            membersInTeam: {team1: {target: {team_id: 'team1', user_id: 'target', roles: 'team_user ' + targetRanks}}},
        },
        roles: {
            roles: {
                system_user: {id: 'system_user', name: 'system_user', permissions: []},
                team_user: {id: 'team_user', name: 'team_user', permissions: []},
                rk_l: {id: 'rk_l', name: 'rk_l', permissions: viewerPermissions},
            },
        },
    },
});

const chipNames = () => screen.queryAllByTestId('customRoleChip').map((c) => c.textContent);
const target = TestHelper.getUserMock({id: 'target', roles: 'system_user'});

describe('ProfilePopoverCustomRoles', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'getAssignableRanks').mockResolvedValue([]);
    });

    test('shows a Department · Rank chip per held rank, in department order, with its color', async () => {
        renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer, 'rk_o rk_l'));

        await waitFor(() => expect(chipNames()).toEqual(['Animasyon · Lead', 'Modelleme · Modeler']));
        expect(screen.getAllByTestId('customRoleChip')[1].querySelector('.custom-role-chip__dot')).toHaveStyle({backgroundColor: modeler.color});
    });

    test('shows nothing for a member without ranks when the viewer cannot assign', async () => {
        const {container} = renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer, ''));

        await act(async () => {}); // let the cached department list resolve
        expect(container).toBeEmptyDOMElement();
        expect(Client4.getAssignableRanks).not.toHaveBeenCalled();
    });

    test('"Edit ranks" needs the permission and at least one assignable rank', async () => {
        const {unmount} = renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer, 'rk_a', ['assign_custom_roles']));
        await waitFor(() => expect(chipNames()).toEqual(['Animasyon · Animator']));
        await waitFor(() => expect(Client4.getAssignableRanks).toHaveBeenCalledWith('team1', 'target'));
        expect(screen.queryByRole('button', {name: 'Edit ranks'})).not.toBeInTheDocument();
        unmount();

        jest.spyOn(Client4, 'getAssignableRanks').mockResolvedValue(['a']);
        renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer, 'rk_a', ['assign_custom_roles']));
        expect(await screen.findByRole('button', {name: 'Edit ranks'})).toBeInTheDocument();
    });

    test('nobody but a system admin edits their own ranks', async () => {
        jest.spyOn(Client4, 'getAssignableRanks').mockResolvedValue(['a']);
        const me = TestHelper.getUserMock({id: 'target', roles: 'system_user'});
        renderWithContext(<ProfilePopoverCustomRoles user={me}/>, stateFor(me, 'rk_a', ['assign_custom_roles']));

        await waitFor(() => expect(chipNames()).toEqual(['Animasyon · Animator']));
        expect(screen.queryByRole('button', {name: 'Edit ranks'})).not.toBeInTheDocument();
        expect(Client4.getAssignableRanks).not.toHaveBeenCalled();
    });
});

describe('CustomRolesEditModal', () => {
    const selects = (modal: HTMLElement) => within(modal).getAllByRole('combobox').map((s) => ({
        name: s.getAttribute('aria-label'),
        value: (s as HTMLSelectElement).value,
        disabled: (s as HTMLSelectElement).disabled,
        options: Array.from((s as HTMLSelectElement).options).map((o) => o.text + (o.disabled ? ' (locked)' : '')),
    }));

    test('one select per department; locks what the viewer may not give; saves every rank', async () => {
        const saved = {team_id: 'team1', user_id: 'target', roles: 'team_user rk_m'};
        const set = jest.spyOn(Client4, 'setMemberRanks').mockResolvedValue(saved as never);
        const onExited = jest.fn();
        const {store} = renderWithContext(
            <CustomRolesEditModal
                user={target}
                teamId='team1'
                assignable={['a']}
                onExited={onExited}
            />,
            stateFor(viewer, 'rk_m rk_a', ['assign_custom_roles']),
            {useMockedStore: true},
        );

        const modal = await screen.findByRole('dialog');
        await waitFor(() => expect(within(modal).getAllByRole('combobox')).toHaveLength(3));

        expect(selects(modal)).toEqual([
            {name: 'Stüdyo geneli', value: '', disabled: false, options: ['—', 'Producer (locked)']},
            {name: 'Animasyon', value: 'a', disabled: false, options: ['—', 'Lead (locked)', 'Animator']},
            {name: 'Modelleme', value: 'm', disabled: true, options: ['—', 'Lead Modeler (locked)', 'Modeler (locked)']},
        ]);

        fireEvent.change(within(modal).getByRole('combobox', {name: 'Animasyon'}), {target: {value: ''}});
        fireEvent.click(within(modal).getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(set).toHaveBeenCalledWith('team1', 'target', ['m']));
        await waitFor(() => expect(onExited).toHaveBeenCalled());
        expect((store as unknown as {getActions: () => unknown[]}).getActions()).toContainEqual(expect.objectContaining({data: saved}));
    });
});
