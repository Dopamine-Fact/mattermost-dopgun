// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Department} from '@mattermost/types/custom_roles';
import type {Task} from '@mattermost/types/tasks';

import {ranksOf} from 'components/profile_popover/use_custom_roles';

import {isComplete} from './task_utils';

// userDepartmentIds is the departments in which a member (by their space-separated team roles) holds a rank.
export function userDepartmentIds(roles: string, departments: Department[]): Set<string> {
    return new Set(ranksOf(departments, roles).map(({department}) => department.id));
}

// openWaitsFor is the waits-for tasks still to finish (done and approved); until they are, the task cannot be done.
export function openWaitsFor(task: Task, byId: Record<string, Task>): Task[] {
    return (task.waits_for ?? []).map((id) => byId[id]).filter((t) => t && !isComplete(t));
}

// lockedBy is openWaitsFor for a To do task: the lock that keeps it from being started. Revisions never wait.
export function lockedBy(task: Task, byId: Record<string, Task>): Task[] {
    if (task.status !== 'todo' || task.video_file_id) {
        return [];
    }
    return openWaitsFor(task, byId);
}
