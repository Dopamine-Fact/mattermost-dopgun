// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {StatusPeriod} from '@mattermost/types/status_periods';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import BreaksReport from './breaks_report';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

const state = {
    entities: {
        general: {config: {WorkdayStart: '09:00', WorkdayEnd: '18:00'}},
        users: {
            currentUserId: 'admin',
            profiles: {
                u1: TestHelper.getUserMock({id: 'u1', username: 'ali'}),
                u2: TestHelper.getUserMock({id: 'u2', username: 'ayse'}),
            },
        },
    },
};

const period = (p: Partial<StatusPeriod>): StatusPeriod => ({id: Math.random().toString(), user_id: 'u1', kind: 'active', start_at: 0, end_at: 0, ...p});

describe('BreaksReport', () => {
    afterEach(() => jest.restoreAllMocks());

    test('lists each user\'s day sorted by break total, longest first', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(at(20, 20));
        const spy = jest.spyOn(Client4, 'getStatusPeriods').mockResolvedValue([
            period({user_id: 'u1', kind: 'active', start_at: at(20, 9, 5), end_at: at(20, 12)}),
            period({user_id: 'u1', kind: 'away', start_at: at(20, 12), end_at: at(20, 12, 30)}),
            period({user_id: 'u1', kind: 'active', start_at: at(20, 12, 30), end_at: at(20, 19)}),
            period({user_id: 'u2', kind: 'active', start_at: at(20, 8, 50), end_at: at(20, 10)}),
            period({user_id: 'u2', kind: 'away', start_at: at(20, 10), end_at: at(20, 10, 40)}),
            period({user_id: 'u2', kind: 'away', start_at: at(20, 14), end_at: at(20, 14, 20)}),
        ]);

        renderWithContext(<BreaksReport/>, state);

        expect(spy).toHaveBeenCalledWith(at(20, 0), at(21, 0));
        ['User', 'First open', 'Breaks', 'Break count', 'Overtime'].forEach((h) => expect(screen.getByRole('columnheader', {name: h})).toBeInTheDocument());

        await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
        const [, first, second] = screen.getAllByRole('row');
        expect(within(first).getAllByRole('cell').map((c) => c.textContent)).toEqual(['ayse', '08:50', '01:00', '2', '00:00']);
        expect(within(second).getAllByRole('cell').map((c) => c.textContent)).toEqual(['ali', '09:05', '00:30', '1', '01:00']);
    });

    test('shows a dash as the first open of a user with no active time', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(at(20, 20));
        jest.spyOn(Client4, 'getStatusPeriods').mockResolvedValue([
            period({user_id: 'u1', kind: 'away', start_at: at(20, 10), end_at: at(20, 10, 30)}),
        ]);

        renderWithContext(<BreaksReport/>, state);

        await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
        expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[1].textContent).toBe('—');
    });

    test('changing the date refetches that local day', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(at(20, 20));
        const spy = jest.spyOn(Client4, 'getStatusPeriods').mockResolvedValue([]);

        renderWithContext(<BreaksReport/>, state);
        fireEvent.change(screen.getByLabelText('Date'), {target: {value: '2026-11-18'}});

        await waitFor(() => expect(spy).toHaveBeenLastCalledWith(at(18, 0), at(19, 0)));
    });
});
