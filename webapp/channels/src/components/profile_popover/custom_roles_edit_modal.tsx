// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {UserProfile} from '@mattermost/types/users';

import {TeamTypes} from 'mattermost-redux/action_types';
import {Client4} from 'mattermost-redux/client';
import {getTeamMember} from 'mattermost-redux/selectors/entities/teams';

import type {GlobalState} from 'types/store';

import {ranksOf, useTeamDepartments} from './use_custom_roles';

type Props = {
    user: UserProfile;
    teamId: string;

    /** rank ids the viewer may give or take away, from Client4.getAssignableRanks */
    assignable: string[];
    onExited: () => void;
};

const CustomRolesEditModal = ({user, teamId, assignable, onExited}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const departments = useTeamDepartments(teamId);
    const member = useSelector((state: GlobalState) => getTeamMember(state, teamId, user.id));

    // department id → chosen rank id ('' for none); untouched departments keep what the member holds
    const [chosen, setChosen] = useState<Record<string, string>>({});
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const current: Record<string, string> = {};
    for (const {department, rank} of ranksOf(departments, member?.roles ?? '')) {
        current[department.id] = rank.id;
    }
    const valueOf = (departmentId: string) => chosen[departmentId] ?? current[departmentId] ?? '';
    const may = new Set(assignable);

    const save = async () => {
        setSaving(true);
        try {
            const rankIds = departments.map((d) => valueOf(d.id)).filter(Boolean);
            const updated = await Client4.setMemberRanks(teamId, user.id, rankIds);
            dispatch({type: TeamTypes.RECEIVED_MEMBER_IN_TEAM, data: updated});
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
            modalHeaderText={formatMessage({id: 'user_profile.custom_roles.edit_title', defaultMessage: 'Ranks of {name}'}, {name: user.username})}
            confirmButtonText={formatMessage({id: 'save', defaultMessage: 'Save'})}
            handleConfirm={save}
            handleCancel={onExited}
            onExited={onExited}
            autoCloseOnConfirmButton={false}
            isConfirmDisabled={saving}
            errorText={error}
        >
            <div className='custom-roles-edit'>
                {departments.map((d) => {
                    // A rank the viewer may not take away locks its whole department.
                    const locked = Boolean(current[d.id]) && !may.has(current[d.id]);
                    return (
                        <label
                            key={d.id}
                            className='custom-roles-edit__role'
                        >
                            <span
                                className='custom-role-chip__dot'
                                style={{backgroundColor: d.color}}
                            />
                            <span className='custom-roles-edit__department'>{d.name}</span>
                            <select
                                className='form-control'
                                aria-label={d.name}
                                value={valueOf(d.id)}
                                disabled={locked}
                                onChange={(e) => setChosen((prev) => ({...prev, [d.id]: e.target.value}))}
                            >
                                <option value=''>{'—'}</option>
                                {d.ranks.map((r) => (
                                    <option
                                        key={r.id}
                                        value={r.id}
                                        disabled={!may.has(r.id)}
                                    >
                                        {r.display_name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    );
                })}
            </div>
        </GenericModal>
    );
};

export default CustomRolesEditModal;
