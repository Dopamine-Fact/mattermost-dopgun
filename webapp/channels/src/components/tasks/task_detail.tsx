// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Link} from 'react-router-dom';

import {CloseIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Task, TaskPatch, TaskSection} from '@mattermost/types/tasks';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';
import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTeam} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {deleteTask, patchTask} from 'actions/tasks';

import {useLoadedTeamDepartments} from 'components/profile_popover/use_custom_roles';
import {episodeTaskCycle} from 'components/team_settings/team_episodes_tab/episode_tasks';

import type {GlobalState} from 'types/store';

import BlurInput from './blur_input';
import {fromDateInput, toDateInput} from './dates';
import TaskApproval from './task_approval';
import {DepartmentChip, LockLine, StatusSelect, TakeItButton, useApprovalEnabled} from './task_bits';
import TaskComments from './task_comments';
import {lockedBy} from './task_departments';
import TaskSubtasks from './task_subtasks';
import {folderPaths, isApprovalLocked, libraryFolderPaths} from './task_utils';
import type {FolderOption} from './task_utils';

type Props = {
    task: Task;
    sections: TaskSection[];
    members: UserProfile[];
    displayName: (user: UserProfile) => string;
    onClose: () => void;
    canManage: boolean;

    // onSelect opens another task here (a subtask, or a subtask's parent).
    onSelect?: (taskId: string) => void;
};

