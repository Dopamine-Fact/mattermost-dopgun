// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {Client4} from 'mattermost-redux/client';

import mockStore from 'tests/test_store';

import {createRevisionChannel} from './tasks';

jest.mock('mattermost-redux/actions/channels', () => ({
    createChannel: jest.fn((channel) => () => Promise.resolve({data: {...channel, id: 'chan1'}})),
    deleteChannel: jest.fn(() => () => Promise.resolve({data: true})),
}));

const section = {id: 'sec1', team_id: 'team1', name: 'Trailer cut', sort_order: 0, channel_id: 'chan1', video_file_id: '', create_at: 1, update_at: 1};
const video = new File(['x'], 'cut.mp4', {type: 'video/mp4'});

describe('createRevisionChannel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Client4, 'createTaskSection').mockResolvedValue(section);
        jest.spyOn(Client4, 'setTaskSectionVideo').mockResolvedValue({...section, video_file_id: 'file1'});
        jest.spyOn(Client4, 'deleteTaskSection').mockResolvedValue({status: 'OK'});
    });

    const store = () => mockStore({entities: {users: {currentUserId: 'me'}}, websocket: {connectionId: 'conn1'}});

    test('creates a public channel, links a revision list to it and uploads the video', async () => {
        const result = await store().dispatch(createRevisionChannel('team1', 'Trailer cut', video));

        expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({team_id: 'team1', name: 'trailer-cut', display_name: 'Trailer cut', type: 'O'}), 'me');
        expect(Client4.createTaskSection).toHaveBeenCalledWith({team_id: 'team1', name: 'Trailer cut', channel_id: 'chan1'}, 'conn1');
        expect(Client4.setTaskSectionVideo).toHaveBeenCalledWith('sec1', video, expect.anything());
        expect(result.data?.id).toBe('chan1');
    });

    test('a name with no url-safe characters still gets a channel name', async () => {
        await store().dispatch(createRevisionChannel('team1', '!!', video));
        expect(jest.mocked(createChannel).mock.calls[0][0].name).toMatch(/^[a-f0-9-]{36}$/);
    });

    test('a failed upload removes the revision list and the channel', async () => {
        jest.spyOn(Client4, 'setTaskSectionVideo').mockRejectedValue(new Error('not a video'));
        const result = await store().dispatch(createRevisionChannel('team1', 'Trailer cut', video));

        expect(result.error).toBeTruthy();
        expect(Client4.deleteTaskSection).toHaveBeenCalledWith('sec1', expect.anything());
        expect(deleteChannel).toHaveBeenCalledWith('chan1');
    });

    test('a refused revision list removes the channel', async () => {
        jest.spyOn(Client4, 'createTaskSection').mockRejectedValue(new Error('forbidden'));
        const result = await store().dispatch(createRevisionChannel('team1', 'Trailer cut', video));

        expect(result.error).toBeTruthy();
        expect(Client4.setTaskSectionVideo).not.toHaveBeenCalled();
        expect(Client4.deleteTaskSection).not.toHaveBeenCalled();
        expect(deleteChannel).toHaveBeenCalledWith('chan1');
    });
});
