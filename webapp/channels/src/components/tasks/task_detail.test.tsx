// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Task} from '@mattermost/types/tasks';

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
        expect(actionable).toHaveBeenCalledWith('team1');
    });
});
