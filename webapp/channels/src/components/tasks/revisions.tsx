// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';

import type {Task, TaskSection} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';

import {createTask} from 'actions/tasks';

import {AssigneeLabel, StatusSelect} from './task_bits';
import {formatVideoTime} from './task_utils';
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

// Revisions shows a revision channel's video and its revisions: tasks pinned to a time in the video.
const Revisions = ({teamId, section, tasks, usersById, selectedId, onSelect, canManage}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const revisions = useMemo(() => tasks.filter((t) => t.section_id === section.id).sort((a, b) => a.video_time - b.video_time), [tasks, section.id]);
    const videoUrl = Client4.getTaskSectionVideoUrl(section.id);
    const stills = useFrameThumbnails(videoUrl, revisions.map((r) => r.video_time));

    const video = useRef<HTMLVideoElement>(null);
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
        seek(revision.video_time);
        onSelect(revision.id);
    };

    const addRevision = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) {
            return;
        }
        const videoTime = Math.round((video.current?.currentTime ?? 0) * 1000);
        const result = await dispatch(createTask({team_id: teamId, title: title.trim(), section_id: section.id, video_time: videoTime}));
        if (result.data) {
            setTitle('');

            // Open the new revision so it can be assigned straight away.
            onSelect(result.data.id);
        }
    };

    return (
        <div className='TaskRevisions'>
            <video
                key={section.id}
                ref={video}
                className='TaskRevisions__video'
                src={videoUrl}
                controls={true}
                preload='metadata'
            />
            <div className='TaskRevisions__hint'>
                <FormattedMessage
                    id='tasks.revisions.frameHint'
                    defaultMessage='Use ← and → to step one frame.'
                />
            </div>

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

            <ul className='TaskRevisions__list'>
                {revisions.map((revision) => (
                    <li
                        key={revision.id}
                        className={classNames('TaskRevisions__card', {'TaskRevisions__card--selected': revision.id === selectedId})}
                    >
                        <button
                            className='TaskRevisions__still'
                            onClick={() => open(revision)}
                            aria-label={formatMessage({id: 'tasks.revisions.seek', defaultMessage: 'Go to {time}'}, {time: formatVideoTime(revision.video_time)})}
                        >
                            {stills[revision.video_time] && (
                                <img
                                    src={stills[revision.video_time]}
                                    alt=''
                                />
                            )}
                            <span className='TaskRevisions__time'>{formatVideoTime(revision.video_time)}</span>
                        </button>
                        <button
                            className='TaskRevisions__name'
                            onClick={() => open(revision)}
                        >
                            {revision.title}
                        </button>
                        <div className='TaskRevisions__meta'>
                            <AssigneeLabel user={usersById[revision.assignee_id]}/>
                            <StatusSelect task={revision}/>
                        </div>
                    </li>
                ))}
                {revisions.length === 0 && (
                    <li className='TaskRevisions__empty'>
                        <FormattedMessage
                            id='tasks.revisions.noRevisions'
                            defaultMessage='No revisions yet. Pause the video where something needs to change and describe it.'
                        />
                    </li>
                )}
            </ul>
        </div>
    );
};

export default Revisions;
