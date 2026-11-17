// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';
import {defineMessages} from 'react-intl';

import type {Task, TaskPatch, TaskSection, TaskStatus} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

// ViewProps is what the board, list and timeline views share.
export type ViewProps = {
    teamId: string;
    tasks: Task[];
    sections: TaskSection[];
    usersById: Record<string, UserProfile>;
    selectedId: string;
    onSelect: (taskId: string) => void;

    // canManage: the user may create, assign and delete tasks and edit sections (manage_tasks; manage_revisions on the Revisions tab).
    canManage: boolean;
};

export const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

export const statusMessages = defineMessages({
    todo: {id: 'tasks.status.todo', defaultMessage: 'To do'},
    in_progress: {id: 'tasks.status.inProgress', defaultMessage: 'In progress'},
    done: {id: 'tasks.status.done', defaultMessage: 'Done'},
});

export function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
    const groups: Record<TaskStatus, Task[]> = {todo: [], in_progress: [], done: []};
    for (const task of tasks) {
        (groups[task.status] ?? groups.todo).push(task);
    }
    return groups;
}

// sortOrderBetween picks a sort order that places a task between its new neighbours.
export function sortOrderBetween(before?: number, after?: number, now = Date.now()): number {
    if (before !== undefined && after !== undefined) {
        return (before + after) / 2;
    }
    if (before !== undefined) {
        // Same scale as new tasks (their create time), so later additions still land below.
        return Math.max(before + 1, now);
    }
    if (after !== undefined) {
        return after - 1000;
    }
    return now;
}

// dropToPatch turns a drag result on status-keyed droppables into the patch to save, or undefined when nothing moved.
export function dropToPatch(byStatus: Record<TaskStatus, Task[]>, {draggableId, source, destination}: DropResult): TaskPatch | undefined {
    if (!destination || (destination.droppableId === source.droppableId && destination.index === source.index)) {
        return undefined;
    }
    const status = destination.droppableId as TaskStatus;
    const column = byStatus[status].filter((t) => t.id !== draggableId);
    return {
        status,
        sort_order: sortOrderBetween(column[destination.index - 1]?.sort_order, column[destination.index]?.sort_order),
    };
}

// formatVideoTime shows a revision's place in its video as m:ss.cc, precise enough to tell frames apart.
export function formatVideoTime(ms: number): string {
    const centis = Math.floor(ms / 10);
    const seconds = Math.floor(centis / 100);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}.${pad(centis % 100)}`;
}

const SECTION_COLORS = ['#e2445c', '#9b5de5', '#f1c40f', '#00a8e8', '#06d6a0', '#ff7f50', '#5c7cfa', '#e67e22'];

// sectionColor gives each section a stable colour so it can be told apart on cards and pills.
export function sectionColor(sectionId: string): string {
    let hash = 0;
    for (const char of sectionId) {
        hash = ((hash * 31) + char.charCodeAt(0)) | 0;
    }
    return SECTION_COLORS[Math.abs(hash) % SECTION_COLORS.length];
}

const DAY = 24 * 60 * 60 * 1000;

// shortcut: the timeline never renders more than a year of days; add paging if teams plan further out.
const MAX_TIMELINE_DAYS = 366;

export function startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function addDays(ms: number, days: number): number {
    const d = new Date(ms);
    d.setDate(d.getDate() + days);
    return d.getTime();
}

// dayIndex rounds so a day with a DST shift (23h or 25h) still counts as one.
export function dayIndex(from: number, ms: number): number {
    return Math.round((startOfDay(ms) - from) / DAY);
}

// taskSpan is the [start, end] a task covers on the timeline; a task with only one date is a one-day bar.
export function taskSpan(task: Task): [number, number] | undefined {
    const start = task.start_at || task.due_at;
    const end = task.due_at || task.start_at;
    return start ? [start, end] : undefined;
}

// resizeSpan moves one edge of a [start, end] day span by delta days, never letting the edges cross.
export function resizeSpan(start: number, end: number, edge: 'start' | 'end', delta: number): [number, number] {
    return edge === 'start' ? [Math.min(start + delta, end), end] : [start, Math.max(end + delta, start)];
}

// timelineRange spans from a week before today to five weeks after, widened to fit every scheduled task.
export function timelineRange(tasks: Task[], now = Date.now()): {from: number; days: number} {
    const today = startOfDay(now);
    let from = addDays(today, -7);
    let to = addDays(today, 35);
    for (const task of tasks) {
        const span = taskSpan(task);
        if (span) {
            from = Math.min(from, addDays(startOfDay(span[0]), -2));
            to = Math.max(to, addDays(startOfDay(span[1]), 7));
        }
    }
    return {from, days: Math.min(dayIndex(from, to) + 1, MAX_TIMELINE_DAYS)};
}
