// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';
import type {Task, TaskCreate, TaskPatch, TaskSectionCreate, TaskSectionPatch} from '@mattermost/types/tasks';

import {TaskTypes} from 'mattermost-redux/action_types';
import {createChannel, deleteChannel, getChannelAndMyMember} from 'mattermost-redux/actions/channels';
import {logError} from 'mattermost-redux/actions/errors';
import {forceLogoutIfNecessary} from 'mattermost-redux/actions/helpers';
import {receivedPosts} from 'mattermost-redux/actions/posts';
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

export function fetchTaskPosts(taskId: string, options: {channelId?: string; before?: number; perPage?: number} = {}) {
    return run(() => Client4.getTaskPosts(taskId, options), receivedPosts);
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

export function setTaskSectionVideo(sectionId: string, video: File, onProgress?: (loaded: number, total: number) => void) {
    return run((connectionId) => Client4.setTaskSectionVideo(sectionId, video, connectionId, onProgress), (data) => ({type: TaskTypes.TASK_SECTION_RECEIVED, data}));
}

export function deleteTaskSection(sectionId: string) {
    return run((connectionId) => Client4.deleteTaskSection(sectionId, connectionId), () => ({type: TaskTypes.TASK_SECTION_DELETED, data: {id: sectionId}}));
}

// createLinkedChannel makes a public channel whose revision list holds the video, then runs extra (the episode's canvas);
// if a step fails, the channel and list are removed again.
function createLinkedChannel(teamId: string, displayName: string, video: File, extra?: (channel: Channel) => ActionFuncAsync<unknown>): ActionFuncAsync<{channel: Channel; sectionId: string}> {
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
            if (!error && extra) {
                error = (await dispatch(extra(created.data))).error;
            }
            if (error) {
                await dispatch(deleteTaskSection(section.data.id));
            }
        }
        if (error) {
            // shortcut: removing archives the channel, so its URL name stays taken; retry under another name or have an admin delete it.
            await dispatch(deleteChannel(created.data.id));
            return {error};
        }
        return {data: {channel: created.data, sectionId: section.data!.id}};
    };
}

export function createRevisionChannel(teamId: string, displayName: string, video: File): ActionFuncAsync<Channel> {
    return async (dispatch) => {
        const result = await dispatch(createLinkedChannel(teamId, displayName, video));
        return result.data ? {data: result.data.channel} : {error: result.error};
    };
}

// createEpisodeChannel has the server create the channel, its revision list, the template folders (with their rules) and tasks;
// the video (optional; it can be uploaded later from Revisions) and canvas follow, and if either fails the tasks, list and channel are removed again.
// Folders and tasks the server could not create come back in failed (template lines).
export function createEpisodeChannel(teamId: string, displayName: string, video?: File): ActionFuncAsync<{channel: Channel; failed: string[]}> {
    return async (dispatch) => {
        const created = await dispatch(run(() => Client4.createEpisode(teamId, cleanUpUrlable(displayName) || generateId(), displayName)));
        if (!created.data) {
            return {error: created.error};
        }
        const {channel, section, failed, task_ids: taskIds} = created.data;
        await dispatch(getChannelAndMyMember(channel.id));
        dispatch({type: TaskTypes.TASK_SECTION_RECEIVED, data: section});

        let error = video ? (await dispatch(setTaskSectionVideo(section.id, video))).error : undefined;
        if (!error) {
            error = (await dispatch(run(() => Client4.createCanvas(teamId, channel.id)))).error;
        }
        if (error) {
            // Deleting the section only unlinks its tasks, so the seeded tasks go first.
            await Promise.all(taskIds.map((id) => dispatch(deleteTask(id))));
            await dispatch(deleteTaskSection(section.id));
            await dispatch(deleteChannel(channel.id));
            return {error};
        }
        return {data: {channel, failed}};
    };
}
