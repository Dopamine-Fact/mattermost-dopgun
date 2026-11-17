// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {useLocation} from 'react-router-dom';

import type {UserProfile} from '@mattermost/types/users';

import {getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {Permissions} from 'mattermost-redux/constants';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {makeGetTaskSectionsForTeam, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getProfilesInTeam} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {fetchTeamTasks} from 'actions/tasks';

import type {GlobalState} from 'types/store';

import Revisions from './revisions';
import TaskDetail from './task_detail';

import './tasks.scss';

// shortcut: the assignee picker lists the first 200 team members, like the tasks page.
const MEMBER_PAGE_SIZE = 200;

type Props = {
    channelId: string;

    // children is the channel's chat, shown on the Messages tab.
    children: React.ReactNode;
};

// RevisionTabs adds Messages | Revisions tabs to a revision channel (a channel some task section links to);
// other channels render their chat unchanged.
const RevisionTabs = ({channelId, children}: Props) => {
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const enabled = Boolean(team?.tasks_enabled && team?.revisions_enabled);

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const getSections = useMemo(() => makeGetTaskSectionsForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const sections = useSelector((state: GlobalState) => getSections(state, teamId));
    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const usersById = useSelector((state: GlobalState) => state.entities.users.profiles);
    const canManage = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_REVISIONS));
    const section = enabled ? sections.find((s) => s.channel_id === channelId) : undefined;

    // ?revision=<task id> (used by assignment messages) opens the Revisions tab on that revision.
    const linked = new URLSearchParams(useLocation().search).get('revision') ?? '';
    const [tab, setTab] = useState<'messages' | 'revisions'>(linked ? 'revisions' : 'messages');
    const [selectedId, setSelectedId] = useState(linked);
    useEffect(() => {
        setTab(linked ? 'revisions' : 'messages');
        setSelectedId(linked);
    }, [channelId, linked]);

    useEffect(() => {
        if (enabled) {
            dispatch(fetchTeamTasks(teamId));
        }
    }, [dispatch, teamId, enabled]);

    // Both tabs show assignees: the revision cards in the chat and the Revisions list.
    const isRevisionChannel = Boolean(section);
    useEffect(() => {
        if (isRevisionChannel) {
            dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
        }
    }, [dispatch, teamId, isRevisionChannel]);
    const showRevisions = isRevisionChannel && tab === 'revisions';

    if (!section) {
        return <>{children}</>;
    }

    const selected = tasks.find((t) => t.id === selectedId && t.section_id === section.id);
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

    return (
        <>
            <div
                className='RevisionTabs'
                role='tablist'
            >
                {tabButton('messages', (
                    <FormattedMessage
                        id='tasks.revisionTabs.messages'
                        defaultMessage='Messages'
                    />
                ))}
                {tabButton('revisions', (
                    <FormattedMessage
                        id='tasks.revisionTabs.revisions'
                        defaultMessage='Revisions'
                    />
                ))}
            </div>
            {showRevisions ? (
                <div
                    className='RevisionTabs__panel'
                    role='tabpanel'
                >
                    <div className='RevisionTabs__main'>
                        <Revisions
                            key={section.id}
                            teamId={teamId}
                            section={section}
                            tasks={tasks}
                            usersById={usersById}
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            canManage={canManage}
                        />
                    </div>
                    {selected && (
                        <TaskDetail
                            task={selected}
                            sections={sections}
                            members={members}
                            displayName={(user: UserProfile) => displayUsername(user, nameDisplay)}
                            onClose={() => setSelectedId('')}
                            canManage={canManage}
                        />
                    )}
                </div>
            ) : children}
        </>
    );
};

export default RevisionTabs;
