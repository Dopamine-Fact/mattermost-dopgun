// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FileInfo} from './files';

export type DailyReportTask = {
    id: string;
    title: string;
    section_name: string;
};

/** draft: files attached but not sent, seen only by the author; excused: a reviewer said no report is expected */
export type DailyReportStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'excused';

export type DailyReport = {
    id: string;
    team_id: string;
    user_id: string;
    date: string; // YYYY-MM-DD
    message: string;

    /** tasks the user finished that day */
    tasks: DailyReportTask[];
    status: DailyReportStatus;
    auto_approved: boolean;
    approved_by: string;
    approved_at: number;

    /** set when the author changed the report after sending it; previous_message is the text the reviewer last saw */
    edited: boolean;
    previous_message: string;
    rejected_by: string;
    rejected_at: number;
    reject_reason: string;
    create_at: number;
    update_at: number;

    /** screenshots and short videos attached to the report */
    files?: FileInfo[];
};
