// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';
import React from 'react';

import type {Department} from '@mattermost/types/custom_roles';
import type {Task, TaskSection} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {patchTask} from 'actions/tasks';

import {act, fireEvent, renderHookWithContext, renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import Board from './board';
import List from './list';
import {useTaskDrop} from './task_bits';
import {addDays, groupByStatus, startOfDay} from './task_utils';
import Timeline from './timeline';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    patchTask: jest.fn(() => ({type: 'MOCK_PATCH_TASK'})),
}));

const user = TestHelper.getUserMock({id: 'user1', username: 'ayse'});
const section: TaskSection = {id: 'sec1', team_id: 'team1', name: 'Design', sort_order: 1, channel_id: '', video_file_id: '', create_at: 1, update_at: 1};
const today = startOfDay(Date.now());
const task = (id: string, status: Task['status'], extra: Partial<Task> = {}): Task => ({
    id,
    team_id: 'team1',
    section_id: '',
    title: `Task ${id}`,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status,
    sort_order: 1,
    video_time: 0,
    video_file_id: '',
    creator_id: 'user1',
    create_at: 1,
    update_at: 1,
    department_id: '',
    waits_for: [],
    folder_id: '',
    parent_id: '',
    approval_status: '',
    ...extra,
});

const props = {
    teamId: 'team1',
    tasks: [
        task('a', 'todo', {section_id: 'sec1', assignee_id: 'user1', start_at: today, due_at: addDays(today, 3)}),
        task('b', 'in_progress', {due_at: addDays(today, -1)}),
        task('c', 'done'),
    ],
    sections: [section],
    usersById: {user1: user},
    selectedId: '',
    onSelect: jest.fn(),
    canManage: true,
};

describe('task views', () => {
    test('board shows a column per status with its cards', () => {
        renderWithContext(<Board {...props}/>);
        expect(screen.getByRole('heading', {name: 'To do'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: 'In progress'})).toBeInTheDocument();
        expect(screen.getByRole('heading', {name: 'Done'})).toBeInTheDocument();
        expect(screen.getByText('Task a').closest('.TaskCard')).toHaveClass('TaskStatus--todo');
        expect(screen.getByText('Task c').closest('.TaskCard')).toHaveClass('TaskStatus--done');
        expect(screen.getByText('Design')).toBeInTheDocument();
    });

    test('list groups tasks and shows a status picker per row', () => {
        renderWithContext(<List {...props}/>);
        expect(screen.getByRole('combobox', {name: 'Status of Task b'})).toHaveValue('in_progress');
        expect(screen.getAllByRole('button', {name: /Mark Task . as done/})).toHaveLength(3);
    });

    test('timeline draws a bar only for scheduled tasks', () => {
        renderWithContext(<Timeline {...props}/>);
        expect(screen.getByRole('button', {name: 'Task a'}).closest('.TaskBar')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Task b'}).closest('.TaskBar')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Task c'})).not.toBeInTheDocument();
        expect(screen.getByText(/1 task has no dates/)).toBeInTheDocument();
    });

    test('members without manage_tasks get no create or section controls', () => {
        const manager = renderWithContext(<Board {...props}/>);
        expect(screen.getAllByRole('textbox', {name: 'New task title'})).toHaveLength(3);
        manager.unmount();

        const member = renderWithContext(<Board {...{...props, canManage: false}}/>);
        expect(screen.queryByRole('textbox', {name: 'New task title'})).not.toBeInTheDocument();
        member.unmount();

        renderWithContext(<Timeline {...{...props, canManage: false}}/>);
        expect(screen.getByText('Design')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: 'Section name'})).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', {name: 'New section name'})).not.toBeInTheDocument();
    });

    test('dragging a bar edge saves the new dates', () => {
        // jsdom has no PointerEvent; MouseEvent carries the clientX the handles read.
        window.PointerEvent ??= window.MouseEvent as typeof PointerEvent;
        Element.prototype.setPointerCapture = jest.fn();
        renderWithContext(<Timeline {...props}/>);
        const bar = screen.getByRole('button', {name: 'Task a'}).closest('.TaskBar')!;
        const end = bar.querySelector('.TaskBar__handle--end')!;

        // Two days to the right (DAY_WIDTH is 36px).
        fireEvent.pointerDown(end, {clientX: 100, pointerId: 1});
        fireEvent.pointerMove(end, {clientX: 172, pointerId: 1});
        expect(bar).toHaveClass('TaskBar--resizing');
        fireEvent.pointerUp(end, {clientX: 172, pointerId: 1});

        expect(patchTask).toHaveBeenCalledWith('a', {start_at: today, due_at: addDays(today, 5)});
        expect(bar).not.toHaveClass('TaskBar--resizing');
    });

    test('list and board rows show the department and the lock', async () => {
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue([{id: 'anim', name: 'Animation', color: '#112233', ranks: []} as unknown as Department]);
        const tasks = [
            task('a', 'todo', {department_id: 'anim', waits_for: ['b']}),
            task('b', 'in_progress'),
        ];
        const viewProps = {...props, tasks};
        const view = renderWithContext(<List {...viewProps}/>);
        expect(await screen.findByText('Animation')).toBeInTheDocument();
        expect(screen.getAllByLabelText('Waiting for: Task b')).toHaveLength(1);
        view.unmount();

        renderWithContext(<Board {...viewProps}/>);
        expect(await screen.findByText('Animation')).toBeInTheDocument();
        expect(screen.getAllByLabelText('Waiting for: Task b')).toHaveLength(1);
    });
});

describe('useTaskDrop', () => {
    const waiting = task('w', 'in_progress', {waits_for: ['p']});
    const pre = task('p', 'todo');
    const byId = {w: waiting, p: pre};
    const byStatus = groupByStatus([waiting, pre]);
    const drop = (id: string, from: string, to: string) => ({draggableId: id, source: {droppableId: from, index: 0}, destination: {droppableId: to, index: 0}}) as DropResult;

    beforeEach(() => jest.mocked(patchTask).mockClear());

    test('refuses a drop into Done while a waits-for task is open and names it', async () => {
        const {result} = renderHookWithContext(() => useTaskDrop(byStatus, byId));
        await act(() => result.current.onDragEnd(drop('w', 'in_progress', 'done')));
        expect(patchTask).not.toHaveBeenCalled();
        expect(result.current.notice).toBe('"Task w" can\'t be done yet. It is waiting for: Task p');
    });

    test('saves other drops and shows the server error when the save is refused', async () => {
        jest.mocked(patchTask).mockReturnValueOnce((() => Promise.resolve({error: {message: 'Refused by the server'}})) as unknown as ReturnType<typeof patchTask>);
        const {result} = renderHookWithContext(() => useTaskDrop(byStatus, byId));
        await act(() => result.current.onDragEnd(drop('p', 'todo', 'in_progress')));
        expect(patchTask).toHaveBeenCalledWith('p', expect.objectContaining({status: 'in_progress'}));
        expect(result.current.notice).toBe('Refused by the server');
    });
});
