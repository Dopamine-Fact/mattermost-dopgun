// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {createEpisodeChannel} from 'actions/tasks';

import {renderWithContext, screen, userEvent, waitFor} from 'tests/react_testing_utils';
import {getHistory} from 'utils/browser_history';
import {TestHelper} from 'utils/test_helper';

import EpisodeChannelModal from './episode_channel_modal';

jest.mock('actions/tasks', () => ({
    createEpisodeChannel: jest.fn(),
}));

const state = {
    entities: {
        teams: {
            currentTeamId: 'team1',
            teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one'})},
        },
    },
};
const video = new File(['x'], 'ep1.mp4', {type: 'video/mp4'});
const created = (failed: string[]) => jest.mocked(createEpisodeChannel).mockReturnValue((() => Promise.resolve({data: {channel: {id: 'chan1', name: 'episode-1'}, failed}})) as any);

describe('EpisodeChannelModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(getHistory(), 'push').mockImplementation(() => {});
    });

    const createIt = async () => {
        await userEvent.type(screen.getByLabelText('Name'), 'Episode 1');
        await userEvent.upload(screen.getByLabelText('Video (optional)'), video);
        await userEvent.click(screen.getByRole('button', {name: 'Create'}));
    };

    test('opens the new episode channel', async () => {
        created([]);
        renderWithContext(<EpisodeChannelModal onExited={jest.fn()}/>, state);
        await createIt();
        expect(createEpisodeChannel).toHaveBeenCalledWith('team1', 'Episode 1', video);
        await waitFor(() => expect(getHistory().push).toHaveBeenCalledWith('/team-one/channels/episode-1'));
    });

    test('creates the episode without a video', async () => {
        created([]);
        renderWithContext(<EpisodeChannelModal onExited={jest.fn()}/>, state);
        await userEvent.type(screen.getByLabelText('Name'), 'Episode 1');
        await userEvent.click(screen.getByRole('button', {name: 'Create'}));
        expect(createEpisodeChannel).toHaveBeenCalledWith('team1', 'Episode 1', undefined);
        await waitFor(() => expect(getHistory().push).toHaveBeenCalledWith('/team-one/channels/episode-1'));
    });

    test('the modal shows the warning list', async () => {
        created(['Layout/Ref', 'Storyboard']);
        renderWithContext(<EpisodeChannelModal onExited={jest.fn()}/>, state);
        await createIt();

        expect(await screen.findByText('Layout/Ref')).toBeInTheDocument();
        expect(screen.getByText('Storyboard')).toBeInTheDocument();
        expect(getHistory().push).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', {name: 'Open channel'}));
        expect(getHistory().push).toHaveBeenCalledWith('/team-one/channels/episode-1');
    });

    test('shows why the channel could not be made', async () => {
        jest.mocked(createEpisodeChannel).mockReturnValue((() => Promise.resolve({error: {message: 'A channel with that name already exists'}})) as any);
        renderWithContext(<EpisodeChannelModal onExited={jest.fn()}/>, state);
        await createIt();
        expect(await screen.findByText('A channel with that name already exists')).toBeInTheDocument();
        expect(getHistory().push).not.toHaveBeenCalled();
    });
});
