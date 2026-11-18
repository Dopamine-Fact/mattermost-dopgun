// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {Client4} from 'mattermost-redux/client';

import mockStore from 'tests/test_store';

import {createEpisodeChannel, createRevisionChannel, fetchTaskPosts} from './tasks';

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

describe('createEpisodeChannel', () => {
    const team = {id: 'team1', episode_folders: 'Layout/Ref\nLayout/Final\n\n  Audio  ', episode_tasks: 'Storyboard\nAnimatic'};
    const store = () => mockStore({entities: {users: {currentUserId: 'me'}, teams: {teams: {team1: team}}}, websocket: {connectionId: 'conn1'}});

    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Client4, 'createTaskSection').mockResolvedValue(section);
        jest.spyOn(Client4, 'setTaskSectionVideo').mockResolvedValue({...section, video_file_id: 'file1'});
        jest.spyOn(Client4, 'deleteTaskSection').mockResolvedValue({status: 'OK'});
        jest.spyOn(Client4, 'createCanvas').mockResolvedValue({id: 'cv1'} as any);
        jest.spyOn(Client4, 'createDriveFolder').mockImplementation((channelId, parentId, name) => Promise.resolve({id: `f-${name}`} as any));
        jest.spyOn(Client4, 'createTask').mockImplementation((task) => Promise.resolve({...task, id: `t-${task.title}`} as any));
    });

    test('createEpisodeChannel calls channel, section, video, canvas in order', async () => {
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        const order = [
            jest.mocked(createChannel).mock.invocationCallOrder[0],
            jest.mocked(Client4.createTaskSection).mock.invocationCallOrder[0],
            jest.mocked(Client4.setTaskSectionVideo).mock.invocationCallOrder[0],
            jest.mocked(Client4.createCanvas).mock.invocationCallOrder[0],
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(Client4.createCanvas).toHaveBeenCalledWith('team1', 'chan1');
        expect(Client4.createTask).toHaveBeenNthCalledWith(1, {team_id: 'team1', title: 'Storyboard', section_id: 'sec1', status: 'todo'}, 'conn1');
        expect(Client4.createTask).toHaveBeenNthCalledWith(2, {team_id: 'team1', title: 'Animatic', section_id: 'sec1', status: 'todo'}, 'conn1');
        expect(result.data).toEqual({channel: expect.objectContaining({id: 'chan1'}), failed: []});
    });

    test('a canvas failure deletes the section and the channel', async () => {
        jest.spyOn(Client4, 'createCanvas').mockRejectedValue(new Error('canvases off'));
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(result.error).toBeTruthy();
        expect(Client4.deleteTaskSection).toHaveBeenCalledWith('sec1', expect.anything());
        expect(deleteChannel).toHaveBeenCalledWith('chan1');
        expect(Client4.createDriveFolder).not.toHaveBeenCalled();
        expect(Client4.createTask).not.toHaveBeenCalled();
    });

    test('folders are created parent first and a shared parent once', async () => {
        await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(jest.mocked(Client4.createDriveFolder).mock.calls).toEqual([
            ['chan1', '', 'Layout'],
            ['chan1', 'f-Layout', 'Ref'],
            ['chan1', 'f-Layout', 'Final'],
            ['chan1', '', 'Audio'],
        ]);
    });

    test('a failed folder or task is reported and the rest still created', async () => {
        jest.spyOn(Client4, 'createDriveFolder').mockImplementation((channelId, parentId, name) => (name === 'Layout' ? Promise.reject(new Error('no')) : Promise.resolve({id: `f-${name}`} as any)));
        jest.spyOn(Client4, 'createTask').mockImplementation((task) => (task.title === 'Storyboard' ? Promise.reject(new Error('no')) : Promise.resolve({...task, id: 't'} as any)));
        const result = await store().dispatch(createEpisodeChannel('team1', 'Episode 1', video));

        expect(result.data?.failed).toEqual(['Layout/Ref', 'Layout/Final', 'Storyboard']);
        expect(Client4.createDriveFolder).toHaveBeenCalledTimes(2);
        expect(Client4.createDriveFolder).toHaveBeenLastCalledWith('chan1', '', 'Audio');
        expect(Client4.createTask).toHaveBeenLastCalledWith(expect.objectContaining({title: 'Animatic'}), 'conn1');
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
