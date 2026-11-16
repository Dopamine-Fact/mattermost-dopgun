// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {DailyReport} from '@mattermost/types/daily_reports';

import {Client4} from 'mattermost-redux/client';
import * as roles from 'mattermost-redux/selectors/entities/roles';

import {act, fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import DailyReports, {todayIn} from './daily_reports';

jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('mattermost-redux/selectors/entities/roles', () => ({
    ...jest.requireActual('mattermost-redux/selectors/entities/roles'),
    haveITeamPermission: jest.fn(() => false),
}));
jest.mock('client/web_websocket_client', () => ({
    addMessageListener: jest.fn(),
    removeMessageListener: jest.fn(),
}));

const me = TestHelper.getUserMock({id: 'me', username: 'me'});
const ayse = TestHelper.getUserMock({id: 'u2', username: 'ayse'});
const mehmet = TestHelper.getUserMock({id: 'u3', username: 'mehmet'});

const report = (extra: Partial<DailyReport>): DailyReport => ({
    id: 'r1',
    team_id: 'team1',
    user_id: 'u2',
    date: '2026-11-16',
    message: 'Wrote the parser',
    tasks: [{id: 't1', title: 'Parser task', section_name: 'Backend'}],
    status: 'pending',
    auto_approved: false,
    approved_by: '',
    approved_at: 0,
    create_at: 1,
    update_at: 1,
    ...extra,
});

const renderPage = (canApprove: boolean) => {
    (roles.haveITeamPermission as jest.Mock).mockReturnValue(canApprove);
    return renderWithContext(<DailyReports/>, {
        entities: {
            general: {config: {}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', daily_reports_enabled: true})},
            },
            users: {
                currentUserId: 'me',
                profiles: {me, u2: ayse, u3: mehmet},
                profilesInTeam: {team1: new Set(['me', 'u2', 'u3'])},
            },
        },
    });
};

describe('DailyReports', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(Client4, 'getDailyReports').mockResolvedValue([]);
    });

    test('submits the message from the My report tab', async () => {
        const submit = jest.spyOn(Client4, 'submitDailyReport').mockResolvedValue(report({user_id: 'me', message: 'Did things'}));
        renderPage(false);

        fireEvent.change(await screen.findByRole('textbox', {name: 'Your report for today'}), {target: {value: 'Did things'}});
        fireEvent.click(screen.getByRole('button', {name: 'Submit'}));

        await waitFor(() => expect(submit).toHaveBeenCalledWith('team1', 'Did things'));
        expect(await screen.findByRole('button', {name: 'Update'})).toBeInTheDocument();
    });

    test('hides the Team reports tab without permission', async () => {
        renderPage(false);
        await screen.findByRole('tab', {name: 'My report'});
        expect(screen.queryByRole('tab', {name: 'Team reports'})).not.toBeInTheDocument();
    });

    test('approves a pending row', async () => {
        jest.spyOn(Client4, 'getDailyReports').mockResolvedValue([report({})]);
        const approve = jest.spyOn(Client4, 'approveDailyReport').mockResolvedValue(report({status: 'approved'}));
        renderPage(true);

        fireEvent.click(await screen.findByRole('tab', {name: 'Team reports'}));
        expect(await screen.findByText('Wrote the parser')).toBeInTheDocument();
        expect(screen.getAllByText('Missing')).toHaveLength(2); // me and mehmet have no report
        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'Approve'}));
        });

        expect(approve).toHaveBeenCalledWith('r1');
    });

    test('labels an auto-approved row', async () => {
        jest.spyOn(Client4, 'getDailyReports').mockResolvedValue([report({status: 'approved', auto_approved: true})]);
        renderPage(true);

        fireEvent.click(await screen.findByRole('tab', {name: 'Team reports'}));
        expect(await screen.findByText('Auto-approved')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Approve'})).not.toBeInTheDocument();
    });
});

describe('todayIn', () => {
    const instant = new Date('2026-11-16T23:30:00Z');

    test('uses the team timezone for the date boundary', () => {
        expect(todayIn('Europe/Istanbul', instant)).toBe('2026-11-17');
        expect(todayIn('America/New_York', instant)).toBe('2026-11-16');
    });

    test('falls back to the browser timezone when empty or invalid', () => {
        const local = todayIn(undefined, instant);
        expect(todayIn('', instant)).toBe(local);
        expect(todayIn('Not/AZone', instant)).toBe(local);
    });
});
