// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Task, TaskSection} from '@mattermost/types/tasks';

import {TaskTypes, UserTypes} from 'mattermost-redux/action_types';
import reducer from 'mattermost-redux/reducers/entities/tasks';
import deepFreezeAndThrowOnMutation from 'mattermost-redux/utils/deep_freeze';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    team_id: 'team1',
    section_id: '',
    title: id,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: 0,
    creator_id: 'user1',
    create_at: 1,
    update_at: 1,
    ...overrides,
});

const section = (id: string, overrides: Partial<TaskSection> = {}): TaskSection => ({
    id,
    team_id: 'team1',
    name: id,
    sort_order: 0,
    channel_id: '', video_file_id: '',
    create_at: 1,
    update_at: 1,
    ...overrides,
});

describe('reducers.entities.tasks', () => {
    const initial = deepFreezeAndThrowOnMutation({
        byId: {
            a: task('a', {section_id: 's1'}),
            b: task('b'),
            other: task('other', {team_id: 'team2'}),
        },
        sectionsById: {s1: section('s1'), s2: section('s2', {team_id: 'team2'})},
    });

    test('TEAM_TASKS_RECEIVED replaces only that team', () => {
        const state = reducer(initial, {
            type: TaskTypes.TEAM_TASKS_RECEIVED,
            data: {teamId: 'team1', tasks: [task('c')], sections: []},
        });

        expect(Object.keys(state.byId).sort()).toEqual(['c', 'other']);
        expect(Object.keys(state.sectionsById)).toEqual(['s2']);
    });

    test('TASK_RECEIVED ignores an older copy of a task', () => {
        const newer = reducer(initial, {type: TaskTypes.TASK_RECEIVED, data: task('b', {update_at: 5, status: 'done'})});
        expect(newer.byId.b.status).toBe('done');

        const stale = reducer(newer, {type: TaskTypes.TASK_RECEIVED, data: task('b', {update_at: 3})});
        expect(stale.byId.b.status).toBe('done');
    });

    test('TASK_DELETED removes the task', () => {
        const state = reducer(initial, {type: TaskTypes.TASK_DELETED, data: {id: 'a'}});
        expect(state.byId.a).toBeUndefined();
    });

    test('TASK_SECTION_DELETED removes the section and moves its tasks to no section', () => {
        const state = reducer(initial, {type: TaskTypes.TASK_SECTION_DELETED, data: {id: 's1'}});

        expect(state.sectionsById.s1).toBeUndefined();
        expect(state.byId.a.section_id).toBe('');
        expect(state.byId.b).toBe(initial.byId.b);
    });

    test('LOGOUT_SUCCESS clears everything', () => {
        const state = reducer(initial, {type: UserTypes.LOGOUT_SUCCESS});
        expect(state).toEqual({byId: {}, sectionsById: {}});
    });
});
