// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';
import {CategoryTypes} from 'mattermost-redux/constants/channel_categories';

import {openModal} from 'actions/views/modals';
import {getDisplayedChannels} from 'selectors/views/channel_sidebar';

import MoreDirectChannels from 'components/more_direct_channels';
import {getSidebarDisplayedChannels, getVisibleSidebarCategories} from 'components/sidebar/sidebar_list';

import {fireEvent, renderWithContext, screen} from 'tests/react_testing_utils';
import {getHistory} from 'utils/browser_history';
import {ModalIdentifiers, WindowSizes} from 'utils/constants';
import {TestHelper} from 'utils/test_helper';

import type {GlobalState} from 'types/store';

import DmPanel from './dm_panel';

jest.mock('actions/views/modals', () => ({openModal: jest.fn(() => ({type: 'MOCK_OPEN_MODAL'}))}));

const mockPictureRenders = jest.fn();
jest.mock('components/profile_picture', () => ({
    __esModule: true,
    default: ({src}: {src: string}) => {
        mockPictureRenders(src);
        return null;
    },
}));

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
        views: {browser: {windowSize: WindowSizes.DESKTOP_VIEW}, channelSidebar: {unreadFilterEnabled: false}, channel: {lastUnreadChannel: null}},
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

    test('in mobile view, where the panel is not shown, the sidebar keeps the DM category', () => {
        const mobile = {...state(), views: {...state().views, browser: {windowSize: WindowSizes.MOBILE_VIEW}}};
        expect(getVisibleSidebarCategories(mobile as unknown as GlobalState).map((c) => c.id)).toEqual(['chcat', 'dmcat']);
    });

    test('keeps open DMs with bots and deactivated users', () => {
        const s = state();
        (s.entities.channels as {channels: Record<string, Channel>}).channels = {
            ...s.entities.channels.channels,
            dmr: TestHelper.getChannelMock({id: 'dmr', name: 'me__robot', type: 'D', teammate_id: 'robot'}),
            dmg: TestHelper.getChannelMock({id: 'dmg', name: 'gone__me', type: 'D', teammate_id: 'gone'}),
        };
        s.entities.channels.channelsInTeam[''] = new Set(['dmc', 'g1', 'dme', 'dmr', 'dmg']);
        s.entities.channelCategories.byId.dmcat.channel_ids = ['g1', 'dmc', 'dme', 'dmr', 'dmg'];
        renderWithContext(<DmPanel/>, s);
        expect(rowNames()).toEqual(expect.arrayContaining(['robot', 'gone']));
        expect(rowNames().filter((n) => n === 'robot' || n === 'gone')).toHaveLength(2);
    });

    test('the sidebar leaves the DMs it hides out of keyboard navigation, but not unread ones shown under Unreads', () => {
        const withChannel = (showPanel?: string, unreadsSection = false) => {
            const s = state(showPanel);
            (s.entities.channels as {channels: Record<string, Channel>}).channels.pub = TestHelper.getChannelMock({id: 'pub', name: 'pub', type: 'O', team_id: 't1'});
            (s.entities.channels.channelsInTeam as Record<string, Set<string>>).t1 = new Set(['pub']);
            (s.entities.channels.myMembers as Record<string, unknown>).pub = TestHelper.getChannelMembershipMock({channel_id: 'pub', msg_count: 1});
            (s.entities.channels.messageCounts as Record<string, unknown>).pub = {total: 1, root: 1};
            (s.entities.channelCategories.byId.chcat.channel_ids as string[]) = ['pub'];
            if (unreadsSection) {
                (s.entities.preferences.myPreferences as Record<string, unknown>)['sidebar_settings--show_unread_section'] = {category: 'sidebar_settings', name: 'show_unread_section', user_id: 'me', value: 'true'};
            }
            return s as unknown as GlobalState;
        };
        const ids = (s: GlobalState) => getSidebarDisplayedChannels(s).map((c) => c.id);

        const off = withChannel('false');
        expect(getSidebarDisplayedChannels(off)).toBe(getDisplayedChannels(off));
        expect(ids(off)).toEqual(expect.arrayContaining(['pub', 'dmc']));
        expect(ids(withChannel())).toEqual(['pub']);
        expect(ids(withChannel(undefined, true)).sort()).toEqual(['dmc', 'pub']);
    });
    test('the + button opens the new direct or group message dialog', () => {
        renderWithContext(<DmPanel/>, state());
        fireEvent.click(screen.getByRole('button', {name: 'Write a direct message'}));
        expect(openModal).toHaveBeenCalledWith(expect.objectContaining({
            modalId: ModalIdentifiers.CREATE_DM_CHANNEL,
            dialogType: MoreDirectChannels,
            dialogProps: expect.objectContaining({isExistingChannel: false}),
        }));
    });

    test('a status change re-renders only the row of the person whose status changed', () => {
        const {updateStoreState} = renderWithContext(<DmPanel/>, state());
        mockPictureRenders.mockClear();
        updateStoreState({entities: {users: {statuses: {alice: 'dnd'}}}});
        expect(mockPictureRenders.mock.calls.map(([src]) => src.split('/')[4])).toEqual(['alice']);
    });
});
