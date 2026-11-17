// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {defineMessages, useIntl} from 'react-intl';

import type {DailyReport, DailyReportTask} from '@mattermost/types/daily_reports';

export const DAILY_REPORT_UPDATED = 'daily_report_updated';

// Matches DailyReportMessageMaxRunes and DailyReportRejectReasonMaxRunes on the server.
export const MESSAGE_MAX_LENGTH = 16000;
export const REASON_MAX_LENGTH = 1000;

type Status = 'missing' | 'pending' | 'approved' | 'auto_approved' | 'rejected';

const statusLabels = defineMessages<Status>({
    missing: {id: 'daily_reports.status.missing', defaultMessage: 'Missing'},
    pending: {id: 'daily_reports.status.pending', defaultMessage: 'Pending'},
    approved: {id: 'daily_reports.status.approved', defaultMessage: 'Approved'},
    auto_approved: {id: 'daily_reports.status.autoApproved', defaultMessage: 'Auto-approved'},
    rejected: {id: 'daily_reports.status.rejected', defaultMessage: 'Sent back'},
});

function statusOf(report?: DailyReport): Status {
    if (!report) {
        return 'missing';
    }
    if (report.status === 'approved') {
        return report.auto_approved ? 'auto_approved' : 'approved';
    }
    return report.status;
}

export function StatusChip({report}: {report?: DailyReport}) {
    const {formatMessage} = useIntl();
    const status = statusOf(report);
    return (
        <span className={classNames('DailyReportsPage__chip', `DailyReportsPage__chip--${status}`)}>
            {formatMessage(statusLabels[status])}
        </span>
    );
}

export function TaskChips({tasks}: {tasks?: DailyReportTask[]}) {
    if (!tasks?.length) {
        return null;
    }
    return (
        <ul className='DailyReportsPage__tasks'>
            {tasks.map((t) => (
                <li key={t.id}>
                    <i className='icon icon-check'/>
                    {t.section_name ? `${t.section_name}: ${t.title}` : t.title}
                </li>
            ))}
        </ul>
    );
}

// The calendar day (YYYY-MM-DD) in the team's timezone; falls back to the browser's when it is empty or invalid.
export function todayIn(timeZone?: string, now = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-CA', {timeZone: timeZone || undefined}).format(now);
    } catch {
        return new Intl.DateTimeFormat('en-CA').format(now);
    }
}

export function daysBefore(date: string, days: number) {
    return new Date(Date.parse(`${date}T00:00:00Z`) - (days * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}
