// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';
import type {UserProfile} from '@mattermost/types/users';

import {getProfilesInTeam, getStatusesByIds} from 'mattermost-redux/actions/users';
import {CategoryTypes} from 'mattermost-redux/constants/channel_categories';
import {getAllDirectChannels, getChannelMessageCounts, getMyChannelMemberships} from 'mattermost-redux/selectors/entities/channels';
import {isCollapsedThreadsEnabled, getTeammateNameDisplaySetting, shouldShowDmPanel} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId, getProfilesInCurrentTeam, getUserStatuses, getUsers} from 'mattermost-redux/selectors/entities/users';
import {calculateUnreadCount, getDirectChannelName} from 'mattermost-redux/utils/channel_utils';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {getCategoriesForCurrentTeam} from 'selectors/views/channel_sidebar';

import ProfilePicture from 'components/profile_picture';
import {ranksHeldBy, useTeamDepartments} from 'components/profile_popover/use_custom_roles';

import {getHistory} from 'utils/browser_history';
import {UserStatuses} from 'utils/constants';
import {imageURLForUser} from 'utils/utils';

import type {GlobalState} from 'types/store';

import './dm_panel.scss';

const COLLAPSED_KEY = 'dm_panel_collapsed';
const PROFILE_PAGE_SIZE = 200;

function readCollapsed() {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
        return false;
    }
}

function writeCollapsed(collapsed: boolean) {
    try {
        localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
        // storage blocked; the panel still toggles for this page view
    }
}

type Row = {
    key: string;
    name: string;
    path: string;
    unread: boolean;
    mentions: number;
    user?: UserProfile;
    status?: string;
    color?: string;
};

