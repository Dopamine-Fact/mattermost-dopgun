// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';

import {FolderOutlineIcon, LinkVariantIcon, LockOutlineIcon, PencilOutlineIcon, PlusIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Department} from '@mattermost/types/custom_roles';

import {useTeamDepartments} from 'components/profile_popover/use_custom_roles';

import {
    addEpisodeFolder,
    folderName,
    folderNameTaken,
    isValidFolderName,
    MAX_EPISODE_FOLDERS,
    mirrorSources,
    parentPath,
    removeEpisodeFolder,
    renameEpisodeFolder,
} from './episode_folders';
import type {EpisodeFolder} from './episode_folders';

import './episode_folder_panel.scss';

const msg = defineMessages({
    tree: {id: 'team_settings.episodeFolders.tree', defaultMessage: 'Episode folders'},
    empty: {id: 'team_settings.episodeFolders.empty', defaultMessage: 'No folders yet. New episodes start with an empty drive.'},
    addFolder: {id: 'team_settings.episodeFolders.addFolder', defaultMessage: 'Add folder'},
    addSubfolder: {id: 'team_settings.episodeFolders.addSubfolder', defaultMessage: 'Add subfolder to {path}'},
    rename: {id: 'team_settings.episodeFolders.rename', defaultMessage: 'Rename {path}'},
    delete: {id: 'team_settings.episodeFolders.delete', defaultMessage: 'Delete {path}'},
    nameLabel: {id: 'team_settings.episodeFolders.nameLabel', defaultMessage: 'Folder name'},
    nameInvalid: {id: 'team_settings.episodeFolders.nameInvalid', defaultMessage: 'Folder names cannot be empty, "." or "..", or contain / \\ : * ? " < > |.'},
    nameTaken: {id: 'team_settings.episodeFolders.nameTaken', defaultMessage: 'A folder with this name already exists here.'},
    limit: {id: 'team_settings.episodeFolders.limit', defaultMessage: 'A template holds at most {max} folders.'},
    readOnly: {id: 'team_settings.episodeFolders.readOnly', defaultMessage: 'Read-only'},
    mirror: {id: 'team_settings.episodeFolders.mirror', defaultMessage: 'Mirror'},
    pick: {id: 'team_settings.episodeFolders.pick', defaultMessage: 'Select a folder to set who sees and changes it.'},
    whoSees: {id: 'team_settings.episodeFolders.whoSees', defaultMessage: 'Who sees it'},
    whoChanges: {id: 'team_settings.episodeFolders.whoChanges', defaultMessage: 'Who may change it'},
    contents: {id: 'team_settings.episodeFolders.contents', defaultMessage: 'Contents'},
    everyone: {id: 'team_settings.episodeFolders.everyone', defaultMessage: 'Everyone'},
    chosen: {id: 'team_settings.episodeFolders.chosen', defaultMessage: 'Chosen departments'},
    everyoneWhoSees: {id: 'team_settings.episodeFolders.everyoneWhoSees', defaultMessage: 'Everyone who sees it'},
    nobody: {id: 'team_settings.episodeFolders.nobody', defaultMessage: 'Nobody'},
    ownFiles: {id: 'team_settings.episodeFolders.ownFiles', defaultMessage: 'Own files'},
    mirrorOf: {id: 'team_settings.episodeFolders.mirrorOf', defaultMessage: 'Mirror of'},
    mirrorHint: {id: 'team_settings.episodeFolders.mirrorHint', defaultMessage: 'Shows the contents of another folder, read-only, to everyone who sees this one.'},
    deletedDepartment: {id: 'team_settings.episodeFolders.deletedDepartment', defaultMessage: 'Deleted department'},
});

// Sorts parents before their children, case-insensitively, one path segment at a time.
const byPath = (a: EpisodeFolder, b: EpisodeFolder) => {
    const x = a.path.toLowerCase().split('/');
    const y = b.path.toLowerCase().split('/');
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
        if (x[i] !== y[i]) {
            return x[i] < y[i] ? -1 : 1;
        }
    }
    return x.length - y.length;
};

