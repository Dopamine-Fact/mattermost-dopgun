// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {UserProfile} from '@mattermost/types/users';

import {Permissions} from 'mattermost-redux/constants';
import {haveISystemPermission} from 'mattermost-redux/selectors/entities/roles';

import {openModal} from 'actions/views/modals';

import {ModalIdentifiers} from 'utils/constants';

import type {GlobalState} from 'types/store';

import CustomRolesEditModal from './custom_roles_edit_modal';
import {rolesOf, useCustomRoles} from './use_custom_roles';

type Props = {
    user: UserProfile;
    hide?: () => void;
};

const ProfilePopoverCustomRoles = ({user, hide}: Props) => {
    const dispatch = useDispatch();
    const roles = useCustomRoles();
    const canAssign = useSelector((state: GlobalState) => haveISystemPermission(state, {permission: Permissions.ASSIGN_CUSTOM_ROLES}));
    const held = rolesOf(roles, user.roles);

    if (user.is_bot || (held.length === 0 && !canAssign)) {
        return null;
    }

    const edit = () => {
        hide?.();
        dispatch(openModal({
            modalId: ModalIdentifiers.CUSTOM_ROLES_EDIT,
            dialogType: CustomRolesEditModal,
            dialogProps: {user},
        }));
    };

    return (
        <div className='custom-role-chips'>
            {held.map((r) => (
                <span
                    key={r.id}
                    className='custom-role-chip'
                    data-testid='customRoleChip'
                >
                    <span
                        className='custom-role-chip__dot'
                        style={{backgroundColor: r.color}}
                    />
                    {r.display_name}
                </span>
            ))}
            {canAssign && (
                <button
                    type='button'
                    className='btn btn-tertiary btn-xs'
                    onClick={edit}
                >
                    <FormattedMessage
                        id='user_profile.custom_roles.edit'
                        defaultMessage='Edit roles'
                    />
                </button>
            )}
        </div>
    );
};

export default ProfilePopoverCustomRoles;
