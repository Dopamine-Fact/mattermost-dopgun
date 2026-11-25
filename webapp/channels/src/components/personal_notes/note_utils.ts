// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {EventInput} from '@fullcalendar/core';

import type {PersonalNote, PersonalNotePatch} from '@mattermost/types/personal_notes';

export const NO_REMINDER = -1;
export const TITLE_MAX_RUNES = 200;
export const MESSAGE_MAX_RUNES = 4000;

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD from the Date's local fields (toISOString would shift late-evening dates to UTC). */
export function toLocalDateString(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalTimeString(d: Date): string {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function plusThirtyMinutes(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const total = Math.min((h * 60) + m + 30, (23 * 60) + 59);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** A FullCalendar event for a dated note. Dates stay strings so every viewer sees the same day (floating time). */
export function noteToEvent(note: PersonalNote, currentUserId: string, ownerName: string): EventInput {
    const own = note.user_id === currentUserId;
    const allDay = note.time === '';
    return {
        id: note.id,
        title: note.title,
        start: allDay ? note.date : `${note.date}T${note.time}`,
        end: allDay ? undefined : `${note.date}T${plusThirtyMinutes(note.time)}`,
        allDay,
        editable: own,
        classNames: [
            'PersonalNote',
            own ? 'PersonalNote--own' : 'PersonalNote--team',
            ...(note.done_at ? ['PersonalNote--done'] : []),
        ],
        extendedProps: {note, ownerName},
    };
}

/** The patch for a dragged note: month view moves only the day, week view also sets (or clears) the time. */
export function dropToPatch(start: Date, allDay: boolean, view: string): PersonalNotePatch {
    const date = toLocalDateString(start);
    if (view !== 'timeGridWeek') {
        return {date};
    }
    return {date, time: allDay ? '' : toLocalTimeString(start)};
}

export function reminderOptions(allDay: boolean): Array<{value: number; labelId: string; defaultMessage: string}> {
    if (allDay) {
        return [
            {value: NO_REMINDER, labelId: 'personal_notes.reminder.none', defaultMessage: 'No reminder'},
            {value: 0, labelId: 'personal_notes.reminder.onTheDay', defaultMessage: 'On the day at 09:00'},
            {value: 1440, labelId: 'personal_notes.reminder.dayBefore', defaultMessage: 'The day before at 09:00'},
        ];
    }
    return [
        {value: NO_REMINDER, labelId: 'personal_notes.reminder.none', defaultMessage: 'No reminder'},
        {value: 0, labelId: 'personal_notes.reminder.atStart', defaultMessage: 'At the time'},
        {value: 5, labelId: 'personal_notes.reminder.min5', defaultMessage: '5 minutes before'},
        {value: 15, labelId: 'personal_notes.reminder.min15', defaultMessage: '15 minutes before'},
        {value: 30, labelId: 'personal_notes.reminder.min30', defaultMessage: '30 minutes before'},
        {value: 60, labelId: 'personal_notes.reminder.hour1', defaultMessage: '1 hour before'},
        {value: 1440, labelId: 'personal_notes.reminder.day1', defaultMessage: '1 day before'},
    ];
}

const runes = (s: string) => Array.from(s).length;

/** The i18n id of the first problem, mirroring the server's PersonalNote.IsValid; null when the note can be saved. */
export function validateNote(note: Partial<PersonalNote>): string | null {
    const title = (note.title ?? '').trim();
    if (!title || runes(title) > TITLE_MAX_RUNES) {
        return 'personal_notes.error.title';
    }
    if (runes(note.message ?? '') > MESSAGE_MAX_RUNES) {
        return 'personal_notes.error.message';
    }
    if (!note.date && note.time) {
        return 'personal_notes.error.timeWithoutDate';
    }
    if (!note.date && (note.remind_minutes ?? NO_REMINDER) !== NO_REMINDER) {
        return 'personal_notes.error.reminderWithoutDate';
    }
    return null;
}
