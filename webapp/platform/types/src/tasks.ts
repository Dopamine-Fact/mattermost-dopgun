// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FileInfo} from './files';

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type Task = {
    id: string;
    team_id: string;

    /** '' when the task is in no section */
    section_id: string;
    title: string;
    description: string;

    /** '' when unassigned */
    assignee_id: string;

    /** ms timestamp (local midnight), 0 when there is no start date */
    start_at: number;

    /** ms timestamp (local midnight), 0 when there is no due date */
    due_at: number;
    status: TaskStatus;

    /** order within the status column; a float so a dragged task can land between two others */
    sort_order: number;

    /** ms into the section's video; only meaningful for revisions (tasks in a section with a video) */
    video_time: number;

    /** the section video version a revision is pinned to; '' for an ordinary task. Set on create only. */
    video_file_id: string;
    creator_id: string;
    create_at: number;
    update_at: number;
};

export type TaskPatch = Partial<Pick<Task, 'section_id' | 'title' | 'description' | 'assignee_id' | 'start_at' | 'due_at' | 'status' | 'sort_order' | 'video_time'>>;

// TaskCreate is what a new task is made from; video_file_id (which pins a revision to a video version) can only be set here.
export type TaskCreate = Pick<Task, 'team_id' | 'title'> & TaskPatch & Partial<Pick<Task, 'video_file_id'>>;

export type TaskSection = {
    id: string;
    team_id: string;
    name: string;
    sort_order: number;

    /** the channel this section is the revision list of; '' for an ordinary section. Set on create only. */
    channel_id: string;

    /** the revision channel's video; '' otherwise. Stream it with Client4.getTaskSectionVideoUrl. */
    video_file_id: string;
    create_at: number;
    update_at: number;
};

// TaskSectionVideo is one uploaded version of a revision section's video; versions are never deleted on re-upload.
export type TaskSectionVideo = {
    id: string;
    section_id: string;
    file_id: string;
    version: number;
    creator_id: string;
    create_at: number;
    file: FileInfo;
};

export type TaskSectionPatch = Partial<Pick<TaskSection, 'name' | 'sort_order'>>;

// TaskSectionCreate is what a new section is made from; channel_id can only be set here.
export type TaskSectionCreate = Pick<TaskSection, 'team_id' | 'name'> & TaskSectionPatch & Partial<Pick<TaskSection, 'channel_id'>>;

export type TaskComment = {
    id: string;
    task_id: string;
    user_id: string;
    message: string;
    file_ids: string[];
    create_at: number;

    /** attachments; download them with Client4.getTaskCommentFileUrl, not the regular file routes */
    files?: FileInfo[];
};

export type TasksState = {
    byId: Record<string, Task>;
    sectionsById: Record<string, TaskSection>;
};
