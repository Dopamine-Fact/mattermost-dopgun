// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';
import classNames from 'classnames';
import React, {useState} from 'react';
import type {CSSProperties} from 'react';
import {FormattedDate, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {CheckboxMultipleMarkedOutlineIcon, CheckCircleIcon, CheckCircleOutlineIcon, LockOutlineIcon} from '@mattermost/compass-icons/components';
import type {Department} from '@mattermost/types/custom_roles';
import type {Task, TaskSection, TaskStatus} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getMyTeamMember, getTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {createTask, patchTask} from 'actions/tasks';

import Avatar from 'components/widgets/users/avatar';

import {imageURLForUser} from 'utils/utils';

import type {GlobalState} from 'types/store';

import BlurInput from './blur_input';
import {isOverdue} from './dates';
import {openWaitsFor, userDepartmentIds} from './task_departments';
import {approvalMessages, dropToPatch, isApprovalLocked, isComplete, sectionColor, STATUSES, statusMessages} from './task_utils';
import type {SubtaskCount} from './task_utils';

// useApprovalEnabled: whether the team runs the supervisor → director approval of done tasks.
export function useApprovalEnabled(teamId: string): boolean {
    return useSelector((state: GlobalState) => Boolean(getTeam(state, teamId)?.task_approval_enabled));
}

// useCannotFinish: a task cannot be finished while one of its subtasks, or a task it waits for, is not done and approved.
function useCannotFinish(task: Task): boolean {
    return useSelector((state: GlobalState) => {
        const byId = state.entities.tasks.byId;
        return Object.values(byId).some((t) => t.parent_id === task.id && !isComplete(t)) || openWaitsFor(task, byId).length > 0;
    });
}

// useTaskDrop handles a drag between status groups. A drop into Done while a waits-for task is open is refused (the
// card snaps back); that reason, or the server's error after patchTask rolls the card back, is the notice.
export function useTaskDrop(byStatus: Record<TaskStatus, Task[]>, byId: Record<string, Task>) {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const [notice, setNotice] = useState('');
    const onDragEnd = async (result: DropResult) => {
        const patch = dropToPatch(byStatus, result);
        const task = byId[result.draggableId];
        if (!patch || !task) {
            return;
        }
        const open = patch.status === 'done' && task.status !== 'done' ? openWaitsFor(task, byId) : [];
        if (open.length) {
            setNotice(formatMessage(
                {id: 'tasks.doneBlocked', defaultMessage: '"{title}" can\'t be done yet. It is waiting for: {titles}'},
                {title: task.title, titles: open.map((t) => t.title).join(', ')},
            ));
            return;
        }
        setNotice('');
        const saved = await dispatch(patchTask(task.id, patch)) as {error?: {message?: string}};
        if (saved.error) {
            setNotice(saved.error.message ?? '');
        }
    };
    return {onDragEnd, notice};
}

export const TaskDropNotice = ({notice}: {notice: string}) => (notice ? (
    <p
        className='TaskDetail__error'
        role='alert'
    >
        {notice}
    </p>
) : null);

// locked: the waits-for lock holds the task for this viewer, so it cannot be marked done. An approved task and a
// parent with open subtasks cannot be toggled either.
export const DoneToggle = ({task, locked}: {task: Task; locked?: boolean}) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const done = task.status === 'done';
    const Icon = done ? CheckCircleIcon : CheckCircleOutlineIcon;
    const approvalLocked = isApprovalLocked(task, useApprovalEnabled(task.team_id));
    const cannotFinish = useCannotFinish(task);

    return (
        <button
            className={classNames('TaskDoneToggle', {'TaskDoneToggle--done': done})}
            onClick={(e) => {
                e.stopPropagation();
                dispatch(patchTask(task.id, {status: done ? 'todo' : 'done'}));
            }}
            aria-pressed={done}
            disabled={locked || approvalLocked || (!done && cannotFinish)}
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

// locked: the waits-for lock holds the task for this viewer, so it cannot leave To do.
export const StatusSelect = ({task, locked}: {task: Task; locked?: boolean}) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const approvalLocked = isApprovalLocked(task, useApprovalEnabled(task.team_id));
    const cannotFinish = useCannotFinish(task);
    return (
        <select
            className={`TaskStatusPill TaskStatus--${task.status}`}
            value={task.status}
            disabled={approvalLocked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => dispatch(patchTask(task.id, {status: e.target.value as TaskStatus}))}
            aria-label={formatMessage({id: 'tasks.statusOf', defaultMessage: 'Status of {title}'}, {title: task.title})}
        >
            {STATUSES.map((status) => (
                <option
                    key={status}
                    value={status}
                    disabled={status !== task.status && (locked || (status === 'done' && cannotFinish))}
                >
                    {formatMessage(statusMessages[status])}
                </option>
            ))}
        </select>
    );
};

// DepartmentChip names the department a task is for; departments is undefined until loaded, and revisions have none.
export const DepartmentChip = ({task, departments}: {task: Task; departments?: Department[]}) => {
    if (!departments || !task.department_id || task.video_file_id) {
        return null;
    }
    const department = departments.find((d) => d.id === task.department_id);
    return (
        <span
            className='TaskLabel'
            style={{'--task-label-color': department?.color || sectionColor(task.department_id)} as CSSProperties}
        >
            {department ? department.name : (
                <FormattedMessage
                    id='tasks.department.deleted'
                    defaultMessage='Deleted department'
                />
            )}
        </span>
    );
};

// ApprovalBadge shows where a done task is in the approval chain; an approval given on arrival (no chain) is not shown.
export const ApprovalBadge = ({task}: {task: Task}) => {
    const {formatMessage} = useIntl();
    const approvalEnabled = useApprovalEnabled(task.team_id);
    const status = task.approval_status;
    if (!status || task.video_file_id || (status === 'approved' && !approvalEnabled)) {
        return null;
    }
    return (
        <span className={`TaskApproval TaskApproval--${status}`}>
            {formatMessage(approvalMessages[status])}
        </span>
    );
};

// SubtaskBadge shows how many of a parent's subtasks are done and approved.
export const SubtaskBadge = ({count}: {count?: SubtaskCount}) => {
    const {formatMessage} = useIntl();
    if (!count) {
        return null;
    }
    return (
        <span
            className='TaskSubtaskCount'
            title={formatMessage({id: 'tasks.subtasks.count', defaultMessage: '{done} of {total} subtasks done'}, {...count})}
        >
            <CheckboxMultipleMarkedOutlineIcon size={12}/>
            <FormattedMessage
                id='tasks.subtasks.progress'
                defaultMessage='{done}/{total}'
                values={{...count}}
            />
        </span>
    );
};

// ParentLabel names a subtask's parent on the subtask's own card.
export const ParentLabel = ({task, byId}: {task: Task; byId: Record<string, Task>}) => {
    const parent = task.parent_id ? byId[task.parent_id] : undefined;
    if (!parent) {
        return null;
    }
    return (
        <span className='TaskParentLabel'>
            <FormattedMessage
                id='tasks.subtasks.parent'
                defaultMessage='↳ {title}'
                values={{title: parent.title}}
            />
        </span>
    );
};

// SubtasksToggle shows subtasks as their own cards; hidden (by default) they are reached from their parent.
export const SubtasksToggle = ({tasks, checked, onChange}: {tasks: Task[]; checked: boolean; onChange: (checked: boolean) => void}) => {
    if (!tasks.some((t) => t.parent_id)) {
        return null;
    }
    return (
        <label className='TaskSubtasksToggle'>
            <input
                type='checkbox'
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
            <FormattedMessage
                id='tasks.subtasks.show'
                defaultMessage='Show subtasks'
            />
        </label>
    );
};

// LockLine says which tasks hold this one back; compact shows just the icon.
export const LockLine = ({waitingFor, compact}: {waitingFor: Task[]; compact?: boolean}) => {
    const {formatMessage} = useIntl();
    if (!waitingFor.length) {
        return null;
    }
    const text = formatMessage({id: 'tasks.waitingFor', defaultMessage: 'Waiting for: {titles}'}, {titles: waitingFor.map((t) => t.title).join(', ')});
    return (
        <span
            className='TaskLock'
            aria-label={compact ? text : undefined}
            title={text}
        >
            <LockOutlineIcon size={12}/>
            {!compact && text}
        </span>
    );
};

// TakeItButton lets a member of the task's department claim it while nobody has it; locked disables it.
export const TakeItButton = ({task, departments, locked}: {task: Task; departments?: Department[]; locked?: boolean}) => {
    const dispatch = useDispatch();
    const me = useSelector(getCurrentUserId);
    const roles = useSelector((state: GlobalState) => getMyTeamMember(state, task.team_id)?.roles ?? '');
    if (!departments || !task.department_id || task.assignee_id || task.video_file_id || !userDepartmentIds(roles, departments).has(task.department_id)) {
        return null;
    }
    return (
        <button
            className='btn btn-primary btn-sm TaskTakeIt'
            disabled={locked}
            onClick={(e) => {
                e.stopPropagation();
                dispatch(patchTask(task.id, {assignee_id: me}));
            }}
        >
            <FormattedMessage
                id='tasks.takeIt'
                defaultMessage='Take it'
            />
        </button>
    );
};

type AddTaskProps = {
    teamId: string;
    status: TaskStatus;
    count: number;
    className: string;

    // sectionId files the new task under that section (the Tasks tab of a linked channel).
    sectionId?: string;
};

export const AddTask = ({teamId, status, count, className, sectionId}: AddTaskProps) => {
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
            onSave={(title) => dispatch(createTask({team_id: teamId, title, status, ...(sectionId ? {section_id: sectionId} : {})}))}
            aria-label={formatMessage({id: 'tasks.addTask.label', defaultMessage: 'New task title'})}
        />
    );
};
