// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {defineMessages, FormattedDate, FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {DailyReport, DailyReportTask} from '@mattermost/types/daily_reports';

import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getUser} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import type {GlobalState} from 'types/store';

export const DAILY_REPORT_UPDATED = 'daily_report_updated';

// Matches DailyReportMessageMaxRunes and DailyReportRejectReasonMaxRunes on the server.
export const MESSAGE_MAX_LENGTH = 16000;
export const REASON_MAX_LENGTH = 1000;

export type Status = 'missing' | 'draft' | 'pending' | 'sent' | 'approved' | 'auto_approved' | 'rejected' | 'excused';

export const statusLabels = defineMessages<Status>({
    missing: {id: 'daily_reports.status.missing', defaultMessage: 'Missing'},
    draft: {id: 'daily_reports.status.draft', defaultMessage: 'Draft'},
    pending: {id: 'daily_reports.status.pending', defaultMessage: 'Pending'},
    sent: {id: 'daily_reports.status.sent', defaultMessage: 'Sent'},
    approved: {id: 'daily_reports.status.approved', defaultMessage: 'Approved'},
    auto_approved: {id: 'daily_reports.status.autoApproved', defaultMessage: 'Auto-approved'},
    rejected: {id: 'daily_reports.status.rejected', defaultMessage: 'Sent back'},
    excused: {id: 'daily_reports.status.excused', defaultMessage: 'Excused'},
});

export function statusOf(report?: DailyReport, own?: boolean): Status {
    if (!report) {
        return 'missing';
    }
    if (report.status === 'pending' && own) {
        return 'sent'; // the author waits on no one; "pending" reads as their own to-do
    }
    if (report.status === 'approved') {
        return report.auto_approved ? 'auto_approved' : 'approved';
    }
    return report.status;
}

// own: shown to the report's author, who sees pending as Sent.
export function StatusChip({report, own}: {report?: DailyReport; own?: boolean}) {
    const {formatMessage} = useIntl();
    const status = statusOf(report, own);
    return (
        <span className={classNames('DailyReportsPage__chip', `DailyReportsPage__chip--${status}`)}>
            {formatMessage(statusLabels[status])}
        </span>
    );
}

// A report's day (YYYY-MM-DD), e.g. "Thursday, Nov 19, 2026"; noon UTC keeps the day the same in every zone.
export function ReportDate({date}: {date: string}) {
    return (
        <FormattedDate
            value={Date.parse(`${date}T12:00:00Z`)}
            timeZone='UTC'
            weekday='long'
            day='numeric'
            month='short'
            year='numeric'
        />
    );
}

export function RejectedBanner({report}: {report: DailyReport}) {
    const reviewer = useSelector((state: GlobalState) => getUser(state, report.rejected_by));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    return (
        <div
            className='DailyReportsPage__banner'
            role='status'
        >
            <i className='icon icon-alert-outline'/>
            <FormattedMessage
                id='daily_reports.rejectedBanner'
                defaultMessage='Sent back by {name}: {reason}'
                values={{name: reviewer ? displayUsername(reviewer, nameDisplay) : '', reason: report.reject_reason}}
            />
        </div>
    );
}

// The last rejection stays on a report once it is pending (or approved) again, so the fix can be judged against it.
export function PreviouslyRejected({report}: {report?: DailyReport}) {
    if (!report?.reject_reason || report.status === 'rejected') {
        return null;
    }
    return (
        <p className='DailyReportsPage__previouslyRejected'>
            <FormattedMessage
                id='daily_reports.previouslyRejected'
                defaultMessage='Previously sent back: {reason}'
                values={{reason: report.reject_reason}}
            />
        </p>
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
