// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, FormattedTime, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {DailyReport} from '@mattermost/types/daily_reports';
import type {FileInfo} from '@mattermost/types/files';
import type {UserProfile} from '@mattermost/types/users';

import {getTeamMembers} from 'mattermost-redux/actions/teams';
import {getMissingProfilesByIds, getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getMembersInTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId, getProfilesInTeam, getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import Markdown from 'components/markdown';
import {ranksOf, useTeamDepartments} from 'components/profile_popover/use_custom_roles';

import type {GlobalState} from 'types/store';

import AssigneesModal from './assignees_modal';
import {daysBefore, PreviouslyRejected, ReportDate, StatusChip, statusLabels, statusOf, TaskChips, todayIn} from './common';
import type {Status} from './common';
import {kindOf} from './media_section';
import RejectModal from './reject_modal';
import ReportDetailModal from './report_detail_modal';

// shortcut: the team list shows the first 200 members; page through them for bigger teams.
const MEMBER_PAGE_SIZE = 200;

// The client keeps the range short so the list stays readable; the server allows a year.
const MAX_RANGE_DAYS = 31;

const FILTER_STATUSES: Status[] = ['missing', 'pending', 'approved', 'auto_approved', 'rejected', 'excused'];

type Sort = 'newest' | 'oldest' | 'name';

export type Row = {user: UserProfile; date: string; report?: DailyReport};

const isWeekday = (date: string) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return day > 0 && day < 6;
};

// rowsForRange gives one row per report, plus a missing row for each weekday in from..to on which someone in owes sent none.
// Authors outside owes are looked up in profiles; reports whose author is unknown are left out.
export function rowsForRange(from: string, to: string, owes: UserProfile[], reports: DailyReport[], profiles: Record<string, UserProfile> = {}): Row[] {
    const sent = new Set(reports.map((r) => `${r.user_id}|${r.date}`));
    const rows: Row[] = [];
    for (let date = from; date <= to; date = daysBefore(date, -1)) {
        if (isWeekday(date)) {
            owes.forEach((user) => !sent.has(`${user.id}|${date}`) && rows.push({user, date}));
        }
    }
    const users = new Map(owes.map((u) => [u.id, u]));
    reports.forEach((report) => {
        const user = users.get(report.user_id) ?? profiles[report.user_id];
        if (user) {
            rows.push({user, date: report.date, report});
        }
    });
    return rows;
}

// To stays within [from, from + 31 days).
const clampTo = (from: string, to: string) => {
    const cap = daysBefore(from, -(MAX_RANGE_DAYS - 1));
    if (to < from) {
        return from;
    }
    return to > cap ? cap : to;
};

function AttachmentChip({files}: {files?: FileInfo[]}) {
    const {formatMessage} = useIntl();
    if (!files?.length) {
        return null;
    }
    const kinds = files.map(kindOf);
    let icon = 'icon-paperclip';
    let label = formatMessage({id: 'daily_reports.attachments', defaultMessage: '{count, plural, one {# attachment} other {# attachments}}'}, {count: files.length});
    if (kinds.includes('video')) {
        icon = 'icon-video-outline';
        label = formatMessage({id: 'daily_reports.media.count', defaultMessage: '{count} media'}, {count: files.length});
    } else if (kinds.includes('image')) {
        icon = 'icon-image-outline';
    }
    return (
        <span className='DailyReportsPage__attachments'>
            <i className={`icon ${icon}`}/>
            {label}
        </span>
    );
}

type ExcuseProps = {
    teamId: string;
    user: UserProfile;
    date: string;
    name: string;
    onDone: () => void;
    onExited: () => void;
};

