// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {Suspense, useEffect, useMemo, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {useLocation} from 'react-router-dom';

import type {UserProfile} from '@mattermost/types/users';

import {getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {haveIChannelPermission, haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {makeGetTaskSectionsForTeam, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getProfilesInTeam} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {fetchTeamTasks} from 'actions/tasks';

import List from 'components/tasks/list';
import Revisions from 'components/tasks/revisions';
import TaskDetail from 'components/tasks/task_detail';

import {isArchivedChannel} from 'utils/channel_utils';

import type {GlobalState} from 'types/store';

import 'components/tasks/tasks.scss';
import 'components/canvas/canvas.scss';

// The board pulls in Pixi and Rough.js; keep them out of the main bundle.
const LazyCanvasBoard = React.lazy(() => import('components/canvas/canvas_board'));

// shortcut: the assignee picker lists the first 200 team members, like the tasks page.
const MEMBER_PAGE_SIZE = 200;

type Tab = 'messages' | 'revisions' | 'tasks' | 'canvas';

type Props = {
    channelId: string;

    // children is the channel's chat, shown on the Messages tab.
    children: React.ReactNode;
};

// ChannelTabs builds one tab bar from what the channel has: Revisions and Tasks when a task section links to it,
// Canvas when it is a canvas. A channel with neither renders its chat unchanged.
const ChannelTabs = ({channelId, children}: Props) => {
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const revisionsEnabled = Boolean(team?.tasks_enabled && team?.revisions_enabled);
    const canvasEnabled = Boolean(team?.canvas_enabled);

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const getSections = useMemo(() => makeGetTaskSectionsForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const sections = useSelector((state: GlobalState) => getSections(state, teamId));
    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const usersById = useSelector((state: GlobalState) => state.entities.users.profiles);
    const canManageRevisions = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_REVISIONS));
    const canManageTasks = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_TASKS));
    const section = revisionsEnabled ? sections.find((s) => s.channel_id === channelId) : undefined;
    const sectionTasks = useMemo(() => tasks.filter((t) => section && t.section_id === section.id && !t.video_file_id), [tasks, section]);

    // Same rule as the post textbox, plus archived channels.
    const canPost = useSelector((state: GlobalState) => {
        const channel = getChannel(state, channelId);
        return channel ? !isArchivedChannel(channel) && haveIChannelPermission(state, channel.team_id, channel.id, Permissions.CREATE_POST) : false;
    });

    // The channel the server confirmed to be a canvas; any error (404 included) leaves it unset.
    const [canvasChannelId, setCanvasChannelId] = useState('');
    useEffect(() => {
        setCanvasChannelId('');
        if (!canvasEnabled || !channelId) {
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
    }, [canvasEnabled, channelId]);
    const isCanvas = canvasChannelId === channelId;

    // ?revision=<task id> (assignment messages) opens Revisions on that revision; ?canvas=1 (after creating) opens Canvas.
    const params = new URLSearchParams(useLocation().search);
    const linkedRevision = params.get('revision') ?? '';
    const linkedCanvas = params.get('canvas') === '1';
    const linkedTab: Tab = (linkedRevision && 'revisions') || (linkedCanvas && 'canvas') || 'messages';
    const [tab, setTab] = useState<Tab>(linkedTab);
    const [selectedId, setSelectedId] = useState(linkedRevision);
    useEffect(() => {
        setTab(linkedTab);
        setSelectedId(linkedRevision);
    }, [channelId, linkedTab, linkedRevision]);

    useEffect(() => {
        if (revisionsEnabled) {
            dispatch(fetchTeamTasks(teamId));
        }
    }, [dispatch, teamId, revisionsEnabled]);

    // Every tab of a linked channel shows assignees: the revision cards in the chat, the revisions and the tasks.
    const isLinked = Boolean(section);
    useEffect(() => {
        if (isLinked) {
            dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
        }
    }, [dispatch, teamId, isLinked]);

    if (!section && !isCanvas) {
        return <>{children}</>;
    }

    const switchTab = (id: Tab) => {
        if (id !== tab) {
            setSelectedId('');
        }
        setTab(id);
    };
    const tabButton = (id: Tab, label: React.ReactNode) => (
        <button
            role='tab'
            aria-selected={tab === id}
            className={classNames('RevisionTabs__tab', {'RevisionTabs__tab--active': tab === id})}
            onClick={() => switchTab(id)}
        >
            {label}
        </button>
    );

    const selected = section && tasks.find((t) => t.id === selectedId && t.section_id === section.id);
    const detail = selected && (
        <TaskDetail
            task={selected}
            sections={sections}
            members={members}
            displayName={(user: UserProfile) => displayUsername(user, nameDisplay)}
            onClose={() => setSelectedId('')}
            canManage={selected.video_file_id ? canManageRevisions : canManageTasks}
        />
    );

    let panel = children;
    if (section && tab === 'revisions') {
        panel = (
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
                        canManage={canManageRevisions}
                    />
                </div>
                {detail}
            </div>
        );
    } else if (section && tab === 'tasks') {
        panel = (
            <div
                className='RevisionTabs__panel'
                role='tabpanel'
            >
                <div className='RevisionTabs__main'>
                    <List
                        teamId={teamId}
                        sectionId={section.id}
                        tasks={sectionTasks}
                        sections={sections}
                        usersById={usersById}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        canManage={canManageTasks}
                    />
                </div>
                {detail}
            </div>
        );
    } else if (isCanvas && tab === 'canvas') {
        // While the Canvas tab shows, the chat is unmounted, so the post textbox's document keydown listener
        // (use_textbox_focus) is gone and keys the board ignores cannot steal focus.
        panel = (
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
        );
    }

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
                {section && tabButton('revisions', (
                    <FormattedMessage
                        id='tasks.revisionTabs.revisions'
                        defaultMessage='Revisions'
                    />
                ))}
                {section && tabButton('tasks', (
                    <FormattedMessage
                        id='tasks.revisionTabs.tasks'
                        defaultMessage='Tasks'
                    />
                ))}
                {isCanvas && tabButton('canvas', (
                    <FormattedMessage
                        id='canvas.tabs.canvas'
                        defaultMessage='Canvas'
                    />
                ))}
            </div>
            {panel}
        </>
    );
};

export default ChannelTabs;