const TaskDetail = ({task, sections, members, displayName, onClose, canManage, onSelect}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const save = (patch: TaskPatch) => dispatch(patchTask(task.id, patch));
    const currentUserId = useSelector(getCurrentUserId);

    // The server only lets a role assign to members it outranks; offer just those (null: not known, offer all).
    // Revisions (tasks pinned to a video version) are given by manage_revisions, the rest by manage_tasks.
    const permission = task.video_file_id ? 'manage_revisions' : 'manage_tasks';
    const [actionable, setActionable] = useState<Set<string> | null>(null);
    useEffect(() => {
        if (!canManage) {
            return undefined;
        }
        let live = true;
        Client4.getActionableUserIds(task.team_id, permission).then((ids) => live && setActionable(new Set(ids)), () => {});
        return () => {
            live = false;
        };
    }, [task.team_id, canManage, permission]);

    // Departments, the waits-for lock and the folder belong to ordinary tasks, never to revisions.
    const departments = useLoadedTeamDepartments(task.team_id);
    const byId = useSelector((state: GlobalState) => state.entities.tasks.byId);
    const waitingFor = lockedBy(task, byId);
    const locked = !canManage && waitingFor.length > 0;

    // An approved task keeps its section and assignee until a director reopens it (the server enforces it too).
    const approvalLocked = isApprovalLocked(task, useApprovalEnabled(task.team_id));

    // A move drops the task's links both ways, so only a manager moves a linked task (the server enforces it too).
    const linked = task.waits_for.length > 0 || Object.values(byId).some((t) => t.waits_for.includes(task.id));
    const channelId = sections.find((s) => s.id === task.section_id)?.channel_id ?? '';
    const channelName = useSelector((state: GlobalState) => getChannel(state, channelId)?.name ?? '');
    const team = useSelector((state: GlobalState) => getTeam(state, task.team_id));

    // A task may wait for another of its section, unless that one (directly or not) already waits for this one.
    const candidates = useMemo(() => {
        if (!canManage || task.video_file_id) {
            return [];
        }
        const sameSection = Object.values(byId).filter((t) => t.team_id === task.team_id && t.section_id === task.section_id && !t.video_file_id);
        const asKeys = (waitsFor: string[]) => sameSection.map((t) => ({key: t.id, title: t.title, waits_for: t.id === task.id ? waitsFor : t.waits_for}));
        return sameSection.
            filter((t) => t.id !== task.id && (task.waits_for.includes(t.id) || !episodeTaskCycle(asKeys([...task.waits_for, t.id])))).
            sort((a, b) => a.title.localeCompare(b.title));
    }, [byId, canManage, task]);

    // A manager picks the episode channel folder that lists the task's files, and a team library folder that mirrors it.
    const showFolders = canManage && Boolean(channelId) && !task.video_file_id;
    const [uploadFolders, setUploadFolders] = useState<FolderOption[] | null>(null);
    const [libraryFolders, setLibraryFolders] = useState<FolderOption[] | null>(null);
    useEffect(() => {
        setUploadFolders(null);
        setLibraryFolders(null);
        if (!showFolders) {
            return undefined;
        }
        let live = true;
        Client4.getDriveFolders(channelId).then((items) => live && setUploadFolders(folderPaths(items)), () => {});
        Client4.getTeamFilesLayout(task.team_id).then((layout) => live && setLibraryFolders(libraryFolderPaths(layout)), () => {});
        return () => {
            live = false;
        };
    }, [showFolders, channelId, task.team_id]);

    const assignable = members.filter((u) => !actionable || actionable.has(u.id) || u.id === currentUserId || u.id === task.assignee_id);

    return (
        <aside
            className='TaskDetail'
            aria-label={formatMessage({id: 'tasks.detail.label', defaultMessage: 'Task details'})}
        >
            <div className='TaskDetail__header'>
                <span className='TaskDetail__status'>
                    <StatusSelect
                        task={task}
                        locked={locked}
                    />
                </span>
                {canManage && (
                    <button
                        className='btn btn-icon btn-sm'
                        onClick={() => {
                            dispatch(deleteTask(task.id));
                            onClose();
                        }}
                        aria-label={formatMessage({id: 'tasks.detail.delete', defaultMessage: 'Delete task'})}
                    >
                        <TrashCanOutlineIcon size={18}/>
                    </button>
                )}
                <button
                    className='btn btn-icon btn-sm'
                    onClick={onClose}
                    aria-label={formatMessage({id: 'tasks.detail.close', defaultMessage: 'Close'})}
                >
                    <CloseIcon size={18}/>
                </button>
            </div>

            <BlurInput
                className='TaskDetail__title form-control'
                value={task.title}
                maxLength={512}
                onSave={(title) => save({title})}
                aria-label={formatMessage({id: 'tasks.detail.title', defaultMessage: 'Task title'})}
            />

            <TaskApproval task={task}/>
            <TaskSubtasks
                task={task}
                canManage={canManage}
                onSelect={onSelect}
            />

            {!task.video_file_id && (
                <>
                    <LockLine waitingFor={waitingFor}/>
                    {canManage ? (
                        <label className='TaskDetail__field'>
                            <FormattedMessage
                                id='tasks.detail.department'
                                defaultMessage='Department'
                            />
                            <select
                                className='form-control'
                                value={task.department_id}
                                onChange={(e) => save({department_id: e.target.value})}
                            >
                                <option value=''>{formatMessage({id: 'tasks.detail.noDepartment', defaultMessage: 'No department'})}</option>
                                {departments && task.department_id && !departments.some((d) => d.id === task.department_id) && (
                                    <option value={task.department_id}>{formatMessage({id: 'tasks.department.deleted', defaultMessage: 'Deleted department'})}</option>
                                )}
                                {departments?.map((department) => (
                                    <option
                                        key={department.id}
                                        value={department.id}
                                    >
                                        {department.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : (
                        <div>
                            <DepartmentChip
                                task={task}
                                departments={departments}
                            />
                        </div>
                    )}
                </>
            )}

            <label className='TaskDetail__field'>
                <FormattedMessage
                    id='tasks.detail.assignee'
                    defaultMessage='Assignee'
                />
                <select
                    className='form-control'
                    value={task.assignee_id}
                    disabled={!canManage || approvalLocked}
                    onChange={(e) => save({assignee_id: e.target.value})}
                >
                    <option value=''>{formatMessage({id: 'tasks.detail.unassigned', defaultMessage: 'Unassigned'})}</option>
                    {assignable.map((user) => (
                        <option
                            key={user.id}
                            value={user.id}
                        >
                            {displayName(user)}
                        </option>
                    ))}
                </select>
                <TakeItButton
                    task={task}
                    departments={departments}
                    locked={locked}
                />
            </label>

            {candidates.length > 0 && (
                <fieldset className='TaskDetail__field'>
                    <legend>
                        <FormattedMessage
                            id='tasks.detail.waitsFor'
                            defaultMessage='Waits for'
                        />
                    </legend>
                    {candidates.map((t) => (
                        <label
                            key={t.id}
                            className='TaskDetail__check'
                        >
                            <input
                                type='checkbox'
                                checked={task.waits_for.includes(t.id)}
                                onChange={(e) => save({waits_for: e.target.checked ? [...task.waits_for, t.id] : task.waits_for.filter((id) => id !== t.id)})}
                            />
                            {t.title}
                        </label>
                    ))}
                </fieldset>
            )}

            <div className='TaskDetail__dates'>
                <label className='TaskDetail__field'>
                    <FormattedMessage
                        id='tasks.detail.startDate'
                        defaultMessage='Start date'
                    />
                    <input
                        type='date'
                        className='form-control'
                        value={toDateInput(task.start_at)}
                        max={toDateInput(task.due_at) || undefined}
                        onChange={(e) => save({start_at: fromDateInput(e.target.value)})}
                    />
                </label>
                <label className='TaskDetail__field'>
                    <FormattedMessage
                        id='tasks.detail.dueDate'
                        defaultMessage='Due date'
                    />
                    <input
                        type='date'
                        className='form-control'
                        value={toDateInput(task.due_at)}
                        min={toDateInput(task.start_at) || undefined}
                        onChange={(e) => save({due_at: fromDateInput(e.target.value)})}
                    />
                </label>
            </div>

            <label className='TaskDetail__field'>
                <FormattedMessage
                    id='tasks.detail.section'
                    defaultMessage='Section'
                />
                <select
                    className='form-control'
                    value={task.section_id}
                    disabled={Boolean(task.video_file_id) || (!canManage && linked) || approvalLocked}
                    onChange={(e) => save({section_id: e.target.value})}
                >
                    <option value=''>{formatMessage({id: 'tasks.noSection', defaultMessage: 'No section'})}</option>
                    {sections.map((section) => (
                        <option
                            key={section.id}
                            value={section.id}
                        >
                            {section.name}
                        </option>
                    ))}
                </select>
            </label>

            {showFolders && uploadFolders && (
                <FolderSelect
                    label={formatMessage({id: 'tasks.detail.uploadFolder', defaultMessage: 'Upload folder'})}
                    value={task.folder_id}
                    options={uploadFolders}
                    onChange={(folderId) => save({folder_id: folderId})}
                />
            )}
            {showFolders && libraryFolders && (
                <FolderSelect
                    label={formatMessage({id: 'tasks.detail.libraryFolder', defaultMessage: 'Library folder'})}
                    value={task.library_folder_id ?? ''}
                    options={libraryFolders}
                    onChange={(folderId) => save({library_folder_id: folderId})}
                />
            )}

            {task.folder_id && !task.video_file_id && team?.files_enabled && channelName && (
                <Link
                    className='TaskDetail__folder'
                    to={`/${team.name}/channels/${channelName}?folder=${task.folder_id}`}
                >
                    <FormattedMessage
                        id='tasks.detail.openFolder'
                        defaultMessage='Open folder'
                    />
                </Link>
            )}

            <div className='TaskDetail__field'>
                <FormattedMessage
                    id='tasks.detail.description'
                    defaultMessage='Description'
                />
                <BlurInput
                    multiline={true}
                    allowEmpty={true}
                    className='form-control'
                    value={task.description}
                    maxLength={16000}
                    onSave={(description) => save({description})}
                    aria-label={formatMessage({id: 'tasks.detail.description', defaultMessage: 'Description'})}
                />
            </div>

            <TaskComments
                taskId={task.id}
                canManage={canManage}
                channelId={sections.find((s) => s.id === task.section_id)?.channel_id || undefined}
            />
        </aside>
    );
};

type FolderSelectProps = {
    label: string;
    value: string;
    options: FolderOption[];
    onChange: (folderId: string) => void;
};

const FolderSelect = ({label, value, options, onChange}: FolderSelectProps) => {
    const {formatMessage} = useIntl();
    return (
        <label className='TaskDetail__field'>
            {label}
            <select
                className='form-control'
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                <option value=''>{formatMessage({id: 'tasks.detail.noFolder', defaultMessage: 'None'})}</option>
                {value && !options.some((o) => o.id === value) && (
                    <option value={value}>{formatMessage({id: 'tasks.detail.unavailableFolder', defaultMessage: 'Unavailable folder'})}</option>
                )}
                {options.map((o) => (
                    <option
                        key={o.id}
                        value={o.id}
                    >
                        {o.path}
                    </option>
                ))}
            </select>
        </label>
    );
};

export default TaskDetail;
