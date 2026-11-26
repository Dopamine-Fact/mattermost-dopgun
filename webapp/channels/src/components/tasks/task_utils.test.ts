// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';

import type {Task, TaskStage} from '@mattermost/types/tasks';

import {addDays, dayIndex, deriveStages, dropToPatch, folderPaths, groupByStatus, hasWeight, isApprovalLocked, isComplete, libraryFolderPaths, resizeSpan, sectionColor, sortOrderBetween, startOfDay, subtaskCounts, taskSpan, timelineRange, visibleTasks} from './task_utils';

const task = (id: string, status: Task['status'], sortOrder: number) => ({id, status, sort_order: sortOrder} as Task);

const drop = (id: string, from: string, fromIndex: number, to?: string, toIndex = 0) => ({
    draggableId: id,
    source: {droppableId: from, index: fromIndex},
    destination: to ? {droppableId: to, index: toIndex} : null,
} as DropResult);

describe('task_utils', () => {
    test('deriveStages mirrors the server: status from the tasks, the first stage not done is current', () => {
        const byId = {
            todo: {id: 'todo', status: 'todo', approval_status: ''} as Task,
            doing: {id: 'doing', status: 'in_progress', approval_status: ''} as Task,
            pending: {id: 'pending', status: 'done', approval_status: 'pending_supervisor'} as Task,
            done: {id: 'done', status: 'done', approval_status: 'approved'} as Task,
        };
        const stage = (...ids: string[]) => ({task_ids: ids} as TaskStage);

        const derived = deriveStages([stage('done'), stage('done', 'unknown'), stage('pending'), stage('todo'), stage()], byId);
        expect(derived.map((d) => d.status)).toEqual(['done', 'done', 'in_progress', 'not_started', 'not_started']);
        expect(derived.map((d) => d.current)).toEqual([false, false, true, false, false]);

        expect(deriveStages([stage('todo', 'doing')], byId)[0].status).toBe('in_progress');
        expect(deriveStages([stage('done')], byId)[0].current).toBe(false);
    });

    test('hasWeight needs both dates', () => {
        expect(hasWeight({start_at: 1, due_at: 2} as Task)).toBe(true);
        expect(hasWeight({start_at: 0, due_at: 2} as Task)).toBe(false);
        expect(hasWeight({start_at: 1, due_at: 0} as Task)).toBe(false);
    });

    test('sortOrderBetween', () => {
        expect(sortOrderBetween(10, 20)).toBe(15);
        expect(sortOrderBetween(10, undefined, 5)).toBe(11);
        expect(sortOrderBetween(10, undefined, 500)).toBe(500);
        expect(sortOrderBetween(undefined, 5000)).toBe(4000);
        expect(sortOrderBetween(undefined, undefined, 42)).toBe(42);
    });

    test('groupByStatus keeps order and buckets unknown statuses as todo', () => {
        const groups = groupByStatus([task('a', 'done', 1), task('b', 'todo', 2), task('c', 'weird' as Task['status'], 3)]);
        expect(groups.todo.map((t) => t.id)).toEqual(['b', 'c']);
        expect(groups.done.map((t) => t.id)).toEqual(['a']);
        expect(groups.in_progress).toEqual([]);
    });

    test('dropToPatch', () => {
        const byStatus = groupByStatus([task('a', 'todo', 10), task('b', 'todo', 20), task('c', 'in_progress', 30)]);

        expect(dropToPatch(byStatus, drop('a', 'todo', 0))).toBeUndefined();
        expect(dropToPatch(byStatus, drop('a', 'todo', 0, 'todo', 0))).toBeUndefined();

        // Moving "a" below "b" in the same column.
        const moved = dropToPatch(byStatus, drop('a', 'todo', 0, 'todo', 1))!;
        expect(moved.status).toBe('todo');
        expect(moved.sort_order).toBeGreaterThan(20);

        // Dropping "b" above "c" in another column.
        expect(dropToPatch(byStatus, drop('b', 'todo', 1, 'in_progress', 0))).toEqual({status: 'in_progress', sort_order: -970});

        // Dropping between two tasks.
        expect(dropToPatch(byStatus, drop('c', 'in_progress', 0, 'todo', 1))).toEqual({status: 'todo', sort_order: 15});
    });

    test('sectionColor is stable', () => {
        expect(sectionColor('abc')).toBe(sectionColor('abc'));
        expect(sectionColor('abc')).toMatch(/^#/);
    });

    test('taskSpan', () => {
        expect(taskSpan({start_at: 0, due_at: 0} as Task)).toBeUndefined();
        expect(taskSpan({start_at: 0, due_at: 5} as Task)).toEqual([5, 5]);
        expect(taskSpan({start_at: 3, due_at: 0} as Task)).toEqual([3, 3]);
        expect(taskSpan({start_at: 3, due_at: 5} as Task)).toEqual([3, 5]);
    });

    test('resizeSpan moves one edge without crossing the other', () => {
        expect(resizeSpan(5, 10, 'start', -2)).toEqual([3, 10]);
        expect(resizeSpan(5, 10, 'start', 9)).toEqual([10, 10]);
        expect(resizeSpan(5, 10, 'end', 3)).toEqual([5, 13]);
        expect(resizeSpan(5, 10, 'end', -9)).toEqual([5, 5]);
    });

    test('timelineRange covers the default window and scheduled tasks', () => {
        const now = new Date(2026, 10, 16, 15).getTime();
        const today = startOfDay(now);

        const empty = timelineRange([], now);
        expect(empty.from).toBe(addDays(today, -7));
        expect(empty.days).toBe(43);
        expect(dayIndex(empty.from, now)).toBe(7);

        const early = addDays(today, -30);
        const wide = timelineRange([{start_at: early, due_at: addDays(today, 60)} as Task], now);
        expect(wide.from).toBe(addDays(early, -2));
        expect(wide.days).toBe(dayIndex(wide.from, addDays(today, 67)) + 1);

        expect(timelineRange([{start_at: 0, due_at: addDays(today, 5000)} as Task], now).days).toBe(366);
    });

    test('a task is complete only once done and approved', () => {
        expect(isComplete({status: 'done', approval_status: 'approved'} as Task)).toBe(true);
        expect(isComplete({status: 'done', approval_status: 'pending_director'} as Task)).toBe(false);
        expect(isComplete({status: 'in_progress', approval_status: 'rejected'} as Task)).toBe(false);
    });

    test('approval locks only approved ordinary tasks of a team that runs approvals', () => {
        const approved = {approval_status: 'approved', video_file_id: ''} as Task;
        expect(isApprovalLocked(approved, true)).toBe(true);
        expect(isApprovalLocked(approved, false)).toBe(false);
        expect(isApprovalLocked({...approved, video_file_id: 'v'}, true)).toBe(false);
        expect(isApprovalLocked({...approved, approval_status: 'pending_supervisor'}, true)).toBe(false);
    });

    test('subtasks are counted per parent and hidden under a visible parent', () => {
        const parent = {id: 'p', parent_id: ''} as Task;
        const open = {id: 'a', parent_id: 'p', status: 'todo', approval_status: ''} as Task;
        const done = {id: 'b', parent_id: 'p', status: 'done', approval_status: 'approved'} as Task;
        const orphan = {id: 'c', parent_id: 'elsewhere'} as Task;

        expect(subtaskCounts([parent, open, done]).get('p')).toEqual({done: 1, total: 2});
        expect(visibleTasks([parent, open, done, orphan], false)).toEqual([parent, orphan]);
        expect(visibleTasks([parent, open, orphan], true)).toEqual([parent, open, orphan]);
    });
});

describe('folder paths', () => {
    test('a drive folder is labelled by its path from the channel root, sorted by path', () => {
        expect(folderPaths([
            {id: 'b', name: 'BOARDS', parent_id: 'e'},
            {id: 'a', name: '02_ANIMATIC', parent_id: ''},
            {id: 'e', name: 'EXPORTS', parent_id: 'a'},
            {id: 'r', name: '01_REF', parent_id: ''},
        ])).toEqual([
            {id: 'r', path: '01_REF'},
            {id: 'a', path: '02_ANIMATIC'},
            {id: 'e', path: '02_ANIMATIC/EXPORTS'},
            {id: 'b', path: '02_ANIMATIC/EXPORTS/BOARDS'},
        ]);
    });

    test('the library offers its descendants with an id, and null without a library', () => {
        const projects = {id: 'p', name: '01_PROJECTS', kind: 'projects' as const, children: [{id: 'x', name: 'X'}]};
        const children = [
            {id: 'ch', name: 'CHARACTERS', children: [{id: 'hero', name: 'HERO'}]},
            {name: 'UNAPPLIED'},
            {id: 'bg', name: 'BACKGROUNDS'},
        ];
        const library = {id: 'l', name: '03_LIBRARY', kind: 'library' as const, children};
        const layout = {channel_id: 'c', production_channel_ids: [], is_admin: false, folders: [projects, library]};
        expect(libraryFolderPaths(layout)).toEqual([
            {id: 'bg', path: '03_LIBRARY/BACKGROUNDS'},
            {id: 'ch', path: '03_LIBRARY/CHARACTERS'},
            {id: 'hero', path: '03_LIBRARY/CHARACTERS/HERO'},
        ]);
        expect(libraryFolderPaths({...layout, folders: [projects]})).toBeNull();
    });
});
