// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {DropResult} from '@hello-pangea/dnd';
import {DragDropContext, Draggable, Droppable} from '@hello-pangea/dnd';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, defineMessages, useIntl} from 'react-intl';

import {DragVerticalIcon, PencilOutlineIcon, PlusIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import {GenericModal} from '@mattermost/components';
import type {CustomRole} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

import AdminHeader from 'components/widgets/admin_console/admin_header';
import AdminPanel from 'components/widgets/admin_console/admin_panel';

import WebSocketClient from 'client/web_websocket_client';

import CustomRoleModal from './custom_role_modal';

import {AdminWrapper, DangerText} from '../system_properties/controls';
import type {SearchableStrings} from '../types';

import './custom_roles.scss';

export const CUSTOM_ROLES_CHANGED = 'custom_roles_changed';

const byPosition = (a: CustomRole, b: CustomRole) => a.position - b.position;

export default function CustomRoles() {
    const {formatMessage} = useIntl();
    const [roles, setRoles] = useState<CustomRole[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
    const [deleting, setDeleting] = useState<CustomRole | null>(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const list = [...await Client4.getCustomRoles()].sort(byPosition);
            setRoles(list);
            const entries = await Promise.all(list.map(async (r) => {
                const stats = await Client4.getFilteredUsersStats({roles: [r.role_name], include_bots: false});
                return [r.id, stats.total_users_count] as const;
            }));
            setCounts(Object.fromEntries(entries));
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => {
        load();
        const listener = (msg: {event: string}) => {
            if (msg.event === CUSTOM_ROLES_CHANGED) {
                load();
            }
        };
        WebSocketClient.addMessageListener(listener);
        return () => WebSocketClient.removeMessageListener(listener);
    }, [load]);

    const departments = useMemo(() => [...new Set(roles.map((r) => r.department).filter(Boolean))].sort(), [roles]);

    const handleDragEnd = async (result: DropResult) => {
        if (!result.destination || result.destination.index === result.source.index) {
            return;
        }
        const next = [...roles];
        const [moved] = next.splice(result.source.index, 1);
        next.splice(result.destination.index, 0, moved);
        setRoles(next);
        try {
            setRoles([...await Client4.reorderCustomRoles(next.map((r) => r.id))].sort(byPosition));
        } catch (e) {
            setError((e as Error).message);
            load();
        }
    };

    const confirmDelete = async () => {
        if (!deleting) {
            return;
        }
        try {
            await Client4.deleteCustomRole(deleting.id);
            load();
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const memberCount = (r: CustomRole) => (
        counts[r.id] === undefined ? null : (
            <FormattedMessage
                {...msg.members}
                values={{count: counts[r.id]}}
            />
        )
    );

    return (
        <div
            className='wrapper--fixed custom-roles'
            data-testid='customRoles'
        >
            <AdminHeader>
                <FormattedMessage {...msg.pageTitle}/>
            </AdminHeader>
            <AdminWrapper>
                <AdminPanel
                    id='custom_roles'
                    title={msg.panelTitle}
                    subtitle={msg.panelSubtitle}
                    button={(
                        <button
                            type='button'
                            className='btn btn-primary'
                            onClick={() => setEditing('new')}
                        >
                            <PlusIcon size={16}/>
                            <FormattedMessage {...msg.add}/>
                        </button>
                    )}
                >
                    {error && <DangerText>{error}</DangerText>}
                    {roles.length === 0 ? (
                        <p className='custom-roles__empty'><FormattedMessage {...msg.empty}/></p>
                    ) : (
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId='custom-roles'>
                                {(droppable) => (
                                    <ol
                                        ref={droppable.innerRef}
                                        {...droppable.droppableProps}
                                        className='custom-roles__list'
                                    >
                                        {roles.map((r, index) => (
                                            <Draggable
                                                key={r.id}
                                                draggableId={r.id}
                                                index={index}
                                            >
                                                {(draggable) => (
                                                    <li
                                                        ref={draggable.innerRef}
                                                        {...draggable.draggableProps}
                                                        className='custom-roles__row'
                                                        data-testid='customRoleRow'
                                                    >
                                                        <span
                                                            className='custom-roles__handle'
                                                            {...draggable.dragHandleProps}
                                                            aria-label={formatMessage(msg.drag)}
                                                        >
                                                            <DragVerticalIcon size={18}/>
                                                        </span>
                                                        <span
                                                            className='custom-roles__dot'
                                                            data-testid='customRoleColor'
                                                            style={{backgroundColor: r.color}}
                                                        />
                                                        <span
                                                            className='custom-roles__name'
                                                            data-testid='customRoleName'
                                                        >
                                                            {r.display_name}
                                                        </span>
                                                        <span className='custom-roles__department'>{r.department}</span>
                                                        <span className='custom-roles__members'>{memberCount(r)}</span>
                                                        <button
                                                            type='button'
                                                            className='btn btn-icon btn-sm'
                                                            aria-label={formatMessage(msg.edit, {name: r.display_name})}
                                                            onClick={() => setEditing(r)}
                                                        >
                                                            <PencilOutlineIcon size={16}/>
                                                        </button>
                                                        <button
                                                            type='button'
                                                            className='btn btn-icon btn-sm'
                                                            aria-label={formatMessage(msg.delete, {name: r.display_name})}
                                                            onClick={() => setDeleting(r)}
                                                        >
                                                            <TrashCanOutlineIcon size={16}/>
                                                        </button>
                                                    </li>
                                                )}
                                            </Draggable>
                                        ))}
                                        {droppable.placeholder}
                                    </ol>
                                )}
                            </Droppable>
                        </DragDropContext>
                    )}
                </AdminPanel>
            </AdminWrapper>
            {editing && (
                <CustomRoleModal
                    role={editing === 'new' ? undefined : editing}
                    departments={departments}
                    onExited={() => {
                        setEditing(null);
                        load();
                    }}
                />
            )}
            {deleting && (
                <GenericModal
                    id='deleteCustomRoleModal'
                    compassDesign={true}
                    destructive={true}
                    modalHeaderText={formatMessage(msg.deleteTitle, {name: deleting.display_name})}
                    confirmButtonText={formatMessage(msg.deleteConfirm)}
                    handleConfirm={confirmDelete}
                    handleCancel={() => setDeleting(null)}
                    onExited={() => setDeleting(null)}
                >
                    <FormattedMessage
                        {...msg.deleteBody}
                        values={{count: counts[deleting.id] ?? 0}}
                    />
                </GenericModal>
            )}
        </div>
    );
}

const msg = defineMessages({
    pageTitle: {id: 'admin.custom_roles.page_title', defaultMessage: 'Roles'},
    panelTitle: {id: 'admin.custom_roles.panel_title', defaultMessage: 'Studio roles'},
    panelSubtitle: {id: 'admin.custom_roles.panel_subtitle', defaultMessage: 'Higher roles in the list outrank lower ones. A role with a department only outranks roles in the same department or without one. Drag to reorder.'},
    add: {id: 'admin.custom_roles.add', defaultMessage: 'Add role'},
    empty: {id: 'admin.custom_roles.empty', defaultMessage: 'No roles yet.'},
    drag: {id: 'admin.custom_roles.drag', defaultMessage: 'Drag to change rank'},
    edit: {id: 'admin.custom_roles.edit', defaultMessage: 'Edit {name}'},
    delete: {id: 'admin.custom_roles.delete', defaultMessage: 'Delete {name}'},
    members: {id: 'admin.custom_roles.members', defaultMessage: '{count, plural, one {# member} other {# members}}'},
    deleteTitle: {id: 'admin.custom_roles.delete_title', defaultMessage: 'Delete {name}?'},
    deleteBody: {id: 'admin.custom_roles.delete_body', defaultMessage: '{count, plural, one {# member} other {# members}} will lose this role.'},
    deleteConfirm: {id: 'admin.custom_roles.delete_confirm', defaultMessage: 'Delete'},
});

export const searchableStrings: SearchableStrings = [msg.pageTitle, msg.panelTitle, msg.panelSubtitle];
