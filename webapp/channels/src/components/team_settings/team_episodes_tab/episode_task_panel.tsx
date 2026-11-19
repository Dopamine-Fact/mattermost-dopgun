// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Department} from '@mattermost/types/custom_roles';
import type {UserProfile} from '@mattermost/types/users';

import {getTeamMembers} from 'mattermost-redux/actions/teams';
import {getProfilesInTeam as fetchProfilesInTeam} from 'mattermost-redux/actions/users';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getMembersInTeam} from 'mattermost-redux/selectors/entities/teams';
import {getProfilesInTeam} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {ranksOf, useTeamDepartments} from 'components/profile_popover/use_custom_roles';

import type {GlobalState} from 'types/store';

import type {EpisodeFolder} from './episode_folders';
import {episodeTaskCycle, MAX_DUE_DAYS, MAX_EPISODE_TASKS, tidyEpisodeTask} from './episode_tasks';
import type {EpisodeTask} from './episode_tasks';

import './episode_task_panel.scss';

// shortcut: the person list shows the first 200 team members; page through them for bigger teams.
const MEMBER_PAGE_SIZE = 200;

const NEW_TASK_TITLE = 'New task';

const msg = defineMessages({
    list: {id: 'team_settings.episodeTasks.list', defaultMessage: 'Episode tasks'},
    empty: {id: 'team_settings.episodeTasks.empty', defaultMessage: 'No tasks yet. New episodes start with an empty task list.'},
    add: {id: 'team_settings.episodeTasks.add', defaultMessage: 'Add task'},
    delete: {id: 'team_settings.episodeTasks.delete', defaultMessage: 'Delete {title}'},
    moveUp: {id: 'team_settings.episodeTasks.moveUp', defaultMessage: 'Move {title} up'},
    moveDown: {id: 'team_settings.episodeTasks.moveDown', defaultMessage: 'Move {title} down'},
    limit: {id: 'team_settings.episodeTasks.limit', defaultMessage: 'At most {max} tasks.'},
    pick: {id: 'team_settings.episodeTasks.pick', defaultMessage: 'Select a task to edit its rules.'},
    title: {id: 'team_settings.episodeTasks.title', defaultMessage: 'Task title'},
    department: {id: 'team_settings.episodeTasks.department', defaultMessage: 'Department'},
    anyDepartment: {id: 'team_settings.episodeTasks.anyDepartment', defaultMessage: 'Any department'},
    deletedDepartment: {id: 'team_settings.episodeTasks.deletedDepartment', defaultMessage: 'Deleted department'},
    person: {id: 'team_settings.episodeTasks.person', defaultMessage: 'Person'},
    unassigned: {id: 'team_settings.episodeTasks.unassigned', defaultMessage: 'Unassigned'},
    unknownUser: {id: 'team_settings.episodeTasks.unknownUser', defaultMessage: 'Unknown user'},
    dueDays: {id: 'team_settings.episodeTasks.dueDays', defaultMessage: 'Days after opening'},
    dueDaysHint: {id: 'team_settings.episodeTasks.dueDaysHint', defaultMessage: '0 to {max}. Leave empty for no deadline.'},
    waitsFor: {id: 'team_settings.episodeTasks.waitsFor', defaultMessage: 'Waits for'},
    waitsForHint: {id: 'team_settings.episodeTasks.waitsForHint', defaultMessage: 'Cannot be taken until these are done. Tasks that would make a loop are disabled.'},
    folder: {id: 'team_settings.episodeTasks.folder', defaultMessage: 'Folder'},
    missingFolder: {id: 'team_settings.episodeTasks.missingFolder', defaultMessage: 'Missing folder'},
    missingTask: {id: 'team_settings.episodeTasks.missingTask', defaultMessage: 'Missing task'},
    noFolder: {id: 'team_settings.episodeTasks.noFolder', defaultMessage: 'No folder'},
});

type DetailProps = {
    task: EpisodeTask;
    tasks: EpisodeTask[];
    folders: EpisodeFolder[];
    departments: Department[];
    members: Array<{user: UserProfile; name: string; roles: string}>;
    onChange: (task: EpisodeTask) => void;
};

