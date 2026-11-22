// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {defineMessages, FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';

import type {StatusPeriod} from '@mattermost/types/status_periods';

import {Client4} from 'mattermost-redux/client';
import {getConfig} from 'mattermost-redux/selectors/entities/general';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentUser, getStatusForUserId} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import UserAccountMenu from 'components/user_account_menu';

import {UserStatuses} from 'utils/constants';
import {atTime, summarizeDay} from 'utils/status_periods';

import type {GlobalState} from 'types/store';

import './status_box.scss';

const statusMessages = defineMessages({
    online: {id: 'status_box.status.online', defaultMessage: 'Online'},
    away: {id: 'status_box.status.away', defaultMessage: 'Away'},
    dnd: {id: 'status_box.status.dnd', defaultMessage: 'Do Not Disturb'},
    ooo: {id: 'status_box.status.ooo', defaultMessage: 'Out of office'},
    offline: {id: 'status_box.status.offline', defaultMessage: 'Offline'},
});

const pad = (n: number) => String(n).padStart(2, '0');

function formatHourMin(ms: number) {
    const m = Math.floor(ms / 60000);
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** The current user's avatar, status, and overtime counter at the bottom of the left sidebar; opens the status menu. */
export default function StatusBox() {
    const user = useSelector(getCurrentUser);
    const status = useSelector((state: GlobalState) => getStatusForUserId(state, user?.id)) || UserStatuses.OFFLINE;
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const config = useSelector(getConfig);
    const workdayStart = config.WorkdayStart || '09:00';
    const workdayEnd = config.WorkdayEnd || '18:00';

    const [periods, setPeriods] = useState<StatusPeriod[]>([]);
    const [now, setNow] = useState(Date.now());

    const load = useCallback(() => {
        const today = new Date(Date.now());
        const from = atTime(today, '00:00');
        const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
        Client4.getStatusPeriods(from, to).then((result) => {
            setPeriods(result);
            setNow(Date.now());
        }).catch(() => {});
    }, []);

    useEffect(() => {
        load();

        // The server records the period just after the status changes; the minute refresh also rolls over the day.
        const retry = setTimeout(load, 2000);
        const refresh = setInterval(load, 60 * 1000);
        return () => {
            clearTimeout(retry);
            clearInterval(refresh);
        };
    }, [status, load]);

    const today = new Date(now);
    const workEnd = atTime(today, workdayEnd);
    const afterHours = now >= workEnd;
    const summary = useMemo(() => summarizeDay(periods, new Date(now), workdayStart, workdayEnd, now), [periods, now, workdayStart, workdayEnd]);
    const openActive = periods.find((p) => p.kind === 'active' && !p.end_at);
    const running = afterHours && openActive !== undefined;

    useEffect(() => {
        if (!running) {
            return undefined;
        }
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, [running]);

    if (!user) {
        return null;
    }

    const statusMessage = statusMessages[status as keyof typeof statusMessages] ?? statusMessages.offline;

    return (
        <div className='StatusBox'>
            <UserAccountMenu placement='sidebar'>
                <span className='StatusBox__text'>
                    <span className='StatusBox__name'>{displayUsername(user, nameDisplay)}</span>
                    <span className='StatusBox__status'><FormattedMessage {...statusMessage}/></span>
                    {afterHours && summary.overtimeMs > 0 && (
                        <span className='StatusBox__counter StatusBox__counter--overtime'>
                            <FormattedMessage
                                id='status_box.overtime'
                                defaultMessage='Overtime {time}'
                                values={{time: formatHourMin(summary.overtimeMs)}}
                            />
                        </span>
                    )}
                </span>
            </UserAccountMenu>
        </div>
    );
}
