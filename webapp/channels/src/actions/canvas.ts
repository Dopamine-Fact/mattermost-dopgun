// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';

import {createChannel, deleteChannel} from 'mattermost-redux/actions/channels';
import {logError} from 'mattermost-redux/actions/errors';
import {forceLogoutIfNecessary} from 'mattermost-redux/actions/helpers';
import {Client4} from 'mattermost-redux/client';
import {General} from 'mattermost-redux/constants';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/common';
import {generateId} from 'mattermost-redux/utils/helpers';

import {cleanUpUrlable} from 'utils/url';

import type {ActionFuncAsync} from 'types/store';

// createCanvasChannel makes a public channel and turns it into a canvas; if that fails, the channel is removed again.
export function createCanvasChannel(teamId: string, displayName: string): ActionFuncAsync<Channel> {
    return async (dispatch, getState) => {
        const channel = {team_id: teamId, name: cleanUpUrlable(displayName) || generateId(), display_name: displayName, type: General.OPEN_CHANNEL} as Channel;
        const created = await dispatch(createChannel(channel, getCurrentUserId(getState())));
        if (!created.data) {
            return {error: created.error};
        }

        try {
            await Client4.createCanvas(teamId, created.data.id);
        } catch (error) {
            forceLogoutIfNecessary(error, dispatch, getState);
            dispatch(logError(error));

            // shortcut: removing archives the channel, so its URL name stays taken; retry under another name or have an admin delete it.
            await dispatch(deleteChannel(created.data.id));
            return {error};
        }
        return {data: created.data};
    };
}
