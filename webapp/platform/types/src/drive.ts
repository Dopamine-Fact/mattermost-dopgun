// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FileInfo} from './files';

export type DriveItemType = 'folder' | 'file';

/** A file or folder in a channel's file drive; parent_id '' is the channel root. */
export type DriveItem = {
    id: string;
    channel_id: string;
    parent_id: string;
    type: DriveItemType;
    name: string;
    file_id: string;
    creator_id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    deleted_by: string;
    file_info?: FileInfo;

    /** Folder rules from an episode template; empty on folders without rules. */
    view_departments?: string[];
    write_departments?: string[];
    read_only?: boolean;

    /** Source folder id when this folder mirrors another. */
    mirror_of?: string;
};

/** A file attached to a task whose folder is the listed one. */
export type DriveTaskFile = FileInfo & {task_id: string};

/** A drive folder's children and its path from the channel root (root excluded). */
export type DriveListing = {
    items: DriveItem[];
    path: DriveItem[];

    /** Message files of the task owning this folder; empty for other folders. */
    task_files: DriveTaskFile[];

    /** How the viewer may change this folder: '' means no write rule applies. */
    access: '' | 'write' | 'read';

    /** A mirror whose source folder is gone. */
    source_missing?: boolean;
};

export type DriveChatFileSort = 'create_at' | 'name' | 'size';

export type TeamFilesKind = '' | 'library' | 'projects' | 'production' | 'channels';
export type TeamFilesAccess = '' | 'admin' | 'read';

/** One folder of a team's Files page template; id is its drive folder in the team files channel once applied. */
export type TeamFilesFolder = {
    id?: string;
    name: string;
    description?: string;

    /** top folders only */
    kind?: TeamFilesKind;
    access?: TeamFilesAccess;
    children?: TeamFilesFolder[];
};

/** The Files page root for the current user. */
export type TeamFilesLayout = {

    /** the team files channel; '' without a template */
    channel_id: string;
    folders: TeamFilesFolder[];

    /** the team's episode channels (channels with a task section) */
    production_channel_ids: string[];
    is_admin: boolean;
};

export type DriveShares = {item_id: string; team_ids: string[]};
