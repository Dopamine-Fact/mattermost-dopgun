// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Department} from '@mattermost/types/custom_roles';
import type {Task} from '@mattermost/types/tasks';

import {ranksOf} from 'components/profile_popover/use_custom_roles';

// userDepartmentIds is the departments in which a member (by their space-separated team roles) holds a rank.
export function userDepartmentIds(roles: string, departments: Department[]): Set<string> {
    return new Set(ranksOf(departments, roles).map(({department}) => department.id));
}

// lockedBy is the waits-for tasks still to finish. The lock only holds a To do task; revisions never wait.
export function lockedBy(task: Task, byId: Record<string, Task>): Task[] {
    if (task.status !== 'todo' || task.video_file_id) {
        return [];
    }
    return (task.waits_for ?? []).map((id) => byId[id]).filter((t) => t && t.status !== 'done');
}
