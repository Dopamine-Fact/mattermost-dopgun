// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Draggable} from '@hello-pangea/dnd';
import classNames from 'classnames';
import React, {useState} from 'react';
import type {AnimationEvent, ReactNode} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import Constants from 'utils/constants';

import SidebarBaseChannel from './sidebar_base_channel';
import SidebarDirectChannel from './sidebar_direct_channel';
import SidebarGroupChannel from './sidebar_group_channel';

// Sub-channels render through the connected component; it's only read at render time, so the import cycle is harmless.
import ConnectedSidebarChannel from './index';
import type {Props} from './index';

function SidebarChannel({
    isCategoryCollapsed,
    isCategoryDragged,
    isUnread,
    isCurrentChannel,
    collapseCategoryWithUnreads,
    setChannelRef,
    channel,
    channelId,
    currentTeamName,
    isDraggable,
    isChannelSelected,
    draggingState,
    multiSelectedChannelIds,
    channelIndex,
    isAutoSortedCategory,
    autoSortedCategoryIds,
    isSubChannel,
    subChannelIds,
}: Props) {
    const {formatMessage} = useIntl();
    const [show, setShow] = useState(true);
    const [subChannelsOpen, setSubChannelsOpen] = useState(() => readSubChannelsOpen(channelId));
    if (!channel) {
        return null;
    }

    if (!currentTeamName) {
        return null;
    }

    function isCollapsed() {
        if (isCategoryDragged) {
            return true;
        }

        // The current channel always stays visible. Unread channels stay visible unless the user chose to hide them too.
        return isCategoryCollapsed && !isCurrentChannel && (collapseCategoryWithUnreads || !isUnread);
    }

    function setRef(refMethod?: (element: HTMLLIElement) => void) {
        return (ref: HTMLLIElement) => {
            setChannelRef(channel?.id || '', ref);
            refMethod?.(ref);
        };
    }

    function handleAnimationStart(event: AnimationEvent) {
        if (event && event.animationName === 'toOpaqueAnimation' && !isCollapsed()) {
            setShow(true);
        }
    }

    function handleAnimationEnd(event: AnimationEvent) {
        if (event && event.animationName === 'toTransparentAnimation' && isCollapsed()) {
            setShow(false);
        }
    }

    let component: ReactNode;
    if (!show) {
        component = null;
    } else if (channel.type === Constants.DM_CHANNEL) {
        component = (
            <SidebarDirectChannel
                channel={channel}
                currentTeamName={currentTeamName}
            />
        );
    } else if (channel.type === Constants.GM_CHANNEL) {
        component = (
            <SidebarGroupChannel
                channel={channel}
                currentTeamName={currentTeamName}
            />
        );
    } else {
        component = (
            <SidebarBaseChannel
                channel={channel}
                currentTeamName={currentTeamName}
            />
        );
    }

    // A parent lists its sub-channels under itself behind a toggle; they stay hidden while anything is
    // dragged, as they aren't draggables and would sit in the way of the moving rows.
    let subChannelToggle: ReactNode = null;
    let subChannels: ReactNode = null;
    if (subChannelIds.length) {
        const toggleSubChannels = () => {
            writeSubChannelsOpen(channel.id, !subChannelsOpen);
            setSubChannelsOpen(!subChannelsOpen);
        };
        subChannelToggle = show ? (
            <button
                className='SidebarChannel__subChannelToggle'
                aria-expanded={subChannelsOpen}
                aria-label={formatMessage(subChannelsOpen ? {id: 'sidebar_left.sidebar_channel.hideSubChannels', defaultMessage: 'Hide sub-channels'} : {id: 'sidebar_left.sidebar_channel.showSubChannels', defaultMessage: 'Show sub-channels'})}
                onClick={toggleSubChannels}
            >
                <i className={classNames('icon icon-chevron-right', {open: subChannelsOpen})}/>
            </button>
        ) : null;
        subChannels = subChannelIds.map((id) => (
            <ConnectedSidebarChannel
                key={id}
                channelId={id}
                channelIndex={-1}
                isSubChannel={true}
                isDraggable={false}
                isAutoSortedCategory={isAutoSortedCategory}
                isCategoryCollapsed={isCategoryCollapsed || !subChannelsOpen}
                isCategoryDragged={isCategoryDragged || Boolean(draggingState.state)}
                setChannelRef={setChannelRef}
            />
        ));
    }

    if (isDraggable) {
        let selectedCount: React.ReactNode;
        if (isChannelSelected && draggingState.state && draggingState.id === channel.id && multiSelectedChannelIds.length > 1) {
            selectedCount = show ? (
                <div className='SidebarChannel__selectedCount'>
                    <FormattedMessage
                        id='sidebar_left.sidebar_channel.selectedCount'
                        defaultMessage='{count} selected'
                        values={{count: multiSelectedChannelIds.length}}
                    />
                </div>
            ) : null;
        }

        return (
            <>
                <Draggable
                    draggableId={channel.id}
                    index={channelIndex}
                >
                    {(provided, snapshot) => {
                        return (
                            <li
                                draggable='false'
                                ref={setRef(provided.innerRef)}
                                className={classNames('SidebarChannel', {
                                    collapsed: isCollapsed(),
                                    expanded: !isCollapsed(),
                                    unread: isUnread,
                                    active: isCurrentChannel,
                                    dragging: snapshot.isDragging,
                                    combineTarget: Boolean(snapshot.combineTargetFor),
                                    'SidebarChannel--hasSubChannels': Boolean(subChannelToggle),
                                    selectedDragging: isChannelSelected && draggingState.state && draggingState.id !== channel.id,
                                    fadeOnDrop: snapshot.isDropAnimating && snapshot.draggingOver && autoSortedCategoryIds.has(snapshot.draggingOver),
                                    noFloat: isAutoSortedCategory && !snapshot.isDragging,
                                })}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onAnimationStart={handleAnimationStart}
                                onAnimationEnd={handleAnimationEnd}
                                role='listitem'
                                tabIndex={-1}
                            >
                                {subChannelToggle}
                                {component}
                                {selectedCount}
                            </li>
                        );
                    }}
                </Draggable>
                {subChannels}
            </>
        );
    }

    return (
        <>
            <li
                ref={setRef()}
                className={classNames('SidebarChannel', {
                    collapsed: isCollapsed(),
                    expanded: !isCollapsed(),
                    unread: isUnread,
                    active: isCurrentChannel,
                    'SidebarChannel--sub': isSubChannel,
                    'SidebarChannel--hasSubChannels': Boolean(subChannelToggle),
                })}
                onAnimationStart={handleAnimationStart}
                onAnimationEnd={handleAnimationEnd}
                role='listitem'
            >
                {subChannelToggle}
                {component}
            </li>
            {subChannels}
        </>
    );
}

const subChannelsOpenKey = (channelId: string) => `sidebarSubChannelsOpen:${channelId}`;

// Whether a parent's sub-channels are shown is remembered per browser; shown until hidden.
function readSubChannelsOpen(channelId: string) {
    try {
        return localStorage.getItem(subChannelsOpenKey(channelId)) !== 'false';
    } catch {
        return true;
    }
}

function writeSubChannelsOpen(channelId: string, open: boolean) {
    try {
        if (open) {
            localStorage.removeItem(subChannelsOpenKey(channelId));
        } else {
            localStorage.setItem(subChannelsOpenKey(channelId), 'false');
        }
    } catch {
        // Storage can be unavailable (private mode); the toggle still works for this session.
    }
}

export default SidebarChannel;
