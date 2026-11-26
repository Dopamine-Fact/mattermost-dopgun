// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Task, TaskSection, TaskStage} from '@mattermost/types/tasks';

import {createTaskStage, fetchTeamStages, patchTaskStage} from 'actions/tasks';

import {fireEvent, renderWithContext, screen, within} from 'tests/react_testing_utils';

import Stages from './stages';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    createTaskStage: jest.fn(() => () => Promise.resolve({data: {}})),
    patchTaskStage: jest.fn(() => () => Promise.resolve({data: {}})),
    deleteTaskStage: jest.fn(() => () => Promise.resolve({data: true})),
    fetchTeamStages: jest.fn(() => () => Promise.resolve({data: []})),
}));

const section: TaskSection = {id: 'sec1', team_id: 'team1', name: 'Episode 1', sort_order: 1, channel_id: '', video_file_id: '', create_at: 1, update_at: 1};
const task = (id: string, extra: Partial<Task> = {}): Task => ({
    id,
    team_id: 'team1',
    section_id: 'sec1',
    title: `Task ${id}`,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status: 'todo',
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
const stage = (id: string, sortOrder: number, taskIds: string[]): TaskStage => ({
    id,
    team_id: 'team1',
    section_id: 'sec1',
    name: `Stage ${id}`,
    sort_order: sortOrder,
    task_ids: taskIds,
    create_at: 1,
    update_at: 1,

    // Stale server copies: the view derives both from the tasks.
    status: 'not_started',
    current: false,
});

const tasks = [
    task('a', {status: 'done', approval_status: 'approved'}),
    task('b', {status: 'in_progress'}),
    task('c'),
    task('free'),
    task('revision', {video_file_id: 'file1'}),
];

const renderStages = (canManage: boolean, extra: {sectionId?: string; compact?: boolean} = {}) => renderWithContext(
    <Stages
        teamId='team1'
        tasks={tasks}
        sections={[section]}
        usersById={{}}
        selectedId=''
        onSelect={jest.fn()}
        canManage={canManage}
        {...extra}
    />,
    {entities: {tasks: {byId: {}, sectionsById: {}, stagesById: {s3: stage('s3', 3, ['c']), s1: stage('s1', 1, ['a']), s2: stage('s2', 2, ['b'])}}}},
);

describe('Stages', () => {
    test('shows stages in order with status from their tasks, the current and the next stage', () => {
        renderStages(false);
        const cards = screen.getAllByRole('listitem').filter((li) => li.classList.contains('TaskStage'));
        expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['Stage s1', 'Stage s2', 'Stage s3']);
        expect(within(cards[0]).getByText('Done')).toBeInTheDocument();
        expect(within(cards[1]).getByText('In progress')).toBeInTheDocument();
        expect(within(cards[1]).getByText('Current stage')).toBeInTheDocument();
        expect(within(cards[2]).getByText('Not started')).toBeInTheDocument();
        expect(within(cards[2]).getByText('Next')).toBeInTheDocument();

        // Read-only without manage_tasks.
        expect(screen.queryByRole('button', {name: 'Delete stage'})).toBeNull();
        expect(screen.queryByPlaceholderText('New stage name')).toBeNull();
    });

    test('loads the stages and offers a section picker', () => {
        renderStages(false);
        expect(fetchTeamStages).toHaveBeenCalledWith('team1');
        expect(screen.getByText('Task a')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    test('a fixed, compact overview has no picker, task lists or editing and loads nothing itself', () => {
        jest.mocked(fetchTeamStages).mockClear();
        renderStages(true, {sectionId: 'sec1', compact: true});
        expect(fetchTeamStages).not.toHaveBeenCalled();
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.queryByText('Task a')).toBeNull();
        expect(screen.queryByPlaceholderText('New stage name')).toBeNull();
        expect(screen.getAllByRole('progressbar').map((b) => b.getAttribute('aria-valuenow'))).toEqual(['1', '0', '0']);
    });

    test('managers link only unlinked ordinary tasks and add stages', () => {
        renderStages(true);
        const picker = screen.getAllByRole('combobox', {name: 'Add a task to the stage'})[0];
        expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Add a task to the stage', 'Task free']);

        fireEvent.change(picker, {target: {value: 'free'}});
        expect(patchTaskStage).toHaveBeenCalledWith('s1', {task_ids: ['a', 'free']});

        fireEvent.change(screen.getByPlaceholderText('New stage name'), {target: {value: ' Compositing '}});
        fireEvent.click(screen.getByRole('button', {name: 'Add stage'}));
        expect(createTaskStage).toHaveBeenCalledWith({team_id: 'team1', section_id: 'sec1', name: 'Compositing'});
    });
});
