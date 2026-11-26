// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';
import type {Task, TaskSection, TaskStage} from '@mattermost/types/tasks';

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

// makeGetTaskStagesForSection: the section's stages in order.
export function makeGetTaskStagesForSection(): (state: GlobalState, sectionId: string) => TaskStage[] {
    return createSelector(
        'makeGetTaskStagesForSection',
        (state: GlobalState) => state.entities.tasks.stagesById,
        (_state: GlobalState, sectionId: string) => sectionId,
        (stagesById, sectionId) => Object.values(stagesById).
            filter((stage) => stage.section_id === sectionId).
            sort((a, b) => (a.sort_order - b.sort_order) || (a.create_at - b.create_at)),
    );
}

// getTaskSectionForChannel: the section a live task-list channel is linked to, while its team has tasks and revisions on.
export function getTaskSectionForChannel(state: GlobalState, channelId: string): TaskSection | undefined {
    const section = Object.values(state.entities.tasks.sectionsById).find((s) => s.channel_id === channelId);
    const team = section && state.entities.teams.teams[section.team_id];
    return team?.tasks_enabled && team?.revisions_enabled ? section : undefined;
}

// shortcut: scans every loaded post on each posts-store change; index posts by task if that shows in profiles.
export function makeGetTaskRootPosts(): (state: GlobalState, taskId: string, channelId?: string) => Post[] {
    return createSelector(
        'makeGetTaskRootPosts',
        (state: GlobalState) => state.entities.posts.posts,
        (_state: GlobalState, taskId: string) => taskId,
        (_state: GlobalState, _taskId: string, channelId?: string) => channelId,
        (posts, taskId, channelId) => Object.values(posts).
            filter((post) => post.props?.task_id === taskId && !post.root_id && !post.delete_at && (!channelId || post.channel_id === channelId)).
            sort((a, b) => a.create_at - b.create_at),
    );
}
