// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import type {CSSProperties} from 'react';
import {FormattedDate, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {CheckCircleIcon, CheckCircleOutlineIcon} from '@mattermost/compass-icons/components';
import type {Task, TaskSection, TaskStatus} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {createTask, patchTask} from 'actions/tasks';

import Avatar from 'components/widgets/users/avatar';

import {imageURLForUser} from 'utils/utils';

import BlurInput from './blur_input';
import {isOverdue} from './dates';
import {sectionColor, STATUSES, statusMessages} from './task_utils';

export const DoneToggle = ({task}: {task: Task}) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const done = task.status === 'done';
    const Icon = done ? CheckCircleIcon : CheckCircleOutlineIcon;

    return (
        <button
            className={classNames('TaskDoneToggle', {'TaskDoneToggle--done': done})}
            onClick={(e) => {
                e.stopPropagation();
                dispatch(patchTask(task.id, {status: done ? 'todo' : 'done'}));
            }}
            aria-pressed={done}
            aria-label={formatMessage({id: 'tasks.markDone', defaultMessage: 'Mark {title} as done'}, {title: task.title})}
        >
            <Icon size={16}/>
        </button>
    );
};

export const SectionLabel = ({section}: {section?: TaskSection}) => {
    if (!section) {
        return null;
    }
    return (
        <span
            className='TaskLabel'
            style={{'--task-label-color': sectionColor(section.id)} as CSSProperties}
        >
            {section.name}
        </span>
    );
};

export const AssigneeAvatar = ({user}: {user?: UserProfile}) => {
    if (!user) {
        return null;
    }
    return (
        <Avatar
            size='xs'
            username={user.username}
            url={imageURLForUser(user.id, user.last_picture_update)}
        />
    );
};

// AssigneeLabel names who a task is for, with their picture, or says nobody is.
export const AssigneeLabel = ({user}: {user?: UserProfile}) => {
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    return (
        <span className='TaskAssigneeLabel'>
            {user ? (
                <>
                    <AssigneeAvatar user={user}/>
                    <span>{displayUsername(user, nameDisplay)}</span>
                </>
            ) : (
                <FormattedMessage
                    id='tasks.detail.unassigned'
                    defaultMessage='Unassigned'
                />
            )}
        </span>
    );
};

export const DueDate = ({task}: {task: Task}) => {
    if (!task.due_at) {
        return null;
    }
    return (
        <span className={classNames('TaskDue', {'TaskDue--overdue': task.status !== 'done' && isOverdue(task.due_at)})}>
            <FormattedDate
                value={task.due_at}
                month='short'
                day='numeric'
            />
        </span>
    );
};

export const StatusSelect = ({task}: {task: Task}) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    return (
        <select
            className={`TaskStatusPill TaskStatus--${task.status}`}
            value={task.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => dispatch(patchTask(task.id, {status: e.target.value as TaskStatus}))}
            aria-label={formatMessage({id: 'tasks.statusOf', defaultMessage: 'Status of {title}'}, {title: task.title})}
        >
            {STATUSES.map((status) => (
                <option
                    key={status}
                    value={status}
                >
                    {formatMessage(statusMessages[status])}
                </option>
            ))}
        </select>
    );
};

type AddTaskProps = {
    teamId: string;
    status: TaskStatus;
    count: number;
    className: string;
};

export const AddTask = ({teamId, status, count, className}: AddTaskProps) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    return (

        // Keyed on the count so the field clears once the new task arrives.
        <BlurInput
            key={count}
            className={className}
            value=''
            maxLength={512}
            placeholder={formatMessage({id: 'tasks.addTask', defaultMessage: '+ Add task'})}
            onSave={(title) => dispatch(createTask({team_id: teamId, title, status}))}
            aria-label={formatMessage({id: 'tasks.addTask.label', defaultMessage: 'New task title'})}
        />
    );
};
