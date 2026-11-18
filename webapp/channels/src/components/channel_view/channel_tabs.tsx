// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {Suspense, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {useHistory, useLocation} from 'react-router-dom';

import type {UserProfile} from '@mattermost/types/users';

import {getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {haveIChannelPermission, haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getTaskSectionForChannel, makeGetTaskSectionsForTeam, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getProfilesInTeam} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {fetchTeamTasks} from 'actions/tasks';

import {useExplorerChannels} from 'components/file_explorer/use_explorer_data';
import List from 'components/tasks/list';
import Revisions from 'components/tasks/revisions';
import TaskDetail from 'components/tasks/task_detail';
import TaskPostList from 'components/tasks/task_post_list';

import {isArchivedChannel} from 'utils/channel_utils';

import type {GlobalState} from 'types/store';

import TaskFilterContext from './task_filter_context';

import 'components/tasks/tasks.scss';
import 'components/canvas/canvas.scss';

// The board pulls in Pixi and Rough.js; keep them out of the main bundle.
const LazyCanvasBoard = React.lazy(() => import('components/canvas/canvas_board'));
const LazyFileExplorer = React.lazy(() => import('components/file_explorer/file_explorer').then((m) => ({default: m.FileExplorerView})));

// shortcut: the assignee picker lists the first 200 team members, like the tasks page.
const MEMBER_PAGE_SIZE = 200;

type Tab = 'messages' | 'revisions' | 'tasks' | 'canvas' | 'files';

type Props = {
    channelId: string;

    // children is the channel's chat and composer its post box, both shown on the Messages tab.
    children: React.ReactNode;
    composer?: React.ReactNode;
};

// ChannelTabs builds one tab bar from what the channel has: Revisions and Tasks when a task section links to it,
// Canvas when it is a canvas. A channel with neither renders its chat unchanged.
const ChannelTabs = ({channelId, children, composer}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const revisionsEnabled = Boolean(team?.tasks_enabled && team?.revisions_enabled);
    const canvasEnabled = Boolean(team?.canvas_enabled);

    // Only a channel the explorer lists (a member's open or private, unarchived channel); for any other it would show the team's channels.
    const explorerChannels = useExplorerChannels();
    const filesEnabled = Boolean(team?.files_enabled) && explorerChannels.some((c) => c.id === channelId);

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const getSections = useMemo(() => makeGetTaskSectionsForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const sections = useSelector((state: GlobalState) => getSections(state, teamId));
    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const usersById = useSelector((state: GlobalState) => state.entities.users.profiles);
    const canManageRevisions = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_REVISIONS));
    const canManageTasks = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_TASKS));
    const section = useSelector((state: GlobalState) => getTaskSectionForChannel(state, channelId));
    const sectionTasks = useMemo(() => tasks.filter((t) => section && t.section_id === section.id && !t.video_file_id), [tasks, section]);

    // The Messages filter offers every task of the section, revisions included, like the post box's task picker, and
    // any task the loaded messages name, so a task moved to another section can still be filtered here.
    const postedTaskIds = useSelector((state: GlobalState) => {
        const {posts, postsInChannel} = state.entities.posts;
        const ids = new Set<string>();
        for (const block of postsInChannel[channelId] ?? []) {
            for (const id of block.order) {
                const taskId = posts[id]?.props?.task_id;
                if (typeof taskId === 'string' && taskId) {
                    ids.add(taskId);
                }
            }
        }
        return [...ids].sort().join(',');
    });
    const filterTasks = useMemo(() => {
        const posted = new Set(postedTaskIds.split(','));
        return tasks.filter((t) => section && (t.section_id === section.id || posted.has(t.id)));
    }, [tasks, section, postedTaskIds]);
    const [filterTaskId, setFilterTaskId] = useState('');

    // Same rule as the post textbox, plus archived channels.
    const channelName = useSelector((state: GlobalState) => getChannel(state, channelId)?.name ?? '');
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

    // ?revision=<task id> (assignment messages) opens Revisions on that revision, ?task=<task id> (a message's task
    // label) opens Tasks on that task; ?canvas=1 (after creating) opens Canvas; ?folder=<id> opens Files at that folder.
    const location = useLocation();
    const history = useHistory();
    const params = new URLSearchParams(location.search);
    const linkedRevision = params.get('revision') ?? '';
    const linkedTask = params.get('task') ?? '';
    const linkedCanvas = params.get('canvas') === '1';
    const linkedFolder = filesEnabled && params.has('folder');
    const folderId = params.get('folder') ?? '';
    const linkedTab: Tab = (linkedRevision && 'revisions') || (linkedTask && 'tasks') || (linkedCanvas && 'canvas') || (linkedFolder && 'files') || 'messages';
    const linkedId = linkedRevision || linkedTask;
    const [tab, setTab] = useState<Tab>(linkedTab);
    const [selectedId, setSelectedId] = useState(linkedId);

    // location.key: following the same link again re-opens it after the user moved away.
    useEffect(() => {
        setTab(linkedTab);
        setSelectedId(linkedId);
    }, [channelId, linkedTab, linkedId, location.key]);
    useEffect(() => setFilterTaskId(''), [channelId]);

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
        return (
            <>
                {children}
                {composer}
            </>
        );
    }

    const folderUrl = (_: string, folder?: string) => `${location.pathname}?folder=${folder ?? ''}`;
    const switchTab = (id: Tab) => {
        if (id !== tab) {
            setSelectedId('');
        }
        setTab(id);

        // The folder lives in the address so browser Back steps out of a folder instead of out of the tab.
        if (id === 'files' && !linkedFolder) {
            history.push(folderUrl(channelName));
        } else if (id !== 'files' && linkedFolder) {
            history.push(location.pathname);
        }
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

    const filterTask = section && filterTasks.find((t) => t.id === filterTaskId);
    let panel = (
        <TaskFilterContext.Provider value={filterTask ? filterTask.id : ''}>
            {filterTask ? (
                <div
                    className='TaskPostList__panel'
                    role='tabpanel'
                >
                    <TaskPostList
                        key={filterTask.id}
                        taskId={filterTask.id}
                        channelId={channelId}
                        startAtEnd={true}
                    />
                </div>
            ) : children}
            {composer}
        </TaskFilterContext.Provider>
    );
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
                        detail={detail}
                    />
                </div>
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
    } else if (filesEnabled && tab === 'files') {
        panel = (
            <div
                className='ChannelFiles__panel'
                role='tabpanel'
            >
                <Suspense fallback={null}>
                    <LazyFileExplorer
                        key={channelId}
                        channelName={channelName}
                        folderId={folderId}
                        urlFor={folderUrl}
                        embedded={true}
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
                {filesEnabled && tabButton('files', (
                    <FormattedMessage
                        id='file_explorer.title'
                        defaultMessage='Files'
                    />
                ))}
                {section && tab === 'messages' && (
                    <select
                        className='RevisionTabs__filter'
                        aria-label={formatMessage({id: 'channel_tabs.filter.label', defaultMessage: 'Filter by task'})}
                        value={filterTask ? filterTask.id : ''}
                        onChange={(e) => setFilterTaskId(e.target.value)}
                    >
                        <option value=''>{formatMessage({id: 'channel_tabs.filter.all', defaultMessage: 'All'})}</option>
                        {filterTasks.map((t) => (
                            <option
                                key={t.id}
                                value={t.id}
                            >
                                {t.title}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            {panel}
        </>
    );
};

export default ChannelTabs;
