// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {Client4} from 'mattermost-redux/client';

import mockStore from 'tests/test_store';

import {createCanvasChannel} from './canvas';

jest.mock('mattermost-redux/actions/channels', () => ({
    createChannel: jest.fn((channel) => () => Promise.resolve({data: {...channel, id: 'chan1'}})),
    deleteChannel: jest.fn(() => () => Promise.resolve({data: true})),
}));

const canvas = {id: 'cv1', channel_id: 'chan1', team_id: 'team1', creator_id: 'me', last_seq: 0, snapshot_seq: 0, create_at: 1, update_at: 1};

describe('createCanvasChannel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const store = () => mockStore({entities: {users: {currentUserId: 'me'}}});

    test('creates a public channel and turns it into a canvas', async () => {
        jest.spyOn(Client4, 'createCanvas').mockResolvedValue(canvas);
        const result = await store().dispatch(createCanvasChannel('team1', 'Sketches'));

        expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({team_id: 'team1', name: 'sketches', display_name: 'Sketches', type: 'O'}), 'me');
        expect(Client4.createCanvas).toHaveBeenCalledWith('team1', 'chan1');
        expect(result.data?.id).toBe('chan1');
        expect(deleteChannel).not.toHaveBeenCalled();
    });

    test('a name with no url-safe characters still gets a channel name', async () => {
        jest.spyOn(Client4, 'createCanvas').mockResolvedValue(canvas);
        await store().dispatch(createCanvasChannel('team1', '!!'));
        expect(jest.mocked(createChannel).mock.calls[0][0].name).toMatch(/^[a-f0-9-]{36}$/);
    });

    test('a refused canvas removes the channel', async () => {
        jest.spyOn(Client4, 'createCanvas').mockRejectedValue(new Error('forbidden'));
        const result = await store().dispatch(createCanvasChannel('team1', 'Sketches'));

        expect(result.error).toBeTruthy();
        expect(deleteChannel).toHaveBeenCalledWith('chan1');
    });
});
