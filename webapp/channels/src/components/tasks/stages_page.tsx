// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Link, Redirect} from 'react-router-dom';

import {CheckCircleIcon, CircleOutlineIcon, ClockOutlineIcon, MagnifyIcon, PlayOutlineIcon} from '@mattermost/compass-icons/components';
import type {Channel} from '@mattermost/types/channels';
import type {Task, TaskSection, TaskStage, TaskStageStatus} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';
import {makeGetTaskSectionsForTeam, makeGetTasksForTeam} from 'mattermost-redux/selectors/entities/tasks';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {fetchTeamStages, fetchTeamTasks} from 'actions/tasks';
import {selectLhsItem} from 'actions/views/lhs';

import type {GlobalState} from 'types/store';
import {LhsItemType, LhsPage} from 'types/store/lhs';

import {useCanSeeStages} from './task_bits';
import {deriveStages, episodeCode} from './task_utils';

import './tasks.scss';

const STAGE_ICON: Record<TaskStageStatus, typeof CheckCircleIcon> = {not_started: CircleOutlineIcon, in_progress: ClockOutlineIcon, done: CheckCircleIcon};
const STAGE_COLOR: Record<TaskStageStatus, string> = {not_started: 'todo', in_progress: 'in_progress', done: 'done'};

type RowProps = {
    teamName: string;
    section: TaskSection;
    stages: TaskStage[];
    byId: Record<string, Task>;
    channel?: Channel;
};

// EpisodeRow is one episode: its code, its stages as a stepper with the current one named, and its latest video.
const EpisodeRow = ({teamName, section, stages, byId, channel}: RowProps) => {
    const {formatNumber} = useIntl();
    const derived = deriveStages(stages, byId);
    const done = derived.filter((d) => d.status === 'done').length;
    const current = derived.find((d) => d.current);
    const code = episodeCode(section.name);

    // "View task progress" opens the episode channel on its Tasks tab, or the task page for a section without one.
    const tasksLink = channel ? {pathname: `/${teamName}/channels/${channel.name}`, state: {channelTab: 'tasks'}} : `/${teamName}/tasks`;

    let summary;
    if (!derived.length) {
        summary = (
            <FormattedMessage
                id='tasks.overview.noStages'
                defaultMessage='No stages yet. Add them from the Stages tab of the episode.'
            />
        );
    } else if (current) {
        summary = (
            <FormattedMessage
                id='tasks.overview.current'
                defaultMessage='Now: {name}'
                values={{name: current.stage.name}}
            />
        );
    } else {
        summary = (
            <FormattedMessage
                id='tasks.overview.allDone'
                defaultMessage='All stages completed'
            />
        );
    }

    return (
        <li className='ProductionOverview__row'>
            <div className='ProductionOverview__episode'>
                {code && <span className='ProductionOverview__code'>{`${code.season} · ${code.episode}`}</span>}
                <h2>{section.name}</h2>
                <Link to={tasksLink}>
                    <FormattedMessage
                        id='tasks.overview.viewTasks'
                        defaultMessage='View task progress ›'
                    />
                </Link>
            </div>

            <div className='ProductionOverview__progress'>
                <div className='ProductionOverview__barRow'>
                    <div
                        className='ProductionOverview__bar'
                        role='progressbar'
                        aria-valuemin={0}
                        aria-valuemax={derived.length}
                        aria-valuenow={done}
                        aria-label={section.name}
                    >
                        <span style={{width: `${derived.length ? (100 * done) / derived.length : 0}%`}}/>
                    </div>
                    <span>{formatNumber(derived.length ? done / derived.length : 0, {style: 'percent'})}</span>
                </div>
                {derived.length > 0 && (
                    <ol className='StageStepper'>
                        {derived.map(({stage, status, current: isCurrent}) => {
                            const Icon = STAGE_ICON[status];
                            return (
                                <li
                                    key={stage.id}
                                    className={classNames('StageStepper__step', `TaskStatus--${STAGE_COLOR[status]}`, {'StageStepper__step--current': isCurrent})}
                                >
                                    <span className='StageStepper__icon'>
                                        <Icon size={18}/>
                                    </span>
                                    <span className='StageStepper__name'>{stage.name}</span>
                                </li>
                            );
                        })}
                    </ol>
                )}
                {derived.length > 0 && (
                    <p className='ProductionOverview__count'>
                        <FormattedMessage
                            id='tasks.overview.stagesDone'
                            defaultMessage='{done}/{total} stages completed'
                            values={{done, total: derived.length}}
                        />
                    </p>
                )}
                <p className='ProductionOverview__count'>{summary}</p>
            </div>

            <div className='ProductionOverview__preview'>
                {section.video_file_id ? (
                    <video
                        src={Client4.getTaskSectionVideoUrl(section.id)}
                        controls={true}
                        preload='metadata'
                        aria-label={section.name}
                    />
                ) : (
                    <div className='ProductionOverview__noVideo'>
                        <PlayOutlineIcon size={32}/>
                        <FormattedMessage
                            id='tasks.overview.noVideo'
                            defaultMessage='No video uploaded yet'
                        />
                    </div>
                )}
            </div>
        </li>
    );
};

