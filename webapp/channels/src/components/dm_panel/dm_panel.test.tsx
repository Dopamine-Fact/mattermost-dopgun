// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {Client4} from 'mattermost-redux/client';
import {CategoryTypes} from 'mattermost-redux/constants/channel_categories';

import {getVisibleSidebarCategories} from 'components/sidebar/sidebar_list';

import {fireEvent, renderWithContext, screen} from 'tests/react_testing_utils';
import {getHistory} from 'utils/browser_history';
import {TestHelper} from 'utils/test_helper';

import type {GlobalState} from 'types/store';

import DmPanel from './dm_panel';

jest.mock('utils/browser_history', () => {
    const history = {push: jest.fn()};
    return {getHistory: () => history};
});

const user = (id: string, extra = {}) => TestHelper.getUserMock({id, username: id, ...extra});
const profiles = {
    me: user('me'),
    alice: user('alice'),
    bob: user('bob'),
    carol: user('carol'),
    dave: user('dave'),
    robot: user('robot', {is_bot: true}),
    gone: user('gone', {delete_at: 1}),
    erin: user('erin'),
};

function state(showPanel?: string) {
    return {
        entities: {
            general: {config: {}},
            teams: {currentTeamId: 't1', teams: {t1: TestHelper.getTeamMock({id: 't1', name: 'team'})}},
            users: {
                currentUserId: 'me',
                profiles,
                profilesInTeam: {t1: new Set(Object.keys(profiles).filter((id) => id !== 'erin'))},
                statuses: {alice: 'online', bob: 'offline', carol: 'offline', dave: 'away', robot: 'online', gone: 'online'},
            },
            channels: {
                channelsInTeam: {'': new Set(['dmc', 'g1', 'dme'])},
                channels: {
                    dmc: TestHelper.getChannelMock({id: 'dmc', name: 'carol__me', type: 'D', teammate_id: 'carol'}),
                    dme: TestHelper.getChannelMock({id: 'dme', name: 'erin__me', type: 'D', teammate_id: 'erin'}),
                    g1: TestHelper.getChannelMock({id: 'g1', name: 'g1name', type: 'G', display_name: 'yan, zed'}),
                },
                myMembers: {
                    dmc: TestHelper.getChannelMembershipMock({channel_id: 'dmc', msg_count: 2, mention_count: 1}),
                    g1: TestHelper.getChannelMembershipMock({channel_id: 'g1', msg_count: 1}),
                },
                messageCounts: {dmc: {total: 5, root: 5}, g1: {total: 1, root: 1}},
            },
            channelCategories: {
                byId: {
                    dmcat: {id: 'dmcat', team_id: 't1', type: CategoryTypes.DIRECT_MESSAGES, display_name: 'Direct Messages', channel_ids: ['g1', 'dmc', 'dme']},
                    chcat: {id: 'chcat', team_id: 't1', type: CategoryTypes.CHANNELS, display_name: 'Channels', channel_ids: []},
                },
                orderByTeam: {t1: ['chcat', 'dmcat']},
            },
            preferences: {
                myPreferences: showPanel === undefined ? {} : {'sidebar_settings--show_dm_panel': {category: 'sidebar_settings', name: 'show_dm_panel', user_id: 'me', value: showPanel}},
            },
        },
    };
}

describe('DmPanel', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'getProfilesInTeam').mockResolvedValue([]);
        jest.spyOn(Client4, 'getStatusesByIds').mockResolvedValue([]);
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue([]);
        localStorage.clear();
    });
    afterEach(() => jest.restoreAllMocks());

    const rowNames = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.DmPanel__name')?.textContent);

    test('lists group DMs, then unread, then online/away/dnd, then offline, skipping bots, deactivated users and self', () => {
        renderWithContext(<DmPanel/>, state());
        expect(rowNames()).toEqual(['yan, zed', 'carol', 'alice', 'dave', 'bob', 'erin']);
    });

    test('keeps an open DM with someone outside the team', () => {
        renderWithContext(<DmPanel/>, state());
        expect(rowNames()).toContain('erin');
    });

    test('clicking a person opens the direct message', () => {
        renderWithContext(<DmPanel/>, state());
        fireEvent.click(screen.getByText('alice'));
        expect(getHistory().push).toHaveBeenCalledWith('/team/messages/@alice');
    });

    test('collapsing hides the list and is remembered', () => {
        const {unmount} = renderWithContext(<DmPanel/>, state());
        fireEvent.click(screen.getByRole('button', {name: 'Collapse direct messages'}));
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(localStorage.getItem('dm_panel_collapsed')).toBe('true');
        unmount();

        renderWithContext(<DmPanel/>, state());
        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByRole('button', {name: 'Expand direct messages'})).toBeInTheDocument();
    });

    test('with the setting off, the panel is empty and the sidebar keeps the DM category', () => {
        const {container} = renderWithContext(<DmPanel/>, state('false'));
        expect(container).toBeEmptyDOMElement();
        expect(getVisibleSidebarCategories(state('false') as unknown as GlobalState).map((c) => c.id)).toEqual(['chcat', 'dmcat']);
        expect(getVisibleSidebarCategories(state() as unknown as GlobalState).map((c) => c.id)).toEqual(['chcat']);
    });
});
