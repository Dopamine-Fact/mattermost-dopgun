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
};

/** A drive folder's children and its path from the channel root (root excluded). */
export type DriveListing = {
    items: DriveItem[];
    path: DriveItem[];
};

export type DriveChatFileSort = 'create_at' | 'name' | 'size';