// ExcuseModal confirms that no report is expected from the user on that day.
function ExcuseModal({teamId, user, date, name, onDone, onExited}: ExcuseProps) {
    const {formatMessage} = useIntl();
    const [show, setShow] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const confirm = async () => {
        setBusy(true);
        setError('');
        try {
            await Client4.excuseDailyReport(teamId, user.id, date);
            setShow(false);
            onDone();
        } catch (e) {
            setError((e as Error).message);
            if ((e as {status_code?: number}).status_code === 409) {
                onDone(); // the day was sent meanwhile: show it
            }
        }
        setBusy(false);
    };

    return (
        <GenericModal
            id='dailyReportExcuseModal'
            modalHeaderText={formatMessage({id: 'daily_reports.excuseModal.title', defaultMessage: 'Excuse this day?'})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={confirm}
            confirmButtonText={formatMessage({id: 'daily_reports.excuse', defaultMessage: 'Excuse'})}
            isConfirmDisabled={busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <div className='DailyReportsModal__body'>
                <FormattedMessage
                    id='daily_reports.excuseModal.body'
                    defaultMessage='{name} will not be expected to report on {date}.'
                    values={{name, date: <ReportDate date={date}/>}}
                />
            </div>
        </GenericModal>
    );
}

type Props = {
    teamId: string;
    timeZone?: string;

    /** bumped on every daily report websocket event */
    tick: number;
    onError: (message: string) => void;
};

const TeamReports = ({teamId, timeZone, tick, onError}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const teamMembers = useSelector((state: GlobalState) => getMembersInTeam(state, teamId));
    const profiles = useSelector(getUsers);
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const currentUserId = useSelector(getCurrentUserId);
    const departments = useTeamDepartments(teamId);

    // Only admins review their own report; the server refuses it for everyone else.
    const canReviewSelf = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_TEAM));

    const today = todayIn(timeZone);
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState(today);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<Status | 'all'>('all');
    const [who, setWho] = useState('all'); // 'all', 'dept:<id>' or 'user:<id>'
    const [sort, setSort] = useState<Sort>('newest');

    const [reports, setReports] = useState<DailyReport[]>([]);
    const [assignees, setAssignees] = useState<string[]>([]);
    const [actionable, setActionable] = useState<Set<string> | null>(null); // null: unknown, show everyone
    const [reload, setReload] = useState(0);
    const [rejecting, setRejecting] = useState<DailyReport>();
    const [detail, setDetail] = useState<DailyReport>();
    const [excusing, setExcusing] = useState<Row>();
    const [pickingReporters, setPickingReporters] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
        dispatch(getTeamMembers(teamId, 0, MEMBER_PAGE_SIZE));
    }, [dispatch, teamId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [list, ids, canAct] = await Promise.all([
                    Client4.getDailyReports(teamId, from, to),
                    Client4.getDailyReportAssignees(teamId),
                    Client4.getActionableUserIds(teamId, 'manage_daily_reports').catch(() => null),
                ]);
                if (!cancelled) {
                    setReports(list);
                    setAssignees(ids);
                    setActionable(canAct && new Set(canAct));
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
    }, [teamId, from, to, tick, reload, onError]);

    const refresh = useCallback(() => setReload((n) => n + 1), []);

    // Authors of reports may have left the team or be past the first member page: load their profiles by id.
    useEffect(() => {
        const missing = reports.map((r) => r.user_id).filter((id) => !profiles[id]);
        if (missing.length) {
            dispatch(getMissingProfilesByIds(missing));
        }
    }, [dispatch, reports, profiles]);

    // Active members who owe a report (assignees only, when the team picked some) and whom the viewer outranks, plus every report author.
    // Days after today are not missing yet.
    const rows = useMemo(() => {
        const owes = members.filter((u) => !u.is_bot && !u.delete_at && (assignees.length === 0 || assignees.includes(u.id)) && (!actionable || actionable.has(u.id)));
        return rowsForRange(from, to < today ? to : today, owes, reports, profiles);
    }, [members, profiles, reports, assignees, actionable, from, to, today]);

    const nameOf = useCallback((user: UserProfile) => displayUsername(user, nameDisplay), [nameDisplay]);

    const people = useMemo(() => {
        const byId = new Map(rows.map(({user}) => [user.id, user]));
        return Array.from(byId.values()).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    }, [rows, nameOf]);

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        const keep = ({user, report}: Row) => {
            if (query && ![nameOf(user), user.username, report?.message ?? ''].some((text) => text.toLowerCase().includes(query))) {
                return false;
            }
            if (status !== 'all' && statusOf(report) !== status) {
                return false;
            }
            if (who.startsWith('user:')) {
                return user.id === who.slice(5);
            }
            if (who.startsWith('dept:')) {
                return ranksOf(departments, teamMembers?.[user.id]?.roles ?? '').some(({department}) => department.id === who.slice(5));
            }
            return true;
        };
        const byName = (a: Row, b: Row) => nameOf(a.user).localeCompare(nameOf(b.user));
        const compare = (a: Row, b: Row) => {
            if (sort === 'name') {
                return byName(a, b) || b.date.localeCompare(a.date);
            }
            const x = a.report?.create_at ?? 0;
            const y = b.report?.create_at ?? 0;
            if (!x !== !y) {
                return x ? -1 : 1; // missing rows last
            }
            return (sort === 'newest' ? y - x : x - y) || b.date.localeCompare(a.date) || byName(a, b);
        };
        return rows.filter(keep).sort(compare);
    }, [rows, search, status, who, sort, departments, teamMembers, nameOf]);

    const approve = async (report: DailyReport) => {
        setDetail(undefined);
        try {
            await Client4.approveDailyReport(report.id, report.update_at);
            onError('');
        } catch (e) {
            onError((e as Error).message);
        }
        refresh();
    };

    const reject = (report: DailyReport) => {
        setDetail(undefined);
        setRejecting(report);
    };

    const toggleExpanded = (id: string) => setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) {
            next.add(id);
        }
        return next;
    });

    const canReview = (userId: string) => userId !== currentUserId || canReviewSelf;

    const reviewButtons = (report: DailyReport) => canReview(report.user_id) && (
        <>
            {(report.status === 'pending' || report.status === 'approved') && (
                <button
                    className='btn btn-tertiary btn-sm btn-danger'
                    onClick={() => reject(report)}
                >
                    <FormattedMessage
                        id='daily_reports.reject'
                        defaultMessage='Reject'
                    />
                </button>
            )}
            {report.status === 'pending' && (
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
        </>
    );

    const changeFrom = (value: string) => {
        if (value) {
            setFrom(value);
            setTo(clampTo(value, to));
        }
    };

    // Moves the whole range by one day, keeping its length.
    const shiftDay = (days: number) => {
        setFrom(daysBefore(from, -days));
        setTo(daysBefore(to, -days));
    };

    return (
        <section className='DailyReportsPage__team'>
            <div className='DailyReportsPage__filters'>
                <input
                    type='search'
                    className='form-control DailyReportsPage__search'
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={formatMessage({id: 'daily_reports.search', defaultMessage: 'Search people or report text…'})}
                    aria-label={formatMessage({id: 'daily_reports.search', defaultMessage: 'Search people or report text…'})}
                />
                <select
                    className='form-control'
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Status | 'all')}
                    aria-label={formatMessage({id: 'daily_reports.filter.status', defaultMessage: 'Status'})}
                >
                    <option value='all'>{formatMessage({id: 'daily_reports.filter.all', defaultMessage: 'All'})}</option>
                    {FILTER_STATUSES.map((s) => (
                        <option
                            key={s}
                            value={s}
                        >
                            {formatMessage(statusLabels[s])}
                        </option>
                    ))}
                </select>
                <select
                    className='form-control'
                    value={who}
                    onChange={(e) => setWho(e.target.value)}
                    aria-label={formatMessage({id: 'daily_reports.filter.who', defaultMessage: 'Team / member'})}
                >
                    <option value='all'>{formatMessage({id: 'daily_reports.filter.all', defaultMessage: 'All'})}</option>
                    {departments.length > 0 && (
                        <optgroup label={formatMessage({id: 'daily_reports.filter.departments', defaultMessage: 'Teams'})}>
                            {departments.map((d) => (
                                <option
                                    key={d.id}
                                    value={`dept:${d.id}`}
                                >
                                    {d.name}
                                </option>
                            ))}
                        </optgroup>
                    )}
                    <optgroup label={formatMessage({id: 'daily_reports.filter.members', defaultMessage: 'Members'})}>
                        {people.map((u) => (
                            <option
                                key={u.id}
                                value={`user:${u.id}`}
                            >
                                {nameOf(u)}
                            </option>
                        ))}
                    </optgroup>
                </select>
                <button
                    className='btn btn-icon btn-sm'
                    onClick={() => shiftDay(-1)}
                    aria-label={formatMessage({id: 'daily_reports.prevDay', defaultMessage: 'Previous day'})}
                    title={formatMessage({id: 'daily_reports.prevDay', defaultMessage: 'Previous day'})}
                >
                    <i className='icon icon-chevron-left'/>
                </button>
                <label className='DailyReportsPage__field'>
                    <FormattedMessage
                        id='daily_reports.from'
                        defaultMessage='From'
                    />
                    <input
                        type='date'
                        value={from}
                        onChange={(e) => changeFrom(e.target.value)}
                    />
                </label>
                <label
                    className='DailyReportsPage__field'
                    title={formatMessage({id: 'daily_reports.rangeLimit', defaultMessage: 'Up to {days} days'}, {days: MAX_RANGE_DAYS})}
                >
                    <FormattedMessage
                        id='daily_reports.to'
                        defaultMessage='To'
                    />
                    <input
                        type='date'
                        value={to}
                        min={from}
                        max={clampTo(from, '9999-12-31')}
                        onChange={(e) => e.target.value && setTo(clampTo(from, e.target.value))}
                    />
                </label>
                <button
                    className='btn btn-icon btn-sm'
                    onClick={() => shiftDay(1)}
                    disabled={to >= today}
                    aria-label={formatMessage({id: 'daily_reports.nextDay', defaultMessage: 'Next day'})}
                    title={formatMessage({id: 'daily_reports.nextDay', defaultMessage: 'Next day'})}
                >
                    <i className='icon icon-chevron-right'/>
                </button>
                <a
                    className='btn btn-tertiary btn-sm'
                    href={Client4.getDailyReportsExportUrl(teamId, from, to)}
                    download={true}
                >
                    <i className='icon icon-download-outline'/>
                    <FormattedMessage
                        id='daily_reports.download'
                        defaultMessage='Download CSV'
                    />
                </a>
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
            <div className='DailyReportsPage__toolbar'>
                <span className='DailyReportsPage__count'>
                    <FormattedMessage
                        id='daily_reports.count'
                        defaultMessage='{count, plural, one {# report} other {# reports}}'
                        values={{count: visible.length}}
                    />
                </span>
                <select
                    className='form-control DailyReportsPage__sort'
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    aria-label={formatMessage({id: 'daily_reports.sort', defaultMessage: 'Sort'})}
                >
                    <option value='newest'>{formatMessage({id: 'daily_reports.sort.newest', defaultMessage: 'Sent (newest first)'})}</option>
                    <option value='oldest'>{formatMessage({id: 'daily_reports.sort.oldest', defaultMessage: 'Sent (oldest first)'})}</option>
                    <option value='name'>{formatMessage({id: 'daily_reports.sort.name', defaultMessage: 'Name (A → Z)'})}</option>
                </select>
            </div>
            <ul className='DailyReportsPage__rows'>
                {visible.map(({user, date, report}) => (
                    <li
                        key={`${user.id}|${date}`}
                        className='DailyReportsPage__row'
                        data-testid='dailyReportRow'
                    >
                        <div className='DailyReportsPage__rowHead'>
                            <span
                                className='DailyReportsPage__avatar'
                                aria-hidden={true}
                            >
                                {(user.first_name?.[0] ?? '') + (user.last_name?.[0] ?? '') || user.username.slice(0, 2).toUpperCase()}
                            </span>
                            <strong className='DailyReportsPage__rowName'>{nameOf(user)}</strong>
                            <StatusChip report={report}/>
                            {from !== to && (
                                <span className='DailyReportsPage__rowTime'>
                                    <ReportDate date={date}/>
                                </span>
                            )}
                            <span className='DailyReportsPage__rowTime'>
                                {report && report.status !== 'excused' ? <FormattedTime value={report.create_at}/> : '—'}
                            </span>
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
                            <AttachmentChip files={report?.files}/>
                            <span className='DailyReportsPage__rowActions'>
                                {report && (
                                    <button
                                        className='btn btn-tertiary btn-sm'
                                        onClick={() => setDetail(report)}
                                    >
                                        <FormattedMessage
                                            id='daily_reports.view'
                                            defaultMessage='View'
                                        />
                                    </button>
                                )}
                                {report && reviewButtons(report)}
                                {!report && canReview(user.id) && (
                                    <button
                                        className='btn btn-tertiary btn-sm'
                                        onClick={() => setExcusing({user, date})}
                                    >
                                        <FormattedMessage
                                            id='daily_reports.excuse'
                                            defaultMessage='Excuse'
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
                        <PreviouslyRejected report={report}/>
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
                        {report?.message ? (
                            <div className='DailyReportsPage__body DailyReportsPage__body--clamp'>
                                <Markdown message={report.message}/>
                            </div>
                        ) : (
                            <p className='DailyReportsPage__empty'>
                                <FormattedMessage
                                    id='daily_reports.noContent'
                                    defaultMessage='No report content.'
                                />
                            </p>
                        )}
                        <TaskChips tasks={report?.tasks}/>
                    </li>
                ))}
            </ul>
            {detail && (
                <ReportDetailModal
                    report={detail}
                    onClose={() => setDetail(undefined)}
                    actions={reviewButtons(detail)}
                />
            )}
            {excusing && (
                <ExcuseModal
                    teamId={teamId}
                    user={excusing.user}
                    date={excusing.date}
                    name={nameOf(excusing.user)}
                    onDone={refresh}
                    onExited={() => setExcusing(undefined)}
                />
            )}
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
