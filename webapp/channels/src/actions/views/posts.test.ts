// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createPost} from 'mattermost-redux/actions/posts';

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
        users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me'})}},
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
});
