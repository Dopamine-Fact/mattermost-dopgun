// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/** A stretch of desktop work ('active') or a break ('away'); end_at is 0 while it is still running. */
export type StatusPeriod = {
    id: string;
    user_id: string;
    kind: 'active' | 'away';
    start_at: number;
    end_at: number;
};
