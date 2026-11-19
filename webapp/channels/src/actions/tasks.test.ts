// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {Client4} from 'mattermost-redux/client';

import mockStore from 'tests/test_store';

import {createEpisodeChannel, createRevisionChannel, fetchTaskPosts} from './tasks';

jest.mock('mattermost-redux/actions/channels', () => ({
    createChannel: jest.fn((channel) => () => Promise.resolve({data: {...channel, id: 'chan1'}})),
    deleteChannel: jest.fn(() => () => Promise.resolve({data: true})),
    getChannelAndMyMember: jest.fn(() => () => Promise.resolve({data: true})),
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
        expect(Client4.setTaskSectionVideo).toHaveBeenCalledWith('sec1', video, expect.anything(), undefined);
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

describe('createEpisodeChannel', () => {
    const channel = {id: 'chan1', team_id: 'team1', name: 'episode-1', display_name: 'Episode 1', type: 'O'} as any;
    const store = () => mockStore({entities: {users: {currentUserId: 'me'}}, websocket: {connectionId: 'conn1'}});

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Client4, 'createEpisode').mockResolvedValue({channel, section, failed: ['Notes'], task_ids: ['t1', 't2']});
        jest.spyOn(Client4, 'deleteTask').mockResolvedValue({status: 'OK'} as any);
        jest.spyOn(Client4, 'setTaskSectionVideo').mockResolvedValue({...section, video_file_id: 'file1'});
        jest.spyOn(Client4, 'deleteTaskSection').mockResolvedValue({status: 'OK'});
        jest.spyOn(Client4, 'createCanvas').mockResolvedValue({id: 'cv1'} as any);
    });

    test('calls the episode endpoint, then video and canvas', async () => {
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(Client4.createEpisode).toHaveBeenCalledWith('team1', 'episode-1', 'Episode 1');
        expect(Client4.setTaskSectionVideo).toHaveBeenCalledWith('sec1', video, expect.anything(), undefined);
        expect(jest.mocked(Client4.setTaskSectionVideo).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(Client4.createCanvas).mock.invocationCallOrder[0]);
        expect(Client4.createCanvas).toHaveBeenCalledWith('team1', 'chan1');
        expect(result.data).toEqual({channel, failed: ['Notes']});
    });

    test('without a video it skips the upload and still makes the canvas', async () => {
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1'));

        expect(Client4.setTaskSectionVideo).not.toHaveBeenCalled();
        expect(Client4.createCanvas).toHaveBeenCalledWith('team1', 'chan1');
        expect(result.data).toEqual({channel, failed: ['Notes']});
    });

    test('removes section and channel when the video fails', async () => {
        jest.spyOn(Client4, 'setTaskSectionVideo').mockRejectedValue(new Error('not a video'));
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(result.error).toBeTruthy();
        expect(Client4.createCanvas).not.toHaveBeenCalled();
        expect(Client4.deleteTask).toHaveBeenCalledWith('t1', expect.anything());
        expect(Client4.deleteTask).toHaveBeenCalledWith('t2', expect.anything());
        expect(Client4.deleteTaskSection).toHaveBeenCalledWith('sec1', expect.anything());
        expect(deleteChannel).toHaveBeenCalledWith('chan1');
    });

    test('removes tasks, section and channel when the canvas fails', async () => {
        jest.spyOn(Client4, 'createCanvas').mockRejectedValue(new Error('no canvas'));
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(result.error).toBeTruthy();
        expect(Client4.deleteTask).toHaveBeenCalledWith('t1', expect.anything());
        expect(Client4.deleteTask).toHaveBeenCalledWith('t2', expect.anything());
        expect(Client4.deleteTaskSection).toHaveBeenCalledWith('sec1', expect.anything());
        expect(deleteChannel).toHaveBeenCalledWith('chan1');
    });

    test('returns the endpoint error without further calls', async () => {
        jest.spyOn(Client4, 'createEpisode').mockRejectedValue(new Error('forbidden'));
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(result.error).toBeTruthy();
        expect(Client4.setTaskSectionVideo).not.toHaveBeenCalled();
        expect(Client4.deleteTask).not.toHaveBeenCalled();
        expect(Client4.deleteTaskSection).not.toHaveBeenCalled();
        expect(deleteChannel).not.toHaveBeenCalled();
    });
});

describe('fetchTaskPosts', () => {
    test('loads the task\'s messages into the posts store', async () => {
        const list = {order: ['p1'], posts: {p1: {id: 'p1', channel_id: 'chan1', props: {task_id: 'T'}}}};
        jest.spyOn(Client4, 'getTaskPosts').mockResolvedValue(list as any);
        const store = mockStore({entities: {users: {currentUserId: 'me'}}, websocket: {connectionId: 'conn1'}});

        const result = await store.dispatch(fetchTaskPosts('T', {channelId: 'chan1', perPage: 30}));

        expect(Client4.getTaskPosts).toHaveBeenCalledWith('T', {channelId: 'chan1', perPage: 30});
        expect(result.data).toBe(list);
        expect(store.getActions()).toContainEqual(expect.objectContaining({type: 'RECEIVED_POSTS', data: list}));
    });
});
