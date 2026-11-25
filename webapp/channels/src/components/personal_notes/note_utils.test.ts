// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {PersonalNote} from '@mattermost/types/personal_notes';

import {dropToPatch, noteToEvent, reminderOptions, toLocalDateString, toLocalTimeString, validateNote} from './note_utils';

function note(over: Partial<PersonalNote> = {}): PersonalNote {
    return {
        id: 'n1',
        team_id: 't1',
        user_id: 'me',
        title: 'Send report',
        message: '',
        visibility: 'private',
        date: '2026-11-25',
        time: '10:00',
        remind_minutes: -1,
        remind_at: 0,
        done_at: 0,
        create_at: 1,
        update_at: 1,
        ...over,
    };
}

describe('noteToEvent', () => {
    test('all-day notes start on the date string itself, never a Date', () => {
        const event = noteToEvent(note({time: ''}), 'me', 'Me');
        expect(event.allDay).toBe(true);
        expect(event.start).toBe('2026-11-25');
        expect(event.end).toBeUndefined();
    });

    test('timed notes are a 30 minute floating event', () => {
        const event = noteToEvent(note(), 'me', 'Me');
        expect(event.allDay).toBe(false);
        expect(event.start).toBe('2026-11-25T10:00');
        expect(event.end).toBe('2026-11-25T10:30');
    });

    test('a timed note near midnight ends on the same day', () => {
        expect(noteToEvent(note({time: '23:50'}), 'me', 'Me').end).toBe('2026-11-25T23:59');
    });

    test('only the owner can drag a note', () => {
        expect(noteToEvent(note(), 'me', 'Me').editable).toBe(true);
        expect(noteToEvent(note({user_id: 'ayse', visibility: 'team'}), 'me', 'Ayşe').editable).toBe(false);
    });

    test('carries the note and marks done and teammate notes', () => {
        const event = noteToEvent(note({user_id: 'ayse', visibility: 'team', done_at: 5}), 'me', 'Ayşe');
        expect(event.extendedProps?.note.id).toBe('n1');
        expect(event.extendedProps?.ownerName).toBe('Ayşe');
        expect(event.classNames).toEqual(expect.arrayContaining(['PersonalNote--team', 'PersonalNote--done']));
    });
});

describe('dropToPatch', () => {
    const start = new Date(2026, 10, 27, 14, 30);

    test('month view moves the date and keeps the time', () => {
        expect(dropToPatch(start, false, 'dayGridMonth')).toEqual({date: '2026-11-27'});
    });

    test('week view moves date and time', () => {
        expect(dropToPatch(start, false, 'timeGridWeek')).toEqual({date: '2026-11-27', time: '14:30'});
    });

    test('week view all-day row clears the time', () => {
        expect(dropToPatch(new Date(2026, 10, 27), true, 'timeGridWeek')).toEqual({date: '2026-11-27', time: ''});
    });
});

describe('date helpers', () => {
    test('use local fields, not UTC', () => {
        const late = new Date(2026, 10, 25, 23, 30);
        expect(toLocalDateString(late)).toBe('2026-11-25');
        expect(toLocalTimeString(late)).toBe('23:30');
        expect(toLocalDateString(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
        expect(toLocalTimeString(new Date(2026, 0, 5, 0, 5))).toBe('00:05');
    });
});

describe('reminderOptions', () => {
    test('timed notes offer minutes before the start', () => {
        expect(reminderOptions(false).map((o) => o.value)).toEqual([-1, 0, 5, 15, 30, 60, 1440]);
    });

    test('all-day notes offer the day and the day before', () => {
        expect(reminderOptions(true).map((o) => o.value)).toEqual([-1, 0, 1440]);
    });
});

describe('validateNote', () => {
    test('accepts a complete note', () => {
        expect(validateNote(note())).toBeNull();
        expect(validateNote(note({date: '', time: '', remind_minutes: -1}))).toBeNull();
    });

    test('rejects a blank or too long title', () => {
        expect(validateNote(note({title: '   '}))).toBe('personal_notes.error.title');
        expect(validateNote(note({title: 'ş'.repeat(201)}))).toBe('personal_notes.error.title');
        expect(validateNote(note({title: 'ş'.repeat(200)}))).toBeNull();
    });

    test('rejects a too long description', () => {
        expect(validateNote(note({message: 'x'.repeat(4001)}))).toBe('personal_notes.error.message');
    });

    test('rejects time or reminder without a date', () => {
        expect(validateNote(note({date: '', time: '10:00'}))).toBe('personal_notes.error.timeWithoutDate');
        expect(validateNote(note({date: '', time: '', remind_minutes: 0}))).toBe('personal_notes.error.reminderWithoutDate');
    });
});
