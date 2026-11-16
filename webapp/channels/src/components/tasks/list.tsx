// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DragDropContext, Draggable, Droppable} from '@hello-pangea/dnd';
import type {DropResult} from '@hello-pangea/dnd';
import classNames from 'classnames';
import React, {useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {ChevronDownIcon, ChevronRightIcon} from '@mattermost/compass-icons/components';
import type {TaskStatus} from '@mattermost/types/tasks';

import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {patchTask} from 'actions/tasks';

import {AddTask, AssigneeAvatar, DoneToggle, DueDate, SectionLabel, StatusSelect} from './task_bits';
import {dropToPatch, groupByStatus, STATUSES, statusMessages} from './task_utils';
import type {ViewProps} from './task_utils';

const List = ({teamId, tasks, sections, usersById, selectedId, onSelect, canManage}: ViewProps) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const byStatus = useMemo(() => groupByStatus(tasks), [tasks]);
    const sectionsById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
    const [collapsed, setCollapsed] = useState<Partial<Record<TaskStatus, boolean>>>({});

    const handleDragEnd = (result: DropResult) => {
        const patch = dropToPatch(byStatus, result);
        if (patch) {
            dispatch(patchTask(result.draggableId, patch));
        }
    };

    return (
        <div className='TaskList'>
            <div className='TaskList__row TaskList__row--head'>
                <FormattedMessage
                    id='tasks.list.name'
                    defaultMessage='Task name'
                />
                <FormattedMessage
                    id='tasks.detail.assignee'
                    defaultMessage='Assignee'
                />
                <FormattedMessage
                    id='tasks.detail.dueDate'
                    defaultMessage='Due date'
                />
                <FormattedMessage
                    id='tasks.detail.section'
                    defaultMessage='Section'
                />
                <FormattedMessage
                    id='tasks.detail.status'
                    defaultMessage='Status'
                />
            </div>
            <DragDropContext onDragEnd={handleDragEnd}>
                {STATUSES.map((status) => {
                    const isCollapsed = Boolean(collapsed[status]);
                    const Chevron = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
                    return (
                        <section
                            key={status}
                            className={`TaskList__group TaskStatus--${status}`}
                        >
                            <button
                                className='TaskList__groupHeader'
                                onClick={() => setCollapsed({...collapsed, [status]: !isCollapsed})}
                                aria-expanded={!isCollapsed}
                            >
                                <Chevron size={18}/>
                                <span className='TaskStatusDot'/>
                                <h2>{formatMessage(statusMessages[status])}</h2>
                                <span className='TaskBoard__count'>{byStatus[status].length}</span>
                            </button>
                            {!isCollapsed && (
                                <>
                                    <Droppable droppableId={status}>
                                        {(drop, dropSnapshot) => (
                                            <div
                                                ref={drop.innerRef}
                                                {...drop.droppableProps}
                                                className={classNames('TaskList__rows', {'TaskList__rows--over': dropSnapshot.isDraggingOver})}
                                            >
                                                {byStatus[status].map((task, index) => {
                                                    const assignee = usersById[task.assignee_id];
                                                    return (
                                                        <Draggable
                                                            key={task.id}
                                                            draggableId={task.id}
                                                            index={index}
                                                        >
                                                            {(drag, dragSnapshot) => (
                                                                <div
                                                                    ref={drag.innerRef}
                                                                    {...drag.draggableProps}
                                                                    {...drag.dragHandleProps}
                                                                    role='button'
                                                                    tabIndex={0}
                                                                    className={classNames('TaskList__row', `TaskStatus--${dragSnapshot.draggingOver ?? task.status}`, {
                                                                        'TaskList__row--dragging': dragSnapshot.isDragging,
                                                                        'TaskList__row--selected': task.id === selectedId,
                                                                    })}
                                                                    onClick={() => onSelect(task.id)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            onSelect(task.id);
                                                                        }
                                                                    }}
                                                                >
                                                                    <span className='TaskList__name'>
                                                                        <DoneToggle task={task}/>
                                                                        <span>{task.title}</span>
                                                                    </span>
                                                                    <span className='TaskList__assignee'>
                                                                        <AssigneeAvatar user={assignee}/>
                                                                        {assignee && displayUsername(assignee, nameDisplay)}
                                                                    </span>
                                                                    <span><DueDate task={task}/></span>
                                                                    <span><SectionLabel section={sectionsById.get(task.section_id)}/></span>
                                                                    <span><StatusSelect task={task}/></span>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    );
                                                })}
                                                {drop.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                    {canManage && (
                                        <AddTask
                                            teamId={teamId}
                                            status={status}
                                            count={byStatus[status].length}
                                            className='TaskList__add'
                                        />
                                    )}
                                </>
                            )}
                        </section>
                    );
                })}
            </DragDropContext>
        </div>
    );
};

export default List;
