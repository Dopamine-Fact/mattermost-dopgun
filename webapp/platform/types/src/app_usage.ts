// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** A stretch of time the desktop app saw one window focused while its user was active. */
export type AppUsageInterval = {
    app: string;
    title: string;
    start_at: number;
    end_at: number;
};

/** Time one user spent in one app window within the asked range. */
export type AppUsageTotal = {
    user_id: string;
    app: string;
    title: string;
    ms: number;
};
