// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {DailyReport} from '@mattermost/types/daily_reports';

import {Client4} from 'mattermost-redux/client';
import * as roles from 'mattermost-redux/selectors/entities/roles';

import WebSocketClient from 'client/web_websocket_client';
import {act, fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import DailyReports, {todayIn} from './daily_reports';

jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
    getMissingProfilesByIds: jest.fn(() => () => Promise.resolve({data: []})),
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

const bot = TestHelper.getUserMock({id: 'u4', username: 'bot', is_bot: true});
const exMember = TestHelper.getUserMock({id: 'u5', username: 'leaver'});

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
                profiles: {me, u2: ayse, u3: mehmet, u4: bot, u5: exMember},
                profilesInTeam: {team1: new Set(['me', 'u2', 'u3', 'u4'])},
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

    test('My report ignores other users reports, even for approvers', async () => {
        const list = jest.spyOn(Client4, 'getDailyReports').mockResolvedValue([report({message: 'Not mine'})]);
        renderPage(true);

        await screen.findByRole('textbox', {name: 'Your report for today'});
        await waitFor(() => expect(list).toHaveBeenCalledWith('team1', undefined, undefined, 'me'));
    });

    test('My report follows the server report when it changes', async () => {
        const list = jest.spyOn(Client4, 'getDailyReports').mockResolvedValue([report({user_id: 'me', message: 'v1'})]);
        renderPage(false);
        expect(await screen.findByDisplayValue('v1')).toBeInTheDocument();

        list.mockResolvedValue([report({user_id: 'me', message: 'v2', update_at: 2})]);
        const listener = (WebSocketClient.addMessageListener as jest.Mock).mock.calls.at(-1)[0];
        await act(async () => {
            listener({event: 'daily_report_updated'});
        });

        expect(await screen.findByDisplayValue('v2')).toBeInTheDocument();
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

    test('lists report authors who left the team but not bots without a report', async () => {
        jest.spyOn(Client4, 'getDailyReports').mockResolvedValue([report({user_id: 'u5', message: 'Handover notes'})]);
        renderPage(true);

        fireEvent.click(await screen.findByRole('tab', {name: 'Team reports'}));
        expect(await screen.findByText('Handover notes')).toBeInTheDocument();
        expect(screen.getByText('leaver')).toBeInTheDocument();
        expect(screen.queryByText('bot')).not.toBeInTheDocument();
        expect(screen.getAllByText('Missing')).toHaveLength(3); // me, ayse and mehmet
    });

    test('disables the CSV download when the range is reversed', async () => {
        renderPage(false);
        const link = await screen.findByText('Download CSV');
        expect(link.closest('a')).toHaveAttribute('href');

        const [from] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}$/);
        fireEvent.change(from, {target: {value: '2999-01-01'}});

        expect(link.closest('a')).not.toHaveAttribute('href');
        expect(link.closest('a')).toHaveAttribute('aria-disabled', 'true');
    });

    test('clears the error after a successful refresh', async () => {
        const list = jest.spyOn(Client4, 'getDailyReports').mockRejectedValue(new Error('boom'));
        renderPage(false);
        expect(await screen.findByRole('alert')).toHaveTextContent('boom');

        list.mockResolvedValue([]);
        const listener = (WebSocketClient.addMessageListener as jest.Mock).mock.calls.at(-1)[0];
        await act(async () => {
            listener({event: 'daily_report_updated'});
        });

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
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
