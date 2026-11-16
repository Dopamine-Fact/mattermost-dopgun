// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DragDropContext, Draggable, Droppable} from '@hello-pangea/dnd';
import type {DropResult} from '@hello-pangea/dnd';
import classNames from 'classnames';
import React, {useMemo} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';

import {patchTask} from 'actions/tasks';

import {AddTask, AssigneeAvatar, DoneToggle, DueDate, SectionLabel} from './task_bits';
import {dropToPatch, groupByStatus, STATUSES, statusMessages} from './task_utils';
import type {ViewProps} from './task_utils';

const Board = ({teamId, tasks, sections, usersById, selectedId, onSelect, canManage}: ViewProps) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const byStatus = useMemo(() => groupByStatus(tasks), [tasks]);
    const sectionsById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

    const handleDragEnd = (result: DropResult) => {
        const patch = dropToPatch(byStatus, result);
        if (patch) {
            dispatch(patchTask(result.draggableId, patch));
        }
    };

    return (
        <DragDropContext onDragEnd={handleDragEnd}>
            <div className='TaskBoard'>
                {STATUSES.map((status) => (
                    <section
                        key={status}
                        className={`TaskBoard__column TaskStatus--${status}`}
                    >
                        <header className='TaskBoard__columnHeader'>
                            <span className='TaskStatusDot'/>
                            <h2>{formatMessage(statusMessages[status])}</h2>
                            <span className='TaskBoard__count'>{byStatus[status].length}</span>
                        </header>
                        <Droppable droppableId={status}>
                            {(drop, dropSnapshot) => (
                                <div
                                    ref={drop.innerRef}
                                    {...drop.droppableProps}
                                    className={classNames('TaskBoard__cards', {'TaskBoard__cards--over': dropSnapshot.isDraggingOver})}
                                >
                                    {byStatus[status].map((task, index) => (
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

                                                    // While dragging, the card takes the colour of the column it is over.
                                                    className={classNames('TaskCard', `TaskStatus--${dragSnapshot.draggingOver ?? task.status}`, {
                                                        'TaskCard--dragging': dragSnapshot.isDragging,
                                                        'TaskCard--selected': task.id === selectedId,
                                                    })}
                                                    onClick={() => onSelect(task.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            onSelect(task.id);
                                                        }
                                                    }}
                                                >
                                                    <SectionLabel section={sectionsById.get(task.section_id)}/>
                                                    <div className='TaskCard__title'>
                                                        <DoneToggle task={task}/>
                                                        <span>{task.title}</span>
                                                    </div>
                                                    <div className='TaskCard__footer'>
                                                        <AssigneeAvatar user={usersById[task.assignee_id]}/>
                                                        <DueDate task={task}/>
                                                    </div>
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {drop.placeholder}
                                </div>
                            )}
                        </Droppable>
                        {canManage && (
                            <AddTask
                                teamId={teamId}
                                status={status}
                                count={byStatus[status].length}
                                className='TaskBoard__add'
                            />
                        )}
                    </section>
                ))}
            </div>
        </DragDropContext>
    );
};

export default Board;
