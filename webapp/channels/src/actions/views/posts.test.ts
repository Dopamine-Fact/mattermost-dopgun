// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createPost} from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';

import {makeInitialState} from 'packages/mattermost-redux/test/test_store';
import mockStore from 'tests/test_store';
import {TestHelper} from 'utils/test_helper';

import {forwardPost} from './posts';

jest.mock('mattermost-redux/actions/posts', () => ({
    ...jest.requireActual('mattermost-redux/actions/posts'),
    createPost: jest.fn(() => () => Promise.resolve({data: true})),
}));
jest.mock('actions/hooks', () => ({
    runMessageWillBePostedHooks: jest.fn((post) => () => Promise.resolve({data: post})),
}));
jest.mock('selectors/urls', () => ({
    getPermalinkURL: () => '/team-one/pl/p1',
}));

const post = TestHelper.getPostMock({id: 'p1', channel_id: 'from'});
const target = TestHelper.getChannelMock({id: 'chan1', team_id: 'team1'});
const store = () => mockStore(makeInitialState({
    entities: {
        users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me'}), alice: TestHelper.getUserMock({id: 'alice', username: 'alice'})}},
        channels: {channels: {dm: TestHelper.getChannelMock({id: 'dm', type: 'D'})}},
        teams: {currentTeamId: 'team1', teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one'})}},
    },
} as any));

describe('forwardPost', () => {
    beforeEach(() => jest.clearAllMocks());

    test('names the task picked for a task-list channel', async () => {
        await store().dispatch(forwardPost(post, target, 'see this', 'T'));
        expect(createPost).toHaveBeenCalledWith(expect.objectContaining({channel_id: 'chan1', props: expect.objectContaining({task_id: 'T'})}), []);
    });

    test('names no task when none is given', async () => {
        await store().dispatch(forwardPost(post, target));
        expect(jest.mocked(createPost).mock.calls[0][0].props).not.toHaveProperty('task_id');
    });

    test('copies a direct message as a quote, since recipients cannot open its link', async () => {
        const dmPost = TestHelper.getPostMock({id: 'p2', channel_id: 'dm', user_id: 'alice', message: 'line one\nline two'});
        await store().dispatch(forwardPost(dmPost, target, 'fyi'));
        expect(jest.mocked(createPost).mock.calls[0][0].message).toBe('fyi\n> **alice**:\n> line one\n> line two');
    });

    test('keeps the link when a direct message is forwarded back into itself', async () => {
        const dmPost = TestHelper.getPostMock({id: 'p2', channel_id: 'dm', user_id: 'alice', message: 'hi'});
        await store().dispatch(forwardPost(dmPost, TestHelper.getChannelMock({id: 'dm', type: 'D'})));
        expect(jest.mocked(createPost).mock.calls[0][0].message).toMatch(/\/team-one\/pl\/p1$/);
    });

    test('forwards a direct message\'s attachments as fresh copies', async () => {
        const original = TestHelper.getFileInfoMock({id: 'f1', name: 'cut.mp4'});
        const dmPost = TestHelper.getPostMock({id: 'p2', channel_id: 'dm', user_id: 'alice', message: 'hi', file_ids: ['f1'], metadata: {files: [original]} as any});
        jest.spyOn(Client4, 'copyFileInfosForPost').mockResolvedValue(['copy1']);

        await store().dispatch(forwardPost(dmPost, target));

        expect(Client4.copyFileInfosForPost).toHaveBeenCalledWith('p2');
        expect(jest.mocked(createPost).mock.calls[0][1]).toEqual([expect.objectContaining({id: 'copy1', name: 'cut.mp4'})]);
    });
});
