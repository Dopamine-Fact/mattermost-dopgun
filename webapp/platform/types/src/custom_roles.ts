// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** A rank inside a team department. A lower position ranks higher within its department. */
export type Rank = {
    id: string;

    /** the native role backing it, 'rk_' + id; team members hold this name in their roles */
    role_name: string;
    team_id: string;
    department_id: string;
    display_name: string;

    /** '#rrggbb', lowercase */
    color: string;
    position: number;
    permissions: string[];
    member_count: number;
    create_at: number;
    update_at: number;
    delete_at: number;
};

/** A team department with its ranks, top rank first. Stüdyo geneli (is_studio) always comes first and outranks every other. */
export type Department = {
    id: string;
    team_id: string;
    name: string;
    color: string;
    position: number;
    is_studio: boolean;
    create_at: number;
    update_at: number;
    delete_at: number;
    ranks: Rank[];
};

export type RankPatch = Partial<Pick<Rank, 'display_name' | 'color' | 'permissions'>>;

export type RankCreate = Pick<Rank, 'display_name' | 'color' | 'permissions'>;

export type DepartmentPatch = Partial<Pick<Department, 'name' | 'color'>>;

export type DepartmentCreate = Pick<Department, 'name' | 'color'>;

/** Every permission a rank may carry, in display order. */
export const RANK_PERMISSIONS = ['manage_tasks', 'manage_daily_reports', 'manage_revisions', 'assign_custom_roles'] as const;

/** Websocket event sent to a team when one of its departments or ranks, or a member's ranks, change. */
export const DEPARTMENTS_CHANGED = 'departments_changed';
