// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

// Uploaded channel icon URL, or null when the channel has none (DM/GM never do).
export function channelIconUrl(channel?: Channel): string | null {
    return channel?.last_icon_update ? Client4.getChannelIconUrl(channel.id, channel.last_icon_update) : null;
}
