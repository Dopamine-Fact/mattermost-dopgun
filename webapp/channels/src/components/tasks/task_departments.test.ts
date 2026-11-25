// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Department} from '@mattermost/types/custom_roles';
import type {Task} from '@mattermost/types/tasks';

import {lockedBy, userDepartmentIds} from './task_departments';

const dept = (id: string, ...roles: string[]) => ({id, ranks: roles.map((name) => ({role_name: name}))}) as unknown as Department;

const task = (id: string, extra: Partial<Task> = {}) => ({id, status: 'todo', waits_for: [], video_file_id: '', ...extra}) as Task;

describe('userDepartmentIds', () => {
    test('is the departments whose rank the member holds', () => {
        const departments = [dept('D', 'rk_d1', 'rk_d2'), dept('E', 'rk_e1')];
        expect(userDepartmentIds('team_user rk_d2', departments)).toEqual(new Set(['D']));
        expect(userDepartmentIds('team_user', departments)).toEqual(new Set());
    });
});

describe('lockedBy', () => {
    const story = task('s', {status: 'in_progress'});
    const pending = task('p', {status: 'done', approval_status: 'pending_director'});
    const byId = {s: story, d: task('d', {status: 'done', approval_status: 'approved'}), p: pending};

    test('lists the waits-for tasks that are not done and approved, while the task is to do', () => {
        expect(lockedBy(task('t', {waits_for: ['s', 'd', 'p']}), byId)).toEqual([story, pending]);
    });

    test('is empty once they are done, once the task has started, and for revisions', () => {
        expect(lockedBy(task('t', {waits_for: ['d']}), byId)).toEqual([]);
        expect(lockedBy(task('t', {status: 'in_progress', waits_for: ['s']}), byId)).toEqual([]);
        expect(lockedBy(task('t', {waits_for: ['s'], video_file_id: 'f'}), byId)).toEqual([]);
    });
});
