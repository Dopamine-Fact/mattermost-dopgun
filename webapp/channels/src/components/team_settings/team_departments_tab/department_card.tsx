// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DraggableProvidedDragHandleProps} from '@hello-pangea/dnd';
import {Draggable, Droppable} from '@hello-pangea/dnd';
import React, {useEffect, useState} from 'react';
import {FormattedMessage, defineMessages, useIntl} from 'react-intl';

import {DragVerticalIcon, PlusIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Department, Rank} from '@mattermost/types/custom_roles';
import {RANK_PERMISSIONS} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

import {refreshTeamDepartments} from 'components/profile_popover/use_custom_roles';

export const NEW_COLOR = '#888888';

/** `base`, or `base 2`, `base 3`… — the first one not in `taken`; names are unique case-insensitively. */
export const freeName = (base: string, taken: string[]) => {
    const used = new Set(taken.map((t) => t.toLowerCase()));
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
        name = `${base} ${n}`;
    }
    return name;
};

type ColorDotProps = {
    color: string;
    label: string;
    onSave: (color: string) => void;
};

/** A color dot with a native color picker behind it; saves when the picker loses focus. */
const ColorDot = ({color, label, onSave}: ColorDotProps) => {
    const [value, setValue] = useState(color);
    useEffect(() => setValue(color), [color]);
    return (
        <label
            className='TeamDepartments__dot'
            style={{backgroundColor: value}}
        >
            <input
                type='color'
                aria-label={label}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => value !== color && onSave(value)}
            />
        </label>
    );
};

type NameProps = {
    value: string;
    label: string;
    className: string;
    onSave: (value: string) => void;
};

/** An inline name field; saves a changed, non-empty name on blur or Enter and restores an emptied one. */
const InlineName = ({value, label, className, onSave}: NameProps) => {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    const commit = () => {
        const next = text.trim();
        if (!next) {
            setText(value);
        } else if (next !== value) {
            onSave(next);
        }
    };
    return (
        <input
            type='text'
            className={className}
            aria-label={label}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
    );
};

type Props = {
    teamId: string;
    department: Department;

    /** the department's drag handle; Stüdyo geneli has none */
    dragHandleProps?: DraggableProvidedDragHandleProps | null;
    onDelete: (target: {kind: 'department' | 'rank'; id: string; name: string; members: number}) => void;
};

