// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo} from 'react';
import {defineMessages, FormattedDate, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Link} from 'react-router-dom';

import {AtIcon, CheckboxMarkedCircleOutlineIcon, FireIcon, HomeVariantOutlineIcon, MessageTextOutlineIcon} from '@mattermost/compass-icons/components';

import {getChannelMessageCounts, getMyChannelMemberships, getUnreadChannels} from 'mattermost-redux/selectors/entities/channels';
import {getCurrentUser} from 'mattermost-redux/selectors/entities/common';
import {isCollapsedThreadsEnabled} from 'mattermost-redux/selectors/entities/preferences';
import {makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {calculateUnreadCount} from 'mattermost-redux/utils/channel_utils';

import {fetchTeamTasks} from 'actions/tasks';
import {selectLhsItem} from 'actions/views/lhs';

import type {GlobalState} from 'types/store';
import {LhsItemType, LhsPage} from 'types/store/lhs';

import {isPriority, myOpenTasks, urgency} from './focus';
import type {Urgency} from './focus';

import './dashboard.scss';

const LIST_SIZE = 8;

const urgencyLabels = defineMessages({
    overdue: {id: 'dashboard.due.overdue', defaultMessage: 'Overdue'},
    today: {id: 'dashboard.due.today', defaultMessage: 'Today'},
    tomorrow: {id: 'dashboard.due.tomorrow', defaultMessage: 'Tomorrow'},
});

const statusLabels = defineMessages({
    todo: {id: 'dashboard.status.todo', defaultMessage: 'To do'},
    in_progress: {id: 'dashboard.status.in_progress', defaultMessage: 'In progress'},
    done: {id: 'dashboard.status.done', defaultMessage: 'Done'},
});

type StatProps = {
    icon: React.ReactNode;
    value: number;
    label: React.ReactNode;
    tone?: 'alert';
};

const Stat = ({icon, value, label, tone}: StatProps) => (
    <div className={classNames('DashboardPage__stat', {'DashboardPage__stat--alert': tone === 'alert' && value > 0})}>
        <span className='DashboardPage__statIcon'>{icon}</span>
        <span className='DashboardPage__statValue'>{value}</span>
        <span className='DashboardPage__statLabel'>{label}</span>
    </div>
);

const Dashboard = () => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const user = useSelector(getCurrentUser);
    const teamId = team?.id ?? '';
    const tasksEnabled = Boolean(team?.tasks_enabled);

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const unreadChannels = useSelector((state: GlobalState) => getUnreadChannels(state));
    const messageCounts = useSelector(getChannelMessageCounts);
    const memberships = useSelector(getMyChannelMemberships);
    const crtEnabled = useSelector(isCollapsedThreadsEnabled);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Dashboard));
    }, [dispatch]);

    useEffect(() => {
        if (tasksEnabled) {
            dispatch(fetchTeamTasks(teamId));
        }
    }, [dispatch, teamId, tasksEnabled]);

    const unreads = useMemo(() => unreadChannels.
        map((channel) => ({channel, ...calculateUnreadCount(messageCounts[channel.id], memberships[channel.id], crtEnabled)})).
        sort((a, b) => (b.mentions - a.mentions) || (b.messages - a.messages)), [unreadChannels, messageCounts, memberships, crtEnabled]);

    const mine = useMemo(() => myOpenTasks(tasks, user?.id ?? ''), [tasks, user?.id]);

    if (!team || !user) {
        return null;
    }

    const now = Date.now();
    const unreadMessages = unreads.reduce((sum, u) => sum + Math.max(u.messages, 0), 0);
    const mentions = unreads.reduce((sum, u) => sum + u.mentions, 0);
    const priorityCount = mine.filter((t) => isPriority(t, now)).length;

    return (
        <div className='DashboardPage'>
            <div className='DashboardPage__header'>
                <HomeVariantOutlineIcon size={18}/>
                <h1>
                    <FormattedMessage
                        id='dashboard.title'
                        defaultMessage='Dashboard'
                    />
                </h1>
                <span className='DashboardPage__date'>
                    <FormattedDate
                        value={now}
                        weekday='long'
                        day='numeric'
                        month='long'
                    />
                </span>
            </div>

            <div className='DashboardPage__content'>
                <h2 className='DashboardPage__greeting'>
                    <FormattedMessage
                        id='dashboard.greeting'
                        defaultMessage='Hello, {name}'
                        values={{name: user.first_name || user.username}}
                    />
                </h2>

                <div className='DashboardPage__stats'>
                    <Stat
                        icon={<MessageTextOutlineIcon size={20}/>}
                        value={unreadMessages}
                        label={
                            <FormattedMessage
                                id='dashboard.stat.unreadMessages'
                                defaultMessage='Unread messages'
                            />
                        }
                    />
                    <Stat
                        icon={<AtIcon size={20}/>}
                        value={mentions}
                        tone='alert'
                        label={
                            <FormattedMessage
                                id='dashboard.stat.mentions'
                                defaultMessage='Mentions'
                            />
                        }
                    />
                    {tasksEnabled && (
                        <>
                            <Stat
                                icon={<CheckboxMarkedCircleOutlineIcon size={20}/>}
                                value={mine.length}
                                label={
                                    <FormattedMessage
                                        id='dashboard.stat.assignedTasks'
                                        defaultMessage='Tasks assigned to you'
                                    />
                                }
                            />
                            <Stat
                                icon={<FireIcon size={20}/>}
                                value={priorityCount}
                                tone='alert'
                                label={
                                    <FormattedMessage
                                        id='dashboard.stat.priorityTasks'
                                        defaultMessage='Priority tasks'
                                    />
                                }
                            />
                        </>
                    )}
                </div>

                <div className='DashboardPage__panels'>
                    {tasksEnabled && (
                        <section className='DashboardPage__panel'>
                            <div className='DashboardPage__panelHeader'>
                                <h3>
                                    <FormattedMessage
                                        id='dashboard.focus.title'
                                        defaultMessage='Your focus'
                                    />
                                </h3>
                                <Link to={`/${team.name}/tasks`}>
                                    <FormattedMessage
                                        id='dashboard.focus.all'
                                        defaultMessage='All tasks'
                                    />
                                </Link>
                            </div>
                            {mine.length === 0 ? (
                                <p className='DashboardPage__empty'>
                                    <FormattedMessage
                                        id='dashboard.focus.empty'
                                        defaultMessage='No open tasks are assigned to you.'
                                    />
                                </p>
                            ) : (
                                <ul className='DashboardPage__list'>
                                    {mine.slice(0, LIST_SIZE).map((task) => {
                                        const u: Urgency = urgency(task.due_at, now);
                                        return (
                                            <li key={task.id}>
                                                <Link
                                                    className='DashboardPage__row'
                                                    to={`/${team.name}/tasks?task=${task.id}`}
                                                >
                                                    <span className='DashboardPage__rowTitle'>{task.title}</span>
                                                    <span className='DashboardPage__rowMeta'>
                                                        {formatMessage(statusLabels[task.status])}
                                                    </span>
                                                    {u !== 'none' && (
                                                        <span className={classNames('DashboardPage__badge', `DashboardPage__badge--${u}`)}>
                                                            {u === 'later' ? (
                                                                <FormattedDate
                                                                    value={task.due_at}
                                                                    day='numeric'
                                                                    month='short'
                                                                />
                                                            ) : formatMessage(urgencyLabels[u])}
                                                        </span>
                                                    )}
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    )}

                    <section className='DashboardPage__panel'>
                        <div className='DashboardPage__panelHeader'>
                            <h3>
                                <FormattedMessage
                                    id='dashboard.unreads.title'
                                    defaultMessage='Unread channels'
                                />
                            </h3>
                        </div>
                        {unreads.length === 0 ? (
                            <p className='DashboardPage__empty'>
                                <FormattedMessage
                                    id='dashboard.unreads.empty'
                                    defaultMessage="You're all caught up."
                                />
                            </p>
                        ) : (
                            <ul className='DashboardPage__list'>
                                {unreads.slice(0, LIST_SIZE).map(({channel, messages, mentions: channelMentions}) => (
                                    <li key={channel.id}>
                                        <Link
                                            className='DashboardPage__row'
                                            to={`/${team.name}/channels/${channel.name}`}
                                        >
                                            <span className='DashboardPage__rowTitle'>{channel.display_name}</span>
                                            {messages > 0 && (
                                                <span className='DashboardPage__rowMeta'>
                                                    <FormattedMessage
                                                        id='dashboard.unreads.messages'
                                                        defaultMessage='{count, plural, one {# new message} other {# new messages}}'
                                                        values={{count: messages}}
                                                    />
                                                </span>
                                            )}
                                            {channelMentions > 0 && (
                                                <span className='DashboardPage__badge DashboardPage__badge--mention'>
                                                    <AtIcon size={12}/>
                                                    {channelMentions}
                                                </span>
                                            )}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
