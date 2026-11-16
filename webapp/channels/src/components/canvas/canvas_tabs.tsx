// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {Suspense, useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {useLocation} from 'react-router-dom';

import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {haveIChannelPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {isArchivedChannel} from 'utils/channel_utils';

import type {GlobalState} from 'types/store';

import '../tasks/tasks.scss';
import './canvas.scss';

// The board pulls in Pixi and Rough.js; keep them out of the main bundle.
const LazyCanvasBoard = React.lazy(() => import('./canvas_board'));

type Props = {
    channelId: string;

    // children is the channel's chat, shown on the Messages tab.
    children: React.ReactNode;
};

// CanvasTabs adds Messages | Canvas tabs to a canvas channel; other channels render their chat unchanged.
const CanvasTabs = ({channelId, children}: Props) => {
    const enabled = Boolean(useSelector(getCurrentTeam)?.canvas_enabled);

    // The channel the server confirmed to be a canvas; any error (404 included) leaves it unset.
    const [canvasChannelId, setCanvasChannelId] = useState('');
    useEffect(() => {
        setCanvasChannelId('');
        if (!enabled || !channelId) {
            return undefined;
        }
        let cancelled = false;
        Client4.getCanvas(channelId).then(() => {
            if (!cancelled) {
                setCanvasChannelId(channelId);
            }
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [enabled, channelId]);

    // Same rule as the post textbox, plus archived channels.
    const canPost = useSelector((state: GlobalState) => {
        const channel = getChannel(state, channelId);
        return channel ? !isArchivedChannel(channel) && haveIChannelPermission(state, channel.team_id, channel.id, Permissions.CREATE_POST) : false;
    });

    // ?canvas=1 (used after creating the channel) opens the Canvas tab.
    const linked = new URLSearchParams(useLocation().search).get('canvas') === '1';
    const [tab, setTab] = useState<'messages' | 'canvas'>(linked ? 'canvas' : 'messages');
    useEffect(() => {
        setTab(linked ? 'canvas' : 'messages');
    }, [channelId, linked]);

    if (canvasChannelId !== channelId) {
        return <>{children}</>;
    }

    const tabButton = (id: typeof tab, label: React.ReactNode) => (
        <button
            role='tab'
            aria-selected={tab === id}
            className={classNames('RevisionTabs__tab', {'RevisionTabs__tab--active': tab === id})}
            onClick={() => setTab(id)}
        >
            {label}
        </button>
    );

    // While the Canvas tab shows, the chat is unmounted, so the post textbox's document keydown listener
    // (use_textbox_focus) is gone and keys the board ignores cannot steal focus.
    return (
        <>
            <div
                className='RevisionTabs'
                role='tablist'
            >
                {tabButton('messages', (
                    <FormattedMessage
                        id='canvas.tabs.messages'
                        defaultMessage='Messages'
                    />
                ))}
                {tabButton('canvas', (
                    <FormattedMessage
                        id='canvas.tabs.canvas'
                        defaultMessage='Canvas'
                    />
                ))}
            </div>
            {tab === 'canvas' ? (
                <div
                    className='CanvasTabs__panel'
                    role='tabpanel'
                >
                    <Suspense fallback={null}>
                        <LazyCanvasBoard
                            key={channelId}
                            channelId={channelId}
                            readOnly={!canPost}
                        />
                    </Suspense>
                </div>
            ) : children}
        </>
    );
};

export default CanvasTabs;
