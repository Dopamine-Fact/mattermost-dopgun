// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type Canvas = {
    channel_id: string;
    team_id: string;
    creator_id: string;
    last_seq: number;
    snapshot_seq: number;
    create_at: number;
    update_at: number;
};

/** All `data` fields are base64-encoded Yjs updates. */
export type CanvasState = {
    snapshot?: string;
    snapshot_seq: number;
    updates: Array<{seq: number; data: string}>;
    last_seq: number;
};
