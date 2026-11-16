// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {FormattedDate, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';

import {TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Task, TaskSection} from '@mattermost/types/tasks';

import {createTaskSection, deleteTaskSection, patchTask, patchTaskSection} from 'actions/tasks';

import BlurInput from './blur_input';
import {addDays, dayIndex, resizeSpan, taskSpan, timelineRange} from './task_utils';
import type {ViewProps} from './task_utils';

const DAY_WIDTH = 36;
const LANE_HEIGHT = 34;

type Row = {section?: TaskSection; tasks: Task[]};

// Resize is a bar edge being dragged; delta is how many days it has moved so far.
type Resize = {taskId: string; edge: 'start' | 'end'; originX: number; delta: number};

const Timeline = ({teamId, tasks, sections, onSelect, canManage}: ViewProps) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [resize, setResize] = useState<Resize>();

    const scheduled = useMemo(() => tasks.filter((t) => taskSpan(t)), [tasks]);
    const {from, days} = useMemo(() => timelineRange(scheduled), [scheduled]);
    const todayIndex = dayIndex(from, Date.now());
    const width = days * DAY_WIDTH;

    const rows = useMemo(() => {
        const sectionIds = new Set(sections.map((s) => s.id));
        const loose = scheduled.filter((t) => !sectionIds.has(t.section_id));
        const result: Row[] = loose.length || !sections.length ? [{tasks: loose}] : [];
        for (const section of sections) {
            result.push({section, tasks: scheduled.filter((t) => t.section_id === section.id)});
        }
        return result;
    }, [scheduled, sections]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = Math.max(0, (todayIndex - 3) * DAY_WIDTH);
        }

    // Only on first render, so it doesn't fight the user's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const unscheduled = tasks.length - scheduled.length;
    const nextSortOrder = sections.reduce((max, s) => Math.max(max, s.sort_order), 0) + 1;
    const deleteSectionLabel = formatMessage({id: 'tasks.section.delete', defaultMessage: 'Delete section (its tasks move to No section)'});
    const dayList = Array.from({length: days}, (_, i) => addDays(from, i));
    const todayLine = todayIndex >= 0 && todayIndex < days ? (
        <span
            className='TaskTimeline__today'
            style={{left: (todayIndex * DAY_WIDTH) + (DAY_WIDTH / 2)}}
        />
    ) : null;

    return (
        <div className='TaskTimeline'>
            {unscheduled > 0 && (
                <div className='TaskTimeline__note'>
                    <FormattedMessage
                        id='tasks.timeline.unscheduled'
                        defaultMessage='{count, plural, one {# task has no dates and is} other {# tasks have no dates and are}} not shown here.'
                        values={{count: unscheduled}}
                    />
                </div>
            )}
            <div
                className='TaskTimeline__scroll'
                ref={scrollRef}
            >
                <div className='TaskTimeline__row TaskTimeline__row--head'>
                    <div className='TaskTimeline__sectionCell'>
                        <FormattedMessage
                            id='tasks.detail.section'
                            defaultMessage='Section'
                        />
                    </div>
                    <div
                        className='TaskTimeline__days'
                        style={{width}}
                    >
                        {dayList.map((day, i) => {
                            const date = new Date(day);
                            const showMonth = i === 0 || date.getDate() === 1;
                            return (
                                <div
                                    key={day}
                                    className='TaskTimeline__day'
                                    style={{width: DAY_WIDTH}}
                                >
                                    <span className='TaskTimeline__month'>
                                        {showMonth && (
                                            <FormattedDate
                                                value={day}
                                                month='short'
                                                year={i === 0 || date.getMonth() === 0 ? 'numeric' : undefined}
                                            />
                                        )}
                                    </span>
                                    <span className={i === todayIndex ? 'TaskTimeline__dayNum TaskTimeline__dayNum--today' : 'TaskTimeline__dayNum'}>
                                        {date.getDate()}
                                    </span>
                                </div>
                            );
                        })}
                        {todayLine}
                    </div>
                </div>

                {rows.map(({section, tasks: rowTasks}) => (
                    <div
                        key={section?.id ?? ''}
                        className='TaskTimeline__row'
                    >
                        <div className='TaskTimeline__sectionCell'>
                            {section && !canManage && (
                                <span className='TaskTimeline__sectionName'>{section.name}</span>
                            )}
                            {section && canManage && (
                                <>
                                    <BlurInput
                                        className='TaskTimeline__sectionName'
                                        value={section.name}
                                        maxLength={64}
                                        onSave={(name) => dispatch(patchTaskSection(section.id, {name}))}
                                        aria-label={formatMessage({id: 'tasks.section.name', defaultMessage: 'Section name'})}
                                    />
                                    <button
                                        className='btn btn-icon btn-xs'
                                        onClick={() => dispatch(deleteTaskSection(section.id))}
                                        aria-label={deleteSectionLabel}
                                        title={deleteSectionLabel}
                                    >
                                        <TrashCanOutlineIcon size={16}/>
                                    </button>
                                </>
                            )}
                            {!section && (
                                <span className='TaskTimeline__sectionName'>
                                    <FormattedMessage
                                        id='tasks.noSection'
                                        defaultMessage='No section'
                                    />
                                </span>
                            )}
                        </div>
                        <div
                            className='TaskTimeline__lane'
                            style={{width, height: (Math.max(rowTasks.length, 1) * LANE_HEIGHT) + 8, backgroundSize: `${DAY_WIDTH}px 100%`}}
                        >
                            {rowTasks.map((task, lane) => {
                                const [start, end] = taskSpan(task)!;
                                const resizing = resize?.taskId === task.id ? resize : undefined;
                                let [rawStart, rawEnd] = [dayIndex(from, start), dayIndex(from, end)];
                                if (resizing) {
                                    [rawStart, rawEnd] = resizeSpan(rawStart, rawEnd, resizing.edge, resizing.delta);
                                }
                                const startIndex = Math.max(0, rawStart);
                                const endIndex = Math.min(days - 1, rawEnd);
                                if (startIndex > endIndex) {
                                    return null; // Past the capped end of the range.
                                }

                                // Edge handles are mouse/touch only; the detail panel's date fields are the keyboard path.
                                const handle = (edge: Resize['edge']) => (
                                    <span
                                        aria-hidden={true}
                                        className={`TaskBar__handle TaskBar__handle--${edge}`}
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.currentTarget.setPointerCapture(e.pointerId);
                                            setResize({taskId: task.id, edge, originX: e.clientX, delta: 0});
                                        }}
                                        onPointerMove={(e) => {
                                            if (resizing) {
                                                setResize({...resizing, delta: Math.round((e.clientX - resizing.originX) / DAY_WIDTH)});
                                            }
                                        }}
                                        onPointerUp={() => {
                                            setResize(undefined);
                                            if (resizing?.delta) {
                                                dispatch(patchTask(task.id, {start_at: addDays(from, rawStart), due_at: addDays(from, rawEnd)}));
                                            }
                                        }}
                                        onPointerCancel={() => setResize(undefined)}
                                    />
                                );

                                return (
                                    <div
                                        key={task.id}
                                        className={`TaskBar TaskStatus--${task.status}${resizing ? ' TaskBar--resizing' : ''}`}
                                        style={{
                                            left: (startIndex * DAY_WIDTH) + 2,
                                            width: (((endIndex - startIndex) + 1) * DAY_WIDTH) - 4,
                                            top: (lane * LANE_HEIGHT) + 6,
                                        }}
                                    >
                                        {handle('start')}
                                        <button
                                            className='TaskBar__title'
                                            onClick={() => onSelect(task.id)}
                                            title={task.title}
                                        >
                                            {task.title}
                                        </button>
                                        {handle('end')}
                                    </div>
                                );
                            })}
                            {todayLine}
                        </div>
                    </div>
                ))}

                {canManage && (
                    <div className='TaskTimeline__row'>
                        <div className='TaskTimeline__sectionCell'>
                            <BlurInput
                                key={sections.length}
                                className='TaskTimeline__addSection'
                                value=''
                                maxLength={64}
                                placeholder={formatMessage({id: 'tasks.addSection', defaultMessage: '+ Add section'})}
                                onSave={(name) => dispatch(createTaskSection({team_id: teamId, name, sort_order: nextSortOrder}))}
                                aria-label={formatMessage({id: 'tasks.addSection.label', defaultMessage: 'New section name'})}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Timeline;
