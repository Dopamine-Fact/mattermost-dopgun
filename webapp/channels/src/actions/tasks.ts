// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';
import type {Task, TaskCreate, TaskPatch, TaskSectionCreate, TaskSectionPatch} from '@mattermost/types/tasks';

import {TaskTypes} from 'mattermost-redux/action_types';
import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {logError} from 'mattermost-redux/actions/errors';
import {forceLogoutIfNecessary} from 'mattermost-redux/actions/helpers';
import {receivedPosts} from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';
import {General} from 'mattermost-redux/constants';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/common';
import {generateId} from 'mattermost-redux/utils/helpers';

import {getConnectionId} from 'selectors/general';

import {templateLines} from 'components/tasks/task_utils';

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

export function setTaskSectionVideo(sectionId: string, video: File) {
    return run((connectionId) => Client4.setTaskSectionVideo(sectionId, video, connectionId), (data) => ({type: TaskTypes.TASK_SECTION_RECEIVED, data}));
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

// createEpisodeChannel makes a revision channel that is also a canvas, then seeds the team's folder and task templates.
// Folders and tasks that fail are returned in failed (template lines) and do not stop the rest.
export function createEpisodeChannel(teamId: string, displayName: string, video: File): ActionFuncAsync<{channel: Channel; failed: string[]}> {
    return async (dispatch, getState) => {
        const team = getState().entities.teams.teams[teamId];
        const created = await dispatch(createLinkedChannel(teamId, displayName, video, (channel) => run(() => Client4.createCanvas(teamId, channel.id))));
        if (!created.data) {
            return {error: created.error};
        }
        const {channel, sectionId} = created.data;
        const failed: string[] = [];

        // Folder ids by path; a failed folder is cached as null so its children are reported, not retried.
        const folders = new Map<string, string | null>();
        for (const line of templateLines(team?.episode_folders)) {
            let parentId = '';
            let path = '';
            for (const name of line.split('/')) {
                path = path ? `${path}/${name}` : name;
                if (!folders.has(path)) {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        folders.set(path, (await Client4.createDriveFolder(channel.id, parentId, name)).id);
                    } catch {
                        folders.set(path, null);
                    }
                }
                const id = folders.get(path);
                if (!id) {
                    failed.push(line);
                    break;
                }
                parentId = id;
            }
        }

        for (const title of templateLines(team?.episode_tasks)) {
            // eslint-disable-next-line no-await-in-loop
            if ((await dispatch(createTask({team_id: teamId, title, section_id: sectionId, status: 'todo'}))).error) {
                failed.push(title);
            }
        }
        return {data: {channel, failed}};
    };
}
