// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {PaperclipIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {TaskComment} from '@mattermost/types/tasks';

import {addUserIdsForStatusFetchingPoll} from 'mattermost-redux/actions/status_profile_polling';
import {Client4} from 'mattermost-redux/client';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import ProfilePicture from 'components/profile_picture';
import UserProfile from 'components/user_profile';

import {imageURLForUser} from 'utils/utils';

import type {GlobalState} from 'types/store';

type Props = {
    taskId: string;
    canManage: boolean;
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Comments live in local state: only the open panel needs them, so they stay out of the redux store and websocket events.
const TaskComments = ({taskId, canManage}: Props) => {
    const {formatMessage, formatDate} = useIntl();
    const currentUserId = useSelector(getCurrentUserId);
    const dispatch = useDispatch();
    const usersById = useSelector((state: GlobalState) => state.entities.users.profiles);
    const statuses = useSelector((state: GlobalState) => state.entities.users.statuses);
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let current = true;
        setComments([]);
        setError('');
        Client4.getTaskComments(taskId).then(
            (loaded) => current && setComments(loaded),
            (err) => current && setError(errorMessage(err)),
        );
        return () => {
            current = false;
        };
    }, [taskId]);

    // Authors join the status poll posts use, so their dots stay current.
    useEffect(() => {
        const authorIds = [...new Set(comments.map((c) => c.user_id))];
        if (authorIds.length) {
            dispatch(addUserIdsForStatusFetchingPoll(authorIds));
        }
    }, [dispatch, comments]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (sending || (!message.trim() && files.length === 0)) {
            return;
        }
        setSending(true);
        setError('');
        try {
            const comment = await Client4.createTaskComment(taskId, message, files);
            setComments((prev) => [...prev, comment]);
            setMessage('');
            setFiles([]);
            if (fileInput.current) {
                fileInput.current.value = '';
            }
        } catch (err) {
            setError(errorMessage(err));
        }
        setSending(false);
    };

    const remove = async (commentId: string) => {
        try {
            await Client4.deleteTaskComment(commentId);
            setComments((prev) => prev.filter((c) => c.id !== commentId));
        } catch (err) {
            setError(errorMessage(err));
        }
    };

    return (
        <section className='TaskComments'>
            <h3 className='TaskComments__title'>
                <FormattedMessage
                    id='tasks.comments.title'
                    defaultMessage='Comments'
                />
            </h3>

            {comments.map((comment) => {
                const author = usersById[comment.user_id];
                return (
                    <article
                        key={comment.id}
                        className='TaskComment'
                    >
                        <ProfilePicture
                            size='sm'
                            userId={comment.user_id}
                            username={author?.username}
                            src={imageURLForUser(comment.user_id, author?.last_picture_update)}
                            status={statuses?.[comment.user_id]}
                        />
                        <div className='TaskComment__body'>
                            <div className='TaskComment__header'>
                                <strong><UserProfile userId={comment.user_id}/></strong>
                                <span className='TaskComment__time'>{formatDate(comment.create_at, {dateStyle: 'medium', timeStyle: 'short'})}</span>
                                {(canManage || comment.user_id === currentUserId) && (
                                    <button
                                        className='btn btn-icon btn-xs'
                                        onClick={() => remove(comment.id)}
                                        aria-label={formatMessage({id: 'tasks.comments.delete', defaultMessage: 'Delete comment'})}
                                    >
                                        <TrashCanOutlineIcon size={14}/>
                                    </button>
                                )}
                            </div>
                            {comment.message && <p className='TaskComment__message'>{comment.message}</p>}
                            {comment.files?.map((file) => {
                                const url = Client4.getTaskCommentFileUrl(comment.id, file.id);
                                return (
                                    <React.Fragment key={file.id}>
                                        {file.mime_type.startsWith('image/') && (
                                            <img
                                                className='TaskComment__image'
                                                src={url}
                                                alt={file.name}
                                            />
                                        )}
                                        <a
                                            className='TaskComment__file'
                                            href={`${url}?download=1`}
                                        >
                                            <PaperclipIcon size={14}/>
                                            {file.name}
                                        </a>
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    </article>
                );
            })}

            <form
                className='TaskComments__composer'
                onSubmit={submit}
            >
                <textarea
                    className='form-control'
                    value={message}
                    maxLength={16000}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={formatMessage({id: 'tasks.comments.placeholder', defaultMessage: 'Write a comment'})}
                    aria-label={formatMessage({id: 'tasks.comments.label', defaultMessage: 'Comment'})}
                />
                {files.length > 0 && (
                    <ul className='TaskComments__pending'>
                        {files.map((file) => <li key={file.name + file.size}>{file.name}</li>)}
                    </ul>
                )}
                {error && <div className='TaskComments__error'>{error}</div>}
                <div className='TaskComments__actions'>
                    <label
                        className='btn btn-icon btn-sm'
                        title={formatMessage({id: 'tasks.comments.attach', defaultMessage: 'Attach files'})}
                    >
                        <PaperclipIcon size={18}/>
                        <input
                            ref={fileInput}
                            type='file'
                            multiple={true}
                            hidden={true}
                            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                            aria-label={formatMessage({id: 'tasks.comments.attach', defaultMessage: 'Attach files'})}
                        />
                    </label>
                    <button
                        type='submit'
                        className='btn btn-primary btn-sm'
                        disabled={sending || (!message.trim() && files.length === 0)}
                    >
                        <FormattedMessage
                            id='tasks.comments.send'
                            defaultMessage='Send'
                        />
                    </button>
                </div>
            </form>
        </section>
    );
};

export default TaskComments;
