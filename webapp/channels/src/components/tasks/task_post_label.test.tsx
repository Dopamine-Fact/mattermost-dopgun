// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Post} from '@mattermost/types/posts';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import TaskPostLabel from './task_post_label';

const state = {
    entities: {
        teams: {currentTeamId: 'team1', teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one'})}},
        channels: {channels: {chan1: TestHelper.getChannelMock({id: 'chan1', team_id: 'team1', name: 'ep-1'})}},
        tasks: {
            byId: {
                t2: {id: 't2', team_id: 'team1', section_id: 'sec1', title: 'Storyboard', video_file_id: ''},
                t1: {id: 't1', team_id: 'team1', section_id: 'sec1', title: 'Logo too small', video_file_id: 'file1'},
            },
            sectionsById: {sec1: {id: 'sec1', team_id: 'team1', name: 'Ep 1', sort_order: 0, channel_id: 'chan1', video_file_id: '', create_at: 1, update_at: 1}},
        },
    },
};
const post = (taskId: string) => TestHelper.getPostMock({id: 'p1', channel_id: 'chan1', props: {task_id: taskId}}) as Post;

describe('TaskPostLabel', () => {
    test('shows the task and links to it on the Tasks tab', () => {
        renderWithContext(<TaskPostLabel post={post('t2')}/>, state as any);
        expect(screen.getByRole('link', {name: 'Storyboard'})).toHaveAttribute('href', '/team-one/channels/ep-1?task=t2');
    });

    test('a revision links to the Revisions tab', () => {
        renderWithContext(<TaskPostLabel post={post('t1')}/>, state as any);
        expect(screen.getByRole('link', {name: 'Logo too small'})).toHaveAttribute('href', '/team-one/channels/ep-1?revision=t1');
    });

    test('a task that is gone shows as deleted, without a link', () => {
        renderWithContext(<TaskPostLabel post={post('gone')}/>, state as any);
        expect(screen.getByText('Deleted task')).toBeInTheDocument();
        expect(screen.queryByRole('link')).toBeNull();
    });

    test('before the team tasks arrive nothing is claimed about the task', () => {
        const loading = {entities: {...state.entities, tasks: {byId: {}, sectionsById: {}}}};
        renderWithContext(<TaskPostLabel post={post('t2')}/>, loading as any);
        expect(screen.queryByText('Deleted task')).toBeNull();
    });
});
