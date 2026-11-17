// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';
import {Route} from 'react-router-dom';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import FileExplorerLink from './file_explorer_link';

function renderLink(filesEnabled: boolean) {
    const team = TestHelper.getTeamMock({id: 'team1', name: 'team', files_enabled: filesEnabled});
    const state = {entities: {teams: {currentTeamId: team.id, teams: {[team.id]: team}}}};
    return renderWithContext(
        <Route path='/:team'>
            <FileExplorerLink/>
        </Route>,
        state,
        {history: createMemoryHistory({initialEntries: ['/team']})},
    );
}

describe('FileExplorerLink', () => {
    test('is hidden when the team has files turned off', () => {
        renderLink(false);
        expect(screen.queryByText('Files')).not.toBeInTheDocument();
    });

    test('links to the team file explorer when files are on', () => {
        renderLink(true);
        expect(screen.getByText('Files').closest('a')).toHaveAttribute('href', '/team/files');
    });
});