// The settings of the selected task.
const TaskDetail = ({task, tasks, folders, departments, members, onChange}: DetailProps) => {
    const {formatMessage} = useIntl();
    const others = tasks.filter((t) => t.key !== task.key);
    const ownFolders = folders.filter((f) => !f.mirror_of).map((f) => f.path).sort((a, b) => a.localeCompare(b));

    // Department members first, the same rank rule the drive rules use.
    const inDepartment = (roles: string) => ranksOf(departments, roles).some(({department}) => department.id === task.department_id);
    const people = [...members].sort((a, b) => Number(inDepartment(b.roles)) - Number(inDepartment(a.roles)) || a.name.localeCompare(b.name));
    const waits = task.waits_for ?? [];

    const setWaits = (key: string, on: boolean) => onChange({...task, waits_for: on ? [...waits, key] : waits.filter((k) => k !== key)});

    return (
        <div className='EpisodeTasks__detail'>
            <label className='EpisodeTasks__field'>
                {formatMessage(msg.title)}
                <input
                    value={task.title}
                    onChange={(e) => onChange({...task, title: e.target.value})}
                />
            </label>
            <label className='EpisodeTasks__field'>
                {formatMessage(msg.department)}
                <select
                    value={task.department_id ?? ''}
                    onChange={(e) => onChange({...task, department_id: e.target.value})}
                >
                    <option value=''>{formatMessage(msg.anyDepartment)}</option>
                    {task.department_id && !departments.some((d) => d.id === task.department_id) && (
                        <option value={task.department_id}>{formatMessage(msg.deletedDepartment)}</option>
                    )}
                    {departments.map((d) => (
                        <option
                            key={d.id}
                            value={d.id}
                        >
                            {d.name}
                        </option>
                    ))}
                </select>
            </label>
            <label className='EpisodeTasks__field'>
                {formatMessage(msg.person)}
                <select
                    value={task.assignee_id ?? ''}
                    onChange={(e) => onChange({...task, assignee_id: e.target.value})}
                >
                    <option value=''>{formatMessage(msg.unassigned)}</option>
                    {task.assignee_id && !members.some((m) => m.user.id === task.assignee_id) && (
                        <option value={task.assignee_id}>{formatMessage(msg.unknownUser)}</option>
                    )}
                    {people.map((m) => (
                        <option
                            key={m.user.id}
                            value={m.user.id}
                        >
                            {m.name}
                        </option>
                    ))}
                </select>
            </label>
            <div className='EpisodeTasks__field'>
                <label className='EpisodeTasks__field'>
                    {formatMessage(msg.dueDays)}
                    <input
                        type='number'
                        min={0}
                        max={MAX_DUE_DAYS}
                        step={1}
                        value={task.due_days ?? ''}
                        onChange={(e) => {
                            const text = e.target.value;
                            const days = Number(text);
                            if (text === '') {
                                onChange({...task, due_days: undefined});
                            } else if (Number.isInteger(days) && days >= 0 && days <= MAX_DUE_DAYS) {
                                onChange({...task, due_days: days});
                            }
                        }}
                    />
                </label>
                <span className='EpisodeTasks__hint'>{formatMessage(msg.dueDaysHint, {max: MAX_DUE_DAYS})}</span>
            </div>
            <fieldset className='EpisodeTasks__field'>
                <legend>{formatMessage(msg.waitsFor)}</legend>
                <span className='EpisodeTasks__hint'>{formatMessage(msg.waitsForHint)}</span>
                {others.map((o) => {
                    const on = waits.includes(o.key);
                    const loops = !on && episodeTaskCycle(tasks.map((t) => (t.key === task.key ? {...t, waits_for: [...waits, o.key]} : t)));
                    return (
                        <label
                            key={o.key}
                            className='EpisodeTasks__check'
                        >
                            <input
                                type='checkbox'
                                checked={on}
                                disabled={loops}
                                onChange={(e) => setWaits(o.key, e.target.checked)}
                            />
                            {o.title}
                        </label>
                    );
                })}
                {waits.filter((k) => !tasks.some((t) => t.key === k)).map((k) => (
                    <label
                        key={k}
                        className='EpisodeTasks__check'
                    >
                        <input
                            type='checkbox'
                            checked={true}
                            onChange={() => setWaits(k, false)}
                        />
                        {formatMessage(msg.missingTask)}
                    </label>
                ))}
            </fieldset>
            <label className='EpisodeTasks__field'>
                {formatMessage(msg.folder)}
                <select
                    value={task.folder ?? ''}
                    onChange={(e) => onChange({...task, folder: e.target.value})}
                >
                    <option value=''>{formatMessage(msg.noFolder)}</option>
                    {task.folder && !ownFolders.includes(task.folder) && <option value={task.folder}>{formatMessage(msg.missingFolder)}</option>}
                    {ownFolders.map((path) => (
                        <option
                            key={path}
                            value={path}
                        >
                            {path}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );
};

type Props = {
    teamId: string;
    tasks: EpisodeTask[];
    folders: EpisodeFolder[];
    onChange: (tasks: EpisodeTask[]) => void;
};

const EpisodeTaskPanel = ({teamId, tasks, folders, onChange}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const departments = useTeamDepartments(teamId);
    const profiles = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const teamMembers = useSelector((state: GlobalState) => getMembersInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const [selected, setSelected] = useState<string>();

    useEffect(() => {
        dispatch(fetchProfilesInTeam(teamId, 0, MEMBER_PAGE_SIZE));
        dispatch(getTeamMembers(teamId, 0, MEMBER_PAGE_SIZE));
    }, [dispatch, teamId]);

    const members = profiles.map((user) => ({user, name: displayUsername(user, nameDisplay), roles: teamMembers?.[user.id]?.roles ?? ''}));
    const current = tasks.find((t) => t.key === selected);
    const full = tasks.length >= MAX_EPISODE_TASKS;

    const add = () => {
        const taken = new Set(tasks.map((t) => t.key));
        let n = tasks.length + 1;
        while (taken.has('t' + n)) {
            n++;
        }
        const key = 't' + n;
        onChange([...tasks, {key, title: NEW_TASK_TITLE}]);
        setSelected(key);
    };

    const move = (index: number, by: number) => {
        const next = [...tasks];
        next.splice(index + by, 0, ...next.splice(index, 1));
        onChange(next);
    };

    // Deleting a task also drops it from what the others wait for.
    const remove = (key: string) => {
        onChange(tasks.filter((t) => t.key !== key).map((t) => tidyEpisodeTask({...t, waits_for: t.waits_for?.filter((k) => k !== key)})));
        if (selected === key) {
            setSelected(undefined);
        }
    };

    return (
        <div
            className='EpisodeTasks'
            data-testid='episodeTasksPanel'
        >
            <div className='EpisodeTasks__list'>
                {tasks.length === 0 && <p className='EpisodeTasks__hint'>{formatMessage(msg.empty)}</p>}
                <ul aria-label={formatMessage(msg.list)}>
                    {tasks.map((t, i) => (
                        <li
                            key={t.key}
                            className={classNames('EpisodeTasks__row', {'EpisodeTasks__row--selected': t.key === selected})}
                        >
                            <button
                                type='button'
                                className='EpisodeTasks__select-btn'
                                aria-pressed={t.key === selected}
                                onClick={() => setSelected(t.key)}
                            >
                                <span>{t.title}</span>
                            </button>
                            <button
                                type='button'
                                className='btn btn-icon btn-sm'
                                aria-label={formatMessage(msg.moveUp, {title: t.title})}
                                disabled={i === 0}
                                onClick={() => move(i, -1)}
                            >
                                <ArrowUpIcon size={16}/>
                            </button>
                            <button
                                type='button'
                                className='btn btn-icon btn-sm'
                                aria-label={formatMessage(msg.moveDown, {title: t.title})}
                                disabled={i === tasks.length - 1}
                                onClick={() => move(i, 1)}
                            >
                                <ArrowDownIcon size={16}/>
                            </button>
                            <button
                                type='button'
                                className='btn btn-icon btn-sm'
                                aria-label={formatMessage(msg.delete, {title: t.title})}
                                onClick={() => remove(t.key)}
                            >
                                <TrashCanOutlineIcon size={16}/>
                            </button>
                        </li>
                    ))}
                </ul>
                <button
                    type='button'
                    className='btn btn-tertiary btn-sm'
                    disabled={full}
                    onClick={add}
                >
                    <PlusIcon size={16}/>
                    {formatMessage(msg.add)}
                </button>
                {full && <p className='EpisodeTasks__hint'>{formatMessage(msg.limit, {max: MAX_EPISODE_TASKS})}</p>}
            </div>
            {current ? (
                <TaskDetail
                    key={current.key}
                    task={current}
                    tasks={tasks}
                    folders={folders}
                    departments={departments}
                    members={members}
                    onChange={(next) => onChange(tasks.map((t) => (t.key === next.key ? tidyEpisodeTask(next) : t)))}
                />
            ) : (
                <p className='EpisodeTasks__hint'>{formatMessage(msg.pick)}</p>
            )}
        </div>
    );
};

export default EpisodeTaskPanel;
