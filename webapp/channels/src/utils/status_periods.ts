// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {StatusPeriod} from '@mattermost/types/status_periods';

export type DaySummary = {
    breakMs: number;
    breakCount: number;
    overtimeMs: number;
    firstOpenAt?: number;
};

// Local wall-clock "HH:MM" on the same local day as `day`.
function atTime(day: Date, hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
}

function overlap(start: number, end: number, from: number, to: number): number {
    return Math.max(0, Math.min(end, to) - Math.max(start, from));
}

/** Breaks inside working hours, overtime after them, and the first desktop open for the local day containing `day`. */
export function summarizeDay(periods: StatusPeriod[], day: Date, workdayStart: string, workdayEnd: string, now: number): DaySummary {
    const dayStart = atTime(day, '00:00');
    const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const workStart = atTime(day, workdayStart);
    const workEnd = atTime(day, workdayEnd);

    const summary: DaySummary = {breakMs: 0, breakCount: 0, overtimeMs: 0};
    for (const p of periods) {
        const end = p.end_at || now;
        if (p.kind === 'away') {
            const ms = overlap(p.start_at, end, workStart, workEnd);
            if (ms > 0) {
                summary.breakMs += ms;
                summary.breakCount++;
            }
            continue;
        }
        summary.overtimeMs += overlap(p.start_at, end, workEnd, nextDay);
        if (p.start_at >= dayStart && p.start_at < nextDay && (summary.firstOpenAt === undefined || p.start_at < summary.firstOpenAt)) {
            summary.firstOpenAt = p.start_at;
        }
    }
    return summary;
}
