// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';

import {DotsVerticalIcon, MagnifyIcon, PlayIcon, PlusIcon} from '@mattermost/compass-icons/components';
import type {Task, TaskSection, TaskSectionVideo, TaskStatus} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';

import {createTask, deleteTask, setTaskSectionVideo} from 'actions/tasks';

import * as Menu from 'components/menu';

import {revisionStatusMessages, STATUSES, formatVideoTime} from './task_utils';
import {useFrameThumbnails} from './use_frame_thumbnails';

// shortcut: browsers do not expose a video's frame rate, so arrow keys step 1/30 s; read it from the file if other rates matter.
const FRAME_SECONDS = 1 / 30;

type Props = {
    teamId: string;

    // section is the revision channel's list: it holds the video, its tasks are the revisions.
    section: TaskSection;
    tasks: Task[];
    usersById: Record<string, UserProfile>;
    selectedId: string;
    onSelect: (taskId: string) => void;
    canManage: boolean;
};

// Revisions shows a revision channel's video versions and their revisions: tasks pinned to a time in one version.
const Revisions = ({teamId, section, tasks, usersById, selectedId, onSelect, canManage}: Props) => {
    const {formatMessage, formatDate} = useIntl();
    const dispatch = useDispatch();

    // Every upload is kept; a new one (section.video_file_id changes) reloads the list. Only this viewer's own
    // upload switches them to it, so someone else's upload never moves the cut they are pinning revisions on.
    const latest = section.video_file_id;
    const [versions, setVersions] = useState<TaskSectionVideo[]>([]);
    const [selected, setSelected] = useState(latest);
    useEffect(() => {
        setSelected((current) => current || latest);
        let live = true;
        Client4.getTaskSectionVideos(section.id).then((list) => live && setVersions([...list].sort((a, b) => b.version - a.version)), () => {});
        return () => {
            live = false;
        };
    }, [section.id, latest]);
    const versionOf = useMemo(() => Object.fromEntries(versions.map((v) => [v.file_id, v.version])), [versions]);

    // A version shows its own revisions; the latest also carries older ones still open, so nothing pending is lost.
    const revisions = useMemo(() => tasks.
        filter((t) => t.section_id === section.id && t.video_file_id && (t.video_file_id === selected || (selected === latest && t.status !== 'done'))).
        sort((a, b) => a.video_time - b.video_time), [tasks, section.id, selected, latest]);

    // Search and the status filter only narrow what the list shows.
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
    const shown = revisions.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()) && (!statusFilter || r.status === statusFilter));

    const videoUrl = Client4.getTaskSectionVideoUrl(section.id, selected);
    const [replacing, setReplacing] = useState(false);
    const [replaceError, setReplaceError] = useState('');
    const stills = useFrameThumbnails(videoUrl, revisions.filter((r) => r.video_file_id === selected).map((r) => r.video_time));

    const video = useRef<HTMLVideoElement>(null);

    // Where to seek once a switched-to version has loaded.
    const pendingSeek = useRef<number | null>(null);
    const [title, setTitle] = useState('');

    // Arrow keys step one frame while focus is on the revision tabs or panel (or nowhere), but never inside a text field.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const inView = target === document.body || target.closest('.RevisionTabs, .RevisionTabs__panel');
            if (!video.current || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !inView || target.closest('input, textarea, select')) {
                return;
            }
            e.preventDefault();
            video.current.pause();
            const step = e.key === 'ArrowRight' ? FRAME_SECONDS : -FRAME_SECONDS;
            video.current.currentTime = Math.max(0, video.current.currentTime + step);
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    const seek = (ms: number) => {
        if (video.current) {
            video.current.pause();
            video.current.currentTime = ms / 1000;
        }
    };
    const open = (revision: Task) => {
        if (revision.video_file_id === selected) {
            seek(revision.video_time);
        } else {
            pendingSeek.current = revision.video_time;
            setSelected(revision.video_file_id);
        }
        onSelect(revision.id);
    };
    const onLoadedMetadata = () => {
        if (pendingSeek.current !== null) {
            seek(pendingSeek.current);
            pendingSeek.current = null;
        }
    };

    const addRevision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) {
            return;
        }
        const videoTime = Math.round((video.current?.currentTime ?? 0) * 1000);
        const result = await dispatch(createTask({team_id: teamId, title: title.trim(), section_id: section.id, video_time: videoTime, video_file_id: selected}));
        if (result.data) {
            setTitle('');

            // Open the new revision so it can be assigned straight away.
            onSelect(result.data.id);
        }
    };

    const replaceVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || replacing) {
            return;
        }
        setReplacing(true);
        setReplaceError('');
        const result = await dispatch(setTaskSectionVideo(section.id, file));
        setReplacing(false);
        setReplaceError(result.error?.message ?? '');
        if (result.data?.video_file_id) {
            setSelected(result.data.video_file_id);
        }
    };

    const list = (
        <aside className='TaskRevisions__side'>
            <header className='TaskRevisions__head'>
                <div>
                    <h2>
                        <FormattedMessage
                            id='tasks.revisions.heading'
                            defaultMessage='Revisions'
                        />
                    </h2>
                    <p>
                        <FormattedMessage
                            id='tasks.revisions.subheading'
                            defaultMessage="All revisions made on this channel's video"
                        />
                    </p>
                </div>
                {canManage && (
                    <button
                        className='btn btn-primary btn-sm'
                        onClick={() => onSelect('')}
                    >
                        <PlusIcon size={16}/>
                        <FormattedMessage
                            id='tasks.revisions.new'
                            defaultMessage='New revision'
                        />
                    </button>
                )}
            </header>
            <div className='TaskRevisions__filters'>
                <label className='TaskRevisions__search'>
                    <MagnifyIcon size={16}/>
                    <input
                        type='search'
                        className='form-control'
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={formatMessage({id: 'tasks.revisions.search', defaultMessage: 'Search revisions'})}
                        aria-label={formatMessage({id: 'tasks.revisions.search', defaultMessage: 'Search revisions'})}
                    />
                </label>
                <select
                    className='form-control'
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
                    aria-label={formatMessage({id: 'tasks.revisions.statusFilter', defaultMessage: 'Status'})}
                >
                    <option value=''>
                        <FormattedMessage
                            id='tasks.revisions.allStatuses'
                            defaultMessage='All statuses'
                        />
                    </option>
                    {STATUSES.map((status) => (
                        <option
                            key={status}
                            value={status}
                        >
                            {formatMessage(revisionStatusMessages[status])}
                        </option>
                    ))}
                </select>
            </div>
            <ul className='TaskRevisions__list'>
                {shown.map((revision) => (
                    <li
                        key={revision.id}
                        className={classNames('TaskRevisions__card', `TaskStatus--${revision.status}`, {'TaskRevisions__card--selected': revision.id === selectedId})}
                    >
                        <button
                            className='TaskRevisions__still'
                            onClick={() => open(revision)}
                            aria-label={formatMessage({id: 'tasks.revisions.seek', defaultMessage: 'Go to {time}'}, {time: formatVideoTime(revision.video_time)})}
                        >
                            {revision.video_file_id === selected && stills[revision.video_time] && (
                                <img
                                    src={stills[revision.video_time]}
                                    alt=''
                                />
                            )}
                            <span className='TaskRevisions__time'>
                                <PlayIcon size={12}/>
                                {formatVideoTime(revision.video_time)}
                            </span>
                        </button>
                        <div className='TaskRevisions__body'>
                            <div className='TaskRevisions__line'>
                                <button
                                    className='TaskRevisions__name'
                                    onClick={() => open(revision)}
                                >
                                    {revision.title}
                                </button>
                                <span
                                    className='TaskRevisions__version'
                                    title={revision.video_file_id === selected ? undefined : formatMessage({id: 'tasks.revisions.olderVersion', defaultMessage: 'Made on an earlier version; open it to watch that version'})}
                                >
                                    <FormattedMessage
                                        id='tasks.revisions.versionBadge'
                                        defaultMessage='v{version}'
                                        values={{version: versionOf[revision.video_file_id] ?? '?'}}
                                    />
                                </span>
                            </div>
                            <span className='TaskRevisions__date'>{formatDate(revision.create_at, {dateStyle: 'medium', timeStyle: 'short'})}</span>
                        </div>
                        <span className='TaskRevisions__pill'><FormattedMessage {...revisionStatusMessages[revision.status]}/></span>
                        {canManage && (
                            <Menu.Container
                                menuButton={{
                                    id: `revisionMenuButton-${revision.id}`,
                                    class: 'btn btn-icon btn-xs',
                                    'aria-label': formatMessage({id: 'tasks.revisions.more', defaultMessage: 'More actions'}),
                                    children: <DotsVerticalIcon size={16}/>,
                                }}
                                menu={{
                                    id: `revisionMenu-${revision.id}`,
                                    'aria-label': formatMessage({id: 'tasks.revisions.more', defaultMessage: 'More actions'}),
                                }}
                            >
                                <Menu.Item
                                    id={`revisionDelete-${revision.id}`}
                                    isDestructive={true}
                                    onClick={() => {
                                        dispatch(deleteTask(revision.id));
                                        if (revision.id === selectedId) {
                                            onSelect('');
                                        }
                                    }}
                                    labels={
                                        <FormattedMessage
                                            id='tasks.revisions.delete'
                                            defaultMessage='Delete'
                                        />
                                    }
                                />
                            </Menu.Container>
                        )}
                    </li>
                ))}
                {shown.length === 0 && (
                    <li className='TaskRevisions__empty'>
                        {revisions.length ? (
                            <FormattedMessage
                                id='tasks.revisions.noMatch'
                                defaultMessage='No revisions match'
                            />
                        ) : (
                            <FormattedMessage
                                id='tasks.revisions.noRevisions'
                                defaultMessage='No revisions yet. Pause the video where something needs to change and describe it.'
                            />
                        )}
                    </li>
                )}
            </ul>
        </aside>
    );

    return (
        <div className='TaskRevisions'>
            {list}
            <section className='TaskRevisions__stage'>
                <video
                    key={videoUrl}
                    ref={video}
                    className='TaskRevisions__video'
                    src={videoUrl}
                    controls={true}
                    preload='metadata'
                    onLoadedMetadata={onLoadedMetadata}
                />
                <div className='TaskRevisions__hint'>
                    <select
                        className='form-control TaskRevisions__versions'
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                        aria-label={formatMessage({id: 'tasks.revisions.version', defaultMessage: 'Version'})}
                    >
                        {versions.map((v) => (
                            <option
                                key={v.file_id}
                                value={v.file_id}
                            >
                                <FormattedMessage
                                    id='tasks.revisions.versionOption'
                                    defaultMessage='v{version} · {date} · {uploader}'
                                    values={{version: v.version, date: formatDate(v.create_at, {dateStyle: 'medium'}), uploader: usersById[v.creator_id]?.username ?? ''}}
                                />
                            </option>
                        ))}
                    </select>
                    <FormattedMessage
                        id='tasks.revisions.frameHint'
                        defaultMessage='Use ← and → to step one frame.'
                    />
                    {canManage && (
                        <label className={classNames('btn btn-tertiary btn-xs TaskRevisions__replace', {disabled: replacing})}>
                            {replacing ? (
                                <FormattedMessage
                                    id='tasks.revisions.replacing'
                                    defaultMessage='Uploading…'
                                />
                            ) : (
                                <FormattedMessage
                                    id='tasks.revisions.uploadVersion'
                                    defaultMessage='Upload new version'
                                />
                            )}
                            <input
                                type='file'
                                hidden={true}
                                disabled={replacing}
                                accept='video/mp4,video/webm,video/ogg,video/quicktime,.m4v'
                                aria-label={formatMessage({id: 'tasks.revisions.uploadVersion', defaultMessage: 'Upload new version'})}
                                onChange={replaceVideo}
                            />
                        </label>
                    )}
                </div>
                {replaceError && <div className='TaskRevisions__error error-text'>{replaceError}</div>}

                {canManage && (
                    <form
                        className='TaskRevisions__add'
                        onSubmit={addRevision}
                    >
                        <input
                            className='form-control'
                            value={title}
                            maxLength={512}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={formatMessage({id: 'tasks.revisions.placeholder', defaultMessage: 'Describe the revision at the current moment'})}
                            aria-label={formatMessage({id: 'tasks.revisions.title', defaultMessage: 'Revision'})}
                        />
                        <button
                            type='submit'
                            className='btn btn-primary btn-sm'
                            disabled={!title.trim()}
                        >
                            <FormattedMessage
                                id='tasks.revisions.add'
                                defaultMessage='Add revision'
                            />
                        </button>
                    </form>
                )}
            </section>
        </div>
    );
};

export default Revisions;
