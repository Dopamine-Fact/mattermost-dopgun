// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {CloseIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Task, TaskPatch, TaskSection} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {deleteTask, patchTask} from 'actions/tasks';

import BlurInput from './blur_input';
import {fromDateInput, toDateInput} from './dates';
import {StatusSelect} from './task_bits';
import TaskComments from './task_comments';

type Props = {
    task: Task;
    sections: TaskSection[];
    members: UserProfile[];
    displayName: (user: UserProfile) => string;
    onClose: () => void;
    canManage: boolean;
};

const TaskDetail = ({task, sections, members, displayName, onClose, canManage}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const save = (patch: TaskPatch) => dispatch(patchTask(task.id, patch));
    const currentUserId = useSelector(getCurrentUserId);

    // The server only lets a role assign to members it outranks; offer just those (null: not known, offer all).
    // Revisions (tasks pinned to a video version) are given by manage_revisions, the rest by manage_tasks.
    const permission = task.video_file_id ? 'manage_revisions' : 'manage_tasks';
    const [actionable, setActionable] = useState<Set<string> | null>(null);
    useEffect(() => {
        if (!canManage) {
            return undefined;
        }
        let live = true;
        Client4.getActionableUserIds(task.team_id, permission).then((ids) => live && setActionable(new Set(ids)), () => {});
        return () => {
            live = false;
        };
    }, [task.team_id, canManage, permission]);
    const assignable = members.filter((u) => !actionable || actionable.has(u.id) || u.id === currentUserId || u.id === task.assignee_id);

    return (
        <aside
            className='TaskDetail'
            aria-label={formatMessage({id: 'tasks.detail.label', defaultMessage: 'Task details'})}
        >
            <div className='TaskDetail__header'>
                <span className='TaskDetail__status'>
                    <StatusSelect task={task}/>
                </span>
                {canManage && (
                    <button
                        className='btn btn-icon btn-sm'
                        onClick={() => {
                            dispatch(deleteTask(task.id));
                            onClose();
                        }}
                        aria-label={formatMessage({id: 'tasks.detail.delete', defaultMessage: 'Delete task'})}
                    >
                        <TrashCanOutlineIcon size={18}/>
                    </button>
                )}
                <button
                    className='btn btn-icon btn-sm'
                    onClick={onClose}
                    aria-label={formatMessage({id: 'tasks.detail.close', defaultMessage: 'Close'})}
                >
                    <CloseIcon size={18}/>
                </button>
            </div>

            <BlurInput
                className='TaskDetail__title form-control'
                value={task.title}
                maxLength={512}
                onSave={(title) => save({title})}
                aria-label={formatMessage({id: 'tasks.detail.title', defaultMessage: 'Task title'})}
            />

            <label className='TaskDetail__field'>
                <FormattedMessage
                    id='tasks.detail.assignee'
                    defaultMessage='Assignee'
                />
                <select
                    className='form-control'
                    value={task.assignee_id}
                    disabled={!canManage}
                    onChange={(e) => save({assignee_id: e.target.value})}
                >
                    <option value=''>{formatMessage({id: 'tasks.detail.unassigned', defaultMessage: 'Unassigned'})}</option>
                    {assignable.map((user) => (
                        <option
                            key={user.id}
                            value={user.id}
                        >
                            {displayName(user)}
                        </option>
                    ))}
                </select>
            </label>

            <div className='TaskDetail__dates'>
                <label className='TaskDetail__field'>
                    <FormattedMessage
                        id='tasks.detail.startDate'
                        defaultMessage='Start date'
                    />
                    <input
                        type='date'
                        className='form-control'
                        value={toDateInput(task.start_at)}
                        max={toDateInput(task.due_at) || undefined}
                        onChange={(e) => save({start_at: fromDateInput(e.target.value)})}
                    />
                </label>
                <label className='TaskDetail__field'>
                    <FormattedMessage
                        id='tasks.detail.dueDate'
                        defaultMessage='Due date'
                    />
                    <input
                        type='date'
                        className='form-control'
                        value={toDateInput(task.due_at)}
                        min={toDateInput(task.start_at) || undefined}
                        onChange={(e) => save({due_at: fromDateInput(e.target.value)})}
                    />
                </label>
            </div>

            <label className='TaskDetail__field'>
                <FormattedMessage
                    id='tasks.detail.section'
                    defaultMessage='Section'
                />
                <select
                    className='form-control'
                    value={task.section_id}
                    disabled={Boolean(task.video_file_id)}
                    onChange={(e) => save({section_id: e.target.value})}
                >
                    <option value=''>{formatMessage({id: 'tasks.noSection', defaultMessage: 'No section'})}</option>
                    {sections.map((section) => (
                        <option
                            key={section.id}
                            value={section.id}
                        >
                            {section.name}
                        </option>
                    ))}
                </select>
            </label>

            <div className='TaskDetail__field'>
                <FormattedMessage
                    id='tasks.detail.description'
                    defaultMessage='Description'
                />
                <BlurInput
                    multiline={true}
                    allowEmpty={true}
                    className='form-control'
                    value={task.description}
                    maxLength={16000}
                    onSave={(description) => save({description})}
                    aria-label={formatMessage({id: 'tasks.detail.description', defaultMessage: 'Description'})}
                />
            </div>

            <TaskComments
                taskId={task.id}
                canManage={canManage}
            />
        </aside>
    );
};

export default TaskDetail;
