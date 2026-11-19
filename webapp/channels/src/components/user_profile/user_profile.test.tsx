// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Department, Rank} from '@mattermost/types/custom_roles';
import type {UserProfile as UserProfileType} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';
import {Preferences} from 'mattermost-redux/constants';

import {render, screen, waitFor} from 'tests/react_testing_utils';

import UserProfile from './user_profile';

jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

const rank = (id: string, departmentId: string, color: string, memberIds: string[]) => ({
    id, role_name: 'rk_' + id, department_id: departmentId, color, member_ids: memberIds,
} as Rank);
const department = (id: string, ranks: Rank[]) => ({id, ranks} as Department);

// carol is Producer (studio-wide) and Lead; alice is Mid; dave has no rank
const departments = [
    department('s', [rank('p', 's', '#00aa00', ['carol_id'])]),
    department('d1', [rank('l', 'd1', '#aa0000', ['carol_id']), rank('m', 'd1', '#0000aa', ['alice_id'])]),
];

describe('components/UserProfile', () => {
    const baseProps = {
        displayName: 'nickname',
        isBusy: false,
        isMobileView: false,
        user: {username: 'username'} as UserProfileType,
        userId: 'user_id',
        theme: Preferences.THEMES.onyx,
        isShared: false,
        remoteNames: [],
        teamId: '',
        actions: {
            fetchRemoteClusterInfo: jest.fn(),
        },
        dispatch: jest.fn(),
    };

    test('should render ImportedInactiveTag for imported inactive user', () => {
        const props = {
            ...baseProps,
            user: {username: 'username', props: {importedInactive: 'true'}} as unknown as UserProfileType,
        };
        render(<UserProfile {...props}/>);
        expect(screen.getByText('IMPORTED - INACTIVE')).toBeInTheDocument();
    });

    test('should not render ImportedInactiveTag for regular user', () => {
        render(<UserProfile {...baseProps}/>);
        expect(screen.queryByText('IMPORTED - INACTIVE')).not.toBeInTheDocument();
    });

    describe('rank color', () => {
        beforeEach(() => {
            jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue(departments);
        });

        const renderFor = (id: string) => render(
            <UserProfile
                {...baseProps}
                user={{id, username: id} as UserProfileType}
                userId={id}
                teamId='team1'
            />,
        );

        test('a ranked user name takes their rank color without colorize', async () => {
            renderFor('alice_id');
            await waitFor(() => expect(screen.getByText('nickname')).toHaveStyle({color: '#0000aa'}));
        });

        test('the first rank in department order wins', async () => {
            renderFor('carol_id');
            await waitFor(() => expect(screen.getByText('nickname')).toHaveStyle({color: '#00aa00'}));
        });

        test('a user without a rank keeps no inline color', async () => {
            renderFor('alice_id');
            renderFor('dave_id');

            // once alice is colored the departments are in, so dave's plain name is final
            const [alice, dave] = screen.getAllByText('nickname');
            await waitFor(() => expect(alice).toHaveStyle({color: '#0000aa'}));
            expect(dave.style.color).toBe('');
        });
    });
});
