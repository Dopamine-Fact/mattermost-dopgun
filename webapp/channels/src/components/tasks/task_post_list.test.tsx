// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';

import TaskPostList from './task_post_list';

jest.mock('components/post', () => ({
    __esModule: true,
    default: ({post, location}: {post: {message: string}; location: string}) => <div data-testid='post'>{`${post.message} ${location}`}</div>,
}));

const post = (id: string, createAt: number) => ({id, channel_id: 'chan1', root_id: '', delete_at: 0, create_at: createAt, update_at: createAt, message: id, props: {task_id: 'T'}});
const page = (posts: Array<ReturnType<typeof post>>) => ({order: posts.map((p) => p.id), posts: Object.fromEntries(posts.map((p) => [p.id, p]))});

describe('TaskPostList', () => {
    afterEach(() => jest.restoreAllMocks());

    test('loads 60 of the task\'s messages and shows them oldest first', async () => {
        const getTaskPosts = jest.spyOn(Client4, 'getTaskPosts').mockResolvedValue(page([post('late', 30), post('early', 10)]) as any);
        renderWithContext(
            <TaskPostList
                taskId='T'
                channelId='chan1'
            />,
        );

        await waitFor(() => expect(screen.getAllByTestId('post')).toHaveLength(2));
        expect(getTaskPosts).toHaveBeenCalledWith('T', {channelId: 'chan1', before: undefined, perPage: 60});
        expect(screen.getAllByTestId('post').map((p) => p.textContent)).toEqual(['early SEARCH', 'late SEARCH']);
        expect(screen.queryByRole('button', {name: 'Load older'})).toBeNull();
    });

    test('a full page offers older messages from before the oldest one', async () => {
        const full = Array.from({length: 60}, (_, i) => post(`p${i}`, 100 + i));
        const getTaskPosts = jest.spyOn(Client4, 'getTaskPosts').mockResolvedValueOnce(page(full) as any).mockResolvedValueOnce(page([post('old', 5)]) as any);
        renderWithContext(
            <TaskPostList
                taskId='T'
                channelId='chan1'
            />,
        );

        fireEvent.click(await screen.findByRole('button', {name: 'Load older'}));

        await waitFor(() => expect(getTaskPosts).toHaveBeenLastCalledWith('T', {channelId: 'chan1', before: 100, perPage: 60}));
        await waitFor(() => expect(screen.getAllByTestId('post')[0].textContent).toBe('old SEARCH'));
        expect(screen.queryByRole('button', {name: 'Load older'})).toBeNull();
    });

    test('a task with no messages renders nothing', async () => {
        const getTaskPosts = jest.spyOn(Client4, 'getTaskPosts').mockResolvedValue(page([]) as any);
        const {container} = renderWithContext(<TaskPostList taskId='T'/>);
        await waitFor(() => expect(getTaskPosts).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
    });
});
