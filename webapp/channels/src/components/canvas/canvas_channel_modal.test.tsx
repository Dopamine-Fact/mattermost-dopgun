// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {createCanvasChannel} from 'actions/canvas';

import {renderWithContext, screen, userEvent, waitFor} from 'tests/react_testing_utils';
import {getHistory} from 'utils/browser_history';
import {TestHelper} from 'utils/test_helper';

import CanvasChannelModal from './canvas_channel_modal';

jest.mock('actions/canvas', () => ({
    createCanvasChannel: jest.fn(),
}));

const state = {
    entities: {
        teams: {
            currentTeamId: 'team1',
            teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one'})},
        },
    },
};

describe('CanvasChannelModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(getHistory(), 'push').mockImplementation(() => {});
    });

    test('needs a name, then opens the new channel on its Canvas tab', async () => {
        jest.mocked(createCanvasChannel).mockReturnValue((() => Promise.resolve({data: {id: 'chan1', name: 'sketches'}})) as any);
        renderWithContext(<CanvasChannelModal onExited={jest.fn()}/>, state);

        const create = screen.getByRole('button', {name: 'Create'});
        expect(create).toBeDisabled();
        await userEvent.type(screen.getByLabelText('Name'), 'Sketches');
        expect(create).toBeEnabled();

        await userEvent.click(create);
        expect(createCanvasChannel).toHaveBeenCalledWith('team1', 'Sketches');
        await waitFor(() => expect(getHistory().push).toHaveBeenCalledWith('/team-one/channels/sketches?canvas=1'));
    });

    test('shows why the channel could not be made', async () => {
        jest.mocked(createCanvasChannel).mockReturnValue((() => Promise.resolve({error: {message: 'A channel with that name already exists'}})) as any);
        renderWithContext(<CanvasChannelModal onExited={jest.fn()}/>, state);

        await userEvent.type(screen.getByLabelText('Name'), 'Sketches');
        await userEvent.click(screen.getByRole('button', {name: 'Create'}));
        expect(await screen.findByText('A channel with that name already exists')).toBeInTheDocument();
        expect(getHistory().push).not.toHaveBeenCalled();
    });
});
