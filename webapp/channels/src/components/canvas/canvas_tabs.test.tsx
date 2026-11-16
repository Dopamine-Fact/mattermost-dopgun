// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import CanvasTabs from './canvas_tabs';

jest.mock('./canvas_board', () => ({
    __esModule: true,
    default: ({channelId, readOnly}: {channelId: string; readOnly: boolean}) => (
        <div>{`board ${channelId} ${readOnly ? 'readonly' : 'editable'}`}</div>
    ),
}));

const canvas = {id: 'cv1', channel_id: 'chan1', team_id: 'team1', creator_id: 'me', last_seq: 0, snapshot_seq: 0, create_at: 1, update_at: 1};

const renderTabs = ({enabled = true, url = '/team-one/channels/board', permissions = ['create_post'], deleteAt = 0} = {}) => renderWithContext(
    <CanvasTabs channelId='chan1'>
        <div>{'chat'}</div>
    </CanvasTabs>,
    {
        entities: {
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', canvas_enabled: enabled})},
                myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
            },
            channels: {
                channels: {chan1: TestHelper.getChannelMock({id: 'chan1', team_id: 'team1', delete_at: deleteAt})},
                myMembers: {chan1: TestHelper.getChannelMembershipMock({channel_id: 'chan1', user_id: 'me', roles: ''})},
            },
            roles: {roles: {team_user: TestHelper.getRoleMock({name: 'team_user', permissions})}},
        },
    },
    {history: createMemoryHistory({initialEntries: [url]})},
);

describe('CanvasTabs', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('renders the chat as before and asks nothing when the team has canvases off', () => {
        const getCanvas = jest.spyOn(Client4, 'getCanvas').mockResolvedValue(canvas);
        renderTabs({enabled: false});

        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
        expect(getCanvas).not.toHaveBeenCalled();
    });

    test('a channel that is not a canvas (404) renders the chat only', async () => {
        const getCanvas = jest.spyOn(Client4, 'getCanvas').mockRejectedValue({status_code: 404});
        renderTabs();

        await waitFor(() => expect(getCanvas).toHaveBeenCalledWith('chan1'));
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    test('shows no tab bar while the request is in flight', () => {
        jest.spyOn(Client4, 'getCanvas').mockReturnValue(new Promise(() => {}));
        renderTabs();

        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    test('a canvas channel switches between messages and the board', async () => {
        jest.spyOn(Client4, 'getCanvas').mockResolvedValue(canvas);
        renderTabs();

        expect(await screen.findByRole('tab', {name: 'Messages'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('chat')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: 'Canvas'}));
        expect(screen.queryByText('chat')).not.toBeInTheDocument();
        expect(await screen.findByText('board chan1 editable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: 'Messages'}));
        expect(screen.getByText('chat')).toBeInTheDocument();
    });

    test('?canvas=1 opens the Canvas tab', async () => {
        jest.spyOn(Client4, 'getCanvas').mockResolvedValue(canvas);
        renderTabs({url: '/team-one/channels/board?canvas=1'});

        expect(await screen.findByText('board chan1 editable')).toBeInTheDocument();
        expect(screen.getByRole('tab', {name: 'Canvas'})).toHaveAttribute('aria-selected', 'true');
    });

    test('the board is read-only without create_post', async () => {
        jest.spyOn(Client4, 'getCanvas').mockResolvedValue(canvas);
        renderTabs({url: '/team-one/channels/board?canvas=1', permissions: []});

        expect(await screen.findByText('board chan1 readonly')).toBeInTheDocument();
    });

    test('the board is read-only in an archived channel', async () => {
        jest.spyOn(Client4, 'getCanvas').mockResolvedValue(canvas);
        renderTabs({url: '/team-one/channels/board?canvas=1', deleteAt: 5});

        expect(await screen.findByText('board chan1 readonly')).toBeInTheDocument();
    });
});
