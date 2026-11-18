// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';

import {getTaskSectionForChannel, makeGetTaskRootPosts} from './tasks';

const section = {id: 'sec1', team_id: 'team1', name: 'Ep 1', sort_order: 0, channel_id: 'chan1', video_file_id: '', create_at: 1, update_at: 1};
const post = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    channel_id: 'chan1',
    root_id: '',
    delete_at: 0,
    create_at: 0,
    props: {task_id: 'T'},
    ...overrides,
});

const state = (team: Record<string, unknown>, posts: Record<string, unknown> = {}) => ({
    entities: {
        teams: {teams: {team1: {id: 'team1', ...team}}},
        tasks: {byId: {}, sectionsById: {sec1: section}},
        posts: {posts},
    },
} as unknown as GlobalState);

describe('getTaskSectionForChannel', () => {
    test('returns the section linked to the channel', () => {
        expect(getTaskSectionForChannel(state({tasks_enabled: true, revisions_enabled: true}), 'chan1')).toBe(section);
    });

    test('is undefined when the team has revisions turned off', () => {
        expect(getTaskSectionForChannel(state({tasks_enabled: true, revisions_enabled: false}), 'chan1')).toBeUndefined();
    });

    test('is undefined for a channel no section links to', () => {
        expect(getTaskSectionForChannel(state({tasks_enabled: true, revisions_enabled: true}), 'other')).toBeUndefined();
    });
});

describe('makeGetTaskRootPosts', () => {
    const posts = {
        late: post('late', {create_at: 30}),
        early: post('early', {create_at: 10}),
        reply: post('reply', {create_at: 20, root_id: 'early'}),
        deleted: post('deleted', {create_at: 25, delete_at: 26}),
        other: post('other', {create_at: 15, props: {task_id: 'X'}}),
        elsewhere: post('elsewhere', {create_at: 5, channel_id: 'chan2'}),
    };

    test('lists the task\'s live root posts oldest first', () => {
        const getTaskRootPosts = makeGetTaskRootPosts();
        expect(getTaskRootPosts(state({}, posts), 'T').map((p) => p.id)).toEqual(['elsewhere', 'early', 'late']);
    });

    test('narrows to one channel when given', () => {
        const getTaskRootPosts = makeGetTaskRootPosts();
        expect(getTaskRootPosts(state({}, posts), 'T', 'chan1').map((p) => p.id)).toEqual(['early', 'late']);
    });
});
