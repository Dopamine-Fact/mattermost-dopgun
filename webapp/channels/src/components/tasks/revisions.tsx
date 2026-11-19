// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {defineMessage, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {CloseIcon, DotsVerticalIcon, ImageOutlineIcon, MagnifyIcon, PlayIcon, PlusIcon, SendIcon, UploadOutlineIcon} from '@mattermost/compass-icons/components';
import type {Post} from '@mattermost/types/posts';
import type {Task, TaskSection, TaskSectionVideo, TaskStatus} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {createPost} from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {createTask, deleteTask, setTaskSectionVideo} from 'actions/tasks';

import * as Menu from 'components/menu';

import {revisionStatusMessages, STATUSES, formatVideoTime} from './task_utils';
import {useFrameThumbnails} from './use_frame_thumbnails';

// shortcut: browsers do not expose a video's frame rate, so arrow keys step 1/30 s; read it from the file if other rates matter.
const FRAME_SECONDS = 1 / 30;

// The revision description is its title; the form caps it below the title's own 512.
const TITLE_MAX = 500;
const STRIP_FRAMES = 10;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const imageRule = defineMessage({id: 'tasks.revisions.imageRule', defaultMessage: 'PNG, JPG or WEBP up to 10 MB'});

type Props = {
    teamId: string;

    // section is the revision channel's list: it holds the video, its tasks are the revisions.
    section: TaskSection;
    tasks: Task[];
    usersById: Record<string, UserProfile>;
    selectedId: string;
    onSelect: (taskId: string) => void;
    canManage: boolean;

    // The selected revision's detail; it takes the create form's place.
    detail?: React.ReactNode;
};

