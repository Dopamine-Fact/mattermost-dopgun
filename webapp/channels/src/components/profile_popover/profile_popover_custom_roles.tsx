// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {haveITeamPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeamId, getTeamMember} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUser} from 'mattermost-redux/selectors/entities/users';
import {isGuest, isSystemAdmin} from 'mattermost-redux/utils/user_utils';

import {openModal} from 'actions/views/modals';

import {ModalIdentifiers} from 'utils/constants';

import type {GlobalState} from 'types/store';

import CustomRolesEditModal from './custom_roles_edit_modal';
import {ranksOf, useTeamDepartments} from './use_custom_roles';

type Props = {
    user: UserProfile;
    hide?: () => void;
};

const ProfilePopoverCustomRoles = ({user, hide}: Props) => {
    const dispatch = useDispatch();
    const teamId = useSelector(getCurrentTeamId);
    const departments = useTeamDepartments(teamId);
    const viewer = useSelector(getCurrentUser);

    // The popover fetches this member for the current team already.
    const member = useSelector((state: GlobalState) => getTeamMember(state, teamId, user.id));

    // The server refuses ranks for guests and bots, and your own unless you are a system admin.
    const mayAssign = useSelector((state: GlobalState) => Boolean(haveITeamPermission(state, teamId, Permissions.ASSIGN_CUSTOM_ROLES))) &&
        !user.is_bot && !isGuest(user.roles) && (user.id !== viewer.id || isSystemAdmin(viewer.roles));
    const [assignable, setAssignable] = useState<string[]>([]);
    useEffect(() => {
        setAssignable([]);
        if (!mayAssign || !teamId) {
            return undefined;
        }
        let live = true;
        Client4.getAssignableRanks(teamId, user.id).then((ids) => live && setAssignable(ids), () => {});
        return () => {
            live = false;
        };
    }, [mayAssign, teamId, user.id]);

    const held = ranksOf(departments, member?.roles ?? '');
    const canEdit = mayAssign && assignable.length > 0;

    if (user.is_bot || (held.length === 0 && !canEdit)) {
        return null;
    }

    const edit = () => {
        hide?.();
        dispatch(openModal({
            modalId: ModalIdentifiers.CUSTOM_ROLES_EDIT,
            dialogType: CustomRolesEditModal,
            dialogProps: {user, teamId, assignable},
        }));
    };

    return (
        <div className='custom-role-chips'>
            {held.map(({department, rank}) => (
                <span
                    key={rank.id}
                    className='custom-role-chip'
                    data-testid='customRoleChip'
                >
                    <span
                        className='custom-role-chip__dot'
                        style={{backgroundColor: rank.color}}
                    />
                    {`${department.name} · ${rank.display_name}`}
                </span>
            ))}
            {canEdit && (
                <button
                    type='button'
                    className='btn btn-tertiary btn-xs'
                    onClick={edit}
                >
                    <FormattedMessage
                        id='user_profile.custom_roles.edit'
                        defaultMessage='Edit ranks'
                    />
                </button>
            )}
        </div>
    );
};

export default ProfilePopoverCustomRoles;
