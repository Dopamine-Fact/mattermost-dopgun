// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useContext, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import {getTaskSectionForChannel, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';

import TaskFilterContext from 'components/channel_view/task_filter_context';

import type {GlobalState} from 'types/store';
import type {PostDraft} from 'types/store/draft';

// useTaskPicker: a root message in a task-list channel must name one of the channel's tasks (the server enforces it
// too). Replies take their root's task, so they get no picker.
export default function useTaskPicker(
    draft: PostDraft,
    handleDraftChange: (draft: PostDraft, options?: {instant?: boolean; show?: boolean}) => void,
    channelId: string,
    rootId: string,
) {
    const {formatMessage} = useIntl();
    const filterTaskId = useContext(TaskFilterContext);
    const section = useSelector((state: GlobalState) => (rootId ? undefined : getTaskSectionForChannel(state, channelId)));
    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const teamTasks = useSelector((state: GlobalState) => getTasks(state, section?.team_id ?? ''));
    const tasks = useMemo(() => (section ? teamTasks.filter((t) => t.section_id === section.id) : []), [teamTasks, section]);

    const taskId: string = draft.props?.task_id ?? '';
    const setTask = (id: string) => handleDraftChange({...draft, props: {...draft.props, task_id: id}}, {instant: true});

    // Sending without a task shows why nothing happened, until a task is picked or the channel changes.
    const [missing, setMissing] = useState(false);
    const hasTask = tasks.some((t) => t.id === taskId);
    useEffect(() => setMissing(false), [hasTask, channelId]);

    // Filtering Messages to a task also points new messages at it; only a change of filter does, so a pick made
    // afterwards stands.
    useEffect(() => {
        if (section && filterTaskId && filterTaskId !== taskId && tasks.some((t) => t.id === filterTaskId)) {
            setTask(filterTaskId);
        }
    }, [filterTaskId, section?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!section) {
        return {control: null, isTaskSendable: true, warnTaskMissing: () => {}};
    }

    const control = (
        <>
            <select
                className={classNames('AdvancedTextEditor__taskPicker', {'AdvancedTextEditor__taskPicker--missing': missing})}
                aria-invalid={missing}
                aria-label={formatMessage({id: 'advanced_text_editor.task_picker.label', defaultMessage: 'Task'})}
                value={taskId}
                onChange={(e) => setTask(e.target.value)}
            >
                <option
                    value=''
                    disabled={true}
                >
                    {tasks.length ? formatMessage({id: 'advanced_text_editor.task_picker.placeholder', defaultMessage: 'Pick a task'}) : formatMessage({id: 'advanced_text_editor.task_picker.none', defaultMessage: 'No tasks yet: add one in Tasks'})}
                </option>
                {tasks.map((t) => (
                    <option
                        key={t.id}
                        value={t.id}
                    >
                        {t.title}
                    </option>
                ))}
            </select>
            {missing && (
                <span
                    className='AdvancedTextEditor__taskMissing'
                    role='alert'
                >
                    <FormattedMessage
                        id='advanced_text_editor.task_picker.missing'
                        defaultMessage='Pick a task to send your message'
                    />
                </span>
            )}
        </>
    );

    // A slash command may post nothing (/mute, /join); whatever it does post the server holds to the rule.
    const isCommand = draft.message.trimStart().startsWith('/');
    return {control, isTaskSendable: isCommand || hasTask, warnTaskMissing: () => setMissing(true)};
}
