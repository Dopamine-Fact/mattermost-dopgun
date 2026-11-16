// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Task} from '@mattermost/types/tasks';

import {isPriority, myOpenTasks, urgency} from './focus';

const now = new Date(2026, 10, 17, 15, 30).getTime();
const day = (offset: number) => new Date(2026, 10, 17 + offset).getTime();

const task = (id: string, patch: Partial<Task>): Task => ({
    id,
    team_id: 't',
    section_id: '',
    title: id,
    description: '',
    assignee_id: 'me',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 0,
    video_time: 0,
    creator_id: 'x',
    create_at: 0,
    update_at: 0,
    ...patch,
} as Task);

describe('dashboard focus', () => {
    test('urgency buckets due dates relative to today', () => {
        expect(urgency(0, now)).toBe('none');
        expect(urgency(day(-1), now)).toBe('overdue');
        expect(urgency(day(0), now)).toBe('today');
        expect(urgency(day(1), now)).toBe('tomorrow');
        expect(urgency(day(2), now)).toBe('later');
    });

    test('priority means overdue or due by tomorrow', () => {
        expect(isPriority(task('a', {due_at: day(-3)}), now)).toBe(true);
        expect(isPriority(task('b', {due_at: day(1)}), now)).toBe(true);
        expect(isPriority(task('c', {due_at: day(2)}), now)).toBe(false);
        expect(isPriority(task('d', {}), now)).toBe(false);
    });

    test('myOpenTasks keeps my unfinished tasks, soonest first, undated in-progress before to-do', () => {
        const tasks = [
            task('undated-todo', {}),
            task('later', {due_at: day(5)}),
            task('done', {due_at: day(-1), status: 'done'}),
            task('other', {due_at: day(-1), assignee_id: 'someone'}),
            task('undated-progress', {status: 'in_progress'}),
            task('overdue', {due_at: day(-2)}),
        ];
        expect(myOpenTasks(tasks, 'me').map((t) => t.id)).toEqual(['overdue', 'later', 'undated-progress', 'undated-todo']);
    });
});
