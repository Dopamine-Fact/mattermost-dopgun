// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {DailyReport} from '@mattermost/types/daily_reports';

import {getMissingProfilesByIds, getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getProfilesInTeam, getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import Markdown from 'components/markdown';

import type {GlobalState} from 'types/store';

import AssigneesModal from './assignees_modal';
import {StatusChip, TaskChips, todayIn} from './common';
import RejectModal from './reject_modal';

// shortcut: the team list shows the first 200 members; page through them for bigger teams.
const MEMBER_PAGE_SIZE = 200;

type Props = {
    teamId: string;
    timeZone?: string;

    /** bumped on every daily report websocket event */
    tick: number;
    onError: (message: string) => void;
};

const TeamReports = ({teamId, timeZone, tick, onError}: Props) => {
    const dispatch = useDispatch();
    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const profiles = useSelector(getUsers);
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);

    const [date, setDate] = useState(() => todayIn(timeZone));
    const [reports, setReports] = useState<DailyReport[]>([]);
    const [assignees, setAssignees] = useState<string[]>([]);
    const [reload, setReload] = useState(0);
    const [rejecting, setRejecting] = useState<DailyReport>();
    const [pickingReporters, setPickingReporters] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
    }, [dispatch, teamId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [list, ids] = await Promise.all([Client4.getDailyReports(teamId, date, date), Client4.getDailyReportAssignees(teamId)]);
                if (!cancelled) {
                    setReports(list);
                    setAssignees(ids);
                    onError('');
                }
            } catch (e) {
                if (!cancelled) {
                    onError((e as Error).message);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [teamId, date, tick, reload, onError]);

    const refresh = useCallback(() => setReload((n) => n + 1), []);

    // Authors of reports may have left the team or be past the first member page: load their profiles by id.
    useEffect(() => {
        const missing = reports.map((r) => r.user_id).filter((id) => !profiles[id]);
        if (missing.length) {
            dispatch(getMissingProfilesByIds(missing));
        }
    }, [dispatch, reports, profiles]);

    // Active members who owe a report (assignees only, when the team picked some) plus every report author.
    const rows = useMemo(() => {
        const byUser = new Map(reports.map((r) => [r.user_id, r]));
        const owes = members.filter((u) => !u.is_bot && !u.delete_at && (assignees.length === 0 || assignees.includes(u.id)));
        const users = new Map(owes.map((u) => [u.id, u]));
        byUser.forEach((_, id) => {
            if (profiles[id]) {
                users.set(id, profiles[id]);
            }
        });
        return Array.from(users.values(), (user) => ({user, report: byUser.get(user.id)}));
    }, [members, profiles, reports, assignees]);

    const approve = async (report: DailyReport) => {
        try {
            await Client4.approveDailyReport(report.id, report.update_at);
            onError('');
        } catch (e) {
            onError((e as Error).message);
        }
        refresh();
    };

    const toggleExpanded = (id: string) => setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) {
            next.add(id);
        }
        return next;
    });

    return (
        <section className='DailyReportsPage__team'>
            <div className='DailyReportsPage__toolbar'>
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
                <button
                    className='btn btn-tertiary btn-sm'
                    onClick={() => setPickingReporters(true)}
                >
                    <i className='icon icon-account-multiple-outline'/>
                    <FormattedMessage
                        id='daily_reports.reporters'
                        defaultMessage='Reporters'
                    />
                </button>
            </div>
            <ul className='DailyReportsPage__rows'>
                {rows.map(({user, report}) => (
                    <li
                        key={user.id}
                        className='DailyReportsPage__row'
                    >
                        <div className='DailyReportsPage__rowHead'>
                            <strong>{displayUsername(user, nameDisplay)}</strong>
                            <StatusChip report={report}/>
                            {report?.edited && report.previous_message && (
                                <button
                                    className='DailyReportsPage__tag DailyReportsPage__tag--button'
                                    aria-expanded={expanded.has(report.id)}
                                    onClick={() => toggleExpanded(report.id)}
                                >
                                    <FormattedMessage
                                        id='daily_reports.edited'
                                        defaultMessage='Edited'
                                    />
                                </button>
                            )}
                            <span className='DailyReportsPage__rowActions'>
                                {report?.status === 'pending' && (
                                    <button
                                        className='btn btn-primary btn-sm'
                                        onClick={() => approve(report)}
                                    >
                                        <FormattedMessage
                                            id='daily_reports.approve'
                                            defaultMessage='Approve'
                                        />
                                    </button>
                                )}
                                {(report?.status === 'pending' || report?.status === 'approved') && (
                                    <button
                                        className='btn btn-tertiary btn-sm btn-danger'
                                        onClick={() => setRejecting(report)}
                                    >
                                        <FormattedMessage
                                            id='daily_reports.reject'
                                            defaultMessage='Reject'
                                        />
                                    </button>
                                )}
                            </span>
                        </div>
                        {report?.status === 'rejected' && (
                            <p className='DailyReportsPage__reason'>
                                <FormattedMessage
                                    id='daily_reports.rowRejected'
                                    defaultMessage='Sent back: {reason}'
                                    values={{reason: report.reject_reason}}
                                />
                            </p>
                        )}
                        {report && expanded.has(report.id) && (
                            <blockquote className='DailyReportsPage__previous'>
                                <span className='DailyReportsPage__previousLabel'>
                                    <FormattedMessage
                                        id='daily_reports.previous'
                                        defaultMessage='Before the edit'
                                    />
                                </span>
                                <Markdown message={report.previous_message}/>
                            </blockquote>
                        )}
                        {report && (
                            <div className='DailyReportsPage__body'>
                                <Markdown message={report.message}/>
                            </div>
                        )}
                        <TaskChips tasks={report?.tasks}/>
                    </li>
                ))}
            </ul>
            {rejecting && (
                <RejectModal
                    report={rejecting}
                    onDone={refresh}
                    onExited={() => setRejecting(undefined)}
                />
            )}
            {pickingReporters && (
                <AssigneesModal
                    teamId={teamId}
                    members={members}
                    selected={assignees}
                    onSaved={setAssignees}
                    onExited={() => setPickingReporters(false)}
                />
            )}
        </section>
    );
};

export default TeamReports;
