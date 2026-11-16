// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect} from 'react-router-dom';

import {FileTextOutlineIcon} from '@mattermost/compass-icons/components';
import type {DailyReport} from '@mattermost/types/daily_reports';

import {getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getProfilesInTeam} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {selectLhsItem} from 'actions/views/lhs';

import WebSocketClient from 'client/web_websocket_client';

import type {GlobalState} from 'types/store';
import {LhsItemType, LhsPage} from 'types/store/lhs';

import './daily_reports.scss';

// shortcut: the team list shows the first 200 members; page through them for bigger teams.
const MEMBER_PAGE_SIZE = 200;

const DAILY_REPORT_UPDATED = 'daily_report_updated';

type Status = 'missing' | 'pending' | 'approved' | 'auto_approved';

const statusLabels = defineMessages<Status>({
    missing: {id: 'daily_reports.status.missing', defaultMessage: 'Missing'},
    pending: {id: 'daily_reports.status.pending', defaultMessage: 'Pending'},
    approved: {id: 'daily_reports.status.approved', defaultMessage: 'Approved'},
    auto_approved: {id: 'daily_reports.status.autoApproved', defaultMessage: 'Auto-approved'},
});

function statusOf(report?: DailyReport): Status {
    if (!report) {
        return 'missing';
    }
    if (report.status === 'approved') {
        return report.auto_approved ? 'auto_approved' : 'approved';
    }
    return 'pending';
}

// The calendar day (YYYY-MM-DD) in the team's timezone; falls back to the browser's when it is empty or invalid.
export function todayIn(timeZone?: string, now = new Date()) {
    try {
        return new Intl.DateTimeFormat('en-CA', {timeZone: timeZone || undefined}).format(now);
    } catch {
        return new Intl.DateTimeFormat('en-CA').format(now);
    }
}

function StatusChip({status}: {status: Status}) {
    const {formatMessage} = useIntl();
    return (
        <span className={classNames('DailyReportsPage__chip', `DailyReportsPage__chip--${status}`)}>
            {formatMessage(statusLabels[status])}
        </span>
    );
}

type Tab = 'mine' | 'team';

