// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';
import type {Task, TaskCreate, TaskPatch, TaskSectionCreate, TaskSectionPatch} from '@mattermost/types/tasks';

import {TaskTypes} from 'mattermost-redux/action_types';
import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {logError} from 'mattermost-redux/actions/errors';
import {forceLogoutIfNecessary} from 'mattermost-redux/actions/helpers';
import {Client4} from 'mattermost-redux/client';
import {General} from 'mattermost-redux/constants';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/common';
import {generateId} from 'mattermost-redux/utils/helpers';

import {getConnectionId} from 'selectors/general';

import {cleanUpUrlable} from 'utils/url';

import type {ActionFuncAsync} from 'types/store';

// run calls the server and dispatches what it returns; failures are logged and returned as {error}.
function run<T>(call: (connectionId: string) => Promise<T>, received?: (data: T) => {type: string; data: unknown}): ActionFuncAsync<T> {
    return async (dispatch, getState) => {
        let data: T;
        try {
            data = await call(getConnectionId(getState()));
        } catch (error) {
            forceLogoutIfNecessary(error, dispatch, getState);
            dispatch(logError(error));
            return {error};
        }
        if (received) {
            dispatch(received(data));
        }
        return {data};
    };
}

export function fetchTeamTasks(teamId: string) {
    return run(
        () => Promise.all([Client4.getTeamTasks(teamId), Client4.getTeamTaskSections(teamId)]),
        ([tasks, sections]) => ({type: TaskTypes.TEAM_TASKS_RECEIVED, data: {teamId, tasks, sections}}),
    );
}

export function createTask(task: TaskCreate) {
    return run((connectionId) => Client4.createTask(task, connectionId), (data) => ({type: TaskTypes.TASK_RECEIVED, data}));
}

// patchTask applies the change locally first so a dragged card doesn't jump back while the request is in flight.
export function patchTask(taskId: string, patch: TaskPatch): ActionFuncAsync<Task> {
    return async (dispatch, getState) => {
        const previous = getState().entities.tasks.byId[taskId];
        if (previous) {
            dispatch({type: TaskTypes.TASK_RECEIVED, data: {...previous, ...patch}});
        }
        const result = await dispatch(run((connectionId) => Client4.patchTask(taskId, patch, connectionId), (data) => ({type: TaskTypes.TASK_RECEIVED, data})));
        if (result.error && previous) {
            dispatch({type: TaskTypes.TASK_RECEIVED, data: previous});
        }
        return result;
    };
}

export function deleteTask(taskId: string) {
    return run((connectionId) => Client4.deleteTask(taskId, connectionId), () => ({type: TaskTypes.TASK_DELETED, data: {id: taskId}}));
}

export function createTaskSection(section: TaskSectionCreate) {
    return run((connectionId) => Client4.createTaskSection(section, connectionId), (data) => ({type: TaskTypes.TASK_SECTION_RECEIVED, data}));
}

export function patchTaskSection(sectionId: string, patch: TaskSectionPatch) {
    return run((connectionId) => Client4.patchTaskSection(sectionId, patch, connectionId), (data) => ({type: TaskTypes.TASK_SECTION_RECEIVED, data}));
}

export function setTaskSectionVideo(sectionId: string, video: File) {
    return run((connectionId) => Client4.setTaskSectionVideo(sectionId, video, connectionId), (data) => ({type: TaskTypes.TASK_SECTION_RECEIVED, data}));
}

export function deleteTaskSection(sectionId: string) {
    return run((connectionId) => Client4.deleteTaskSection(sectionId, connectionId), () => ({type: TaskTypes.TASK_SECTION_DELETED, data: {id: sectionId}}));
}

// createRevisionChannel makes a public channel whose revision list holds the video; if a step fails, the channel and list are removed again.
export function createRevisionChannel(teamId: string, displayName: string, video: File): ActionFuncAsync<Channel> {
    return async (dispatch, getState) => {
        const channel = {team_id: teamId, name: cleanUpUrlable(displayName) || generateId(), display_name: displayName, type: General.OPEN_CHANNEL} as Channel;
        const created = await dispatch(createChannel(channel, getCurrentUserId(getState())));
        if (!created.data) {
            return {error: created.error};
        }

        const section = await dispatch(createTaskSection({team_id: teamId, name: displayName, channel_id: created.data.id}));
        let error = section.error;
        if (section.data) {
            error = (await dispatch(setTaskSectionVideo(section.data.id, video))).error;
            if (error) {
                await dispatch(deleteTaskSection(section.data.id));
            }
        }
        if (error) {
            // shortcut: removing archives the channel, so its URL name stays taken; retry under another name or have an admin delete it.
            await dispatch(deleteChannel(created.data.id));
            return {error};
        }
        return {data: created.data};
    };
}
