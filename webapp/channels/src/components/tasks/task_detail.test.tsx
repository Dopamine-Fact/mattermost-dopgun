// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Task, TaskSection} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import TaskDetail from './task_detail';

const me = TestHelper.getUserMock({id: 'me', username: 'me'});
const anim = TestHelper.getUserMock({id: 'anim', username: 'anim'});
const lead = TestHelper.getUserMock({id: 'lead', username: 'lead'});
const old = TestHelper.getUserMock({id: 'old', username: 'old'});

const task: Task = {
    id: 't1',
    team_id: 'team1',
    section_id: '',
    title: 'Walk cycle',
    description: '',
    assignee_id: 'old',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: 0,
    video_file_id: '',
    creator_id: 'me',
    create_at: 1,
    update_at: 1,
};

describe('TaskDetail assignee picker', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
    });

    test('offers only the members the viewer may assign, plus themself and the current assignee', async () => {
        const actionable = jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderWithContext(
            <TaskDetail
                task={task}
                sections={[]}
                members={[me, anim, lead, old]}
                displayName={(u) => u.username}
                onClose={jest.fn()}
                canManage={true}
            />,
            {entities: {users: {currentUserId: 'me', profiles: {me}}}},
        );

        const picker = screen.getByRole('combobox', {name: 'Assignee'});
        await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Unassigned', 'me', 'anim', 'old']));
        expect(actionable).toHaveBeenCalledWith('team1', 'manage_tasks');
    });

    const renderDetail = (t: Task, sections: TaskSection[]) => renderWithContext(
        <TaskDetail
            task={t}
            sections={sections}
            members={[me, anim, lead, old]}
            displayName={(u) => u.username}
            onClose={jest.fn()}
            canManage={true}
        />,
        {entities: {users: {currentUserId: 'me', profiles: {me}}}},
    );
    const linked: TaskSection = {id: 'rev', team_id: 'team1', name: 'Rev', sort_order: 0, channel_id: 'ch1', video_file_id: 'file1', create_at: 1, update_at: 1};

    test('a revision asks who the viewer may give revisions to', async () => {
        const actionable = jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderDetail({...task, section_id: 'rev', video_file_id: 'file1'}, [linked]);
        await waitFor(() => expect(actionable).toHaveBeenCalledWith('team1', 'manage_revisions'));
    });

    test('an ordinary task in a revision section asks for manage_tasks', async () => {
        const actionable = jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderDetail({...task, section_id: 'rev'}, [linked]);
        await waitFor(() => expect(actionable).toHaveBeenCalledWith('team1', 'manage_tasks'));
        expect(actionable).not.toHaveBeenCalledWith('team1', 'manage_revisions');
    });

    test("a revision's section cannot be changed", async () => {
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
        renderDetail({...task, section_id: 'rev', video_file_id: 'file1'}, [linked]);
        expect(screen.getByRole('combobox', {name: 'Section'})).toBeDisabled();
    });

    test("an ordinary task's section can be changed", async () => {
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
        renderDetail({...task, section_id: 'rev'}, [linked]);
        expect(screen.getByRole('combobox', {name: 'Section'})).toBeEnabled();
    });
});