// Drops empty rule fields so a folder without rules stays {path}.
const tidy = (f: EpisodeFolder): EpisodeFolder => {
    const out: EpisodeFolder = {path: f.path};
    if (f.view_departments?.length) {
        out.view_departments = f.view_departments;
    }
    if (f.write_departments?.length) {
        out.write_departments = f.write_departments;
    }
    if (f.read_only) {
        out.read_only = true;
    }
    if (f.mirror_of) {
        out.mirror_of = f.mirror_of;
    }
    return out;
};

const initialWriteMode = (f: EpisodeFolder) => {
    if (f.read_only) {
        return 'nobody';
    }
    return f.write_departments?.length ? 'chosen' : 'everyone';
};

const isWithin = (path: string, root: string) => path === root || path.startsWith(root + '/');

type ChipsProps = {
    departments: Department[];
    ids: string[];
    selected: string[];
    onChange: (ids: string[]) => void;
};

// One checkbox chip per department; selected ids the team no longer has show as "Deleted department".
const DepartmentChips = ({departments, ids, selected, onChange}: ChipsProps) => {
    const {formatMessage} = useIntl();
    const all = [...ids, ...selected.filter((id) => !ids.includes(id))];
    return (
        <div className='EpisodeFolders__chips'>
            {all.map((id) => {
                const department = departments.find((d) => d.id === id);
                return (
                    <label
                        key={id}
                        className={classNames('EpisodeFolders__chip', {'EpisodeFolders__chip--on': selected.includes(id)})}
                    >
                        <input
                            type='checkbox'
                            checked={selected.includes(id)}
                            onChange={() => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])}
                        />
                        {department && (
                            <span
                                className='EpisodeFolders__dot'
                                style={{background: department.color}}
                            />
                        )}
                        {department ? department.name : formatMessage(msg.deletedDepartment)}
                    </label>
                );
            })}
        </div>
    );
};

type DetailProps = {
    folder: EpisodeFolder;
    folders: EpisodeFolder[];
    departments: Department[];
    onChange: (folder: EpisodeFolder) => void;
};

