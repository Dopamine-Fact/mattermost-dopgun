// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DragDropContext, Draggable, Droppable} from '@hello-pangea/dnd';
import classNames from 'classnames';
import React, {useMemo, useState} from 'react';
import {useIntl} from 'react-intl';

import {useLoadedTeamDepartments} from 'components/profile_popover/use_custom_roles';

import {AddTask, ApprovalBadge, AssigneeAvatar, DepartmentChip, DoneToggle, DueDate, LockLine, ParentLabel, SectionLabel, SubtaskBadge, SubtasksToggle, TakeItButton, TaskDropNotice, useApprovalEnabled, useTaskDrop} from './task_bits';
import {lockedBy} from './task_departments';
import {groupByStatus, isApprovalLocked, STATUSES, statusMessages, subtaskCounts, visibleTasks} from './task_utils';
import type {ViewProps} from './task_utils';

const Board = ({teamId, tasks, sections, usersById, selectedId, onSelect, canManage}: ViewProps) => {
    const {formatMessage} = useIntl();
    const [showSubtasks, setShowSubtasks] = useState(false);
    const byStatus = useMemo(() => groupByStatus(visibleTasks(tasks, showSubtasks)), [tasks, showSubtasks]);
    const counts = useMemo(() => subtaskCounts(tasks), [tasks]);
    const approvalEnabled = useApprovalEnabled(teamId);
    const departments = useLoadedTeamDepartments(teamId);
    const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);
    const sectionsById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

    const {onDragEnd, notice} = useTaskDrop(byStatus, byId);

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <SubtasksToggle
                tasks={tasks}
                checked={showSubtasks}
                onChange={setShowSubtasks}
            />
            <TaskDropNotice notice={notice}/>
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
                                    {byStatus[status].map((task, index) => {
                                        const waitingFor = lockedBy(task, byId);
                                        const locked = !canManage && waitingFor.length > 0;
                                        return (
                                            <Draggable
                                                key={task.id}
                                                draggableId={task.id}
                                                index={index}
                                                isDragDisabled={locked || isApprovalLocked(task, approvalEnabled)}
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
                                                        <ParentLabel
                                                            task={task}
                                                            byId={byId}
                                                        />
                                                        <DepartmentChip
                                                            task={task}
                                                            departments={departments}
                                                        />
                                                        <div className='TaskCard__title'>
                                                            <DoneToggle
                                                                task={task}
                                                                locked={locked}
                                                            />
                                                            <span>{task.title}</span>
                                                        </div>
                                                        <div className='TaskCard__footer'>
                                                            <AssigneeAvatar user={usersById[task.assignee_id]}/>
                                                            <TakeItButton
                                                                task={task}
                                                                departments={departments}
                                                                locked={locked}
                                                            />
                                                            <LockLine
                                                                waitingFor={waitingFor}
                                                                compact={true}
                                                            />
                                                            <SubtaskBadge count={counts.get(task.id)}/>
                                                            <ApprovalBadge task={task}/>
                                                            <DueDate task={task}/>
                                                        </div>
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
