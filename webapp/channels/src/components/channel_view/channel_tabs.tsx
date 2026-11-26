// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {Suspense, useEffect, useMemo, useState} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {useHistory, useLocation} from 'react-router-dom';

import {FormatListBulletedIcon, KanbanIcon} from '@mattermost/compass-icons/components';
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

import ExplorerUploadPanel from 'components/file_explorer/explorer_upload_panel';
import {useExplorerChannels} from 'components/file_explorer/use_explorer_data';
import {useExplorerUploads} from 'components/file_explorer/use_explorer_uploads';
import Board from 'components/tasks/board';
import List from 'components/tasks/list';
import Revisions from 'components/tasks/revisions';
import TaskDetail from 'components/tasks/task_detail';
import TaskPostList from 'components/tasks/task_post_list';
import Timeline from 'components/tasks/timeline';

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

type Tab = 'messages' | 'revisions' | 'tasks' | 'timeline' | 'canvas' | 'files';

const viewLabels = defineMessages({
    list: {id: 'tasks.view.list', defaultMessage: 'List'},
    board: {id: 'tasks.view.board', defaultMessage: 'Board'},
    timeline: {id: 'tasks.view.timeline', defaultMessage: 'Timeline'},
});

// The Tasks tab's views, picked from the menu that opens when hovering or focusing the tab.
const TASK_VIEWS = [
    {id: 'list', Icon: FormatListBulletedIcon, label: viewLabels.list},
    {id: 'board', Icon: KanbanIcon, label: viewLabels.board},
] as const;

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

    // Kept here, not in the explorer, so an upload's progress and cancel stay on screen after leaving the Files tab.
    const uploads = useExplorerUploads();

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

    // The channel the server confirmed to be a canvas; no canvas (null, from a 204) or an error leaves it unset.
    const [canvasChannelId, setCanvasChannelId] = useState('');
    useEffect(() => {
        setCanvasChannelId('');
        if (!canvasEnabled || !channelId) {
            return undefined;
        }
        let cancelled = false;
        Client4.getCanvas(channelId).then((canvas) => {
            if (canvas && !cancelled) {
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

    // A tab switch that edits the address (entering or leaving Files) names its tab in the history state.
    const switchedTab = (location.state as {channelTab?: Tab} | undefined)?.channelTab;
    const linkedTab: Tab = (linkedRevision && 'revisions') || (linkedTask && 'tasks') || (linkedCanvas && 'canvas') || (linkedFolder && 'files') || switchedTab || 'messages';
    const linkedId = linkedRevision || linkedTask;
    const [tab, setTab] = useState<Tab>(linkedTab);
    const [tasksView, setTasksView] = useState<typeof TASK_VIEWS[number]['id']>('list');
    const [selectedId, setSelectedId] = useState(linkedId);

    // Reset during render, not in an effect, so a new channel never commits with the old channel's tab.
    // location.key: following the same link again re-opens it after the user moved away.
    const linkKey = [channelId, linkedTab, linkedId, location.key].join(' ');
    const [shownLinkKey, setShownLinkKey] = useState(linkKey);
    if (shownLinkKey !== linkKey) {
        setShownLinkKey(linkKey);
        setTab(linkedTab);
        setSelectedId(linkedId);
    }
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

    const tabbed = Boolean(section || isCanvas);
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
            history.push(location.pathname, {channelTab: id});
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
            onSelect={setSelectedId}
            canManage={selected.video_file_id ? canManageRevisions : canManageTasks}
        />
    );

    const filterTask = section && filterTasks.find((t) => t.id === filterTaskId);

    // Another tab covers the chat instead of replacing it: a remounted post list loses its scroll position.
    let panel: React.ReactNode = null;
    if (section && tab === 'revisions') {
        panel = (
            <div
                className='RevisionTabs__panel ChannelTabs__cover'
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
    } else if (section && (tab === 'tasks' || tab === 'timeline')) {
        const viewProps = {teamId, tasks: sectionTasks, sections, usersById, selectedId, onSelect: setSelectedId, canManage: canManageTasks};
        let view = (
            <List
                {...viewProps}
                sectionId={section.id}
            />
        );
        if (tab === 'timeline') {
            // The timeline's canManage only renames, deletes and adds sections, which the episode owns.
            view = (
                <Timeline
                    {...viewProps}
                    sections={[section]}
                    canManage={false}
                />
            );
        } else if (tasksView === 'board') {
            view = <Board {...viewProps}/>;
        }
        panel = (
            <div
                className='RevisionTabs__panel ChannelTabs__cover'
                role='tabpanel'
            >
                <div className='RevisionTabs__main'>
                    {view}
                </div>
                {detail}
            </div>
        );
    } else if (isCanvas && tab === 'canvas') {
        // While the Canvas tab shows, the composer is unmounted, so the post textbox's document keydown listener
        // (use_textbox_focus) is gone and keys the board ignores cannot steal focus.
        panel = (
            <div
                className='CanvasTabs__panel ChannelTabs__cover'
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
                className='ChannelFiles__panel ChannelTabs__cover'
                role='tabpanel'
            >
                <Suspense fallback={null}>
                    <LazyFileExplorer
                        key={channelId}
                        channelName={channelName}
                        folderId={folderId}
                        urlFor={folderUrl}
                        embedded={true}
                        hostUploads={uploads}
                    />
                </Suspense>
            </div>
        );
    }

    // Every branch renders the same tree, so the chat keeps its place (and its scroll) when the tabs appear.
    return (
        <>
            {tabbed && (
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
                    {section && (
                        <div className='RevisionTabs__dropdown'>
                            {tabButton('tasks', (
                                <FormattedMessage
                                    id='tasks.revisionTabs.tasks'
                                    defaultMessage='Tasks'
                                />
                            ))}
                            <div className='RevisionTabs__menu'>
                                {TASK_VIEWS.map(({id, Icon, label}) => (
                                    <button
                                        key={id}
                                        aria-pressed={tasksView === id}
                                        className={classNames('RevisionTabs__menuItem', {'RevisionTabs__menuItem--active': tasksView === id})}
                                        onClick={() => {
                                            setTasksView(id);
                                            switchTab('tasks');
                                        }}
                                    >
                                        <Icon size={16}/>
                                        {formatMessage(label)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {section && tabButton('timeline', <FormattedMessage {...viewLabels.timeline}/>)}
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
            )}
            <div className='ChannelTabs__body'>
                <div
                    className='ChannelTabs__messages'
                    inert={Boolean(panel)}
                >
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
                        {!panel && composer}
                    </TaskFilterContext.Provider>
                </div>
                {panel}
            </div>
            {tabbed && (
                <ExplorerUploadPanel
                    uploads={uploads.uploads}
                    onCancel={uploads.cancel}
                    onClose={uploads.clearFinished}
                />
            )}
        </>
    );
};

export default ChannelTabs;