// Revisions shows a revision channel's video versions and their revisions: tasks pinned to a time in one version.
const Revisions = ({teamId, section, tasks, usersById, selectedId, onSelect, canManage, detail}: Props) => {
    const {formatMessage, formatDate, formatNumber} = useIntl();
    const dispatch = useDispatch();
    const currentUserId = useSelector(getCurrentUserId);

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

    // upload follows a new version's bytes; left (seconds) is unknown until some have gone.
    const [upload, setUpload] = useState<{percent: number; left?: number} | null>(null);
    const replacing = upload !== null;
    const [replaceError, setReplaceError] = useState('');

    // duration and now (ms) follow the player; pinned is the moment "Use current time" fixed for the next revision.
    const [duration, setDuration] = useState(0);
    const [now, setNow] = useState(0);
    const [pinned, setPinned] = useState<number | null>(null);
    const moment = pinned ?? now;
    const stripTimes = useMemo(() => (duration > 0 ? Array.from({length: STRIP_FRAMES}, (_, i) => Math.round(((i + 0.5) * duration * 1000) / STRIP_FRAMES)) : []), [duration]);
    const stills = useFrameThumbnails(videoUrl, [...revisions.filter((r) => r.video_file_id === selected).map((r) => r.video_time), ...stripTimes]);

    // A moment belongs to one cut: a version switch drops it and waits for the new video's metadata.
    useEffect(() => {
        setPinned(null);
        setDuration(0);
        setNow(0);
    }, [selected]);

    const [image, setImage] = useState<File>();
    const [preview, setPreview] = useState('');
    const [imageError, setImageError] = useState('');
    const [creating, setCreating] = useState(false);
    useEffect(() => {
        if (!image) {
            setPreview('');
            return undefined;
        }
        const url = URL.createObjectURL(image);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [image]);

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
        const length = video.current?.duration ?? 0;
        setDuration(Number.isFinite(length) ? length : 0);
        if (pendingSeek.current !== null) {
            seek(pendingSeek.current);
            pendingSeek.current = null;
        }
        trackTime();
    };

    const trackTime = () => setNow(Math.round((video.current?.currentTime ?? 0) * 1000));
    const seekStrip = (e: React.MouseEvent<HTMLElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        if (duration > 0 && box.width > 0) {
            seek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * duration * 1000);
        }
    };

    const pickImage = (file?: File) => {
        if (!file) {
            return;
        }
        if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_MAX_BYTES) {
            setImageError(formatMessage(imageRule));
            return;
        }
        setImageError('');
        setImage(file);
    };
    const clearForm = () => {
        setTitle('');
        setImage(undefined);
        setPinned(null);
    };
    const cancel = () => {
        clearForm();
        setImageError('');
    };

    const addRevision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || creating) {
            return;
        }
        setCreating(true);
        setImageError('');
        const videoTime = pinned ?? Math.round((video.current?.currentTime ?? 0) * 1000);
        const result = await dispatch(createTask({team_id: teamId, title: title.trim(), section_id: section.id, video_time: videoTime, video_file_id: selected}));
        if (result.data) {
            // The image is the revision's first message in the channel, posted before it opens so its conversation loads with it.
            if (image) {
                try {
                    const form = new FormData();
                    form.append('channel_id', section.channel_id);
                    form.append('files', image, image.name);
                    const upload = await Client4.uploadFile(form);
                    const post = {channel_id: section.channel_id, user_id: currentUserId, message: '', props: {task_id: result.data.id}} as unknown as Post;
                    const posted = await dispatch(createPost(post, upload.file_infos)) as {error?: unknown};
                    if (posted?.error) {
                        throw posted.error;
                    }
                } catch {
                    setImageError(formatMessage({id: 'tasks.revisions.imageFailed', defaultMessage: 'The revision was created but the image could not be attached'}));
                }
            }
            clearForm();

            // Open the new revision so it can be assigned straight away.
            onSelect(result.data.id);
        }
        setCreating(false);
    };

    const replaceVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || replacing) {
            return;
        }
        setUpload({percent: 0});
        setReplaceError('');
        const start = Date.now();
        const result = await dispatch(setTaskSectionVideo(section.id, file, (loaded, total) => {
            const elapsed = (Date.now() - start) / 1000;
            setUpload({
                percent: total > 0 ? Math.floor((loaded / total) * 100) : 0,
                left: loaded > 0 && elapsed > 0 ? (elapsed * (total - loaded)) / loaded : undefined,
            });
        }));
        setUpload(null);
        setReplaceError(result.error?.message ?? '');
        if (result.data?.video_file_id) {
            setSelected(result.data.video_file_id);
        }
    };

    const timeLeft = (seconds: number) => (seconds < 60 ? formatNumber(Math.ceil(seconds), {style: 'unit', unit: 'second', unitDisplay: 'long'}) : formatNumber(Math.ceil(seconds / 60), {style: 'unit', unit: 'minute', unitDisplay: 'long'}));
    let uploadStatus = '';
    if (upload?.percent === 100) {
        // Every byte is sent; the server is still storing the video.
        uploadStatus = formatMessage({id: 'tasks.revisions.processing', defaultMessage: 'Processing…'});
    } else if (upload && upload.left === undefined) {
        uploadStatus = formatMessage({id: 'tasks.revisions.uploadPercent', defaultMessage: 'Uploading {percent}%'}, {percent: upload.percent});
    } else if (upload?.left !== undefined) {
        uploadStatus = formatMessage({id: 'tasks.revisions.uploadProgress', defaultMessage: 'Uploading {percent}% · {left} left'}, {percent: upload.percent, left: timeLeft(upload.left)});
    }

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
                {canManage && selected && (
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
                            <span className='TaskRevisions__pill'><FormattedMessage {...revisionStatusMessages[revision.status]}/></span>
                        </div>
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
                <div className='TaskRevisions__bar'>
                    {selected && (
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
                    )}
                    {canManage && (
                        <label className={classNames('btn btn-tertiary btn-xs TaskRevisions__replace', {disabled: replacing})}>
                            {replacing ? uploadStatus : (
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
                {upload && (
                    <progress
                        className='TaskRevisions__progress'
                        max={100}
                        value={upload.percent}
                        aria-label={uploadStatus}
                    />
                )}
                {replaceError && <div className='TaskRevisions__error error-text'>{replaceError}</div>}
                {imageError && (
                    <div
                        className='TaskRevisions__error error-text'
                        role='alert'
                    >
                        {imageError}
                    </div>
                )}

                {selected ? (
                    <div className='TaskRevisions__split'>
                        <div className='TaskRevisions__player'>
                            <video
                                key={videoUrl}
                                ref={video}
                                className='TaskRevisions__video'
                                src={videoUrl}
                                controls={true}
                                preload='metadata'
                                title={formatMessage({id: 'tasks.revisions.frameHint', defaultMessage: 'Use ← and → to step one frame.'})}
                                onLoadedMetadata={onLoadedMetadata}
                                onTimeUpdate={trackTime}
                                onSeeked={trackTime}
                            />
                            <div className='TaskRevisions__moment'>
                                <span className='TaskRevisions__momentLabel'>
                                    <FormattedMessage
                                        id='tasks.revisions.moment'
                                        defaultMessage='Moment'
                                    />
                                </span>
                                <span className='TaskRevisions__momentTime'>{formatVideoTime(moment)}</span>
                                {canManage && (
                                    <button
                                        type='button'
                                        className={classNames('btn btn-tertiary btn-xs', {'TaskRevisions__pin--on': pinned !== null})}
                                        onClick={() => setPinned(Math.round((video.current?.currentTime ?? 0) * 1000))}
                                    >
                                        <FormattedMessage
                                            id='tasks.revisions.useCurrent'
                                            defaultMessage='Use current time'
                                        />
                                    </button>
                                )}
                            </div>
                            <div
                                className='TaskRevisions__strip'
                                role='presentation'
                                onClick={seekStrip}
                            >
                                {stripTimes.map((t) => (
                                    <span
                                        key={t}
                                        className='TaskRevisions__frame'
                                    >
                                        {stills[t] && (
                                            <img
                                                src={stills[t]}
                                                alt=''
                                            />
                                        )}
                                    </span>
                                ))}
                                {duration > 0 && (
                                    <span
                                        className='TaskRevisions__marker'
                                        style={{left: `${Math.min(100, (moment / (duration * 1000)) * 100)}%`}}
                                    />
                                )}
                            </div>
                        </div>

                        <div className='TaskRevisions__panel'>
                            {detail}
                            {!detail && !canManage && (
                                <p className='TaskRevisions__empty'>
                                    <FormattedMessage
                                        id='tasks.revisions.pick'
                                        defaultMessage='Select a revision'
                                    />
                                </p>
                            )}
                            {!detail && canManage && (
                                <form
                                    className='TaskRevisions__form'
                                    onSubmit={addRevision}
                                >
                                    <div className='TaskRevisions__label'>
                                        <label htmlFor='revisionDescription'>
                                            <FormattedMessage
                                                id='tasks.revisions.description'
                                                defaultMessage='Revision description'
                                            />
                                            <span
                                                className='TaskRevisions__required'
                                                aria-hidden={true}
                                            />
                                        </label>
                                        <span className='TaskRevisions__count'>
                                            <FormattedMessage
                                                id='tasks.revisions.count'
                                                defaultMessage='{count} / {max}'
                                                values={{count: title.length, max: TITLE_MAX}}
                                            />
                                        </span>
                                    </div>
                                    <textarea
                                        id='revisionDescription'
                                        className='form-control'
                                        rows={5}
                                        value={title}
                                        maxLength={TITLE_MAX}
                                        required={true}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder={formatMessage({id: 'tasks.revisions.placeholder', defaultMessage: 'Describe the change you want in detail…'})}
                                        aria-label={formatMessage({id: 'tasks.revisions.description', defaultMessage: 'Revision description'})}
                                    />

                                    <div className='TaskRevisions__label'>
                                        <span>
                                            <ImageOutlineIcon size={16}/>
                                            <FormattedMessage
                                                id='tasks.revisions.image'
                                                defaultMessage='Reference image'
                                            />
                                            <span className='TaskRevisions__optional'>
                                                <FormattedMessage
                                                    id='tasks.revisions.optional'
                                                    defaultMessage='(optional)'
                                                />
                                            </span>
                                        </span>
                                    </div>
                                    <div className='TaskRevisions__images'>
                                        <label
                                            className='TaskRevisions__drop'
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                pickImage(e.dataTransfer.files[0]);
                                            }}
                                        >
                                            <UploadOutlineIcon size={20}/>
                                            <FormattedMessage
                                                id='tasks.revisions.drop'
                                                defaultMessage='Drag an image here or <b>choose one</b>'
                                                values={{b: (chunks: React.ReactNode) => <b>{chunks}</b>}}
                                            />
                                            <span className='TaskRevisions__types'>
                                                <FormattedMessage {...imageRule}/>
                                            </span>
                                            <input
                                                type='file'
                                                className='TaskRevisions__fileInput'
                                                accept={IMAGE_TYPES.join(',')}
                                                aria-label={formatMessage({id: 'tasks.revisions.image', defaultMessage: 'Reference image'})}
                                                onChange={(e) => {
                                                    pickImage(e.target.files?.[0]);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </label>
                                        {image && (
                                            <div className='TaskRevisions__preview'>
                                                {preview && (
                                                    <img
                                                        src={preview}
                                                        alt=''
                                                    />
                                                )}
                                                <span className='TaskRevisions__file'>
                                                    <span>{image.name}</span>
                                                    <FormattedMessage
                                                        id='tasks.revisions.imageSize'
                                                        defaultMessage='{size} MB'
                                                        values={{size: (image.size / (1024 * 1024)).toFixed(1)}}
                                                        tagName='span'
                                                    />
                                                </span>
                                                <button
                                                    type='button'
                                                    className='btn btn-icon btn-xs'
                                                    onClick={() => setImage(undefined)}
                                                    aria-label={formatMessage({id: 'tasks.revisions.removeImage', defaultMessage: 'Remove image'})}
                                                >
                                                    <CloseIcon size={14}/>
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className='TaskRevisions__actions'>
                                        <button
                                            type='button'
                                            className='btn btn-tertiary'
                                            onClick={cancel}
                                        >
                                            <FormattedMessage
                                                id='tasks.revisions.cancel'
                                                defaultMessage='Cancel'
                                            />
                                        </button>
                                        <button
                                            type='submit'
                                            className='btn btn-primary'
                                            disabled={!title.trim() || creating}
                                        >
                                            <SendIcon size={16}/>
                                            <FormattedMessage
                                                id='tasks.revisions.create'
                                                defaultMessage='Create revision'
                                            />
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                ) : (

                    // An episode can be made before its video exists; revisions need one to pin to.
                    <p className='TaskRevisions__empty'>
                        <FormattedMessage
                            id='tasks.revisions.noVideo'
                            defaultMessage='No video yet. Upload one to start adding revisions.'
                        />
                    </p>
                )}
            </section>
        </div>
    );
};

export default Revisions;
