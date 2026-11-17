// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {DailyReport} from '@mattermost/types/daily_reports';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getUser} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import Markdown from 'components/markdown';
import AdvancedTextbox from 'components/widgets/advanced_textbox/advanced_textbox';

import type {GlobalState} from 'types/store';

import {daysBefore, MESSAGE_MAX_LENGTH, PreviouslyRejected, StatusChip, TaskChips, todayIn} from './common';

// How far back the author is shown reports that were sent back to them.
const NEEDS_FIXING_DAYS = 30;

function RejectedBanner({report}: {report: DailyReport}) {
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

type EditorProps = {

    /** 'today' or the report id; names the textbox */
    editorId: string;
    teamId: string;
    date: string;
    title: React.ReactNode;
    report?: DailyReport;
    save: (message: string) => Promise<DailyReport>;
    onError: (message: string) => void;
};

// ReportCard shows a report rendered, or an editor that keeps an unsent draft in localStorage.
function ReportCard({editorId, teamId, date, title, report, save, onError}: EditorProps) {
    const {formatMessage} = useIntl();
    const draftKey = `dailyReportDraft:${teamId}:${date}`;

    const hasDraft = useCallback(() => {
        try {
            return localStorage.getItem(draftKey) !== null;
        } catch {
            return false;
        }
    }, [draftKey]);

    // A draft remembers the report text it was written against (base), so one left in another tab
    // can't overwrite a newer version.
    const writeDraft = (text: string | null) => {
        try {
            if (text === null) {
                localStorage.removeItem(draftKey);
            } else {
                localStorage.setItem(draftKey, JSON.stringify({text, base: report?.message ?? ''}));
            }
        } catch {
            // Storage can be full or blocked; the draft is a convenience only.
        }
    };

    const [draft] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
            if (typeof saved?.text === 'string' && saved.base === (report?.message ?? '')) {
                return saved.text as string;
            }
        } catch {
            // unreadable draft: drop it below
        }
        writeDraft(null);
        return null;
    });
    const [message, setMessage] = useState(() => draft ?? report?.message ?? '');
    const [editing, setEditing] = useState(() => !report || draft !== null);
    const [preview, setPreview] = useState(false);
    const [busy, setBusy] = useState(false);

    // Follow the server's report when it changes, unless the user has an unsent draft.
    const version = report ? `${report.id}:${report.update_at}` : '';
    const synced = useRef(version);
    useEffect(() => {
        if (version !== synced.current) {
            synced.current = version;
            if (!hasDraft()) {
                setMessage(report?.message ?? '');
            }
        }
    }, [version, report, hasDraft]);

    const submit = async () => {
        // Same guard as the disabled Send button, since Ctrl+Enter reaches here without it.
        if (!message.trim() || message.length > MESSAGE_MAX_LENGTH || busy) {
            return;
        }
        setBusy(true);
        try {
            const saved = await save(message);
            writeDraft(null);
            synced.current = `${saved.id}:${saved.update_at}`;
            setMessage(saved.message);
            setEditing(false);
            setPreview(false);
            onError('');
        } catch (e) {
            onError((e as Error).message);
        }
        setBusy(false);
    };

    const cancel = () => {
        writeDraft(null);
        setMessage(report?.message ?? '');
        setEditing(false);
        setPreview(false);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
        }
    };

    return (
        <article className='DailyReportsPage__card'>
            <header className='DailyReportsPage__cardHead'>
                <h2>{title}</h2>
                <StatusChip report={report}/>
                {report?.edited && (
                    <span className='DailyReportsPage__tag'>
                        <FormattedMessage
                            id='daily_reports.edited'
                            defaultMessage='Edited'
                        />
                    </span>
                )}
                {report && !editing && (
                    <button
                        className='btn btn-tertiary btn-sm DailyReportsPage__cardAction'
                        onClick={() => setEditing(true)}
                    >
                        <i className='icon icon-pencil-outline'/>
                        <FormattedMessage
                            id='daily_reports.edit'
                            defaultMessage='Edit'
                        />
                    </button>
                )}
            </header>
            {report?.status === 'rejected' && <RejectedBanner report={report}/>}
            <PreviouslyRejected report={report}/>
            <TaskChips tasks={report?.tasks}/>
            {editing ? (
                <>
                    {/* Ctrl/Cmd+Enter sends; the keydown bubbles up from the textbox. */}
                    <div
                        className='DailyReportsPage__editor'
                        role='presentation'
                        onKeyDown={onKeyDown}
                    >
                        <AdvancedTextbox
                            id={`dailyReportEditor_${editorId}`}
                            value={message}
                            channelId=''
                            onChange={(e) => {
                                setMessage(e.target.value);
                                writeDraft(e.target.value);
                            }}
                            onKeyPress={() => {}}
                            createMessage={formatMessage({id: 'daily_reports.mine.placeholder', defaultMessage: 'What did you get done today?'})}
                            maxLength={MESSAGE_MAX_LENGTH}
                            preview={preview}
                            togglePreview={() => setPreview((p) => !p)}
                            showCharacterCount={message.length > MESSAGE_MAX_LENGTH}
                        />
                    </div>
                    <div className='DailyReportsPage__actions'>
                        <span className='DailyReportsPage__hint'>
                            <FormattedMessage
                                id='daily_reports.sendHint'
                                defaultMessage='Markdown supported. Ctrl+Enter to send.'
                            />
                        </span>
                        {report && (
                            <button
                                className='btn btn-tertiary'
                                onClick={cancel}
                            >
                                <FormattedMessage
                                    id='daily_reports.cancel'
                                    defaultMessage='Cancel'
                                />
                            </button>
                        )}
                        <button
                            className='btn btn-primary'
                            disabled={!message.trim() || message.length > MESSAGE_MAX_LENGTH || busy}
                            onClick={submit}
                        >
                            {report ? (
                                <FormattedMessage
                                    id='daily_reports.save'
                                    defaultMessage='Save'
                                />
                            ) : (
                                <FormattedMessage
                                    id='daily_reports.submit'
                                    defaultMessage='Submit'
                                />
                            )}
                        </button>
                    </div>
                </>
            ) : (
                <div className='DailyReportsPage__body'>
                    <Markdown message={report?.message ?? ''}/>
                </div>
            )}
        </article>
    );
}

