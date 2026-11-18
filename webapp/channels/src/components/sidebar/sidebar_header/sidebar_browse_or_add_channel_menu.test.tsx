// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {renderWithContext, screen, userEvent} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import SidebarBrowseOrAddChannelMenu from './sidebar_browse_or_add_channel_menu';

describe('SidebarBrowseOrAddChannelMenu', () => {
    const props = {
        canCreateChannel: true,
        onCreateNewChannelClick: jest.fn(),
        canJoinPublicChannel: true,
        onBrowseChannelClick: jest.fn(),
        onOpenDirectMessageClick: jest.fn(),
        canCreateCustomGroups: true,
        onCreateNewUserGroupClick: jest.fn(),
        unreadFilterEnabled: false,
        onCreateNewCategoryClick: jest.fn(),
        onInvitePeopleClick: jest.fn(),
    };

    const stateWithPluginItems = (items: Array<{id: string; text: string; placement?: 'default' | 'afterCreateChannel'}>) => ({
        entities: {
            teams: {currentTeamId: 'team_id'},
        },
        plugins: {
            components: {
                SidebarBrowseOrAddChannelMenu: items.map((item) => ({
                    ...item,
                    pluginId: 'plugin_id',
                    action: jest.fn(),
                    icon: null,
                })),
            },
        },
    });

    async function menuItemIds(items: Parameters<typeof stateWithPluginItems>[0]) {
        renderWithContext(<SidebarBrowseOrAddChannelMenu {...props}/>, stateWithPluginItems(items));
        await userEvent.click(screen.getByRole('button', {name: 'Browse or create channels'}));
        return screen.getAllByRole('menuitem').map((item) => item.id);
    }

    test('offers "Create revision channel" only when the team has revisions on and the user manages revisions', async () => {
        const state = (revisionsEnabled: boolean, permissions: string[]) => ({
            entities: {
                users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                teams: {
                    currentTeamId: 'team_id',
                    teams: {team_id: TestHelper.getTeamMock({id: 'team_id', tasks_enabled: true, revisions_enabled: revisionsEnabled})},
                    myMembers: {team_id: TestHelper.getTeamMembershipMock({team_id: 'team_id', user_id: 'me', roles: 'team_user'})},
                },
                roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
            },
        });
        const open = async (s: ReturnType<typeof state>) => {
            const {unmount} = renderWithContext(<SidebarBrowseOrAddChannelMenu {...props}/>, s);
            await userEvent.click(screen.getByRole('button', {name: 'Browse or create channels'}));
            const shown = Boolean(screen.queryByRole('menuitem', {name: 'Create revision channel'}));
            unmount();
            return shown;
        };

        expect(await open(state(true, ['manage_revisions']))).toBe(true);
        expect(await open(state(false, ['manage_revisions']))).toBe(false);
        expect(await open(state(true, ['manage_tasks']))).toBe(false);
        expect(await open(state(true, []))).toBe(false);
    });

    test('offers "Create canvas channel" only when the team has canvases on and the user can create public channels', async () => {
        const state = (canvasEnabled: boolean, permissions: string[]) => ({
            entities: {
                users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                teams: {
                    currentTeamId: 'team_id',
                    teams: {team_id: TestHelper.getTeamMock({id: 'team_id', canvas_enabled: canvasEnabled})},
                    myMembers: {team_id: TestHelper.getTeamMembershipMock({team_id: 'team_id', user_id: 'me', roles: 'team_user'})},
                },
                roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
            },
        });
        const open = async (s: ReturnType<typeof state>) => {
            const {unmount} = renderWithContext(<SidebarBrowseOrAddChannelMenu {...props}/>, s);
            await userEvent.click(screen.getByRole('button', {name: 'Browse or create channels'}));
            const shown = Boolean(screen.queryByRole('menuitem', {name: 'Create canvas channel'}));
            unmount();
            return shown;
        };

        expect(await open(state(true, ['create_public_channel']))).toBe(true);
        expect(await open(state(false, ['create_public_channel']))).toBe(false);
        expect(await open(state(true, []))).toBe(false);
    });

    test('the episode menu item needs all four toggles and both permissions', async () => {
        const all = {tasks_enabled: true, revisions_enabled: true, canvas_enabled: true, files_enabled: true};
        const state = (toggles: Partial<typeof all>, permissions: string[]) => ({
            entities: {
                users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
                teams: {
                    currentTeamId: 'team_id',
                    teams: {team_id: TestHelper.getTeamMock({id: 'team_id', ...all, ...toggles})},
                    myMembers: {team_id: TestHelper.getTeamMembershipMock({team_id: 'team_id', user_id: 'me', roles: 'team_user'})},
                },
                roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
            },
        });
        const open = async (s: ReturnType<typeof state>) => {
            const {unmount} = renderWithContext(<SidebarBrowseOrAddChannelMenu {...props}/>, s);
            await userEvent.click(screen.getByRole('button', {name: 'Browse or create channels'}));
            const shown = Boolean(screen.queryByRole('menuitem', {name: 'Create episode channel'}));
            unmount();
            return shown;
        };
        const both = ['manage_revisions', 'manage_tasks'];

        expect(await open(state({}, both))).toBe(true);
        for (const off of Object.keys(all)) {
            // eslint-disable-next-line no-await-in-loop
            expect(await open(state({[off]: false}, both))).toBe(false);
        }
        expect(await open(state({}, ['manage_revisions']))).toBe(false);
        expect(await open(state({}, ['manage_tasks']))).toBe(false);
    });

    test('lists a plugin item after the built-in items by default', async () => {
        const ids = await menuItemIds([{id: 'default_item', text: 'Default item'}]);

        expect(ids.indexOf('default_item_pluginmenuitem')).toBe(ids.indexOf('createUserGroupMenuItem') + 1);
    });

    test('lists a plugin item placed afterCreateChannel second, right below "Create new channel"', async () => {
        const ids = await menuItemIds([
            {id: 'default_item', text: 'Default item'},
            {id: 'create_item', text: 'Create item', placement: 'afterCreateChannel'},
        ]);

        expect(ids.slice(0, 3)).toEqual(['createNewChannelMenuItem', 'create_item_pluginmenuitem', 'browseChannelsMenuItem']);
        expect(ids.indexOf('default_item_pluginmenuitem')).toBe(ids.indexOf('createUserGroupMenuItem') + 1);
    });
});
