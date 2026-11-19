// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {StatusPeriod} from '@mattermost/types/status_periods';

import {summarizeDay} from './status_periods';

const at = (h: number, m = 0, d = 20) => new Date(2026, 10, d, h, m).getTime();
const MIN = 60 * 1000;
const day = new Date(2026, 10, 20, 10);
const late = at(23, 59);

function period(kind: StatusPeriod['kind'], start: number, end = 0): StatusPeriod {
    return {id: `${kind}${start}`, user_id: 'u', kind, start_at: start, end_at: end};
}

describe('summarizeDay', () => {
    test('a break inside working hours counts fully', () => {
        const s = summarizeDay([period('away', at(12), at(12, 30))], day, '09:00', '18:00', late);
        expect(s.breakMs).toBe(30 * MIN);
        expect(s.breakCount).toBe(1);
    });

    test('a break running past the workday end stops at the end', () => {
        expect(summarizeDay([period('away', at(17, 50), at(19))], day, '09:00', '18:00', late).breakMs).toBe(10 * MIN);
    });

    test('a break starting before the workday counts from the start', () => {
        expect(summarizeDay([period('away', at(8), at(9, 15))], day, '09:00', '18:00', late).breakMs).toBe(15 * MIN);
    });

    test('a break wholly outside working hours is not counted', () => {
        const s = summarizeDay([period('away', at(19), at(20))], day, '09:00', '18:00', late);
        expect(s.breakMs).toBe(0);
        expect(s.breakCount).toBe(0);
    });

    test('active time after the workday end is overtime', () => {
        expect(summarizeDay([period('active', at(17), at(19, 30))], day, '09:00', '18:00', late).overtimeMs).toBe(90 * MIN);
    });

    test('an open break counts up to now', () => {
        expect(summarizeDay([period('away', at(12))], day, '09:00', '18:00', at(12, 20)).breakMs).toBe(20 * MIN);
    });

    test('an overnight break counts only its morning part', () => {
        expect(summarizeDay([period('away', at(18, 0, 19), at(9, 30))], day, '09:00', '18:00', late).breakMs).toBe(30 * MIN);
    });

    test('no active rows leaves first open unset', () => {
        expect(summarizeDay([period('away', at(12), at(12, 30))], day, '09:00', '18:00', late).firstOpenAt).toBeUndefined();
    });

    test('first open is the earliest active start on the day', () => {
        const s = summarizeDay([
            period('active', at(23, 0, 19), at(8)),
            period('active', at(13), at(14)),
            period('active', at(8, 40), at(12)),
        ], day, '09:00', '18:00', late);
        expect(s.firstOpenAt).toBe(at(8, 40));
    });
});
