// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';
import {DragDropContext, Draggable, Droppable} from '@hello-pangea/dnd';
import React, {useEffect, useState} from 'react';
import {FormattedMessage, defineMessages, useIntl} from 'react-intl';

import {PlusIcon} from '@mattermost/compass-icons/components';
import {GenericModal} from '@mattermost/components';
import type {Department} from '@mattermost/types/custom_roles';
import type {Team} from '@mattermost/types/teams';

import {Client4} from 'mattermost-redux/client';

import {refreshTeamDepartments, useTeamDepartments} from 'components/profile_popover/use_custom_roles';

import DepartmentCard, {NEW_COLOR, freeName} from './department_card';

import './team_departments_tab.scss';

type Props = {
    team: Team;
};

type DeleteTarget = {kind: 'department' | 'rank'; id: string; name: string};

const move = <T, >(list: T[], from: number, to: number) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

const TeamDepartmentsTab = ({team}: Props) => {
    const {formatMessage} = useIntl();
    const loaded = useTeamDepartments(team.id);

    // Mirrors the server list so a drop shows at once, before the reorder call returns.
    const [departments, setDepartments] = useState<Department[]>(loaded);
    useEffect(() => setDepartments(loaded), [loaded]);
    const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
    const [error, setError] = useState('');

    const run = async (write: () => Promise<unknown>) => {
        setError('');
        try {
            await write();
        } catch (e) {
            setError((e as Error).message);
        }
        await refreshTeamDepartments(team.id);
    };

    const studio = departments.filter((d) => d.is_studio);
    const others = departments.filter((d) => !d.is_studio);

    const handleDragEnd = (result: DropResult) => {
        const {source, destination, type} = result;
        if (!destination || destination.droppableId !== source.droppableId || destination.index === source.index) {
            return;
        }
        if (type === 'department') {
            const next = [...studio, ...move(others, source.index, destination.index)];
            setDepartments(next);
            run(() => Client4.reorderDepartments(team.id, next.map((d) => d.id)));
            return;
        }
        const departmentId = source.droppableId.replace(/^ranks-/, '');
        const ranks = move(departments.find((d) => d.id === departmentId)?.ranks ?? [], source.index, destination.index);
        setDepartments(departments.map((d) => (d.id === departmentId ? {...d, ranks} : d)));
        run(() => Client4.reorderRanks(team.id, departmentId, ranks.map((r) => r.id)));
    };

    const addDepartment = () => run(() => Client4.createDepartment(team.id, {
        name: freeName(formatMessage(msg.newDepartment), departments.map((d) => d.name)),
        color: NEW_COLOR,
    }));

    const confirmDelete = () => {
        if (!deleting) {
            return;
        }
        const {kind, id} = deleting;
        run(() => (kind === 'department' ? Client4.deleteDepartment(team.id, id) : Client4.deleteRank(team.id, id)));
    };

    return (
        <div className='TeamDepartments'>
            <div className='TeamDepartments__top'>
                <p className='TeamDepartments__intro'>
                    <FormattedMessage {...msg.intro}/>
                </p>
                <button
                    type='button'
                    className='btn btn-primary btn-sm'
                    onClick={addDepartment}
                >
                    <PlusIcon size={14}/>
                    <FormattedMessage {...msg.addDepartment}/>
                </button>
            </div>
            {error && <p className='TeamDepartments__error'>{error}</p>}
            <DragDropContext onDragEnd={handleDragEnd}>
                {studio.map((d) => (
                    <DepartmentCard
                        key={d.id}
                        teamId={team.id}
                        department={d}
                        onDelete={setDeleting}
                    />
                ))}
                <Droppable
                    droppableId='departments'
                    type='department'
                >
                    {(droppable) => (
                        <div
                            ref={droppable.innerRef}
                            {...droppable.droppableProps}
                        >
                            {others.map((d, index) => (
                                <Draggable
                                    key={d.id}
                                    draggableId={d.id}
                                    index={index}
                                >
                                    {(draggable) => (
                                        <div
                                            ref={draggable.innerRef}
                                            {...draggable.draggableProps}
                                        >
                                            <DepartmentCard
                                                teamId={team.id}
                                                department={d}
                                                dragHandleProps={draggable.dragHandleProps}
                                                onDelete={setDeleting}
                                            />
                                        </div>
                                    )}
                                </Draggable>
                            ))}
                            {droppable.placeholder}
                        </div>
                    )}
                </Droppable>
            </DragDropContext>
            {deleting && (
                <GenericModal
                    id='deleteDepartmentModal'
                    compassDesign={true}
                    destructive={true}
                    modalHeaderText={formatMessage(msg.deleteTitle, {name: deleting.name})}
                    confirmButtonText={formatMessage(msg.deleteConfirm)}
                    handleConfirm={confirmDelete}
                    handleCancel={() => setDeleting(null)}
                    onExited={() => setDeleting(null)}
                >
                    <FormattedMessage {...(deleting.kind === 'department' ? msg.deleteDepartmentBody : msg.deleteRankBody)}/>
                </GenericModal>
            )}
        </div>
    );
};

const msg = defineMessages({
    intro: {id: 'team_settings.departments.intro', defaultMessage: 'Ranks higher in a department outrank the ones below them. Stüdyo geneli ranks outrank every department. A tick saves at once.'},
    addDepartment: {id: 'team_settings.departments.add_department', defaultMessage: 'Department'},
    newDepartment: {id: 'team_settings.departments.new_department', defaultMessage: 'New department'},
    deleteTitle: {id: 'team_settings.departments.delete_title', defaultMessage: 'Delete {name}?'},
    deleteConfirm: {id: 'team_settings.departments.delete_confirm', defaultMessage: 'Delete'},
    deleteDepartmentBody: {id: 'team_settings.departments.delete_department_body', defaultMessage: 'Its ranks are deleted too, and their members lose them.'},
    deleteRankBody: {id: 'team_settings.departments.delete_rank_body', defaultMessage: 'Members holding this rank lose it.'},
});

export default TeamDepartmentsTab;
