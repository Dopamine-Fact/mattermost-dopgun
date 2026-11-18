// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {PaperclipIcon} from '@mattermost/compass-icons/components';
import type {FileInfo} from '@mattermost/types/files';
import type {Post} from '@mattermost/types/posts';

import {getChannel as fetchChannel, joinChannel} from 'mattermost-redux/actions/channels';
import {createPost} from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getChannel, getMyChannelMember} from 'mattermost-redux/selectors/entities/channels';
import {haveIChannelPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {isArchivedChannel} from 'utils/channel_utils';
import Constants from 'utils/constants';

import type {GlobalState} from 'types/store';

type Props = {
    taskId: string;
    channelId: string;
};

const errorMessage = (err: unknown) => {
    if (err && typeof err === 'object' && 'message' in err) {
        return String(err.message);
    }
    return String(err);
};

// TaskPostComposer posts a message about the task into its section's channel, from the task detail.
// shortcut: plain text and files only, no mentions autocomplete or formatting bar; use the channel's box for those.
const TaskPostComposer = ({taskId, channelId}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const currentUserId = useSelector(getCurrentUserId);
    const channel = useSelector((state: GlobalState) => getChannel(state, channelId));
    const isMember = useSelector((state: GlobalState) => Boolean(getMyChannelMember(state, channelId)));

    // Same rule as the channel's post box, plus archived channels.
    const canPost = useSelector((state: GlobalState) => Boolean(channel) && !isArchivedChannel(channel!) && haveIChannelPermission(state, channel!.team_id, channelId, Permissions.CREATE_POST));
    const [lookedUp, setLookedUp] = useState(Boolean(channel));
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const fileInput = useRef<HTMLInputElement>(null);

    // A private channel the user is not in stays unknown: the server refuses it, which is the answer.
    useEffect(() => {
        if (!channel) {
            setLookedUp(false);
            Promise.resolve(dispatch(fetchChannel(channelId))).finally(() => setLookedUp(true));
        }
    }, [dispatch, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!channel && !lookedUp) {
        return null;
    }

    if (!isMember) {
        if (channel?.type === Constants.OPEN_CHANNEL) {
            return (
                <div className='TaskComments__join'>
                    <button
                        className='btn btn-primary btn-sm'
                        onClick={() => dispatch(joinChannel(currentUserId, channel.team_id, channelId))}
                    >
                        <FormattedMessage
                            id='tasks.conversation.join'
                            defaultMessage='Join the channel to comment'
                        />
                    </button>
                </div>
            );
        }
        return (
            <p className='TaskComments__note'>
                <FormattedMessage
                    id='tasks.conversation.private'
                    defaultMessage='Only members of this channel can see and join its conversation.'
                />
            </p>
        );
    }

    if (!canPost) {
        return (
            <p className='TaskComments__note'>
                <FormattedMessage
                    id='tasks.conversation.readOnly'
                    defaultMessage="You can't post in this channel."
                />
            </p>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (sending || (!message.trim() && files.length === 0)) {
            return;
        }
        setSending(true);
        setError('');
        try {
            let fileInfos: FileInfo[] = [];
            if (files.length) {
                const uploads = await Promise.all(files.map((file) => {
                    const form = new FormData();
                    form.append('channel_id', channelId);
                    form.append('files', file, file.name);
                    return Client4.uploadFile(form);
                }));
                fileInfos = uploads.flatMap((u) => u.file_infos);
            }
            const post = {channel_id: channelId, user_id: currentUserId, message, props: {task_id: taskId}} as unknown as Post;
            const result = await dispatch(createPost(post, fileInfos)) as {error?: unknown};
            if (result?.error) {
                throw result.error;
            }
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

    return (
        <form
            className='TaskComments__composer'
            onSubmit={submit}
        >
            <textarea
                className='form-control'
                value={message}
                maxLength={16383}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={formatMessage({id: 'tasks.conversation.placeholder', defaultMessage: 'Write a message about this task'})}
                aria-label={formatMessage({id: 'tasks.conversation.label', defaultMessage: 'Message'})}
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
                        id='tasks.conversation.send'
                        defaultMessage='Send'
                    />
                </button>
            </div>
        </form>
    );
};

export default TaskPostComposer;