/** Right-hand panel listing group DMs and every teammate, replacing the sidebar's direct messages category. */
export default function DmPanel() {
    const intl = useIntl();
    const dispatch = useDispatch();
    const show = useSelector(shouldShowDmPanel);
    const team = useSelector(getCurrentTeam);
    const currentUserId = useSelector(getCurrentUserId);
    const profiles = useSelector((state: GlobalState) => getProfilesInCurrentTeam(state));
    const users = useSelector(getUsers);
    const statuses = useSelector(getUserStatuses);
    const directChannels = useSelector(getAllDirectChannels);
    const members = useSelector(getMyChannelMemberships);
    const messageCounts = useSelector(getChannelMessageCounts);
    const crt = useSelector(isCollapsedThreadsEnabled);
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const categories = useSelector(getCategoriesForCurrentTeam);
    const departments = useTeamDepartments(team?.id ?? '');
    const [collapsed, setCollapsed] = useState(readCollapsed);

    useEffect(() => {
        if (!show || !team?.id) {
            return;
        }

        // shortcut: only the first 200 active teammates are listed; page through if teams grow past that.
        (dispatch(getProfilesInTeam(team.id, 0, PROFILE_PAGE_SIZE, '', {active: true})) as unknown as Promise<{data?: UserProfile[]}>).then(({data}) => {
            if (data?.length) {
                dispatch(getStatusesByIds(data.map((u) => u.id)));
            }
        });
    }, [show, team?.id, dispatch]);

    const rows = useMemo(() => {
        if (!team) {
            return [];
        }
        const byName = new Map<string, Channel>(directChannels.map((c) => [c.name, c]));
        const byId = new Map<string, Channel>(directChannels.map((c) => [c.id, c]));
        const unreadOf = (channel?: Channel) => (channel ? calculateUnreadCount(messageCounts[channel.id], members[channel.id], crt) : undefined);
        const alpha = (a: Row, b: Row) => a.name.localeCompare(b.name);

        const dmCategory = categories.find((c) => c.type === CategoryTypes.DIRECT_MESSAGES);
        const groups: Row[] = (dmCategory?.channel_ids ?? []).
            map((id) => byId.get(id)).
            filter((c): c is Channel => c?.type === 'G').
            map((c) => {
                const unread = unreadOf(c);
                return {key: c.id, name: c.display_name, path: `/${team.name}/messages/${c.name}`, unread: Boolean(unread?.showUnread), mentions: unread?.mentions ?? 0};
            }).
            sort(alpha);

        const teammates = profiles.filter((u) => u.id !== currentUserId && !u.is_bot && !u.delete_at);

        // Every other open DM (outside the team, bots, deactivated users, self) stays reachable, since the sidebar no longer lists them.
        const listed = new Set(teammates.map((u) => u.id));
        const others = (dmCategory?.channel_ids ?? []).
            map((id) => byId.get(id)).
            filter((c): c is Channel => c?.type === 'D' && Boolean(c.teammate_id) && !listed.has(c.teammate_id!)).
            map((c) => users[c.teammate_id!]).
            filter(Boolean);
        const people: Row[] = [...teammates, ...others].
            map((u) => {
                const unread = unreadOf(byName.get(getDirectChannelName(currentUserId, u.id)));
                return {
                    key: u.id,
                    name: displayUsername(u, nameDisplay),
                    path: `/${team.name}/messages/@${u.username}`,
                    unread: Boolean(unread?.showUnread),
                    mentions: unread?.mentions ?? 0,
                    user: u,
                    status: statuses[u.id] || UserStatuses.OFFLINE,
                    color: ranksHeldBy(departments, u.id)[0]?.color,
                };
            });
        const tier = (r: Row) => {
            if (r.unread) {
                return 0;
            }
            return r.status === UserStatuses.OFFLINE ? 2 : 1;
        };
        people.sort((a, b) => tier(a) - tier(b) || alpha(a, b));

        return [...groups, ...people];
    }, [team, directChannels, messageCounts, members, crt, categories, profiles, users, currentUserId, nameDisplay, statuses, departments]);

    if (!show || !team) {
        return null;
    }

    const toggle = () => {
        writeCollapsed(!collapsed);
        setCollapsed(!collapsed);
    };

    return (
        <aside
            className={classNames('DmPanel', {'DmPanel--collapsed': collapsed})}
            aria-label={intl.formatMessage({id: 'dm_panel.label', defaultMessage: 'Direct messages'})}
        >
            <div className='DmPanel__header'>
                {!collapsed && (
                    <span className='DmPanel__title'>
                        <FormattedMessage
                            id='dm_panel.title'
                            defaultMessage='Direct Messages'
                        />
                    </span>
                )}
                <button
                    className='DmPanel__toggle btn btn-icon btn-sm'
                    onClick={toggle}
                    aria-label={collapsed ? intl.formatMessage({id: 'dm_panel.expand', defaultMessage: 'Expand direct messages'}) : intl.formatMessage({id: 'dm_panel.collapse', defaultMessage: 'Collapse direct messages'})}
                    aria-expanded={!collapsed}
                >
                    <i className={collapsed ? 'icon icon-chevron-left' : 'icon icon-chevron-right'}/>
                </button>
            </div>
            {!collapsed && (
                <ul className='DmPanel__list'>
                    {rows.map((r) => (
                        <li key={r.key}>
                            <button
                                className={classNames('DmPanel__row', {'DmPanel__row--unread': r.unread, 'DmPanel__row--offline': r.status === UserStatuses.OFFLINE})}
                                onClick={() => getHistory().push(r.path)}
                            >
                                {r.user ? (
                                    <ProfilePicture
                                        src={imageURLForUser(r.user.id, r.user.last_picture_update)}
                                        status={r.status}
                                        size='sm'
                                    />
                                ) : (
                                    <span className='DmPanel__groupIcon'>
                                        <i className='icon icon-account-multiple-outline'/>
                                    </span>
                                )}
                                <span
                                    className='DmPanel__name'
                                    style={r.color ? {color: r.color} : undefined}
                                >
                                    {r.name}
                                </span>
                                {r.mentions > 0 && <span className='DmPanel__badge badge'>{r.mentions}</span>}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
}
