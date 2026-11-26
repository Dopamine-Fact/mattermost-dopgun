// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Link, Redirect} from 'react-router-dom';

import {FlagCheckeredIcon} from '@mattermost/compass-icons/components';

import {makeGetTaskSectionsForTeam, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {fetchTeamStages, fetchTeamTasks} from 'actions/tasks';
import {selectLhsItem} from 'actions/views/lhs';

import type {GlobalState} from 'types/store';
import {LhsItemType, LhsPage} from 'types/store/lhs';

import Stages from './stages';
import {useCanSeeStages} from './task_bits';

import './tasks.scss';

const noop = () => {};

// StagesPage shows the stages of every section (episode) that has any, read-only, to follow production at a glance.
// Stages are edited on the task page or in the episode channel.
const StagesPage = () => {
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const enabled = Boolean(team?.tasks_enabled);
    const canSee = useCanSeeStages(teamId);

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const getSections = useMemo(() => makeGetTaskSectionsForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const sections = useSelector((state: GlobalState) => getSections(state, teamId));
    const stagesById = useSelector((state: GlobalState) => state.entities.tasks.stagesById);
    const channels = useSelector((state: GlobalState) => state.entities.channels.channels);
    const staged = useMemo(() => {
        const ids = new Set(Object.values(stagesById).map((s) => s.section_id));
        return sections.filter((s) => ids.has(s.id));
    }, [sections, stagesById]);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Stages));
    }, [dispatch]);

    useEffect(() => {
        if (enabled && canSee) {
            dispatch(fetchTeamTasks(teamId));
            dispatch(fetchTeamStages(teamId));
        }
    }, [dispatch, teamId, enabled, canSee]);

    if (!team) {
        return null;
    }
    if (!enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }

    let content;
    if (!canSee) {
        content = (
            <p className='TaskStages__empty'>
                <FormattedMessage
                    id='tasks.stages.hidden'
                    defaultMessage='Your department cannot see the stages.'
                />
            </p>
        );
    } else if (staged.length) {
        content = staged.map((section) => {
            const channel = channels[section.channel_id];
            return (
                <section
                    key={section.id}
                    className='StagesPage__section'
                >
                    <h2>
                        {channel ? <Link to={`/${team.name}/channels/${channel.name}`}>{section.name}</Link> : section.name}
                    </h2>
                    <Stages
                        teamId={teamId}
                        tasks={tasks}
                        sections={[section]}
                        sectionId={section.id}
                        usersById={{}}
                        selectedId=''
                        onSelect={noop}
                        canManage={false}
                        compact={true}
                    />
                </section>
            );
        });
    } else {
        content = (
            <p className='TaskStages__empty'>
                <FormattedMessage
                    id='tasks.stages.noneInTeam'
                    defaultMessage='No section has stages yet. Add them from the Stages tab of the task page.'
                />
            </p>
        );
    }

    return (
        <div className='TasksPage'>
            <div className='TasksPage__main'>
                <div className='TasksPage__header'>
                    <div className='TasksPage__title'>
                        <FlagCheckeredIcon size={18}/>
                        <h1>
                            <FormattedMessage
                                id='tasks.view.stages'
                                defaultMessage='Stages'
                            />
                        </h1>
                    </div>
                </div>
                <div className='TasksPage__content StagesPage'>
                    {content}
                </div>
            </div>
        </div>
    );
};

export default StagesPage;
