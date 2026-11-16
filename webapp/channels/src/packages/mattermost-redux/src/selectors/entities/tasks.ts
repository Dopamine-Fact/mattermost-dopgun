// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';
import type {Task, TaskSection} from '@mattermost/types/tasks';

import {createSelector} from 'mattermost-redux/selectors/create_selector';

export function getTask(state: GlobalState, taskId: string): Task | undefined {
    return state.entities.tasks.byId[taskId];
}

// shortcut: filters every loaded task per team; index by team if teams hold thousands of tasks.
export function makeGetTasksForTeam(): (state: GlobalState, teamId: string) => Task[] {
    return createSelector(
        'makeGetTasksForTeam',
        (state: GlobalState) => state.entities.tasks.byId,
        (_state: GlobalState, teamId: string) => teamId,
        (byId, teamId) => Object.values(byId).
            filter((task) => task.team_id === teamId).
            sort((a, b) => (a.sort_order - b.sort_order) || a.id.localeCompare(b.id)),
    );
}

export function makeGetTaskSectionsForTeam(): (state: GlobalState, teamId: string) => TaskSection[] {
    return createSelector(
        'makeGetTaskSectionsForTeam',
        (state: GlobalState) => state.entities.tasks.sectionsById,
        (_state: GlobalState, teamId: string) => teamId,
        (sectionsById, teamId) => Object.values(sectionsById).
            filter((section) => section.team_id === teamId).
            sort((a, b) => (a.sort_order - b.sort_order) || (a.create_at - b.create_at)),
    );
}
