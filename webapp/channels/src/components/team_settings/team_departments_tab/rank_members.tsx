// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import {CloseIcon} from '@mattermost/compass-icons/components';
import type {Department, Rank} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getProfilesInTeam} from 'mattermost-redux/selectors/entities/users';
import {displayUsername, isGuest} from 'mattermost-redux/utils/user_utils';

import {ranksHeldBy} from 'components/profile_popover/use_custom_roles';
import {AssigneeAvatar} from 'components/tasks/task_bits';

import type {GlobalState} from 'types/store';

type Props = {
    teamId: string;
    rank: Rank;
    departments: Department[];
    run: (write: () => Promise<unknown>) => Promise<void>;
};

/** The people holding a rank, each removable, and a picker that gives it to someone else. */
const RankMembers = ({teamId, rank, departments, run}: Props) => {
    const {formatMessage} = useIntl();
    const profiles = useSelector((state: GlobalState) => getProfilesInTeam(state, teamId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);

    const holders = profiles.filter((u) => rank.member_ids.includes(u.id));
    const candidates = profiles.filter((u) => !rank.member_ids.includes(u.id) && !u.is_bot && !u.delete_at && !isGuest(u.roles));

    // the server takes a person's whole set of ranks; a department allows one, so the new one replaces theirs there
    const save = (userId: string, rankIds: string[]) => run(() => Client4.setMemberRanks(teamId, userId, rankIds));
    const give = (userId: string) => save(userId, [
        ...ranksHeldBy(departments, userId).filter((r) => r.department_id !== rank.department_id).map((r) => r.id),
        rank.id,
    ]);
    const take = (userId: string) => save(userId, ranksHeldBy(departments, userId).filter((r) => r.id !== rank.id).map((r) => r.id));

    return (
        <div className='TeamDepartments__people'>
            {holders.map((user) => {
                const name = displayUsername(user, nameDisplay);
                return (
                    <span
                        key={user.id}
                        className='TeamDepartments__person'
                    >
                        <AssigneeAvatar user={user}/>
                        <span>{name}</span>
                        <button
                            type='button'
                            className='btn btn-icon btn-xs'
                            aria-label={formatMessage(msg.remove, {name, rank: rank.display_name})}
                            onClick={() => take(user.id)}
                        >
                            <CloseIcon size={12}/>
                        </button>
                    </span>
                );
            })}
            <select
                className='TeamDepartments__addPerson'
                aria-label={formatMessage(msg.addTo, {rank: rank.display_name})}
                value=''
                onChange={(e) => e.target.value && give(e.target.value)}
            >
                <option value=''>{formatMessage(msg.add)}</option>
                {candidates.map((user) => (
                    <option
                        key={user.id}
                        value={user.id}
                    >
                        {displayUsername(user, nameDisplay)}
                    </option>
                ))}
            </select>
        </div>
    );
};

const msg = defineMessages({
    add: {id: 'team_settings.departments.add_member', defaultMessage: '+ Add person'},
    addTo: {id: 'team_settings.departments.add_member_to', defaultMessage: 'Add person to {rank}'},
    remove: {id: 'team_settings.departments.remove_member', defaultMessage: 'Remove {name} from {rank}'},
});

export default RankMembers;
