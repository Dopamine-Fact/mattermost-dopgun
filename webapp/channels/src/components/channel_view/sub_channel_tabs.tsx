// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useMemo} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {getAllChannels} from 'mattermost-redux/selectors/entities/channels';

import {switchToChannel} from 'actions/views/channel';
import {getSubChannelIdsByParent} from 'selectors/views/channel_sidebar';

import type {GlobalState} from 'types/store';

type Props = {
    channelId: string;
};

// SubChannelTabs shows, in a parent channel or one of its sub-channels, a tab for the parent and for each
// sub-channel listed under it in the sidebar. A tab switches to its channel.
const SubChannelTabs = ({channelId}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const channels = useSelector(getAllChannels);
    const parentId = channels[channelId]?.parent_id || channelId;
    const subChannelIds = useSelector((state: GlobalState) => getSubChannelIdsByParent(state)[parentId]);

    const tabs = useMemo(() => {
        if (!subChannelIds?.length || !channels[parentId]) {
            return [];
        }
        return [parentId, ...subChannelIds].map((id) => channels[id]).filter(Boolean);
    }, [channels, parentId, subChannelIds]);

    if (!tabs.length) {
        return null;
    }

    return (
        <nav
            className='RevisionTabs SubChannelTabs'
            aria-label={formatMessage({id: 'sub_channel_tabs.label', defaultMessage: 'Sub-channels'})}
        >
            {tabs.map((channel) => (
                <button
                    key={channel.id}
                    className={classNames('RevisionTabs__tab', {'RevisionTabs__tab--active': channel.id === channelId})}
                    aria-current={channel.id === channelId ? 'page' : undefined}
                    onClick={() => channel.id !== channelId && dispatch(switchToChannel(channel))}
                >
                    {channel.display_name}
                </button>
            ))}
        </nav>
    );
};

export default SubChannelTabs;
