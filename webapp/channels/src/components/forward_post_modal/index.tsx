// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {FormattedList, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import type {OnChangeValue} from 'react-select';

import {GenericModal} from '@mattermost/components';
import type {Post, PostPreviewMetadata} from '@mattermost/types/posts';

import {General, Permissions} from 'mattermost-redux/constants';
import {getMyChannelMember, makeGetChannel} from 'mattermost-redux/selectors/entities/channels';
import {haveIChannelPermission, haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getTaskSectionForChannel, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import type {ActionResult} from 'mattermost-redux/types/actions';

import {openDirectChannelToUserId} from 'actions/channel_actions';
import {fetchTeamTasks} from 'actions/tasks';
import {joinChannelById, switchToChannel} from 'actions/views/channel';
import {forwardPost} from 'actions/views/posts';
import {getPermalinkURL} from 'selectors/urls';

import NotificationBox from 'components/notification_box';
import PostMessagePreview from 'components/post_view/post_message_preview';

import Constants from 'utils/constants';
import {getSiteURL} from 'utils/url';

import type {GlobalState} from 'types/store';

import ForwardPostChannelSelect, {makeSelectedChannelOption} from './forward_post_channel_select';
import type {ChannelOption} from './forward_post_channel_select';
import ForwardPostCommentInput from './forward_post_comment_input';

import './forward_post_modal.scss';

type Props = {

    // The function called immediately after the modal is hidden
    onExited?: () => void;

    // the post that is going to be forwarded
    post: Post;
};

const noop = () => {};

const ForwardPostModal = ({onExited, post}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();

    const getChannel = useMemo(() => makeGetChannel(), []);

    const channel = useSelector((state: GlobalState) => getChannel(state, post.channel_id));
    const currentTeam = useSelector(getCurrentTeam);

    const relativePermaLink = useSelector((state: GlobalState) => (currentTeam ? getPermalinkURL(state, currentTeam.id, post.id) : ''));
    const permaLink = `${getSiteURL()}${relativePermaLink}`;

    const isPrivateConversation = channel?.type !== Constants.OPEN_CHANNEL;

    const [comment, setComment] = useState('');
    const [bodyHeight, setBodyHeight] = useState<number>(0);
    const [hasError, setHasError] = useState<boolean>(false);
    const [postError, setPostError] = useState<React.ReactNode>(null);
    const [selectedChannel, setSelectedChannel] = useState<ChannelOption>();

    const bodyRef = useRef<HTMLDivElement>(undefined);

    const measuredRef = useCallback((node: HTMLDivElement) => {
        if (node !== null) {
            bodyRef.current = node;
            setBodyHeight(node.getBoundingClientRect().height);
        }
    }, []);

    const onHeightChange = () => {
        if (bodyRef.current) {
            setBodyHeight(bodyRef.current.getBoundingClientRect().height);
        }
    };

    const selectedChannelId = selectedChannel?.details?.id || '';

    const isSelectedChannelUnjoinedPublic = useSelector((state: GlobalState) => (
        selectedChannel?.details?.type === Constants.OPEN_CHANNEL && !getMyChannelMember(state, selectedChannelId)
    ));

    const canPostInSelectedChannel = useSelector(
        (state: GlobalState) => {
            const channelId = isPrivateConversation ? post.channel_id : selectedChannelId;
            const isDMChannel = selectedChannel?.details?.type === Constants.DM_CHANNEL;
            const teamId = isPrivateConversation ? currentTeam?.id : selectedChannel?.details?.team_id;

            if (isSelectedChannelUnjoinedPublic) {
                return Boolean(haveITeamPermission(state, teamId, Permissions.JOIN_PUBLIC_CHANNELS));
            }

            const hasChannelPermission = haveIChannelPermission(
                state,
                teamId || currentTeam?.id,
                channelId,
                Permissions.CREATE_POST,
            );

            return Boolean(channelId) && (hasChannelPermission || isDMChannel);
        },
    );

    // A task-list channel takes only messages about one of its tasks, so forwarding there names one.
    const targetChannelId = isPrivateConversation ? post.channel_id : selectedChannelId;
    const targetTeamId = (isPrivateConversation ? channel?.team_id : selectedChannel?.details?.team_id) || '';
    const section = useSelector((state: GlobalState) => getTaskSectionForChannel(state, targetChannelId));
    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const teamTasks = useSelector((state: GlobalState) => getTasks(state, section?.team_id ?? ''));
    const tasks = useMemo(() => (section ? teamTasks.filter((t) => t.section_id === section.id) : []), [teamTasks, section]);
    const [taskId, setTaskId] = useState('');
    useEffect(() => setTaskId(''), [targetChannelId]);

    const needsTeamTasks = useSelector((state: GlobalState) => (
        Boolean(state.entities.teams.teams[targetTeamId]?.revisions_enabled) &&
        !Object.values(state.entities.tasks.sectionsById).some((s) => s.team_id === targetTeamId)
    ));
    useEffect(() => {
        if (needsTeamTasks) {
            dispatch(fetchTeamTasks(targetTeamId));
        }
    }, [dispatch, targetTeamId, needsTeamTasks]);

    const canForwardPost = (isPrivateConversation || canPostInSelectedChannel) && !postError && (!section || tasks.some((t) => t.id === taskId));

    const onHide = useCallback(() => {
        onExited?.();
    }, [onExited]);

    const handleChannelSelect = useCallback(
        (channel: OnChangeValue<ChannelOption, boolean>) => {
            if (Array.isArray(channel)) {
                setSelectedChannel(channel[0]);
            }
            setSelectedChannel(channel as ChannelOption);
        },
        [],
    );

    // since the original post has a click handler specified we should prevent any action here
    const preventActionOnPreview = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const messagePreviewTitle = formatMessage({
        id: 'forward_post_modal.preview.title',
        defaultMessage: 'Message preview',
    });

    const previewMetaData: PostPreviewMetadata = {
        post,
        post_id: post.id,
        team_name: currentTeam?.name || '',
        channel_display_name: channel?.display_name || '',
        channel_type: channel?.type || 'O',
        channel_id: post.channel_id,
    };

    let notification;
    if (isPrivateConversation) {
        let notificationText;
        if (channel?.type === General.PRIVATE_CHANNEL) {
            const channelName = `~${channel.display_name}`;
            notificationText = (
                <FormattedMessage
                    id='forward_post_modal.notification.private_channel'
                    defaultMessage='This message is from a private channel and can only be shared with <strong>{channelName}</strong>'
                    values={{
                        channelName,
                        strong: (x: React.ReactNode) => <strong>{x}</strong>,
                    }}
                />
            );
        } else {
            const allParticipants = channel?.display_name.split(', ') || [];
            const participants = allParticipants.map((participant) => <strong key={participant}>{participant}</strong>);

            notificationText = (
                <FormattedMessage
                    id='forward_post_modal.notification.dm_or_gm'
                    defaultMessage='This message is from a private conversation and can only be shared with {participants}'
                    values={{
                        participants: <FormattedList value={participants}/>,
                    }}
                />
            );
        }

        notification = (
            <NotificationBox
                variant={'info'}
                text={notificationText}
                id={'forward_post'}
            />
        );
    }

    const handlePostError = (error: React.ReactNode) => {
        setPostError(error);
        setHasError(true);
        setTimeout(() => setHasError(false), Constants.ANIMATION_TIMEOUT);
    };

    const handleSubmit = () => {
        if (postError) {
            return Promise.resolve();
        }

        if (!channel) {
            return Promise.resolve();
        }

        const channelToForward = isPrivateConversation ? makeSelectedChannelOption(channel) : selectedChannel;

        if (!channelToForward) {
            return Promise.resolve();
        }

        const {type, userId} = channelToForward.details;

        return Promise.resolve().then(() => {
            if (type === Constants.DM_CHANNEL && userId) {
                return dispatch(openDirectChannelToUserId(userId));
            }
            return {data: false} as ActionResult;
        }).then(async ({data}) => {
            if (data) {
                channelToForward.details.id = data.id;
            }

            if (isSelectedChannelUnjoinedPublic) {
                const {error} = await dispatch(joinChannelById(channelToForward.details.id));
                if (error) {
                    throw new Error(error.message || formatMessage({
                        id: 'forward_post_modal.join_error',
                        defaultMessage: 'Unable to join the channel.',
                        description: 'Error shown in the Forward Message modal when joining the selected public channel fails without a specific error message.',
                    }));
                }
            }

            return dispatch(forwardPost(
                post,
                channelToForward.details,
                comment,
                section ? taskId : '',
            ));
        }).then(() => {
            // only switch channels when we are not in a private conversation
            if (!isPrivateConversation) {
                return dispatch(switchToChannel(channelToForward.details));
            }
            return {data: false};
        }).then(() => {
            onHide();
        }).catch((result) => {
            if (result instanceof Error) {
                handlePostError(result.message);
            } else if (result?.error) {
                handlePostError(result.error);
            }
        });
    };

    const postPreviewFooterMessage = formatMessage({
        id: 'forward_post_modal.preview.footer_message',
        defaultMessage: 'Originally posted in ~{channel}',
    },
    {
        channel: channel?.display_name || '',
    });

    return (
        <GenericModal
            className='a11y__modal forward-post'
            id='forward-post-modal'
            show={true}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            modalHeaderText={formatMessage({
                id: 'forward_post_modal.title',
                defaultMessage: 'Forward message',
            })}
            confirmButtonText={formatMessage({
                id: 'forward_post_modal.button.forward',
                defaultMessage: 'Forward',
            })}
            cancelButtonText={formatMessage({
                id: 'forward_post_modal.button.cancel',
                defaultMessage: 'Cancel',
            })}
            isConfirmDisabled={!canForwardPost}
            handleConfirm={handleSubmit}
            handleCancel={onHide}
            onExited={onHide}
        >
            <div
                className={'forward-post__body'}
                ref={measuredRef}
            >
                {isPrivateConversation ? (
                    notification
                ) : (
                    <ForwardPostChannelSelect
                        onSelect={handleChannelSelect}
                        value={selectedChannel}
                        currentBodyHeight={bodyHeight}
                    />
                )}
                {section && (
                    <select
                        className='forward-post__task'
                        aria-label={formatMessage({id: 'forward_post_modal.task.label', defaultMessage: 'Task'})}
                        value={taskId}
                        onChange={(e) => setTaskId(e.target.value)}
                    >
                        <option
                            value=''
                            disabled={true}
                        >
                            {formatMessage({id: 'advanced_text_editor.task_picker.placeholder', defaultMessage: 'Pick a task'})}
                        </option>
                        {tasks.map((t) => (
                            <option
                                key={t.id}
                                value={t.id}
                            >
                                {t.title}
                            </option>
                        ))}
                    </select>
                )}
                <ForwardPostCommentInput
                    canForwardPost={canForwardPost}
                    channelId={selectedChannelId}
                    comment={comment}
                    onChange={setComment}
                    onError={handlePostError}
                    onSubmit={handleSubmit}
                    onHeightChange={onHeightChange}
                    permaLinkLength={permaLink.length}
                />
                <div className={'forward-post__post-preview'}>
                    <span className={'forward-post__post-preview--title'}>
                        {messagePreviewTitle}
                    </span>
                    <div
                        className='post forward-post__post-preview--override'
                        onClick={preventActionOnPreview}
                    >
                        <PostMessagePreview
                            metadata={previewMetaData}
                            handleFileDropdownOpened={noop}
                            preventClickAction={true}
                            previewFooterMessage={postPreviewFooterMessage}
                        />
                    </div>
                    {postError && (
                        <label
                            className={classNames('post-error', {
                                'animation--highlight': hasError,
                            })}
                        >
                            {postError}
                        </label>
                    )}
                </div>
            </div>
        </GenericModal>
    );
};

export default ForwardPostModal;
