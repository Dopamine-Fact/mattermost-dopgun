// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {combineReducers} from 'redux';

import type {Task, TaskSection, TaskStage, TasksState} from '@mattermost/types/tasks';

import type {MMReduxAction} from 'mattermost-redux/action_types';
import {TaskTypes, UserTypes} from 'mattermost-redux/action_types';

function withoutTeam<T extends {team_id: string}>(state: Record<string, T>, teamId: string) {
    const next: Record<string, T> = {};
    for (const [id, item] of Object.entries(state)) {
        if (item.team_id !== teamId) {
            next[id] = item;
        }
    }
    return next;
}

function byId(state: TasksState['byId'] = {}, action: MMReduxAction): TasksState['byId'] {
    switch (action.type) {
    case TaskTypes.TEAM_TASKS_RECEIVED: {
        const next = withoutTeam(state, action.data.teamId);
        action.data.tasks.forEach((task: Task) => {
            next[task.id] = task;
        });
        return next;
    }
    case TaskTypes.TASK_RECEIVED: {
        const task: Task = action.data;
        const existing = state[task.id];

        // WS events may arrive after the HTTP response of the same change, or out of order.
        if (existing && existing.update_at > task.update_at) {
            return state;
        }
        return {...state, [task.id]: task};
    }
    case TaskTypes.TASK_DELETED: {
        if (!state[action.data.id]) {
            return state;
        }
        const next = {...state};
        delete next[action.data.id];
        return next;
    }
    case TaskTypes.TASK_SECTION_DELETED: {
        // The server moves the section's tasks to "no section" without sending per-task events.
        let next = state;
        for (const task of Object.values(state)) {
            if (task.section_id === action.data.id) {
                if (next === state) {
                    next = {...state};
                }
                next[task.id] = {...task, section_id: ''};
            }
        }
        return next;
    }
    case UserTypes.LOGOUT_SUCCESS:
        return {};
    default:
        return state;
    }
}

function sectionsById(state: TasksState['sectionsById'] = {}, action: MMReduxAction): TasksState['sectionsById'] {
    switch (action.type) {
    case TaskTypes.TEAM_TASKS_RECEIVED: {
        const next = withoutTeam(state, action.data.teamId);
        action.data.sections.forEach((section: TaskSection) => {
            next[section.id] = section;
        });
        return next;
    }
    case TaskTypes.TASK_SECTION_RECEIVED: {
        const section: TaskSection = action.data;
        const existing = state[section.id];
        if (existing && existing.update_at > section.update_at) {
            return state;
        }
        return {...state, [section.id]: section};
    }
    case TaskTypes.TASK_SECTION_DELETED: {
        if (!state[action.data.id]) {
            return state;
        }
        const next = {...state};
        delete next[action.data.id];
        return next;
    }
    case UserTypes.LOGOUT_SUCCESS:
        return {};
    default:
        return state;
    }
}

function stagesById(state: TasksState['stagesById'] = {}, action: MMReduxAction): TasksState['stagesById'] {
    switch (action.type) {
    case TaskTypes.TEAM_TASKS_RECEIVED: {
        const next = withoutTeam(state, action.data.teamId);
        action.data.stages.forEach((stage: TaskStage) => {
            next[stage.id] = stage;
        });
        return next;
    }
    case TaskTypes.TASK_STAGE_RECEIVED: {
        const stage: TaskStage = action.data;
        const existing = state[stage.id];
        if (existing && existing.update_at > stage.update_at) {
            return state;
        }
        return {...state, [stage.id]: stage};
    }
    case TaskTypes.TASK_STAGE_DELETED: {
        if (!state[action.data.id]) {
            return state;
        }
        const next = {...state};
        delete next[action.data.id];
        return next;
    }
    case TaskTypes.TASK_SECTION_DELETED: {
        // The server deletes the section's stages with it, without per-stage events.
        const next = Object.fromEntries(Object.entries(state).filter(([, stage]) => stage.section_id !== action.data.id));
        return Object.keys(next).length === Object.keys(state).length ? state : next;
    }
    case UserTypes.LOGOUT_SUCCESS:
        return {};
    default:
        return state;
    }
}

export default combineReducers({
    byId,
    sectionsById,
    stagesById,
});
