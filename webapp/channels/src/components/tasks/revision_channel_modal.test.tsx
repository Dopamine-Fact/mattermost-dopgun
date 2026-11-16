// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {createRevisionChannel} from 'actions/tasks';

import {renderWithContext, screen, userEvent, waitFor} from 'tests/react_testing_utils';
import {getHistory} from 'utils/browser_history';
import {TestHelper} from 'utils/test_helper';

import RevisionChannelModal from './revision_channel_modal';

jest.mock('actions/tasks', () => ({
    createRevisionChannel: jest.fn(),
}));

const state = {
    entities: {
        teams: {
            currentTeamId: 'team1',
            teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one'})},
        },
    },
};
const video = new File(['x'], 'cut.mp4', {type: 'video/mp4'});

describe('RevisionChannelModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(getHistory(), 'push').mockImplementation(() => {});
    });

    const fill = async () => {
        await userEvent.type(screen.getByLabelText('Name'), 'Trailer cut');
        await userEvent.upload(screen.getByLabelText('Video'), video);
    };

    test('needs a name and a video, then opens the new channel', async () => {
        jest.mocked(createRevisionChannel).mockReturnValue((() => Promise.resolve({data: {id: 'chan1', name: 'trailer-cut'}})) as any);
        const onExited = jest.fn();
        renderWithContext(<RevisionChannelModal onExited={onExited}/>, state);

        const create = screen.getByRole('button', {name: 'Create'});
        expect(create).toBeDisabled();
        await fill();
        expect(create).toBeEnabled();

        await userEvent.click(create);
        expect(createRevisionChannel).toHaveBeenCalledWith('team1', 'Trailer cut', video);
        await waitFor(() => expect(getHistory().push).toHaveBeenCalledWith('/team-one/channels/trailer-cut'));
    });

    test('shows why the channel could not be made', async () => {
        jest.mocked(createRevisionChannel).mockReturnValue((() => Promise.resolve({error: {message: 'A channel with that name already exists'}})) as any);
        renderWithContext(<RevisionChannelModal onExited={jest.fn()}/>, state);

        await fill();
        await userEvent.click(screen.getByRole('button', {name: 'Create'}));
        expect(await screen.findByText('A channel with that name already exists')).toBeInTheDocument();
        expect(getHistory().push).not.toHaveBeenCalled();
    });
});
