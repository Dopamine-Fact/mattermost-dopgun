// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {connect} from 'react-redux';
import type {ConnectedProps} from 'react-redux';

import {getCurrentChannelId, makeGetChannel, makeGetChannelUnreadCount} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {getAutoSortedCategoryIds, getDraggingState, getSubChannelIdsByParent, isChannelSelected, shouldCollapseCategoryWithUnreads} from 'selectors/views/channel_sidebar';

import type {GlobalState} from 'types/store';

import SidebarChannel from './sidebar_channel';

const NO_SUB_CHANNELS: string[] = [];

type OwnProps = {
    channelId: string;
    channelIndex: number;
    isCategoryCollapsed: boolean;
    isCategoryDragged: boolean;
    isDraggable: boolean;
    isAutoSortedCategory: boolean;

    // Set when rendered under its parent channel, which then lists no sub-channels of its own.
    isSubChannel?: boolean;

    /**
     * Sets the ref for the sidebar channel div element, so that it can be used by parent components
     */
    setChannelRef: (channelId: string, ref: HTMLLIElement) => void;
};

function makeMapStateToProps() {
    const getChannel = makeGetChannel();
    const getUnreadCount = makeGetChannelUnreadCount();

    return (state: GlobalState, ownProps: OwnProps) => {
        const channel = getChannel(state, ownProps.channelId);
        const currentTeam = getCurrentTeam(state);

        const currentChannelId = getCurrentChannelId(state);

        const unreadCount = getUnreadCount(state, channel?.id || '');

        return {
            channel,
            isCurrentChannel: channel?.id === currentChannelId,
            currentTeamName: currentTeam?.name,
            unreadMentions: unreadCount.mentions,
            isUnread: unreadCount.showUnread,
            collapseCategoryWithUnreads: shouldCollapseCategoryWithUnreads(state),
            draggingState: getDraggingState(state),
            isChannelSelected: isChannelSelected(state, ownProps.channelId),
            multiSelectedChannelIds: state.views.channelSidebar.multiSelectedChannelIds,
            autoSortedCategoryIds: getAutoSortedCategoryIds(state),
            subChannelIds: (!ownProps.isSubChannel && getSubChannelIdsByParent(state)[ownProps.channelId]) || NO_SUB_CHANNELS,
        };
    };
}

const connector = connect(makeMapStateToProps);

type PropsFromRedux = Omit<ConnectedProps<typeof connector>, 'dispatch'>;

export type Props = OwnProps & PropsFromRedux;

// SidebarChannel renders its sub-channels through this connected component, so it is read at render time
// rather than at import time; either module can then be loaded first.
export default connector((props: Props) => React.createElement(SidebarChannel, props));
