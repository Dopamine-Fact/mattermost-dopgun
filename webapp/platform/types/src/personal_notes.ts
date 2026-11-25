// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type PersonalNoteVisibility = 'private' | 'team';

/** A team member's note; date ('' = undated) and time ('' = all day) are wall-clock values. */
export type PersonalNote = {
    id: string;
    team_id: string;
    user_id: string;
    title: string;
    message: string;
    visibility: PersonalNoteVisibility;
    date: string;
    time: string;
    remind_minutes: number;
    remind_at: number;
    done_at: number;
    create_at: number;
    update_at: number;
};

export type PersonalNotePatch = Partial<Pick<PersonalNote, 'title' | 'message' | 'visibility' | 'date' | 'time' | 'remind_minutes'>> & {done?: boolean};

export type PersonalNotesQuery = {from?: string; to?: string; undated?: boolean; only_mine?: boolean};
