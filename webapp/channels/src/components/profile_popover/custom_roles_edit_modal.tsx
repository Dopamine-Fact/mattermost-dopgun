// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {UserProfile} from '@mattermost/types/users';

import {UserTypes} from 'mattermost-redux/action_types';
import {Client4} from 'mattermost-redux/client';
import {getCurrentUser} from 'mattermost-redux/selectors/entities/users';
import {isSystemAdmin} from 'mattermost-redux/utils/user_utils';

import {outranks, rolesOf, useCustomRoles} from './use_custom_roles';

type Props = {
    user: UserProfile;
    onExited: () => void;
};

const CustomRolesEditModal = ({user, onExited}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const viewer = useSelector(getCurrentUser);
    const roles = useCustomRoles();
    const [checked, setChecked] = useState(() => new Set(user.roles.split(' ')));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const admin = isSystemAdmin(viewer.roles);
    const mine = rolesOf(roles, viewer.roles);
    const canGive = (r: typeof roles[number]) => admin || mine.some((m) => outranks(m, r));

    // Roles the viewer may not give still show, locked, so the user sees everything they hold and keeps it.
    const shown = roles.filter((r) => canGive(r) || checked.has(r.role_name));

    const toggle = (name: string) => setChecked((prev) => {
        const next = new Set(prev);
        if (!next.delete(name)) {
            next.add(name);
        }
        return next;
    });

    const save = async () => {
        setSaving(true);
        try {
            const updated = await Client4.setUserCustomRoles(user.id, roles.filter((r) => checked.has(r.role_name)).map((r) => r.id));
            dispatch({type: UserTypes.RECEIVED_PROFILE, data: updated});
            onExited();
        } catch (e) {
            setError((e as Error).message);
            setSaving(false);
        }
    };

    return (
        <GenericModal
            id='customRolesEditModal'
            compassDesign={true}
            modalHeaderText={formatMessage({id: 'user_profile.custom_roles.edit_title', defaultMessage: 'Roles of {name}'}, {name: user.username})}
            confirmButtonText={formatMessage({id: 'save', defaultMessage: 'Save'})}
            handleConfirm={save}
            handleCancel={onExited}
            onExited={onExited}
            autoCloseOnConfirmButton={false}
            isConfirmDisabled={saving}
            errorText={error}
        >
            <div className='custom-roles-edit'>
                {shown.map((r) => (
                    <label
                        key={r.id}
                        className='custom-roles-edit__role'
                    >
                        <input
                            type='checkbox'
                            checked={checked.has(r.role_name)}
                            disabled={!canGive(r)}
                            onChange={() => toggle(r.role_name)}
                        />
                        <span
                            className='custom-role-chip__dot'
                            style={{backgroundColor: r.color}}
                        />
                        {r.display_name}
                    </label>
                ))}
            </div>
        </GenericModal>
    );
};

export default CustomRolesEditModal;
