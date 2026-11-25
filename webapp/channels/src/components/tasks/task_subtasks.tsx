// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useMemo} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {Task} from '@mattermost/types/tasks';

import {createTask} from 'actions/tasks';

import type {GlobalState} from 'types/store';

import BlurInput from './blur_input';
import {ApprovalBadge, DoneToggle} from './task_bits';
import {isComplete} from './task_utils';

type Props = {
    task: Task;

    // canManage: the viewer may create tasks (a subtask is a new task).
    canManage: boolean;
    onSelect?: (taskId: string) => void;
};

// TaskSubtasks links a subtask to its parent, and lists a parent's subtasks (one level deep) with their progress.
const TaskSubtasks = ({task, canManage, onSelect}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const byId = useSelector((state: GlobalState) => state.entities.tasks.byId);
    const subtasks = useMemo(
        () => Object.values(byId).filter((t) => t.parent_id === task.id).sort((a, b) => a.sort_order - b.sort_order),
        [byId, task.id],
    );

    if (task.video_file_id) {
        return null;
    }
    const parent = task.parent_id ? byId[task.parent_id] : undefined;
    if (parent) {
        return (
            <button
                className='TaskDetail__parent'
                onClick={() => onSelect?.(parent.id)}
            >
                <FormattedMessage
                    id='tasks.subtasks.subtaskOf'
                    defaultMessage='Subtask of {title}'
                    values={{title: parent.title}}
                />
            </button>
        );
    }

    // A parent in Done takes no new open work; the server refuses it too.
    const canAdd = canManage && task.status !== 'done';
    if (!subtasks.length && !canAdd) {
        return null;
    }
    return (
        <div className='TaskDetail__field TaskSubtasks'>
            <FormattedMessage
                id='tasks.subtasks.title'
                defaultMessage='Subtasks ({done}/{total})'
                values={{done: subtasks.filter(isComplete).length, total: subtasks.length}}
            />
            {subtasks.length > 0 && (
                <ul className='TaskSubtasks__list'>
                    {subtasks.map((sub) => (
                        <li
                            key={sub.id}
                            className='TaskSubtasks__item'
                        >
                            <DoneToggle task={sub}/>
                            <button
                                className='TaskSubtasks__title'
                                onClick={() => onSelect?.(sub.id)}
                            >
                                {sub.title}
                            </button>
                            <ApprovalBadge task={sub}/>
                        </li>
                    ))}
                </ul>
            )}
            {canAdd && (

                // Keyed on the count so the field clears once the new subtask arrives.
                <BlurInput
                    key={subtasks.length}
                    className='TaskSubtasks__add form-control'
                    value=''
                    maxLength={512}
                    placeholder={formatMessage({id: 'tasks.subtasks.add', defaultMessage: '+ Add subtask'})}
                    onSave={(title) => dispatch(createTask({team_id: task.team_id, title, parent_id: task.id, section_id: task.section_id}))}
                    aria-label={formatMessage({id: 'tasks.subtasks.add.label', defaultMessage: 'New subtask title'})}
                />
            )}
        </div>
    );
};

export default TaskSubtasks;
