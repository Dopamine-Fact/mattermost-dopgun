// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage, defineMessages, useIntl} from 'react-intl';

import {GenericModal} from '@mattermost/components';
import type {CustomRole, CustomRoleCreate} from '@mattermost/types/custom_roles';
import {CUSTOM_ROLE_PERMISSIONS} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

const COLOR_RE = /^#[0-9a-f]{6}$/i;

type Props = {

    /** undefined to create a role */
    role?: CustomRole;

    /** existing departments, offered as suggestions */
    departments: string[];
    onExited: () => void;
};

export default function CustomRoleModal({role, departments, onExited}: Props) {
    const {formatMessage} = useIntl();
    const [name, setName] = useState(role?.display_name ?? '');
    const [color, setColor] = useState(role?.color ?? '#1e90ff');
    const [department, setDepartment] = useState(role?.department ?? '');
    const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const togglePermission = (p: string) => setPermissions((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

    const save = async () => {
        if (!name.trim()) {
            setError(formatMessage(msg.nameRequired));
            return;
        }
        if (!COLOR_RE.test(color.trim())) {
            setError(formatMessage(msg.colorInvalid));
            return;
        }
        const body: CustomRoleCreate = {
            display_name: name.trim(),
            color: color.trim().toLowerCase(),
            department: department.trim(),

            // Keep the whitelist's order so the request does not depend on click order.
            permissions: CUSTOM_ROLE_PERMISSIONS.filter((p) => permissions.includes(p)),
        };
        setSaving(true);
        try {
            if (role) {
                await Client4.patchCustomRole(role.id, body);
            } else {
                await Client4.createCustomRole(body);
            }
            onExited();
        } catch (e) {
            setError((e as Error).message);
            setSaving(false);
        }
    };

    return (
        <GenericModal
            id='customRoleModal'
            className='custom-role-modal'
            compassDesign={true}
            modalHeaderText={formatMessage(role ? msg.editTitle : msg.addTitle)}
            confirmButtonText={formatMessage({id: 'save', defaultMessage: 'Save'})}
            handleConfirm={save}
            handleCancel={onExited}
            onExited={onExited}
            autoCloseOnConfirmButton={false}
            isConfirmDisabled={saving}
            errorText={error}
        >
            <div className='custom-role-modal__form'>
                <label className='custom-role-modal__field'>
                    <span><FormattedMessage {...msg.name}/></span>
                    <input
                        className='form-control'
                        value={name}
                        maxLength={64}
                        onChange={(e) => setName(e.target.value)}
                    />
                </label>
                <div className='custom-role-modal__field'>
                    <label htmlFor='customRoleColor'><FormattedMessage {...msg.color}/></label>
                    <div className='custom-role-modal__color'>
                        <input
                            type='color'
                            aria-hidden={true}
                            tabIndex={-1}
                            value={COLOR_RE.test(color) ? color.toLowerCase() : '#000000'}
                            onChange={(e) => setColor(e.target.value)}
                        />
                        <input
                            id='customRoleColor'
                            className='form-control'
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                        />
                    </div>
                </div>
                <label className='custom-role-modal__field'>
                    <span><FormattedMessage {...msg.department}/></span>
                    <input
                        className='form-control'
                        list='customRoleDepartments'
                        value={department}
                        maxLength={64}
                        placeholder={formatMessage(msg.departmentPlaceholder)}
                        onChange={(e) => setDepartment(e.target.value)}
                    />
                    <datalist id='customRoleDepartments'>
                        {departments.map((d) => (
                            <option
                                key={d}
                                value={d}
                            />
                        ))}
                    </datalist>
                </label>
                <fieldset className='custom-role-modal__permissions'>
                    <legend><FormattedMessage {...msg.permissions}/></legend>
                    {CUSTOM_ROLE_PERMISSIONS.map((p) => (
                        <label
                            key={p}
                            className='custom-role-modal__permission'
                        >
                            <input
                                type='checkbox'
                                checked={permissions.includes(p)}
                                onChange={() => togglePermission(p)}
                            />
                            <span>
                                <strong><FormattedMessage {...permissionMessages[p].name}/></strong>
                                <FormattedMessage {...permissionMessages[p].description}/>
                            </span>
                        </label>
                    ))}
                </fieldset>
            </div>
        </GenericModal>
    );
}

const msg = defineMessages({
    addTitle: {id: 'admin.custom_roles.modal.add_title', defaultMessage: 'Add role'},
    editTitle: {id: 'admin.custom_roles.modal.edit_title', defaultMessage: 'Edit role'},
    name: {id: 'admin.custom_roles.modal.name', defaultMessage: 'Name'},
    color: {id: 'admin.custom_roles.modal.color', defaultMessage: 'Color'},
    department: {id: 'admin.custom_roles.modal.department', defaultMessage: 'Department'},
    departmentPlaceholder: {id: 'admin.custom_roles.modal.department_placeholder', defaultMessage: 'None: ranks across every department'},
    permissions: {id: 'admin.custom_roles.modal.permissions', defaultMessage: 'Permissions'},
    nameRequired: {id: 'admin.custom_roles.modal.name_required', defaultMessage: 'Enter a name.'},
    colorInvalid: {id: 'admin.custom_roles.modal.color_invalid', defaultMessage: 'Use a hex color like #1e90ff.'},
});

const permissionMessages = {
    manage_tasks: defineMessages({
        name: {id: 'admin.custom_roles.permission.manage_tasks', defaultMessage: 'Manage tasks'},
        description: {id: 'admin.custom_roles.permission.manage_tasks.description', defaultMessage: 'Create, assign and delete tasks and task sections.'},
    }),
    manage_daily_reports: defineMessages({
        name: {id: 'admin.custom_roles.permission.manage_daily_reports', defaultMessage: 'Manage daily reports'},
        description: {id: 'admin.custom_roles.permission.manage_daily_reports.description', defaultMessage: 'See, approve and reject the daily reports of lower-ranked members.'},
    }),
    manage_revisions: defineMessages({
        name: {id: 'admin.custom_roles.permission.manage_revisions', defaultMessage: 'Manage revisions'},
        description: {id: 'admin.custom_roles.permission.manage_revisions.description', defaultMessage: 'Add, assign and delete revisions in revision channels.'},
    }),
    assign_custom_roles: defineMessages({
        name: {id: 'admin.custom_roles.permission.assign_custom_roles', defaultMessage: 'Assign roles'},
        description: {id: 'admin.custom_roles.permission.assign_custom_roles.description', defaultMessage: 'Give and remove roles ranked below their own.'},
    }),
};