type Props = {
    teamId: string;
    timeZone?: string;
    currentUserId: string;

    /** bumped on every daily report websocket event */
    tick: number;
    onError: (message: string) => void;
};

const MyReport = ({teamId, timeZone, currentUserId, tick, onError}: Props) => {
    const dispatch = useDispatch();
    const date = useMemo(() => todayIn(timeZone), [timeZone]);
    const [loaded, setLoaded] = useState(false);
    const [today, setToday] = useState<DailyReport>();
    const [fixes, setFixes] = useState<DailyReport[]>([]);
    const [assignees, setAssignees] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [[current], recent, ids] = await Promise.all([

                    // No dates: the server defaults to today in the team's timezone.
                    // user_id: approvers would otherwise get the whole team's reports.
                    Client4.getDailyReports(teamId, undefined, undefined, currentUserId),
                    Client4.getDailyReports(teamId, daysBefore(date, NEEDS_FIXING_DAYS), date, currentUserId),
                    Client4.getDailyReportAssignees(teamId),
                ]);
                if (cancelled) {
                    return;
                }
                setToday(current);
                setFixes(recent.filter((r) => r.status === 'rejected' && r.date !== date && r.id !== current?.id));
                setAssignees(ids);
                setLoaded(true);
                onError('');
            } catch (e) {
                if (!cancelled) {
                    onError((e as Error).message);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [teamId, date, currentUserId, tick, onError]);

    // Reviewer names for the "sent back by" banners.
    useEffect(() => {
        const ids = [today, ...fixes].map((r) => r?.rejected_by).filter((id): id is string => Boolean(id));
        if (ids.length) {
            dispatch(getMissingProfilesByIds(ids));
        }
    }, [dispatch, today, fixes]);

    const saveToday = useCallback(async (message: string) => {
        const saved = await Client4.submitDailyReport(teamId, message);
        setToday(saved);
        return saved;
    }, [teamId]);

    const saveFix = useCallback(async (reportId: string, message: string) => {
        const saved = await Client4.updateDailyReport(reportId, message);
        setFixes((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        return saved;
    }, []);

    if (!loaded) {
        return null;
    }
    if (assignees.length > 0 && !assignees.includes(currentUserId)) {
        return (
            <p className='DailyReportsPage__empty'>
                <FormattedMessage
                    id='daily_reports.notExpected'
                    defaultMessage='No report is expected from you in this team.'
                />
            </p>
        );
    }

    return (
        <section className='DailyReportsPage__mine'>
            <ReportCard
                editorId='today'
                teamId={teamId}
                date={date}
                title={
                    <FormattedMessage
                        id='daily_reports.today'
                        defaultMessage='Today'
                    />
                }
                report={today}
                save={saveToday}
                onError={onError}
            />
            {fixes.length > 0 && (
                <>
                    <h2 className='DailyReportsPage__sectionTitle'>
                        <FormattedMessage
                            id='daily_reports.needsFixing'
                            defaultMessage='Needs fixing'
                        />
                    </h2>
                    {fixes.map((r) => (
                        <ReportCard
                            key={r.id}
                            editorId={r.id}
                            teamId={teamId}
                            date={r.date}
                            title={r.date}
                            report={r}
                            save={(message) => saveFix(r.id, message)}
                            onError={onError}
                        />
                    ))}
                </>
            )}
        </section>
    );
};

export default MyReport;
