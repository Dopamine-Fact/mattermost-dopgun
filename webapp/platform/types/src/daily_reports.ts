// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type DailyReportTask = {
    id: string;
    title: string;
    section_name: string;
};

export type DailyReportStatus = 'pending' | 'approved';

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
    create_at: number;
    update_at: number;
};