// StagesPage is the production overview: one row per episode with its stages in order, for the users who may see
// stages. Progress is the share of stages done. Stages are edited on the task page or in the episode channel.
const StagesPage = () => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const teamId = team?.id ?? '';
    const enabled = Boolean(team?.tasks_enabled);
    const canSee = useCanSeeStages(teamId);
    const [season, setSeason] = useState('');
    const [search, setSearch] = useState('');

    const getTasks = useMemo(() => makeGetTasksForTeam(), []);
    const getSections = useMemo(() => makeGetTaskSectionsForTeam(), []);
    const tasks = useSelector((state: GlobalState) => getTasks(state, teamId));
    const sections = useSelector((state: GlobalState) => getSections(state, teamId));
    const stagesById = useSelector((state: GlobalState) => state.entities.tasks.stagesById);
    const channels = useSelector((state: GlobalState) => state.entities.channels.channels);
    const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

    // Episodes are the channel-linked sections, plus any other section that has stages.
    const stagesBySection = useMemo(() => {
        const map = new Map<string, TaskStage[]>();
        for (const stage of Object.values(stagesById)) {
            map.set(stage.section_id, [...(map.get(stage.section_id) ?? []), stage]);
        }
        map.forEach((list) => list.sort((a, b) => (a.sort_order - b.sort_order) || (a.create_at - b.create_at)));
        return map;
    }, [stagesById]);
    const episodes = sections.filter((s) => s.channel_id || stagesBySection.has(s.id));
    const seasons = new Map<string, number>();
    for (const s of episodes) {
        const code = episodeCode(s.name);
        if (code) {
            seasons.set(code.season, (seasons.get(code.season) ?? 0) + 1);
        }
    }
    const query = search.trim().toLowerCase();
    const shown = episodes.filter((s) => (!season || episodeCode(s.name)?.season === season) && (!query || s.name.toLowerCase().includes(query)));

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
    } else if (episodes.length) {
        content = (
            <>
                {seasons.size > 0 && (
                    <div className='ProductionOverview__seasons'>
                        {[...seasons].sort().map(([name, count]) => (
                            <button
                                key={name}
                                className={classNames('ProductionOverview__season', {'ProductionOverview__season--active': season === name})}
                                aria-pressed={season === name}
                                onClick={() => setSeason(season === name ? '' : name)}
                            >
                                {name}
                                <span>{count}</span>
                            </button>
                        ))}
                    </div>
                )}
                <label className='ProductionOverview__search'>
                    <MagnifyIcon size={16}/>
                    <input
                        type='search'
                        value={search}
                        placeholder={formatMessage({id: 'tasks.overview.search', defaultMessage: 'Search episodes...'})}
                        aria-label={formatMessage({id: 'tasks.overview.search', defaultMessage: 'Search episodes...'})}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </label>
                <div
                    className='ProductionOverview__head'
                    aria-hidden={true}
                >
                    <span>
                        <FormattedMessage
                            id='tasks.overview.col.episode'
                            defaultMessage='Episode'
                        />
                    </span>
                    <span>
                        <FormattedMessage
                            id='tasks.overview.col.progress'
                            defaultMessage='Production progress'
                        />
                    </span>
                    <span>
                        <FormattedMessage
                            id='tasks.overview.col.preview'
                            defaultMessage='Episode preview'
                        />
                    </span>
                </div>
                <ul className='ProductionOverview__rows'>
                    {shown.map((section) => (
                        <EpisodeRow
                            key={section.id}
                            teamName={team.name}
                            section={section}
                            stages={stagesBySection.get(section.id) ?? []}
                            byId={byId}
                            channel={channels[section.channel_id]}
                        />
                    ))}
                </ul>
            </>
        );
    } else {
        content = (
            <p className='TaskStages__empty'>
                <FormattedMessage
                    id='tasks.overview.empty'
                    defaultMessage='No episodes yet.'
                />
            </p>
        );
    }

    return (
        <div className='TasksPage'>
            <div className='TasksPage__main ProductionOverview'>
                <header className='ProductionOverview__header'>
                    <h1>
                        <FormattedMessage
                            id='tasks.overview.title'
                            defaultMessage='Production overview'
                        />
                    </h1>
                    <p className='ProductionOverview__subtitle'>
                        <FormattedMessage
                            id='tasks.overview.subtitle'
                            defaultMessage='Progress per episode and latest previews'
                        />
                    </p>
                    <p className='ProductionOverview__note'>
                        <FormattedMessage
                            id='tasks.overview.note'
                            defaultMessage='Progress shows the completed production stages.'
                        />
                    </p>
                </header>
                {content}
            </div>
        </div>
    );
};

export default StagesPage;
