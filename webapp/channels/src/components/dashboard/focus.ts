// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Task} from '@mattermost/types/tasks';

import {addDays, startOfDay} from 'components/tasks/task_utils';

export type Urgency = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';

// Due dates are local midnight in ms; 0 means no due date.
export function urgency(dueAt: number, now = Date.now()): Urgency {
    if (!dueAt) {
        return 'none';
    }
    const today = startOfDay(now);
    if (dueAt < today) {
        return 'overdue';
    }
    if (dueAt < addDays(today, 1)) {
        return 'today';
    }
    if (dueAt < addDays(today, 2)) {
        return 'tomorrow';
    }
    return 'later';
}

// A task is a priority when it is overdue or due by tomorrow.
export function isPriority(task: Task, now = Date.now()): boolean {
    const u = urgency(task.due_at, now);
    return u === 'overdue' || u === 'today' || u === 'tomorrow';
}

// myOpenTasks lists the user's unfinished tasks, soonest due first; undated tasks go last, in-progress before to-do.
export function myOpenTasks(tasks: Task[], userId: string): Task[] {
    return tasks.
        filter((t) => t.assignee_id === userId && t.status !== 'done').
        sort((a, b) => ((a.due_at || Infinity) - (b.due_at || Infinity)) ||
            (Number(b.status === 'in_progress') - Number(a.status === 'in_progress')));
}
