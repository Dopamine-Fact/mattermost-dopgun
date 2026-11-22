// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';
import {FormattedMessage, defineMessages, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';
import type {Post, PostList} from '@mattermost/types/posts';
import type {UserProfile} from '@mattermost/types/users';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import AdminHeader from 'components/widgets/admin_console/admin_header';

const msg = defineMessages({
    title: {id: 'admin.conversation_viewer.title', defaultMessage: 'Conversations'},
    user: {id: 'admin.conversation_viewer.user', defaultMessage: 'User'},
    users: {id: 'admin.conversation_viewer.users', defaultMessage: 'Users'},
    messages: {id: 'admin.conversation_viewer.messages', defaultMessage: 'Messages'},
    empty: {id: 'admin.conversation_viewer.empty', defaultMessage: 'No conversations.'},
    noMessages: {id: 'admin.conversation_viewer.no_messages', defaultMessage: 'No messages.'},
    loadOlder: {id: 'admin.conversation_viewer.load_older', defaultMessage: 'Load older'},
    files: {id: 'admin.conversation_viewer.files', defaultMessage: '{count} files'},
});

const PAGE = 60;

// Posts of a page in display order (oldest first); `posts` can hold extra thread posts that are not in `order`.
const oldestFirst = (list: PostList) => list.order.map((id) => list.posts[id]).filter(Boolean).reverse();

/** System Console page where a System Admin reads any user's DMs, group messages and channels. */
export default function ConversationViewer() {
    const intl = useIntl();
    const dispatch = useDispatch();
    const users = useSelector(getUsers);
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);

    const [term, setTerm] = useState('');
    const [results, setResults] = useState<UserProfile[]>([]);
    const [userId, setUserId] = useState('');
    const [channels, setChannels] = useState<Channel[]>([]);
    const [channelId, setChannelId] = useState('');
    const [posts, setPosts] = useState<Post[]>([]);
    const [hasOlder, setHasOlder] = useState(false);

    // The open channel, so a reply that arrives after switching away is dropped.
    const openId = useRef('');

    const userName = (id: string) => (users[id] ? displayUsername(users[id], nameDisplay) : id);
    const otherId = (c: Channel) => c.name.split('__').find((id) => id !== userId) ?? userId;
    const label = (c: Channel) => (c.type === 'D' ? userName(otherId(c)) : c.display_name);

    useEffect(() => {
        if (!term) {
            setResults([]);
            return undefined;
        }
        let cancelled = false;
        Client4.autocompleteUsers(term, '', '').then((r) => !cancelled && setResults(r.users)).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [term]);

    useEffect(() => {
        if (!userId) {
            return undefined;
        }
        let cancelled = false;
        Client4.getChannelsForUser(userId).then((list) => {
            if (!cancelled) {
                setChannels([...list].sort((a, b) => b.last_post_at - a.last_post_at));
                dispatch(getMissingProfilesByIds(list.filter((c) => c.type === 'D').flatMap((c) => c.name.split('__'))));
            }
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [userId, dispatch]);

    const showPage = (id: string, list: PostList, older: boolean) => {
        if (id !== openId.current) {
            return;
        }
        const page = oldestFirst(list);
        setPosts((current) => (older ? [...page, ...current] : page));
        setHasOlder(list.order.length >= PAGE);
        dispatch(getMissingProfilesByIds([...new Set(page.map((p) => p.user_id))]));
    };

    const pickUser = (id: string) => {
        setTerm('');
        openId.current = '';
        setUserId(id);
        setChannels([]);
        setChannelId('');
        setPosts([]);
        setHasOlder(false);
    };

    const openChannel = (id: string) => {
        openId.current = id;
        setChannelId(id);
        setPosts([]);
        setHasOlder(false);
        Client4.getPosts(id, 0, PAGE, true, false).then((list) => showPage(id, list, false)).catch(() => {});
    };

    const loadOlder = () => {
        Client4.getPostsBefore(channelId, posts[0].id, 0, PAGE, true, false).then((list) => showPage(channelId, list, true)).catch(() => {});
    };

    return (
        <div className='wrapper--fixed'>
            <AdminHeader>
                <FormattedMessage {...msg.title}/>
            </AdminHeader>
            <div className='admin-console__wrapper'>
                <div className='admin-console__content'>
                    <label>
                        <FormattedMessage {...msg.user}/>
                        <input
                            className='form-control'
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                        />
                    </label>
                    {results.length > 0 && (
                        <ul aria-label={intl.formatMessage(msg.users)}>
                            {results.map((u) => (
                                <li key={u.id}>
                                    <button
                                        className='btn btn-link'
                                        onClick={() => pickUser(u.id)}
                                    >
                                        {displayUsername(u, nameDisplay)}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {userId && (
                        <div style={{display: 'flex', gap: 24, alignItems: 'flex-start'}}>
                            <ul
                                aria-label={intl.formatMessage(msg.title)}
                                style={{minWidth: 200}}
                            >
                                {channels.map((c) => (
                                    <li key={c.id}>
                                        <button
                                            className={c.id === channelId ? 'btn btn-primary' : 'btn btn-link'}
                                            onClick={() => openChannel(c.id)}
                                        >
                                            {label(c)}
                                        </button>
                                    </li>
                                ))}
                                {channels.length === 0 && <li><FormattedMessage {...msg.empty}/></li>}
                            </ul>
                            {channelId && (
                                <div style={{flex: 1}}>
                                    {hasOlder && (
                                        <button
                                            className='btn btn-tertiary'
                                            onClick={loadOlder}
                                        >
                                            <FormattedMessage {...msg.loadOlder}/>
                                        </button>
                                    )}
                                    <ul aria-label={intl.formatMessage(msg.messages)}>
                                        {posts.map((p) => (
                                            <li
                                                key={p.id}
                                                style={{opacity: p.type.startsWith('system_') ? 0.6 : 1, marginBottom: 8}}
                                            >
                                                <strong>{userName(p.user_id)}</strong>
                                                <small style={{marginLeft: 8}}>{new Date(p.create_at).toLocaleString()}</small>
                                                <div style={{whiteSpace: 'pre-wrap'}}>{p.message}</div>
                                                {Boolean(p.file_ids?.length) && (
                                                    <small>
                                                        <FormattedMessage
                                                            {...msg.files}
                                                            values={{count: p.file_ids!.length}}
                                                        />
                                                    </small>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                    {posts.length === 0 && <FormattedMessage {...msg.noMessages}/>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
