// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Channel} from '@mattermost/types/channels';
import type {Post, PostList} from '@mattermost/types/posts';

import {Client4} from 'mattermost-redux/client';

import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import ConversationViewer from './conversation_viewer';

const ali = TestHelper.getUserMock({id: 'u1', username: 'ali'});
const ayse = TestHelper.getUserMock({id: 'u2', username: 'ayse'});

const state = {
    entities: {
        users: {currentUserId: 'admin', profiles: {u1: ali, u2: ayse}},
    },
};

const channel = (c: Partial<Channel>) => ({id: 'c', type: 'O', name: '', display_name: '', last_post_at: 0, ...c}) as Channel;
const post = (p: Partial<Post>) => ({id: 'p', user_id: 'u1', message: '', create_at: 0, type: '', file_ids: [], ...p}) as Post;
const postList = (posts: Post[], extra: Post[] = []): PostList => ({
    order: posts.map((p) => p.id),
    posts: Object.fromEntries([...posts, ...extra].map((p) => [p.id, p])),
} as PostList);

async function pickUser(name: string) {
    fireEvent.change(screen.getByLabelText('User'), {target: {value: name.slice(0, 2)}});
    fireEvent.click(within(await screen.findByRole('list', {name: 'Users'})).getByRole('button', {name}));
}

const conversations = () => within(screen.getByRole('list', {name: 'Conversations'})).getAllByRole('button').map((b) => b.textContent);
const messages = () => within(screen.getByRole('list', {name: 'Messages'})).getAllByRole('listitem').map((li) => li.textContent);

describe('ConversationViewer', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'searchUsers').mockImplementation(async (term: string) => [ali, ayse].filter((u) => u.username.startsWith(term)));
    });
    afterEach(() => jest.restoreAllMocks());

    test('lists the picked user\'s conversations, most recent first, DMs by the other person', async () => {
        const spy = jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([
            channel({id: 'c1', type: 'O', display_name: 'General', last_post_at: 1}),
            channel({id: 'c2', type: 'D', name: 'u1__u2', last_post_at: 5}),
        ]);

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');

        expect(spy).toHaveBeenCalledWith('u1');
        await waitFor(() => expect(conversations()).toEqual(['ayse', 'General']));
    });

    test('self DM is labelled with the user\'s own name', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([channel({id: 'c3', type: 'D', name: 'u1__u1'})]);

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');

        await waitFor(() => expect(conversations()).toEqual(['ali']));
    });

    test('opens a conversation oldest first with sender and file count', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([channel({id: 'c2', type: 'D', name: 'u1__u2'})]);
        const spy = jest.spyOn(Client4, 'getPosts').mockResolvedValue(postList(
            [post({id: 'p2', user_id: 'u2', message: 'merhaba', create_at: 2, file_ids: ['f']}), post({id: 'p1', user_id: 'u1', message: 'selam', create_at: 1})],
            [post({id: 'p9', message: 'thread extra'})],
        ));

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');
        fireEvent.click(await screen.findByRole('button', {name: 'ayse'}));

        await waitFor(() => expect(messages()).toHaveLength(2));
        expect(spy).toHaveBeenCalledWith('c2', 0, 60, true, false);
        const [first, second] = messages();
        expect(first).toContain('ali');
        expect(first).toContain('selam');
        expect(second).toContain('ayse');
        expect(second).toContain('merhaba');
        expect(second).toContain('1 files');
        expect(screen.queryByText('thread extra')).not.toBeInTheDocument();
    });

    test('load older prepends older posts and hides when fewer than 60 come back', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([channel({id: 'c2', type: 'D', name: 'u1__u2'})]);
        const page = Array.from({length: 60}, (_, i) => post({id: `p${60 - i}`, message: `m${60 - i}`, create_at: 160 - i}));
        jest.spyOn(Client4, 'getPosts').mockResolvedValue(postList(page));
        const older = jest.spyOn(Client4, 'getPostsBefore').mockResolvedValue(postList([post({id: 'p0', message: 'oldest', create_at: 1})]));

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');
        fireEvent.click(await screen.findByRole('button', {name: 'ayse'}));
        fireEvent.click(await screen.findByRole('button', {name: 'Load older'}));

        await waitFor(() => expect(messages()).toHaveLength(61));
        expect(older).toHaveBeenCalledWith('c2', 'p1', 0, 60, true, false);
        expect(messages()[0]).toContain('oldest');
        expect(screen.queryByRole('button', {name: 'Load older'})).not.toBeInTheDocument();
    });

    test('a late reply for a conversation that is no longer open is ignored', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([
            channel({id: 'c1', type: 'O', display_name: 'General', last_post_at: 1}),
            channel({id: 'c2', type: 'D', name: 'u1__u2', last_post_at: 5}),
        ]);
        let resolveSlow: (l: PostList) => void = () => {};
        jest.spyOn(Client4, 'getPosts').mockImplementation((id) => (id === 'c2' ? new Promise<PostList>((r) => {
            resolveSlow = r;
        }) : Promise.resolve(postList([post({id: 'p1', message: 'general msg'})]))));

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');
        fireEvent.click(await screen.findByRole('button', {name: 'ayse'}));
        fireEvent.click(screen.getByRole('button', {name: 'General'}));
        expect(await screen.findByText('general msg')).toBeInTheDocument();
        await act(async () => resolveSlow(postList([post({id: 'p2', message: 'dm msg'})])));

        expect(screen.queryByText('dm msg')).not.toBeInTheDocument();
    });

    test('user search includes deactivated users', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([]);

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');

        expect(Client4.searchUsers).toHaveBeenCalledWith('al', {allow_inactive: true});
    });

    test('shows whose conversations are listed', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([]);

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');

        expect(await screen.findByRole('heading', {name: 'ali'})).toBeInTheDocument();
    });

    test('picking the same user again reloads the conversations', async () => {
        const spy = jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([channel({id: 'c1', type: 'O', display_name: 'General'})]);

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');
        await waitFor(() => expect(conversations()).toEqual(['General']));
        await pickUser('ali');

        await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(conversations()).toEqual(['General']));
    });

    test('a failed load says so instead of showing an empty conversation', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockResolvedValue([channel({id: 'c1', type: 'O', display_name: 'General'})]);
        jest.spyOn(Client4, 'getPosts').mockRejectedValue(new Error('500'));

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');
        fireEvent.click(await screen.findByRole('button', {name: 'General'}));

        expect(await screen.findByText('Could not load. Try again.')).toBeInTheDocument();
        expect(screen.queryByText('No messages.')).not.toBeInTheDocument();
    });

    test('a failed conversation list says so instead of "No conversations."', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockRejectedValue(new Error('500'));

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');

        expect(await screen.findByText('Could not load. Try again.')).toBeInTheDocument();
        expect(screen.queryByText('No conversations.')).not.toBeInTheDocument();
    });

    test('picking another user clears the open conversation', async () => {
        jest.spyOn(Client4, 'getChannelsForUser').mockImplementation(async (userId) => (userId === 'u1' ? [channel({id: 'c2', type: 'D', name: 'u1__u2'})] : []));
        jest.spyOn(Client4, 'getPosts').mockResolvedValue(postList([post({id: 'p1', message: 'selam'})]));

        renderWithContext(<ConversationViewer/>, state);
        await pickUser('ali');
        fireEvent.click(await screen.findByRole('button', {name: 'ayse'}));
        expect(await screen.findByText('selam')).toBeInTheDocument();

        await pickUser('ayse');

        await waitFor(() => expect(screen.queryByText('selam')).not.toBeInTheDocument());
    });
});