const DailyReports = () => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const enabled = Boolean(team?.daily_reports_enabled);

    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const canApprove = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_TEAM_TASKS));

    const [tab, setTab] = useState<Tab>('mine');
    const [mine, setMine] = useState<DailyReport>();
    const [message, setMessage] = useState('');
    const [date, setDate] = useState(() => todayIn(team?.daily_report_timezone));
    const [teamReports, setTeamReports] = useState<DailyReport[]>([]);
    const [from, setFrom] = useState(() => todayIn(team?.daily_report_timezone));
    const [to, setTo] = useState(() => todayIn(team?.daily_report_timezone));
    const [error, setError] = useState('');

    const activeTab = canApprove ? tab : 'mine';

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.DailyReports));
    }, [dispatch]);

    useEffect(() => {
        if (enabled && canApprove) {
            dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
        }
    }, [dispatch, teamId, enabled, canApprove]);

    // Refetches whatever list the visible tab shows.
    const refresh = useCallback(async () => {
        try {
            if (activeTab === 'mine') {
                // No dates: the server defaults to today in the team's timezone.
                const [today] = await Client4.getDailyReports(teamId);
                setMine(today);
                setMessage((current) => current || today?.message || '');
            } else {
                setTeamReports(await Client4.getDailyReports(teamId, date, date));
            }
        } catch (e) {
            setError((e as Error).message);
        }
    }, [activeTab, teamId, date]);

    useEffect(() => {
        if (enabled) {
            refresh();
        }
    }, [enabled, refresh]);

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const listener = (msg: {event: string}) => {
            if (msg.event === DAILY_REPORT_UPDATED) {
                refresh();
            }
        };
        WebSocketClient.addMessageListener(listener);
        return () => WebSocketClient.removeMessageListener(listener);
    }, [enabled, refresh]);

    const rows = useMemo(() => {
        const byUser = new Map(teamReports.map((r) => [r.user_id, r]));
        return members.map((user) => ({user, report: byUser.get(user.id)}));
    }, [members, teamReports]);

    if (!team) {
        return null;
    }
    if (!enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }

    const submit = async () => {
        setError('');
        try {
            const saved = await Client4.submitDailyReport(teamId, message);
            setMine(saved);
            setMessage(saved.message);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const approve = async (reportId: string) => {
        setError('');
        try {
            await Client4.approveDailyReport(reportId);
            refresh();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const tabs: Array<{id: Tab; label: string}> = [{id: 'mine', label: formatMessage({id: 'daily_reports.tab.mine', defaultMessage: 'My report'})}];
    if (canApprove) {
        tabs.push({id: 'team', label: formatMessage({id: 'daily_reports.tab.team', defaultMessage: 'Team reports'})});
    }

    const locked = mine?.status === 'approved';

    return (
        <div className='DailyReportsPage'>
            <div className='DailyReportsPage__header'>
                <div className='DailyReportsPage__title'>
                    <FileTextOutlineIcon size={18}/>
                    <h1>
                        <FormattedMessage
                            id='daily_reports.title'
                            defaultMessage='Daily reports'
                        />
                    </h1>
                </div>
                <div
                    className='DailyReportsPage__tabs'
                    role='tablist'
                >
                    {tabs.map(({id, label}) => (
                        <button
                            key={id}
                            role='tab'
                            aria-selected={id === activeTab}
                            className={classNames('DailyReportsPage__tab', {'DailyReportsPage__tab--active': id === activeTab})}
                            onClick={() => setTab(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div
                className='DailyReportsPage__content'
                role='tabpanel'
            >
                {error && (
                    <div
                        className='DailyReportsPage__error'
                        role='alert'
                    >
                        {error}
                    </div>
                )}

                {activeTab === 'mine' ? (
                    <section className='DailyReportsPage__mine'>
                        <StatusChip status={statusOf(mine)}/>
                        <textarea
                            aria-label={formatMessage({id: 'daily_reports.mine.label', defaultMessage: 'Your report for today'})}
                            placeholder={formatMessage({id: 'daily_reports.mine.placeholder', defaultMessage: 'What did you get done today?'})}
                            value={message}
                            readOnly={locked}
                            onChange={(e) => setMessage(e.target.value)}
                        />
                        {mine && mine.tasks.length > 0 && (
                            <ul className='DailyReportsPage__tasks'>
                                {mine.tasks.map((t) => (
                                    <li key={t.id}>{t.section_name ? `${t.section_name}: ${t.title}` : t.title}</li>
                                ))}
                            </ul>
                        )}
                        {!locked && (
                            <button
                                className='btn btn-primary'
                                disabled={!message.trim()}
                                onClick={submit}
                            >
                                {mine ? (
                                    <FormattedMessage
                                        id='daily_reports.update'
                                        defaultMessage='Update'
                                    />
                                ) : (
                                    <FormattedMessage
                                        id='daily_reports.submit'
                                        defaultMessage='Submit'
                                    />
                                )}
                            </button>
                        )}
                    </section>
                ) : (
                    <section className='DailyReportsPage__team'>
                        <label className='DailyReportsPage__field'>
                            <FormattedMessage
                                id='daily_reports.date'
                                defaultMessage='Date'
                            />
                            <input
                                type='date'
                                value={date}
                                onChange={(e) => e.target.value && setDate(e.target.value)}
                            />
                        </label>
                        <ul className='DailyReportsPage__rows'>
                            {rows.map(({user, report}) => (
                                <li
                                    key={user.id}
                                    className='DailyReportsPage__row'
                                >
                                    <div className='DailyReportsPage__rowHead'>
                                        <strong>{displayUsername(user, nameDisplay)}</strong>
                                        <StatusChip status={statusOf(report)}/>
                                        {report?.status === 'pending' && (
                                            <button
                                                className='btn btn-primary btn-sm'
                                                onClick={() => approve(report.id)}
                                            >
                                                <FormattedMessage
                                                    id='daily_reports.approve'
                                                    defaultMessage='Approve'
                                                />
                                            </button>
                                        )}
                                    </div>
                                    {report && <p>{report.message}</p>}
                                    {report && report.tasks.length > 0 && (
                                        <ul className='DailyReportsPage__tasks'>
                                            {report.tasks.map((t) => (
                                                <li key={t.id}>{t.section_name ? `${t.section_name}: ${t.title}` : t.title}</li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <div className='DailyReportsPage__export'>
                    <label className='DailyReportsPage__field'>
                        <FormattedMessage
                            id='daily_reports.from'
                            defaultMessage='From'
                        />
                        <input
                            type='date'
                            value={from}
                            onChange={(e) => e.target.value && setFrom(e.target.value)}
                        />
                    </label>
                    <label className='DailyReportsPage__field'>
                        <FormattedMessage
                            id='daily_reports.to'
                            defaultMessage='To'
                        />
                        <input
                            type='date'
                            value={to}
                            onChange={(e) => e.target.value && setTo(e.target.value)}
                        />
                    </label>
                    <a
                        className='btn btn-tertiary'
                        href={Client4.getDailyReportsExportUrl(teamId, from, to)}
                        download={true}
                    >
                        <FormattedMessage
                            id='daily_reports.download'
                            defaultMessage='Download CSV'
                        />
                    </a>
                </div>
            </div>
        </div>
    );
};

export default DailyReports;
