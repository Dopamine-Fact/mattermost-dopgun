// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fromDateInput, isOverdue, toDateInput} from './dates';

describe('task dates', () => {
    test('round-trips a date input value', () => {
        expect(toDateInput(fromDateInput('2026-03-09'))).toBe('2026-03-09');
        expect(toDateInput(0)).toBe('');
        expect(fromDateInput('')).toBe(0);
    });

    test('a task is overdue only after its due day', () => {
        const now = new Date(2026, 2, 9, 15, 0);
        expect(isOverdue(fromDateInput('2026-03-08'), now)).toBe(true);
        expect(isOverdue(fromDateInput('2026-03-09'), now)).toBe(false);
        expect(isOverdue(0, now)).toBe(false);
    });
});