// The settings of the selected folder. Remounted per folder, so the radio choices start from its data.
const FolderDetail = ({folder, folders, departments, onChange}: DetailProps) => {
    const {formatMessage} = useIntl();
    const [viewChosen, setViewChosen] = useState(Boolean(folder.view_departments?.length));
    const [writeMode, setWriteMode] = useState<'everyone' | 'chosen' | 'nobody'>(initialWriteMode(folder));
    const [isMirror, setIsMirror] = useState(Boolean(folder.mirror_of));

    const view = folder.view_departments ?? [];
    const write = folder.write_departments ?? [];
    const allIds = departments.map((d) => d.id);
    const sources = mirrorSources(folders, folder.path);
    const hasSubfolders = folders.some((f) => f.path.startsWith(folder.path + '/'));
    const isSource = folders.some((f) => f.mirror_of === folder.path);

    // A mirror holds nothing of its own, so it never keeps writers.
    const set = (patch: Partial<EpisodeFolder>) => {
        const next = {...folder, ...patch};
        onChange(tidy(next.mirror_of ? {...next, write_departments: []} : next));
    };

    // Writers must stay among the viewers.
    const setView = (ids: string[]) => set({view_departments: ids, write_departments: ids.length ? write.filter((id) => ids.includes(id)) : write});

    const radio = (name: string, checked: boolean, label: string, onSelect: () => void, disabled?: boolean) => (
        <label className='EpisodeFolders__option'>
            <input
                type='radio'
                name={name}
                checked={checked}
                disabled={disabled}
                onChange={onSelect}
            />
            {label}
        </label>
    );

    return (
        <div className='EpisodeFolders__detail'>
            <h5 className='EpisodeFolders__path'>{folder.path}</h5>
            <fieldset className='EpisodeFolders__group'>
                <legend>{formatMessage(msg.whoSees)}</legend>
                {radio('view', !viewChosen, formatMessage(msg.everyone), () => {
                    setViewChosen(false);
                    setView([]);
                })}
                {radio('view', viewChosen, formatMessage(msg.chosen), () => setViewChosen(true))}
                {viewChosen && (
                    <DepartmentChips
                        departments={departments}
                        ids={allIds}
                        selected={view}
                        onChange={setView}
                    />
                )}
            </fieldset>
            {!isMirror && (
                <fieldset className='EpisodeFolders__group'>
                    <legend>{formatMessage(msg.whoChanges)}</legend>
                    {radio('write', writeMode === 'everyone', formatMessage(msg.everyoneWhoSees), () => {
                        setWriteMode('everyone');
                        set({write_departments: [], read_only: false});
                    })}
                    {radio('write', writeMode === 'chosen', formatMessage(msg.chosen), () => {
                        setWriteMode('chosen');
                        set({read_only: false});
                    })}
                    {writeMode === 'chosen' && (
                        <DepartmentChips
                            departments={departments}
                            ids={view.length ? view : allIds}
                            selected={write}
                            onChange={(ids) => set({write_departments: ids})}
                        />
                    )}
                    {radio('write', writeMode === 'nobody', formatMessage(msg.nobody), () => {
                        setWriteMode('nobody');
                        set({write_departments: [], read_only: true});
                    })}
                </fieldset>
            )}
            <fieldset className='EpisodeFolders__group'>
                <legend>{formatMessage(msg.contents)}</legend>
                {radio('contents', !isMirror, formatMessage(msg.ownFiles), () => {
                    setIsMirror(false);
                    set({mirror_of: undefined});
                })}
                {radio('contents', isMirror, formatMessage(msg.mirrorOf), () => {
                    setIsMirror(true);
                    set({mirror_of: sources[0], write_departments: [], read_only: false});
                }, !isMirror && (!sources.length || hasSubfolders || isSource))}
                {isMirror && (
                    <>
                        <select
                            className='EpisodeFolders__select'
                            aria-label={formatMessage(msg.mirrorOf)}
                            value={folder.mirror_of ?? ''}
                            onChange={(e) => set({mirror_of: e.target.value})}
                        >
                            {sources.map((path) => (
                                <option
                                    key={path}
                                    value={path}
                                >
                                    {path}
                                </option>
                            ))}
                        </select>
                        <p className='EpisodeFolders__hint'>{formatMessage(msg.mirrorHint)}</p>
                    </>
                )}
            </fieldset>
        </div>
    );
};

type Props = {
    teamId: string;
    folders: EpisodeFolder[];
    onChange: (folders: EpisodeFolder[]) => void;
};

