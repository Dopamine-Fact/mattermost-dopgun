// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useState} from 'react';
import {FormattedMessage, defineMessages} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {StatusPeriod} from '@mattermost/types/status_periods';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getConfig} from 'mattermost-redux/selectors/entities/general';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import AdminHeader from 'components/widgets/admin_console/admin_header';

import {summarizeDay} from 'utils/status_periods';

const msg = defineMessages({
    title: {id: 'admin.breaks_report.title', defaultMessage: 'Breaks'},
    date: {id: 'admin.breaks_report.date', defaultMessage: 'Date'},
    user: {id: 'admin.breaks_report.user', defaultMessage: 'User'},
    firstOpen: {id: 'admin.breaks_report.first_open', defaultMessage: 'First open'},
    breaks: {id: 'admin.breaks_report.breaks', defaultMessage: 'Breaks'},
    breakCount: {id: 'admin.breaks_report.break_count', defaultMessage: 'Break count'},
    overtime: {id: 'admin.breaks_report.overtime', defaultMessage: 'Overtime'},
    empty: {id: 'admin.breaks_report.empty', defaultMessage: 'No activity recorded for this day.'},
});

const NO_VALUE = '—';
const pad = (n: number) => String(n).padStart(2, '0');
const hourMin = (ms: number) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}`;
const clock = (t: number) => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`;
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** System Console page listing each user's first open, break total and overtime for one day. */
export default function BreaksReport() {
    const dispatch = useDispatch();
    const config = useSelector(getConfig);
    const users = useSelector(getUsers);
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const workdayStart = config.WorkdayStart || '09:00';
    const workdayEnd = config.WorkdayEnd || '18:00';

    const [date, setDate] = useState(() => isoDay(new Date(Date.now())));
    const [periods, setPeriods] = useState<StatusPeriod[]>([]);

    useEffect(() => {
        const [y, m, d] = date.split('-').map(Number);
        if (!y || !m || !d) {
            return undefined;
        }
        let cancelled = false;
        Client4.getStatusPeriods(new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()).then((result) => {
            if (!cancelled) {
                setPeriods(result);
                dispatch(getMissingProfilesByIds([...new Set(result.map((p) => p.user_id))]));
            }
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [date, dispatch]);

    const rows = useMemo(() => {
        const [y, m, d] = date.split('-').map(Number);
        const day = new Date(y, m - 1, d);
        const byUser = new Map<string, StatusPeriod[]>();
        periods.forEach((p) => byUser.set(p.user_id, [...(byUser.get(p.user_id) ?? []), p]));
        return [...byUser].
            map(([userId, list]) => ({userId, ...summarizeDay(list, day, workdayStart, workdayEnd, Date.now())})).
            sort((a, b) => b.breakMs - a.breakMs);
    }, [periods, date, workdayStart, workdayEnd]);

    return (
        <div className='wrapper--fixed'>
            <AdminHeader>
                <FormattedMessage {...msg.title}/>
            </AdminHeader>
            <div className='admin-console__wrapper'>
                <div className='admin-console__content'>
                    <label>
                        <FormattedMessage {...msg.date}/>
                        <input
                            type='date'
                            className='form-control'
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                        />
                    </label>
                    <table className='table'>
                        <thead>
                            <tr>
                                <th><FormattedMessage {...msg.user}/></th>
                                <th><FormattedMessage {...msg.firstOpen}/></th>
                                <th><FormattedMessage {...msg.breaks}/></th>
                                <th><FormattedMessage {...msg.breakCount}/></th>
                                <th><FormattedMessage {...msg.overtime}/></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.userId}>
                                    <td>{users[r.userId] ? displayUsername(users[r.userId], nameDisplay) : r.userId}</td>
                                    <td>{r.firstOpenAt ? clock(r.firstOpenAt) : NO_VALUE}</td>
                                    <td>{hourMin(r.breakMs)}</td>
                                    <td>{r.breakCount}</td>
                                    <td>{hourMin(r.overtimeMs)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {rows.length === 0 && <FormattedMessage {...msg.empty}/>}
                </div>
            </div>
        </div>
    );
}
