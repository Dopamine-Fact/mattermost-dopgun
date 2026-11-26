// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useState} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect, useLocation} from 'react-router-dom';

import {CheckboxMarkedCircleOutlineIcon, FlagCheckeredIcon, FormatListBulletedIcon, KanbanIcon, TimelineTextOutlineIcon} from '@mattermost/compass-icons/components';
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
import {selectLhsItem} from 'actions/views/lhs';

import type {GlobalState} from 'types/store';
import {LhsItemType, LhsPage} from 'types/store/lhs';

import Board from './board';
import List from './list';
import Stages from './stages';
import {useCanSeeStages} from './task_bits';
import TaskDetail from './task_detail';
import Timeline from './timeline';

import './tasks.scss';

// shortcut: the assignee picker lists the first 200 team members; switch to a user autocomplete for bigger teams.
const MEMBER_PAGE_SIZE = 200;

const viewLabels = defineMessages({
    board: {id: 'tasks.view.board', defaultMessage: 'Board'},
    list: {id: 'tasks.view.list', defaultMessage: 'List'},
    timeline: {id: 'tasks.view.timeline', defaultMessage: 'Timeline'},
    stages: {id: 'tasks.view.stages', defaultMessage: 'Stages'},
});

const VIEWS = [
    {id: 'board', Icon: KanbanIcon, View: Board, label: viewLabels.board},
    {id: 'list', Icon: FormatListBulletedIcon, View: List, label: viewLabels.list},
    {id: 'timeline', Icon: TimelineTextOutlineIcon, View: Timeline, label: viewLabels.timeline},
    {id: 'stages', Icon: FlagCheckeredIcon, View: Stages, label: viewLabels.stages},
] as const;

type ViewId = typeof VIEWS[number]['id'];

const Tasks = () => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const enabled = Boolean(team?.tasks_enabled);

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const getSections = useMemo(() => makeGetTaskSectionsForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const sections = useSelector((state: GlobalState) => getSections(state, teamId));
    const members = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const usersById = useSelector((state: GlobalState) => state.entities.users.profiles);
    const canManage = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_TASKS));
    const canManageRevisions = useSelector((state: GlobalState) => haveITeamPermission(state, teamId, Permissions.MANAGE_REVISIONS));

    const canSeeStages = useCanSeeStages(teamId);
    const views = VIEWS.filter((v) => v.id !== 'stages' || canSeeStages);

    const {search} = useLocation();
    const [view, setView] = useState<ViewId>('board');
    const [selectedId, setSelectedId] = useState('');

    // ?task=<id> (used by assignment messages) opens that task.
    useEffect(() => {
        const linked = new URLSearchParams(search).get('task');
        if (linked) {
            setSelectedId(linked);
        }
    }, [search]);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Tasks));
    }, [dispatch]);

    useEffect(() => {
        if (enabled) {
            dispatch(fetchTeamTasks(teamId));
            dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
        }
    }, [dispatch, teamId, enabled]);

    if (!team) {
        return null;
    }
    if (!enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }

    const displayName = (user: UserProfile) => displayUsername(user, nameDisplay);
    const selected = tasks.find((t) => t.id === selectedId);
    const {View} = views.find((v) => v.id === view) ?? views[0];

    return (
        <div className='TasksPage'>
            <div className='TasksPage__main'>
                <div className='TasksPage__header'>
                    <div className='TasksPage__title'>
                        <CheckboxMarkedCircleOutlineIcon size={18}/>
                        <h1>
                            <FormattedMessage
                                id='tasks.title'
                                defaultMessage='Tasks'
                            />
                        </h1>
                    </div>
                    <div
                        className='TasksPage__tabs'
                        role='tablist'
                    >
                        {views.map(({id, Icon, label}) => (
                            <button
                                key={id}
                                role='tab'
                                aria-selected={id === view}
                                className={classNames('TasksPage__tab', {'TasksPage__tab--active': id === view})}
                                onClick={() => setView(id)}
                            >
                                <Icon size={16}/>
                                {formatMessage(label)}
                            </button>
                        ))}
                    </div>
                </div>

                <div
                    className='TasksPage__content'
                    role='tabpanel'
                >
                    <View
                        teamId={teamId}
                        tasks={tasks}
                        sections={sections}
                        usersById={usersById}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        canManage={canManage}
                    />
                </div>
            </div>

            {selected && (
                <TaskDetail
                    task={selected}
                    sections={sections}
                    members={members}
                    displayName={displayName}
                    onClose={() => setSelectedId('')}
                    onSelect={setSelectedId}
                    canManage={selected.video_file_id ? canManageRevisions : canManage}
                />
            )}
        </div>
    );
};

export default Tasks;
