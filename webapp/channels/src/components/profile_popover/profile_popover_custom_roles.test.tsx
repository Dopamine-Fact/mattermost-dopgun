// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {CustomRole} from '@mattermost/types/custom_roles';
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

const role = (id: string, name: string, position: number, department = ''): CustomRole => ({
    id,
    role_name: 'cr_' + id,
    display_name: name,
    color: '#00aa' + position + position,
    position,
    department,
    permissions: [],
    create_at: 1,
    update_at: 1,
    delete_at: 0,
});

// Producer > Lead Animator > Animator; Lead Modeler ranks above Animator but in another department.
const producer = role('p', 'Producer', 0);
const leadAnim = role('l', 'Lead Animator', 1, 'Animation');
const leadModel = role('m', 'Lead Modeler', 2, 'Modeling');
const anim = role('a', 'Animator', 3, 'Animation');
const modeler = role('o', 'Modeler', 4, 'Modeling');

// The session cache loads once for the whole file, so every test shares this list.
jest.spyOn(Client4, 'getCustomRoles').mockResolvedValue([modeler, anim, producer, leadModel, leadAnim]);

const viewer = TestHelper.getUserMock({id: 'viewer', roles: 'system_user cr_l'});

const stateFor = (current: UserProfile, viewerPermissions: string[] = []) => ({
    entities: {
        users: {
            currentUserId: current.id,
            profiles: {[current.id]: current},
        },
        roles: {
            roles: {
                system_user: {id: 'system_user', name: 'system_user', permissions: []},
                cr_l: {id: 'cr_l', name: 'cr_l', permissions: viewerPermissions},
            },
        },
    },
});

const chipNames = () => screen.queryAllByTestId('customRoleChip').map((c) => c.textContent);

describe('ProfilePopoverCustomRoles', () => {
    test('shows a chip per role, in rank order, with its color', async () => {
        const target = TestHelper.getUserMock({id: 'target', roles: 'system_user cr_a cr_p'});
        renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer));

        await waitFor(() => expect(chipNames()).toEqual(['Producer', 'Animator']));
        expect(screen.getAllByTestId('customRoleChip')[1].querySelector('.custom-role-chip__dot')).toHaveStyle({backgroundColor: anim.color});
    });

    test('shows nothing for a user without roles when the viewer cannot assign', async () => {
        const target = TestHelper.getUserMock({id: 'target', roles: 'system_user'});
        const {container} = renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer));

        await act(async () => {}); // let the cached role list resolve
        expect(container).toBeEmptyDOMElement();
    });

    test('"Edit roles" needs the assign roles permission', async () => {
        const target = TestHelper.getUserMock({id: 'target', roles: 'system_user cr_a'});
        const {unmount} = renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer));
        await waitFor(() => expect(chipNames()).toEqual(['Animator']));
        expect(screen.queryByRole('button', {name: 'Edit roles'})).not.toBeInTheDocument();
        unmount();

        renderWithContext(<ProfilePopoverCustomRoles user={target}/>, stateFor(viewer, ['assign_custom_roles']));
        expect(await screen.findByRole('button', {name: 'Edit roles'})).toBeInTheDocument();
    });
});

describe('CustomRolesEditModal', () => {
    const boxes = (modal: HTMLElement) => within(modal).getAllByRole('checkbox').map((b) => ({
        name: b.closest('label')!.textContent,
        checked: (b as HTMLInputElement).checked,
        disabled: (b as HTMLInputElement).disabled,
    }));

    test('offers only roles the viewer outranks, keeps the others, and saves', async () => {
        const target = TestHelper.getUserMock({id: 'target', roles: 'system_user cr_m cr_a'});
        const saved = {...target, roles: 'system_user cr_m'};
        const set = jest.spyOn(Client4, 'setUserCustomRoles').mockResolvedValue(saved);
        const onExited = jest.fn();
        const {store} = renderWithContext(
            <CustomRolesEditModal
                user={target}
                onExited={onExited}
            />,
            stateFor(viewer, ['assign_custom_roles']),
            {useMockedStore: true},
        );

        const modal = await screen.findByRole('dialog');
        await waitFor(() => expect(within(modal).getAllByRole('checkbox')).toHaveLength(2));

        // Lead Animator gives Animator (same department) only; the held Lead Modeler shows but is locked.
        expect(boxes(modal)).toEqual([
            {name: 'Lead Modeler', checked: true, disabled: true},
            {name: 'Animator', checked: true, disabled: false},
        ]);

        fireEvent.click(within(modal).getByRole('checkbox', {name: 'Animator'}));
        fireEvent.click(within(modal).getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(set).toHaveBeenCalledWith('target', ['m']));
        await waitFor(() => expect(onExited).toHaveBeenCalled());
        expect((store as unknown as {getActions: () => unknown[]}).getActions()).toContainEqual(expect.objectContaining({data: saved}));
    });

    test('system admins may give every role', async () => {
        const admin = TestHelper.getUserMock({id: 'admin', roles: 'system_user system_admin'});
        const target = TestHelper.getUserMock({id: 'target', roles: 'system_user'});
        renderWithContext(
            <CustomRolesEditModal
                user={target}
                onExited={jest.fn()}
            />,
            stateFor(admin),
        );

        const modal = await screen.findByRole('dialog');
        await waitFor(() => expect(boxes(modal).map((b) => b.name)).toEqual(['Producer', 'Lead Animator', 'Lead Modeler', 'Animator', 'Modeler']));
        expect(boxes(modal).every((b) => !b.checked && !b.disabled)).toBe(true);
    });
});
