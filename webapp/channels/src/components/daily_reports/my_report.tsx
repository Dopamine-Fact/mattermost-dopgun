// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';

import type {DailyReport} from '@mattermost/types/daily_reports';
import type {FileInfo} from '@mattermost/types/files';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';

import Markdown from 'components/markdown';
import AdvancedTextbox from 'components/widgets/advanced_textbox/advanced_textbox';

import {daysBefore, MESSAGE_MAX_LENGTH, PreviouslyRejected, RejectedBanner, ReportDate, StatusChip, TaskChips, todayIn} from './common';
import MediaSection from './media_section';
import type {MediaSectionHandle} from './media_section';
import ReportDetailModal from './report_detail_modal';

// How far back the author's own reports are listed under Recent reports.
const RECENT_DAYS = 30;

type Upload = (file: File, onProgress: (loaded: number, total: number) => void) => Promise<FileInfo>;

const isSent = (report?: DailyReport) => report?.status === 'pending' || report?.status === 'approved' || report?.status === 'rejected';

// The first non-empty line without leading markdown markers, for one-line rows.
const excerpt = (message: string) => message.split('\n').find((line) => line.trim())?.replace(/^[\s#>*-]+/, '') ?? '';

type EditorProps = {

    /** 'today' or the report id; names the textbox */
    editorId: string;
    teamId: string;
    date: string;
    title: React.ReactNode;
    report?: DailyReport;
    save: (message: string) => Promise<DailyReport>;
    onError: (message: string) => void;

    /** attaches a file to this report; the media section shows only when given */
    upload?: Upload;
    onFilesChange?: () => void;

    /** open the editor right away, even on a sent report */
    startEditing?: boolean;
};

// ReportCard shows a report rendered, or an editor that keeps an unsent draft in localStorage.
function ReportCard({editorId, teamId, date, title, report, save, onError, upload, onFilesChange, startEditing}: EditorProps) {
    const {formatMessage} = useIntl();
    const draftKey = `dailyReportDraft:${teamId}:${date}`;
    const media = useRef<MediaSectionHandle>(null);
    const sent = isSent(report);

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

    // A draft or excused day has nothing sent yet, so it opens straight in the editor.
    const [editing, setEditing] = useState(() => !sent || draft !== null || Boolean(startEditing));
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

    // Attachments alone are a report; the server accepts an empty message then.
    const sendable = Boolean(message.trim() || report?.files?.length) && message.length <= MESSAGE_MAX_LENGTH && !busy;

    const submit = async () => {
        // Same guard as the disabled Send button, since Ctrl+Enter reaches here without it.
        if (!sendable) {
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

    // A pasted screenshot becomes an attachment instead of text.
    const onPaste = (e: React.ClipboardEvent) => {
        const files = e.clipboardData?.files;
        if (files?.length && media.current) {
            e.preventDefault();
            media.current.add(files);
        }
    };

    return (
        <article className='DailyReportsPage__card'>
            <header className='DailyReportsPage__cardHead'>
                <h2>{title}</h2>
                <StatusChip
                    report={report}
                    own={true}
                />
                {report?.edited && (
                    <span className='DailyReportsPage__tag'>
                        <FormattedMessage
                            id='daily_reports.edited'
                            defaultMessage='Edited'
                        />
                    </span>
                )}
                <span className='DailyReportsPage__dateChip'>
                    <i className='icon icon-calendar-outline'/>
                    <ReportDate date={date}/>
                </span>
                {sent && !editing && (
                    <button
                        className='btn btn-tertiary btn-sm'
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
                        onPaste={onPaste}
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
                        {sent && (
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
                            disabled={!sendable}
                            onClick={submit}
                        >
                            {sent ? (
                                <FormattedMessage
                                    id='daily_reports.save'
                                    defaultMessage='Save'
                                />
                            ) : (
                                <>
                                    <i className='icon icon-send'/>
                                    <FormattedMessage
                                        id='daily_reports.submit'
                                        defaultMessage='Send report'
                                    />
                                </>
                            )}
                        </button>
                    </div>
                </>
            ) : (
                <div className='DailyReportsPage__body'>
                    <Markdown message={report?.message ?? ''}/>
                </div>
            )}
            {upload && (
                <MediaSection
                    ref={media}
                    files={report?.files ?? []}
                    reportId={report?.id}
                    upload={upload}
                    onChange={onFilesChange ?? (() => {})}
                />
            )}
        </article>
    );
}

function ExportCard({teamId, timeZone}: {teamId: string; timeZone?: string}) {
    const [from, setFrom] = useState(() => todayIn(timeZone));
    const [to, setTo] = useState(() => todayIn(timeZone));
    const exportable = Boolean(from && to && from <= to);

    return (
        <article className='DailyReportsPage__card DailyReportsPage__export'>
            <h2>
                <i className='icon icon-download-outline'/>
                <FormattedMessage
                    id='daily_reports.export.title'
                    defaultMessage='Export by date range'
                />
            </h2>
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
    const [recent, setRecent] = useState<DailyReport[]>([]);
    const [assignees, setAssignees] = useState<string[]>([]);
    const [reload, setReload] = useState(0);
    const [detailId, setDetailId] = useState('');
    const [editingDetail, setEditingDetail] = useState(false);

    const refetch = useCallback(() => setReload((n) => n + 1), []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [[current], list, ids] = await Promise.all([

                    // No dates: the server defaults to today in the team's timezone.
                    // user_id: approvers would otherwise get the whole team's reports.
                    Client4.getDailyReports(teamId, undefined, undefined, currentUserId),
                    Client4.getDailyReports(teamId, daysBefore(date, RECENT_DAYS), date, currentUserId),
                    Client4.getDailyReportAssignees(teamId),
                ]);
                if (cancelled) {
                    return;
                }
                setToday(current);
                setRecent(list.filter((r) => r.date !== date && r.id !== current?.id).sort((a, b) => b.date.localeCompare(a.date)));
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
    }, [teamId, date, currentUserId, tick, reload, onError]);

    // Reviewer names for the "sent back by" banners.
    useEffect(() => {
        const ids = [today, ...recent].map((r) => r?.rejected_by).filter((id): id is string => Boolean(id));
        if (ids.length) {
            dispatch(getMissingProfilesByIds(ids));
        }
    }, [dispatch, today, recent]);

    const saveToday = useCallback(async (message: string) => {
        const saved = await Client4.submitDailyReport(teamId, message);
        setToday(saved);
        return saved;
    }, [teamId]);

    const saveEarlier = useCallback(async (reportId: string, message: string) => {
        const saved = await Client4.updateDailyReport(reportId, message);
        setRecent((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        return saved;
    }, []);

    const uploadToday = useCallback<Upload>((file, onProgress) => Client4.uploadMyDailyReportFile(teamId, file, onProgress), [teamId]);

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

    const detail = recent.find((r) => r.id === detailId);

    return (
        <section className='DailyReportsPage__mine'>
            <ReportCard
                editorId='today'
                teamId={teamId}
                date={date}
                title={
                    <FormattedMessage
                        id='daily_reports.todayReport'
                        defaultMessage='Today’s report'
                    />
                }
                report={today}
                save={saveToday}
                onError={onError}
                upload={uploadToday}
                onFilesChange={refetch}
            />
            <ExportCard
                teamId={teamId}
                timeZone={timeZone}
            />
            <h2 className='DailyReportsPage__sectionTitle'>
                <FormattedMessage
                    id='daily_reports.recent'
                    defaultMessage='Recent reports'
                />
            </h2>
            {recent.length === 0 ? (
                <p className='DailyReportsPage__empty'>
                    <FormattedMessage
                        id='daily_reports.recent.empty'
                        defaultMessage='No reports in the last 30 days.'
                    />
                </p>
            ) : (
                <ul className='DailyReportsPage__recent'>
                    {recent.map((r) => (
                        <li key={r.id}>
                            <button
                                className='DailyReportsPage__recentRow'
                                onClick={() => setDetailId(r.id)}
                            >
                                <span className='DailyReportsPage__recentDate'>
                                    <ReportDate date={r.date}/>
                                </span>
                                <StatusChip
                                    report={r}
                                    own={true}
                                />
                                <span className='DailyReportsPage__excerpt'>{excerpt(r.message)}</span>
                                {Boolean(r.files?.length) && (
                                    <span className='DailyReportsPage__attachments'>
                                        <i className='icon icon-paperclip'/>
                                        <FormattedMessage
                                            id='daily_reports.attachments'
                                            defaultMessage='{count, plural, one {# attachment} other {# attachments}}'
                                            values={{count: r.files?.length}}
                                        />
                                    </span>
                                )}
                                <i className='icon icon-chevron-right'/>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {detail && (
                <ReportDetailModal
                    report={detail}
                    onClose={() => {
                        setDetailId('');
                        setEditingDetail(false);
                    }}
                    actions={detail.status === 'rejected' && !editingDetail ? (
                        <button
                            className='btn btn-primary'
                            onClick={() => setEditingDetail(true)}
                        >
                            <FormattedMessage
                                id='daily_reports.edit'
                                defaultMessage='Edit'
                            />
                        </button>
                    ) : undefined}
                >
                    {editingDetail ? (
                        <ReportCard
                            editorId={detail.id}
                            teamId={teamId}
                            date={detail.date}
                            title={
                                <FormattedMessage
                                    id='daily_reports.editReport'
                                    defaultMessage='Edit report'
                                />
                            }
                            report={detail}
                            save={(message) => saveEarlier(detail.id, message)}
                            onError={onError}
                            upload={(file, onProgress) => Client4.uploadDailyReportFile(detail.id, file, onProgress)}
                            onFilesChange={refetch}
                            startEditing={true}
                        />
                    ) : undefined}
                </ReportDetailModal>
            )}
        </section>
    );
};

export default MyReport;
