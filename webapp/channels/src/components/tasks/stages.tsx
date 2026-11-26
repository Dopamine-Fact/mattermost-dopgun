// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {ArrowDownIcon, ArrowUpIcon, CloseIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {TaskStage, TaskStagePatch, TaskStageStatus, TaskStatus} from '@mattermost/types/tasks';

import {makeGetTaskStagesForSection} from 'mattermost-redux/selectors/entities/tasks';

import {createTaskStage, deleteTaskStage, fetchTeamStages, patchTaskStage} from 'actions/tasks';

import type {ActionFuncAsync, GlobalState} from 'types/store';

import BlurInput from './blur_input';
import {deriveStages, isComplete, stageStatusMessages} from './task_utils';
import type {ViewProps} from './task_utils';

// A stage borrows the colour of the task status it matches.
const STAGE_COLOR: Record<TaskStageStatus, TaskStatus> = {not_started: 'todo', in_progress: 'in_progress', done: 'done'};

type Props = ViewProps & {

    // sectionId fixes the section (an episode channel's tab) instead of offering a picker.
    sectionId?: string;

    // compact leaves out each stage's task list, for an overview of many sections.
    compact?: boolean;
};

// Stages lists one section's production stages in order. Their status comes from their tasks; the first stage that is
// not done is the current one and the stage after it is next. Order is shown only: it does not lock any task.
// Render it only for users who may see stages (useCanSeeStages); it loads them itself.
const Stages = ({teamId, tasks, sections, selectedId, onSelect, canManage, sectionId: fixedId, compact}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const [chosenId, setChosenId] = useState('');
    const [newName, setNewName] = useState('');
    const [error, setError] = useState('');

    const sectionId = fixedId ?? (sections.some((s) => s.id === chosenId) ? chosenId : (sections[0]?.id ?? ''));

    // A compact overview is one of many on the stages page, which loads the stages once for all of them.
    useEffect(() => {
        if (!compact) {
            dispatch(fetchTeamStages(teamId));
        }
    }, [dispatch, teamId, compact]);
    const getStages = useMemo(() => makeGetTaskStagesForSection(), []);
    const stages = useSelector((state: GlobalState) => getStages(state, sectionId));
    const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);
    const derived = useMemo(() => deriveStages(stages, byId), [stages, byId]);
    const currentIndex = derived.findIndex((d) => d.current);
    const linked = new Set(stages.flatMap((s) => s.task_ids));
    const unlinked = tasks.filter((t) => t.section_id === sectionId && !t.video_file_id && !linked.has(t.id));

    const call = async (action: ActionFuncAsync<unknown>) => {
        setError('');
        const result = await dispatch(action);
        if (result.error) {
            setError(result.error.message ?? '');
        }
        return result;
    };
    const patch = (stage: TaskStage, p: TaskStagePatch) => call(patchTaskStage(stage.id, p));

    // move swaps the stage's place with its neighbour.
    const move = async (index: number, by: number) => {
        const stage = stages[index];
        const other = stages[index + by];
        if ((await patch(stage, {sort_order: other.sort_order})).data) {
            await patch(other, {sort_order: stage.sort_order});
        }
    };

    const addStage = async () => {
        const name = newName.trim();
        if (!name) {
            return;
        }
        const result = await call(createTaskStage({team_id: teamId, section_id: sectionId, name}));
        if (result.data) {
            setNewName('');
        }
    };

    if (!sectionId) {
        return (
            <p className='TaskStages__empty'>
                <FormattedMessage
                    id='tasks.stages.noSections'
                    defaultMessage='Create a section to plan its stages.'
                />
            </p>
        );
    }

    return (
        <div className='TaskStages'>
            {!fixedId && (
                <label className='TaskStages__section'>
                    <FormattedMessage
                        id='tasks.detail.section'
                        defaultMessage='Section'
                    />
                    <select
                        className='form-control'
                        value={sectionId}
                        onChange={(e) => setChosenId(e.target.value)}
                    >
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
            )}

            {error && (
                <p
                    className='TaskStages__error'
                    role='alert'
                >
                    {error}
                </p>
            )}

            {!derived.length && (
                <p className='TaskStages__empty'>
                    <FormattedMessage
                        id='tasks.stages.empty'
                        defaultMessage='No stages in this section yet.'
                    />
                </p>
            )}

            <ol className='TaskStages__list'>
                {derived.map(({stage, status, current}, index) => {
                    const stageTasks = stage.task_ids.map((id) => byId[id]).filter(Boolean);
                    const done = stageTasks.filter(isComplete).length;
                    return (
                        <li
                            key={stage.id}
                            className={classNames('TaskStage', `TaskStatus--${STAGE_COLOR[status]}`, {'TaskStage--current': current})}
                        >
                            <header className='TaskStage__header'>
                                <span className='TaskStage__number'>{index + 1}</span>
                                {canManage ? (
                                    <BlurInput
                                        className='TaskStage__name form-control'
                                        value={stage.name}
                                        maxLength={64}
                                        aria-label={formatMessage({id: 'tasks.stages.name', defaultMessage: 'Stage name'})}
                                        onSave={(name) => patch(stage, {name})}
                                    />
                                ) : (
                                    <h2 className='TaskStage__name'>{stage.name}</h2>
                                )}
                                <span className='TaskStage__status'>
                                    <span className='TaskStatusDot'/>
                                    {formatMessage(stageStatusMessages[status])}
                                </span>
                                {current && (
                                    <span className='TaskStage__badge TaskStage__badge--current'>
                                        <FormattedMessage
                                            id='tasks.stages.current'
                                            defaultMessage='Current stage'
                                        />
                                    </span>
                                )}
                                {currentIndex >= 0 && index === currentIndex + 1 && (
                                    <span className='TaskStage__badge'>
                                        <FormattedMessage
                                            id='tasks.stages.next'
                                            defaultMessage='Next'
                                        />
                                    </span>
                                )}
                                <span className='TaskStage__progress'>
                                    <FormattedMessage
                                        id='tasks.stages.progress'
                                        defaultMessage='{done}/{total} complete'
                                        values={{done, total: stageTasks.length}}
                                    />
                                </span>
                                {canManage && (
                                    <span className='TaskStage__actions'>
                                        <button
                                            className='btn btn-icon btn-sm'
                                            disabled={index === 0}
                                            aria-label={formatMessage({id: 'tasks.stages.moveUp', defaultMessage: 'Move stage up'})}
                                            onClick={() => move(index, -1)}
                                        >
                                            <ArrowUpIcon size={16}/>
                                        </button>
                                        <button
                                            className='btn btn-icon btn-sm'
                                            disabled={index === stages.length - 1}
                                            aria-label={formatMessage({id: 'tasks.stages.moveDown', defaultMessage: 'Move stage down'})}
                                            onClick={() => move(index, 1)}
                                        >
                                            <ArrowDownIcon size={16}/>
                                        </button>
                                        <button
                                            className='btn btn-icon btn-sm'
                                            aria-label={formatMessage({id: 'tasks.stages.delete', defaultMessage: 'Delete stage'})}
                                            onClick={() => call(deleteTaskStage(stage.id))}
                                        >
                                            <TrashCanOutlineIcon size={16}/>
                                        </button>
                                    </span>
                                )}
                            </header>
                            <div
                                className='TaskStage__bar'
                                role='progressbar'
                                aria-valuemin={0}
                                aria-valuemax={stageTasks.length}
                                aria-valuenow={done}
                                aria-label={stage.name}
                            >
                                <span style={{width: `${stageTasks.length ? (100 * done) / stageTasks.length : 0}%`}}/>
                            </div>

                            {!compact && (
                                <ul className='TaskStage__tasks'>
                                    {stageTasks.map((task) => (
                                        <li
                                            key={task.id}
                                            className={classNames('TaskStage__task', `TaskStatus--${task.status}`, {'TaskStage__task--selected': task.id === selectedId})}
                                        >
                                            <span className='TaskStatusDot'/>
                                            <button
                                                className='TaskStage__taskTitle'
                                                onClick={() => onSelect(task.id)}
                                            >
                                                {task.title}
                                            </button>
                                            {canManage && (
                                                <button
                                                    className='btn btn-icon btn-xs'
                                                    aria-label={formatMessage({id: 'tasks.stages.unlink', defaultMessage: 'Remove {title} from the stage'}, {title: task.title})}
                                                    onClick={() => patch(stage, {task_ids: stage.task_ids.filter((id) => id !== task.id)})}
                                                >
                                                    <CloseIcon size={14}/>
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                    {!stageTasks.length && (
                                        <li className='TaskStage__none'>
                                            <FormattedMessage
                                                id='tasks.stages.noTasks'
                                                defaultMessage='No tasks linked yet.'
                                            />
                                        </li>
                                    )}
                                </ul>
                            )}

                            {canManage && !compact && unlinked.length > 0 && (
                                <select
                                    className='form-control TaskStage__link'
                                    value=''
                                    aria-label={formatMessage({id: 'tasks.stages.addTask', defaultMessage: 'Add a task to the stage'})}
                                    onChange={(e) => patch(stage, {task_ids: [...stage.task_ids, e.target.value]})}
                                >
                                    <option value=''>{formatMessage({id: 'tasks.stages.addTask', defaultMessage: 'Add a task to the stage'})}</option>
                                    {unlinked.map((task) => (
                                        <option
                                            key={task.id}
                                            value={task.id}
                                        >
                                            {task.title}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </li>
                    );
                })}
            </ol>

            {canManage && !compact && (
                <form
                    className='TaskStages__add'
                    onSubmit={(e) => {
                        e.preventDefault();
                        addStage();
                    }}
                >
                    <input
                        type='text'
                        className='form-control'
                        value={newName}
                        maxLength={64}
                        placeholder={formatMessage({id: 'tasks.stages.addPlaceholder', defaultMessage: 'New stage name'})}
                        aria-label={formatMessage({id: 'tasks.stages.addPlaceholder', defaultMessage: 'New stage name'})}
                        onChange={(e) => setNewName(e.target.value)}
                    />
                    <button
                        type='submit'
                        className='btn btn-primary btn-sm'
                        disabled={!newName.trim()}
                    >
                        <FormattedMessage
                            id='tasks.stages.add'
                            defaultMessage='Add stage'
                        />
                    </button>
                </form>
            )}
        </div>
    );
};

export default Stages;