const EpisodeFolderPanel = ({teamId, folders, onChange}: Props) => {
    const {formatMessage} = useIntl();
    const departments = useTeamDepartments(teamId);
    const [selected, setSelected] = useState<string>();
    const [renaming, setRenaming] = useState<{path: string; text: string}>();

    const full = folders.length >= MAX_EPISODE_FOLDERS;
    const sorted = [...folders].sort(byPath);
    const current = folders.find((f) => f.path === selected);

    const add = (parent: string) => {
        const next = addEpisodeFolder(folders, parent);
        onChange(next.folders);
        setSelected(next.path);
    };

    const remove = (path: string) => {
        onChange(removeEpisodeFolder(folders, path));
        if (selected && isWithin(selected, path)) {
            setSelected(undefined);
        }
    };

    const renameProblem = (path: string, text: string) => {
        if (!isValidFolderName(text)) {
            return msg.nameInvalid;
        }
        return folderNameTaken(folders, parentPath(path), text, path) ? msg.nameTaken : undefined;
    };

    const commitRename = () => {
        if (!renaming) {
            return;
        }
        const {path, text} = renaming;
        setRenaming(undefined);
        if (text === folderName(path) || renameProblem(path, text)) {
            return;
        }
        onChange(renameEpisodeFolder(folders, path, text));
        if (selected && isWithin(selected, path)) {
            const parent = parentPath(path);
            setSelected((parent ? parent + '/' : '') + text + selected.slice(path.length));
        }
    };

    return (
        <div
            className='EpisodeFolders'
            data-testid='episodeFoldersPanel'
        >
            <div className='EpisodeFolders__tree'>
                {sorted.length === 0 && <p className='EpisodeFolders__hint'>{formatMessage(msg.empty)}</p>}
                <ul aria-label={formatMessage(msg.tree)}>
                    {sorted.map((f) => {
                        const depth = f.path.split('/').length - 1;
                        const problem = renaming?.path === f.path ? renameProblem(f.path, renaming.text) : undefined;
                        return (
                            <li
                                key={f.path}
                                className={classNames('EpisodeFolders__row', {'EpisodeFolders__row--selected': f.path === selected})}
                                style={{paddingLeft: 8 + (depth * 16)}}
                            >
                                {renaming?.path === f.path ? (
                                    <input
                                        className='EpisodeFolders__name'
                                        aria-label={formatMessage(msg.nameLabel)}
                                        aria-invalid={Boolean(problem)}
                                        value={renaming.text}
                                        onChange={(e) => setRenaming({path: f.path, text: e.target.value})}
                                        onBlur={commitRename}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.currentTarget.blur();
                                            } else if (e.key === 'Escape') {
                                                setRenaming(undefined);
                                            }
                                        }}
                                    />
                                ) : (
                                    <button
                                        type='button'
                                        className='EpisodeFolders__select-btn'
                                        aria-label={f.path}
                                        aria-pressed={f.path === selected}
                                        onClick={() => setSelected(f.path)}
                                    >
                                        <FolderOutlineIcon size={16}/>
                                        <span>{folderName(f.path)}</span>
                                        {f.read_only && (
                                            <LockOutlineIcon
                                                size={14}
                                                title={formatMessage(msg.readOnly)}
                                            />
                                        )}
                                        {f.mirror_of && (
                                            <LinkVariantIcon
                                                size={14}
                                                title={formatMessage(msg.mirror)}
                                            />
                                        )}
                                    </button>
                                )}
                                {problem && <span className='EpisodeFolders__error'>{formatMessage(problem)}</span>}
                                <span className='EpisodeFolders__actions'>
                                    <button
                                        type='button'
                                        className='btn btn-icon btn-sm'
                                        aria-label={formatMessage(msg.addSubfolder, {path: f.path})}
                                        disabled={full || Boolean(f.mirror_of)}
                                        onClick={() => add(f.path)}
                                    >
                                        <PlusIcon size={16}/>
                                    </button>
                                    <button
                                        type='button'
                                        className='btn btn-icon btn-sm'
                                        aria-label={formatMessage(msg.rename, {path: f.path})}
                                        onClick={() => setRenaming({path: f.path, text: folderName(f.path)})}
                                    >
                                        <PencilOutlineIcon size={16}/>
                                    </button>
                                    <button
                                        type='button'
                                        className='btn btn-icon btn-sm'
                                        aria-label={formatMessage(msg.delete, {path: f.path})}
                                        onClick={() => remove(f.path)}
                                    >
                                        <TrashCanOutlineIcon size={16}/>
                                    </button>
                                </span>
                            </li>
                        );
                    })}
                </ul>
                <button
                    type='button'
                    className='btn btn-tertiary btn-sm'
                    disabled={full}
                    onClick={() => add('')}
                >
                    <PlusIcon size={16}/>
                    {formatMessage(msg.addFolder)}
                </button>
                {full && <p className='EpisodeFolders__hint'>{formatMessage(msg.limit, {max: MAX_EPISODE_FOLDERS})}</p>}
            </div>
            {current ? (
                <FolderDetail
                    key={current.path}
                    folder={current}
                    folders={folders}
                    departments={departments}
                    onChange={(next) => onChange(folders.map((f) => (f.path === next.path ? next : f)))}
                />
            ) : (
                <p className='EpisodeFolders__hint'>{formatMessage(msg.pick)}</p>
            )}
        </div>
    );
};

export default EpisodeFolderPanel;
