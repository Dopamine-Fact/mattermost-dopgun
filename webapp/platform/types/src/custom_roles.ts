// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** A studio-defined role. A lower position ranks higher; department '' means none. */
export type CustomRole = {
    id: string;

    /** the native role backing it, 'cr_' + id; users hold this name in their roles */
    role_name: string;
    display_name: string;

    /** '#rrggbb', lowercase */
    color: string;
    position: number;
    department: string;
    permissions: string[];
    create_at: number;
    update_at: number;
    delete_at: number;
};

export type CustomRolePatch = Partial<Pick<CustomRole, 'display_name' | 'color' | 'department' | 'permissions'>>;

export type CustomRoleCreate = Pick<CustomRole, 'display_name' | 'color' | 'department' | 'permissions'>;

/** Every permission a custom role may carry, in display order. */
export const CUSTOM_ROLE_PERMISSIONS = ['manage_tasks', 'manage_daily_reports', 'manage_revisions', 'assign_custom_roles'] as const;
