// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {StatusPeriod} from '@mattermost/types/status_periods';

import {Client4} from 'mattermost-redux/client';

import {act, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import StatusBox from './status_box';

const at = (h: number, m = 0) => new Date(2026, 10, 20, h, m).getTime();

function state(status: string) {
    const user = TestHelper.getUserMock({id: 'me', username: 'ayse', first_name: 'Ayşe', last_name: 'Kaya'});
    return {
        entities: {
            general: {config: {WorkdayStart: '09:00', WorkdayEnd: '18:00'}},
            users: {currentUserId: 'me', profiles: {me: user}, statuses: {me: status}},
        },
    };
}

function mockPeriods(periods: Array<Partial<StatusPeriod>>) {
    jest.spyOn(Client4, 'getStatusPeriods').mockResolvedValue(periods.map((p, i) => ({id: `p${i}`, user_id: 'me', start_at: 0, end_at: 0, kind: 'away', ...p})));
}

describe('StatusBox', () => {
    afterEach(() => jest.restoreAllMocks());

    test('shows the name and status', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(at(10));
        mockPeriods([]);
        renderWithContext(<StatusBox/>, state('online'));
        expect(screen.getByText('ayse')).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
    });

    test('shows no break counter while away inside working hours', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(at(12, 20));
        mockPeriods([{kind: 'away', start_at: at(12)}]);
        renderWithContext(<StatusBox/>, state('away'));
        await waitFor(() => expect(Client4.getStatusPeriods).toHaveBeenCalled());
        await act(() => Promise.resolve());
        expect(screen.queryByText(/On break/)).toBeNull();
        expect(screen.queryByText(/Breaks today/)).toBeNull();
    });

    test('shows overtime while active after the workday end', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(at(19));
        mockPeriods([{kind: 'active', start_at: at(17)}]);
        renderWithContext(<StatusBox/>, state('online'));
        expect(await screen.findByText('Overtime 01:00')).toBeInTheDocument();
    });
});
