// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Post} from '@mattermost/types/posts';
import type {Task} from '@mattermost/types/tasks';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import RevisionPost from './revision_post';

const task: Task = {
    id: 'rev1',
    team_id: 'team1',
    section_id: 'sec1',
    title: 'Logo bigger',
    description: '',
    assignee_id: 'user2',
    start_at: 0,
    due_at: 0,
    status: 'in_progress',
    sort_order: 1,
    video_time: 2330,
    creator_id: 'user1',
    create_at: 1,
    update_at: 1,
};
const post = {id: 'post1', channel_id: 'chan1', message: 'New revision at 0:02.33: [Logo bigger](http://x)', props: {task_id: 'rev1'}} as unknown as Post;

const state = (tasks: Record<string, Task>) => ({
    entities: {
        tasks: {byId: tasks, sectionsById: {}},
        channels: {channels: {chan1: TestHelper.getChannelMock({id: 'chan1', name: 'trailer', team_id: 'team1'})}},
        teams: {teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'studio'})}},
        users: {profiles: {user2: TestHelper.getUserMock({id: 'user2', username: 'ayse'})}},
    },
});

describe('RevisionPost', () => {
    test('shows the revision live: status colour, time, assignee and a link to it', () => {
        renderWithContext(<RevisionPost post={post}/>, state({rev1: task}));

        const card = document.querySelector('.RevisionPost')!;
        expect(card).toHaveClass('TaskStatus--in_progress');
        expect(screen.getByText('0:02.33')).toBeInTheDocument();
        expect(screen.getByText('ayse')).toBeInTheDocument();
        expect(screen.getByRole('link', {name: 'Logo bigger'})).toHaveAttribute('href', '/studio/channels/trailer?revision=rev1');
        expect(screen.getByRole('combobox', {name: 'Status of Logo bigger'})).toHaveValue('in_progress');
    });

    test('falls back to the posted text once the revision is gone', () => {
        renderWithContext(<RevisionPost post={post}/>, state({}));

        expect(document.querySelector('.RevisionPost')).toBeNull();
        expect(screen.getByText(/New revision at 0:02.33/)).toBeInTheDocument();
    });
});
