// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from './channels';
import type {FileInfo} from './files';

export type TaskStatus = 'todo' | 'in_progress' | 'done';

/** Where a done task is in its approval chain; '' before done (or after leaving it). Set by the server only. */
export type TaskApprovalStatus = '' | 'pending_supervisor' | 'pending_director' | 'approved' | 'rejected';

export type TaskApprovalAction = 'approve' | 'reject' | 'revert';

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

    /** '' when the task belongs to no department */
    department_id: string;

    /** ids of the tasks that must be done before this one can be taken; never null */
    waits_for: string[];

    /** the episode channel's drive folder that lists the task's files; '' for tasks without one */
    folder_id: string;

    /** a folder of the team Files library that also lists the task's files; '' for none */
    library_folder_id?: string;

    /** the task this is a subtask of (one level deep); '' for a top-level task */
    parent_id: string;

    /** complete means status 'done' and approval_status 'approved' */
    approval_status: TaskApprovalStatus;
};

export type TaskPatch = Partial<Pick<Task, 'section_id' | 'title' | 'description' | 'assignee_id' | 'start_at' | 'due_at' | 'status' | 'sort_order' | 'video_time' | 'department_id' | 'waits_for' | 'parent_id' | 'folder_id' | 'library_folder_id'>>;

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

/** A stage's status, derived from its tasks: done once all are complete, not started while all are to do. */
export type TaskStageStatus = 'not_started' | 'in_progress' | 'done';

// TaskStage is one ordered production step of a section (episode), made of some of the section's tasks.
export type TaskStage = {
    id: string;
    team_id: string;

    /** set on create only */
    section_id: string;
    name: string;

    /** order within the section */
    sort_order: number;

    /** the section's ordinary tasks that make up the stage; a task is in at most one stage */
    task_ids: string[];
    create_at: number;
    update_at: number;

    /** derived by the server when the stage was sent; derive it from the current tasks with the task utils instead */
    status: TaskStageStatus;

    /** the first stage of its section that is not done */
    current: boolean;
};

export type TaskStagePatch = Partial<Pick<TaskStage, 'name' | 'sort_order' | 'task_ids'>>;

export type TaskStageCreate = Pick<TaskStage, 'team_id' | 'section_id' | 'name'> & TaskStagePatch;

/**
 * TaskSchedule is the timing of a section's ordinary tasks. weights maps a task id to its span, due_at - start_at, in
 * milliseconds; tasks missing either date have no weight and are listed in missing_dates. first_task_id has the earliest
 * start date and last_task_id the latest due date ('' when none).
 */
export type TaskSchedule = {
    section_id: string;
    weights: Record<string, number>;
    missing_dates: string[];
    first_task_id: string;
    last_task_id: string;
};

export type TasksState = {
    byId: Record<string, Task>;
    sectionsById: Record<string, TaskSection>;
    stagesById: Record<string, TaskStage>;
};

/** What the episode endpoint returns; failed lists the template folders and tasks that could not be created, task_ids the seeded tasks. */
export type EpisodeCreated = {channel: Channel; section: TaskSection; failed: string[]; task_ids: string[]};
