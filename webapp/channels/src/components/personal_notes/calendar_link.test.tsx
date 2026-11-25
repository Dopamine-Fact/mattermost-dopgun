// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';
import {Route} from 'react-router-dom';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import CalendarLink from './calendar_link';

function renderLink(notesEnabled: boolean | undefined, path = '/team') {
    const team = TestHelper.getTeamMock({id: 'team1', name: 'team', notes_enabled: notesEnabled});
    const state = {entities: {teams: {currentTeamId: team.id, teams: {[team.id]: team}}}};
    return renderWithContext(
        <Route path='/:team'>
            <CalendarLink/>
        </Route>,
        state,
        {history: createMemoryHistory({initialEntries: [path]})},
    );
}

describe('CalendarLink', () => {
    test('is hidden when the team has notes turned off', () => {
        renderLink(false);
        expect(screen.queryByText('Calendar')).not.toBeInTheDocument();
    });

    test('is hidden when the team has never set notes', () => {
        renderLink(undefined);
        expect(screen.queryByText('Calendar')).not.toBeInTheDocument();
    });

    test('links to the team calendar when notes are on', () => {
        renderLink(true);
        expect(screen.getByText('Calendar').closest('a')).toHaveAttribute('href', '/team/calendar');
        expect(screen.getByText('Calendar').closest('li')).not.toHaveClass('active');
    });

    test('is marked active on the calendar page', () => {
        renderLink(true, '/team/calendar');
        expect(screen.getByText('Calendar').closest('li')).toHaveClass('active');
    });
});
