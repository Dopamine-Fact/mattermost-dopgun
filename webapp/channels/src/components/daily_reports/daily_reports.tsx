// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect} from 'react-router-dom';

import {FileTextOutlineIcon} from '@mattermost/compass-icons/components';

import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {selectLhsItem} from 'actions/views/lhs';

import WebSocketClient from 'client/web_websocket_client';

import type {GlobalState} from 'types/store';
import {LhsItemType, LhsPage} from 'types/store/lhs';

import {DAILY_REPORT_UPDATED, todayIn} from './common';
import MyReport from './my_report';
import TeamReports from './team_reports';

import './daily_reports.scss';

type Tab = 'mine' | 'team';

const DailyReports = () => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const enabled = Boolean(team?.daily_reports_enabled);
    const currentUserId = useSelector(getCurrentUserId);
    const canApprove = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_DAILY_REPORTS));

    const [tab, setTab] = useState<Tab>('mine');
    const [tick, setTick] = useState(0);
    const [from, setFrom] = useState(() => todayIn(team?.daily_report_timezone));
    const [to, setTo] = useState(() => todayIn(team?.daily_report_timezone));
    const [error, setError] = useState('');

    const activeTab = canApprove ? tab : 'mine';

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.DailyReports));
    }, [dispatch]);

    // Every daily report event makes the visible tab refetch.
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const listener = (msg: {event: string}) => {
            if (msg.event === DAILY_REPORT_UPDATED) {
                setTick((n) => n + 1);
            }
        };
        WebSocketClient.addMessageListener(listener);
        return () => WebSocketClient.removeMessageListener(listener);
    }, [enabled]);

    if (!team) {
        return null;
    }
    if (!enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }

    const tabs: Array<{id: Tab; label: string}> = [{id: 'mine', label: formatMessage({id: 'daily_reports.tab.mine', defaultMessage: 'My report'})}];
    if (canApprove) {
        tabs.push({id: 'team', label: formatMessage({id: 'daily_reports.tab.team', defaultMessage: 'Team reports'})});
    }

    const exportable = Boolean(from && to && from <= to);

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
                    <MyReport
                        teamId={teamId}
                        timeZone={team.daily_report_timezone}
                        currentUserId={currentUserId}
                        tick={tick}
                        onError={setError}
                    />
                ) : (
                    <TeamReports
                        teamId={teamId}
                        timeZone={team.daily_report_timezone}
                        tick={tick}
                        onError={setError}
                    />
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
                        className={classNames('btn btn-tertiary', {disabled: !exportable})}
                        href={exportable ? Client4.getDailyReportsExportUrl(teamId, from, to) : undefined}
                        aria-disabled={!exportable}
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