const DepartmentCard = ({teamId, department, dragHandleProps, onDelete}: Props) => {
    const {formatMessage} = useIntl();
    const [error, setError] = useState('');

    // rank id → permissions shown while a save is in flight
    const [pending, setPending] = useState<Record<string, string[]>>({});

    const run = async (write: () => Promise<unknown>) => {
        setError('');
        try {
            await write();
        } catch (e) {
            setError((e as Error).message);
        }
        await refreshTeamDepartments(teamId);
    };

    const toggle = async (rank: Rank, permission: string) => {
        const current = pending[rank.id] ?? rank.permissions;
        const next = current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission];
        setPending((prev) => ({...prev, [rank.id]: next}));
        await run(() => Client4.patchRank(teamId, rank.id, {permissions: next}));
        setPending((prev) => {
            const rest = {...prev};
            delete rest[rank.id];
            return rest;
        });
    };

    // a member holds at most one rank per department, so the counts add up to distinct members
    const departmentMembers = department.ranks.reduce((n, r) => n + r.member_count, 0);

    const patchDepartment = (patch: {name?: string; color?: string}) => run(() => Client4.patchDepartment(teamId, department.id, patch));
    const patchRank = (rank: Rank, patch: {display_name?: string; color?: string}) => run(() => Client4.patchRank(teamId, rank.id, patch));
    const addRank = () => run(() => Client4.createRank(teamId, department.id, {
        display_name: freeName(formatMessage(msg.newRank), department.ranks.map((r) => r.display_name)),
        color: NEW_COLOR,
        permissions: [],
    }));

    return (
        <section
            className='TeamDepartments__card'
            data-testid='departmentCard'
        >
            <div className='TeamDepartments__header'>
                {dragHandleProps ? (
                    <span
                        className='TeamDepartments__handle'
                        {...dragHandleProps}
                        aria-label={formatMessage(msg.dragDepartment, {name: department.name})}
                    >
                        <DragVerticalIcon size={18}/>
                    </span>
                ) : <span className='TeamDepartments__handle'/>}
                <ColorDot
                    color={department.color}
                    label={formatMessage(msg.departmentColor, {name: department.name})}
                    onSave={(color) => patchDepartment({color})}
                />
                <InlineName
                    className='TeamDepartments__departmentName'
                    value={department.name}
                    label={formatMessage(msg.departmentName)}
                    onSave={(name) => patchDepartment({name})}
                />
                <span/>
                {RANK_PERMISSIONS.map((p) => (
                    <span
                        key={p}
                        className='TeamDepartments__column'
                    >
                        <FormattedMessage {...permissionLabels[p]}/>
                    </span>
                ))}
                {department.is_studio ? <span/> : (
                    <button
                        type='button'
                        className='btn btn-icon btn-sm'
                        aria-label={formatMessage(msg.deleteDepartment, {name: department.name})}
                        onClick={() => onDelete({kind: 'department', id: department.id, name: department.name, members: departmentMembers})}
                    >
                        <TrashCanOutlineIcon size={16}/>
                    </button>
                )}
            </div>
            <Droppable
                droppableId={`ranks-${department.id}`}
                type='rank'
            >
                {(droppable) => (
                    <ol
                        ref={droppable.innerRef}
                        {...droppable.droppableProps}
                        className='TeamDepartments__ranks'
                    >
                        {department.ranks.map((rank, index) => {
                            const permissions = pending[rank.id] ?? rank.permissions;
                            return (
                                <Draggable
                                    key={rank.id}
                                    draggableId={rank.id}
                                    index={index}
                                >
                                    {(draggable) => (
                                        <li
                                            ref={draggable.innerRef}
                                            {...draggable.draggableProps}
                                            className='TeamDepartments__rank'
                                        >
                                            <span
                                                className='TeamDepartments__handle'
                                                {...draggable.dragHandleProps}
                                                aria-label={formatMessage(msg.dragRank, {name: rank.display_name})}
                                            >
                                                <DragVerticalIcon size={18}/>
                                            </span>
                                            <ColorDot
                                                color={rank.color}
                                                label={formatMessage(msg.rankColor, {name: rank.display_name})}
                                                onSave={(color) => patchRank(rank, {color})}
                                            />
                                            <InlineName
                                                className='TeamDepartments__rankName'
                                                value={rank.display_name}
                                                label={formatMessage(msg.rankName)}
                                                onSave={(name) => patchRank(rank, {display_name: name})}
                                            />
                                            <span className='TeamDepartments__members'>
                                                <FormattedMessage
                                                    {...msg.members}
                                                    values={{count: rank.member_count}}
                                                />
                                            </span>
                                            {RANK_PERMISSIONS.map((p) => (
                                                <span
                                                    key={p}
                                                    className='TeamDepartments__column'
                                                >
                                                    <input
                                                        type='checkbox'
                                                        aria-label={`${formatMessage(permissionLabels[p])}: ${rank.display_name}`}
                                                        checked={permissions.includes(p)}
                                                        onChange={() => toggle(rank, p)}
                                                    />
                                                </span>
                                            ))}
                                            <button
                                                type='button'
                                                className='btn btn-icon btn-sm'
                                                aria-label={formatMessage(msg.deleteRank, {name: rank.display_name})}
                                                onClick={() => onDelete({kind: 'rank', id: rank.id, name: rank.display_name, members: rank.member_count})}
                                            >
                                                <TrashCanOutlineIcon size={16}/>
                                            </button>
                                        </li>
                                    )}
                                </Draggable>
                            );
                        })}
                        {droppable.placeholder}
                    </ol>
                )}
            </Droppable>
            <div className='TeamDepartments__footer'>
                {error && <span className='TeamDepartments__error'>{error}</span>}
                <button
                    type='button'
                    className='btn btn-tertiary btn-sm'
                    aria-label={formatMessage(msg.addRankTo, {name: department.name})}
                    onClick={addRank}
                >
                    <PlusIcon size={14}/>
                    <FormattedMessage {...msg.addRank}/>
                </button>
            </div>
        </section>
    );
};

export const permissionLabels = defineMessages({
    manage_tasks: {id: 'team_settings.departments.permission.manage_tasks', defaultMessage: 'Tasks'},
    manage_daily_reports: {id: 'team_settings.departments.permission.manage_daily_reports', defaultMessage: 'Daily reports'},
    manage_revisions: {id: 'team_settings.departments.permission.manage_revisions', defaultMessage: 'Revisions'},
    assign_custom_roles: {id: 'team_settings.departments.permission.assign_custom_roles', defaultMessage: 'Give ranks'},
});

const msg = defineMessages({
    newRank: {id: 'team_settings.departments.new_rank', defaultMessage: 'New rank'},
    addRank: {id: 'team_settings.departments.add_rank', defaultMessage: 'Rank'},
    addRankTo: {id: 'team_settings.departments.add_rank_to', defaultMessage: 'Add rank to {name}'},
    departmentName: {id: 'team_settings.departments.department_name', defaultMessage: 'Department name'},
    departmentColor: {id: 'team_settings.departments.department_color', defaultMessage: 'Color of {name}'},
    deleteDepartment: {id: 'team_settings.departments.delete_department', defaultMessage: 'Delete {name}'},
    dragDepartment: {id: 'team_settings.departments.drag_department', defaultMessage: 'Drag {name} to reorder'},
    rankName: {id: 'team_settings.departments.rank_name', defaultMessage: 'Rank name'},
    rankColor: {id: 'team_settings.departments.rank_color', defaultMessage: 'Color of {name}'},
    deleteRank: {id: 'team_settings.departments.delete_rank', defaultMessage: 'Delete {name}'},
    dragRank: {id: 'team_settings.departments.drag_rank', defaultMessage: 'Drag {name} to change its rank'},
    members: {id: 'team_settings.departments.members', defaultMessage: '{count, plural, one {# member} other {# members}}'},
});

export default DepartmentCard;
