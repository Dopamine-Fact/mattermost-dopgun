// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {FileInfo} from '@mattermost/types/files';
import type {TaskComment} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import TaskComments from './task_comments';

const me = TestHelper.getUserMock({id: 'me', username: 'ayse'});
const other = TestHelper.getUserMock({id: 'other', username: 'mehmet'});
const file = {id: 'file1', name: 'plan.png', mime_type: 'image/png'} as FileInfo;
const comment = (id: string, userId: string, extra: Partial<TaskComment> = {}): TaskComment => ({
    id,
    task_id: 'task1',
    user_id: userId,
    message: `message ${id}`,
    file_ids: [],
    create_at: 1700000000000,
    ...extra,
});

const state = {
    entities: {
        users: {
            currentUserId: 'me',
            profiles: {me, other},
            statuses: {other: 'online'},
        },
    },
};

const renderComments = (canManage = false) => renderWithContext(
    <TaskComments
        taskId='task1'
        canManage={canManage}
    />,
    state,
);

describe('TaskComments', () => {
    afterEach(() => jest.restoreAllMocks());

    test('lists comments with files and lets authors delete only their own', async () => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([
            comment('c1', 'other', {file_ids: ['file1'], files: [file]}),
            comment('c2', 'me'),
        ]);
        const remove = jest.spyOn(Client4, 'deleteTaskComment').mockResolvedValue({status: 'OK'});
        renderComments();

        expect(await screen.findByText('message c1')).toBeInTheDocument();
        expect(screen.getByText('mehmet')).toBeInTheDocument();
        expect(screen.getByRole('img', {name: 'plan.png'})).toHaveAttribute('src', expect.stringContaining('/task_comments/c1/files/file1'));
        expect(screen.getByRole('link', {name: 'plan.png'})).toHaveAttribute('href', expect.stringContaining('?download=1'));

        const deleteButtons = screen.getAllByRole('button', {name: 'Delete comment'});
        expect(deleteButtons).toHaveLength(1);
        fireEvent.click(deleteButtons[0]);
        await waitFor(() => expect(screen.queryByText('message c2')).not.toBeInTheDocument());
        expect(remove).toHaveBeenCalledWith('c2');
    });

    test('authors show their status and open the profile card like posts do', async () => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([comment('c1', 'other')]);
        renderComments();
        await screen.findByText('message c1');

        const author = document.querySelector('.TaskComment')!;
        expect(author.querySelector('.status')).not.toBeNull();
        expect(author.querySelector('button.status-wrapper')).not.toBeNull();
    });

    test('managers can delete any comment', async () => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([comment('c1', 'other'), comment('c2', 'me')]);
        renderComments(true);
        await screen.findByText('message c1');
        expect(screen.getAllByRole('button', {name: 'Delete comment'})).toHaveLength(2);
    });

    test('sends text with attached files', async () => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
        const create = jest.spyOn(Client4, 'createTaskComment').mockResolvedValue(comment('c3', 'me', {message: 'done'}));
        renderComments();

        const send = screen.getByRole('button', {name: 'Send'});
        expect(send).toBeDisabled();

        const upload = new File(['x'], 'notes.txt', {type: 'text/plain'});
        fireEvent.change(screen.getByLabelText('Attach files'), {target: {files: [upload]}});
        expect(screen.getByText('notes.txt')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', {name: 'Comment'}), {target: {value: 'done'}});
        fireEvent.click(send);

        expect(await screen.findByText('done')).toBeInTheDocument();
        expect(create).toHaveBeenCalledWith('task1', 'done', [upload]);
        expect(screen.getByRole('textbox', {name: 'Comment'})).toHaveValue('');
        expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
    });

    test('shows the server error and keeps the draft', async () => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
        jest.spyOn(Client4, 'createTaskComment').mockRejectedValue(new Error('A comment can have at most 10 files.'));
        renderComments();

        fireEvent.change(screen.getByRole('textbox', {name: 'Comment'}), {target: {value: 'draft'}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));

        expect(await screen.findByText('A comment can have at most 10 files.')).toBeInTheDocument();
        expect(screen.getByRole('textbox', {name: 'Comment'})).toHaveValue('draft');
    });
});
