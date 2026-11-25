// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';
import type {FileInfo} from '@mattermost/types/files';
import type {Post, PostMetadata} from '@mattermost/types/posts';

import {logError} from 'mattermost-redux/actions/errors';
import * as PostActions from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';
import {General, Permissions} from 'mattermost-redux/constants';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getLicense} from 'mattermost-redux/selectors/entities/general';
import {getAssociatedGroupsForReferenceByMention} from 'mattermost-redux/selectors/entities/groups';
import {isCustomGroupsEnabled} from 'mattermost-redux/selectors/entities/preferences';
import {haveIChannelPermission, haveICurrentChannelPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId, getUser} from 'mattermost-redux/selectors/entities/users';

import {getPermalinkURL} from 'selectors/urls';

import {ActionTypes, AnnouncementBarTypes} from 'utils/constants';
import {containsAtChannel, groupsMentionedInText} from 'utils/post_utils';
import {getSiteURL} from 'utils/url';
import {getTimestamp} from 'utils/utils';

import type {ActionFuncAsync} from 'types/store';

import {runMessageWillBePostedHooks} from '../hooks';

export function editPost(post: Post): ActionFuncAsync<Post> {
    return async (dispatch) => {
        const result = await dispatch(PostActions.editPost(post));

        // Send to error bar if it's an edit post error about time limit.
        if (result.error && result.error.server_error_id === 'api.post.update_post.permissions_time_limit.app_error') {
            dispatch(logError({type: AnnouncementBarTypes.ANNOUNCEMENT, message: result.error.message}));
        }

        return result;
    };
}

// taskId names the task the forwarded message is about; a task-list channel requires one.
export function forwardPost(post: Post, channel: Channel, message = '', taskId = ''): ActionFuncAsync<PostActions.CreatePostReturnType> {
    return async (dispatch, getState) => {
        const state = getState();
        const channelId = channel.id;

        const currentUserId = getCurrentUserId(state);
        const currentTeam = getCurrentTeam(state);

        if (!currentTeam) {
            return {};
        }

        const relativePermaLink = getPermalinkURL(state, currentTeam.id, post.id);
        const permaLink = `${getSiteURL()}${relativePermaLink}`;

        const license = getLicense(state);
        const isLDAPEnabled = license?.IsLicensed === 'true' && license?.LDAPGroups === 'true';
        const useLDAPGroupMentions = isLDAPEnabled && haveICurrentChannelPermission(state, Permissions.USE_GROUP_MENTIONS);
        const useChannelMentions = haveIChannelPermission(state, channel.team_id, channelId, Permissions.USE_CHANNEL_MENTIONS);
        const useCustomGroupMentions = isCustomGroupsEnabled(state) && haveICurrentChannelPermission(state, Permissions.USE_GROUP_MENTIONS);
        const groupsWithAllowReference = useLDAPGroupMentions || useCustomGroupMentions ? getAssociatedGroupsForReferenceByMention(state, currentTeam.id, channelId) : null;

        let newPost = {} as Post;

        newPost.channel_id = channelId;

        const time = getTimestamp();
        const userId = currentUserId;

        // Outsiders can't open a DM/GM, so its permalink would render as a dead link; send a quoted copy instead.
        const sourceType = getChannel(state, post.channel_id)?.type;
        let body = permaLink;
        let files: FileInfo[] = [];
        if ((sourceType === General.DM_CHANNEL || sourceType === General.GM_CHANNEL) && post.channel_id !== channelId) {
            const author = getUser(state, post.user_id)?.username;
            const quote = post.message.split('\n').map((line) => `> ${line}`).join('\n');
            body = author ? `> **${author}**:\n${quote}` : quote;

            if (post.file_ids?.length) {
                // The server returns copies in file_ids order; reuse each original's info so the pending post renders.
                const copyIds = await Client4.copyFileInfosForPost(post.id);
                files = copyIds.map((id, i) => ({...post.metadata?.files?.find((f) => f.id === post.file_ids![i]), id} as FileInfo));
            }
        }

        newPost.message = message ? `${message}\n${body}` : body;
        newPost.pending_post_id = `${userId}:${time}`;
        newPost.user_id = userId;
        newPost.create_at = time;
        newPost.metadata = {} as PostMetadata;
        newPost.props = {};
        if (taskId) {
            newPost.props.task_id = taskId;
        }

        if (!useChannelMentions && containsAtChannel(newPost.message, {checkAllMentions: true})) {
            newPost.props.mentionHighlightDisabled = true;
        }

        if (!useLDAPGroupMentions && !useCustomGroupMentions && groupsMentionedInText(newPost.message, groupsWithAllowReference)) {
            newPost.props.disable_group_highlight = true;
        }

        const hookResult = await dispatch(runMessageWillBePostedHooks(newPost));

        if (hookResult.error) {
            return hookResult as PostActions.CreatePostReturnType;
        }

        newPost = hookResult.data!;

        return dispatch(PostActions.createPost(newPost, files));
    };
}

export function selectAttachmentMenuAction(
    postId: string,
    actionId: string,
    cookie: string,
    dataSource: string | undefined,
    text: string,
    value: string,
): ActionFuncAsync {
    return async (dispatch) => {
        dispatch({
            type: ActionTypes.SELECT_ATTACHMENT_MENU_ACTION,
            data: {
                postId,
                actions: {
                    [actionId]: {
                        text,
                        value,
                    },
                },
            },
        });

        dispatch(PostActions.doPostActionWithCookie(postId, actionId, cookie, value, undefined, ''));

        return {data: true};
    };
}
