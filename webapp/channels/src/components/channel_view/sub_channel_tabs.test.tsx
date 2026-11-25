// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {switchToChannel} from 'actions/views/channel';

import {renderWithContext, screen, userEvent} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import SubChannelTabs from './sub_channel_tabs';

jest.mock('actions/views/channel', () => ({
    switchToChannel: jest.fn((channel) => ({type: 'SWITCH_TO_CHANNEL', channel})),
}));

describe('SubChannelTabs', () => {
    const parent = TestHelper.getChannelMock({id: 'parent', team_id: 'team1', display_name: 'Parent', delete_at: 0});
    const subB = TestHelper.getChannelMock({id: 'subB', team_id: 'team1', display_name: 'Beta', delete_at: 0, parent_id: 'parent'});
    const subA = TestHelper.getChannelMock({id: 'subA', team_id: 'team1', display_name: 'Alpha', delete_at: 0, parent_id: 'parent'});
    const lonely = TestHelper.getChannelMock({id: 'lonely', team_id: 'team1', display_name: 'Lonely', delete_at: 0});

    const state = {
        entities: {
            channels: {
                channels: {parent, subA, subB, lonely},
                channelsInTeam: {team1: new Set(['parent', 'subA', 'subB', 'lonely'])},
                myMembers: {
                    parent: TestHelper.getChannelMembershipMock({channel_id: 'parent'}),
                    subA: TestHelper.getChannelMembershipMock({channel_id: 'subA'}),
                    subB: TestHelper.getChannelMembershipMock({channel_id: 'subB'}),
                    lonely: TestHelper.getChannelMembershipMock({channel_id: 'lonely'}),
                },
            },
            teams: {currentTeamId: 'team1'},
        },
    };

    test('shows the parent and its sub-channels, and switches channel on click', async () => {
        renderWithContext(<SubChannelTabs channelId='parent'/>, state);

        const tabs = screen.getAllByRole('button');
        expect(tabs.map((t) => t.textContent)).toEqual(['Parent', 'Alpha', 'Beta']);
        expect(screen.getByRole('button', {name: 'Parent'})).toHaveAttribute('aria-current', 'page');

        await userEvent.click(screen.getByRole('button', {name: 'Beta'}));
        expect(switchToChannel).toHaveBeenCalledWith(expect.objectContaining({id: 'subB'}));
    });

    test('highlights the sub-channel when inside it', () => {
        renderWithContext(<SubChannelTabs channelId='subA'/>, state);

        expect(screen.getAllByRole('button')).toHaveLength(3);
        expect(screen.getByRole('button', {name: 'Alpha'})).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', {name: 'Parent'})).not.toHaveAttribute('aria-current');
    });

    test('renders nothing for a channel without sub-channels', () => {
        renderWithContext(<SubChannelTabs channelId='lonely'/>, state);

        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });
});
