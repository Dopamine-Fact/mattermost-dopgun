// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';
import {Route} from 'react-router-dom';

import type {PersonalNote} from '@mattermost/types/personal_notes';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import PersonalNotesPage from './personal_notes_page';

const mockRevert = jest.fn();

// FullCalendar renders through browser layout APIs jsdom lacks; the stub shows events and fires the callbacks.
jest.mock('@fullcalendar/react', () => {
    const ReactLib = jest.requireActual('react');
    return {
        __esModule: true,
        default: ReactLib.forwardRef((props: any, ref: any) => {
            ReactLib.useImperativeHandle(ref, () => ({getApi: () => ({gotoDate: jest.fn()})}));
            return (
                <div>
                    {props.events.map((e: any) => (
                        <button
                            key={e.id}
                            onClick={() => props.eventClick({event: {extendedProps: e.extendedProps}})}
                        >
                            {e.title}
                        </button>
                    ))}
                    <button onClick={() => props.datesSet({start: new Date(2026, 9, 26), end: new Date(2026, 11, 7), view: {type: 'dayGridMonth'}})}>
                        {'fire-datesSet'}
                    </button>
                    <button
                        onClick={() => props.eventDrop({
                            event: {start: new Date(2026, 10, 27), allDay: false, extendedProps: props.events[0].extendedProps},
                            view: {type: 'dayGridMonth'},
                            revert: mockRevert,
                        })}
                    >
                        {'fire-drop'}
                    </button>
                </div>
            );
        }),
    };
});
jest.mock('@fullcalendar/daygrid', () => ({}));
jest.mock('@fullcalendar/timegrid', () => ({}));
jest.mock('@fullcalendar/interaction', () => ({}));
jest.mock('@fullcalendar/core/locales-all', () => []);
jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getMissingProfilesByIds: jest.fn(() => () => Promise.resolve({data: []})),
}));

function note(over: Partial<PersonalNote>): PersonalNote {
    return {
        id: 'n1',
        team_id: 'team1',
        user_id: 'me',
        title: 'Mine',
        message: '',
        visibility: 'private',
        date: '2026-11-25',
        time: '',
        remind_minutes: -1,
        remind_at: 0,
        done_at: 0,
        create_at: 1,
        update_at: 1,
        ...over,
    };
}

function renderPage() {
    const team = TestHelper.getTeamMock({id: 'team1', name: 'team', notes_enabled: true});
    const me = TestHelper.getUserMock({id: 'me', username: 'me'});
    const ayse = TestHelper.getUserMock({id: 'ayse', username: 'ayse'});
    const state = {
        entities: {
            teams: {currentTeamId: team.id, teams: {[team.id]: team}},
            users: {currentUserId: me.id, profiles: {[me.id]: me, [ayse.id]: ayse}},
        },
    };
    return renderWithContext(
        <Route path='/:team/calendar'>
            <PersonalNotesPage/>
        </Route>,
        state,
        {history: createMemoryHistory({initialEntries: ['/team/calendar']})},
    );
}

describe('PersonalNotesPage', () => {
    let getNotes: jest.SpyInstance;

    beforeEach(() => {
        mockRevert.mockReset();
        localStorage.clear();
        getNotes = jest.spyOn(Client4, 'getPersonalNotes').mockImplementation(async (_teamId, query) => {
            if (query.undated) {
                return [note({id: 'u1', title: 'Book list', date: ''})];
            }
            return [note({}), note({id: 'n2', user_id: 'ayse', title: 'Theirs', visibility: 'team'})];
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('loads the visible range and the undated list', async () => {
        renderPage();
        fireEvent.click(screen.getByText('fire-datesSet'));
        expect(getNotes).toHaveBeenCalledWith('team1', {from: '2026-10-26', to: '2026-12-06', only_mine: false});
        expect(getNotes).toHaveBeenCalledWith('team1', {undated: true, only_mine: false});
        expect(await screen.findByText('Theirs')).toBeInTheDocument();
        expect(screen.getByText('Book list')).toBeInTheDocument();
    });

    test('"Only mine" refetches with only_mine', async () => {
        renderPage();
        fireEvent.click(screen.getByText('fire-datesSet'));
        fireEvent.click(screen.getByRole('button', {name: 'Only mine'}));
        expect(getNotes).toHaveBeenCalledWith('team1', {from: '2026-10-26', to: '2026-12-06', only_mine: true});
    });

    test("a teammate's note opens read-only", async () => {
        renderPage();
        fireEvent.click(screen.getByText('fire-datesSet'));
        fireEvent.click(await screen.findByText('Theirs'));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Save'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Delete'})).not.toBeInTheDocument();
    });

    test('my note opens for editing', async () => {
        renderPage();
        fireEvent.click(screen.getByText('fire-datesSet'));
        fireEvent.click(await screen.findByText('Mine'));
        expect(await screen.findByRole('button', {name: 'Save'})).toBeInTheDocument();
        expect(screen.getByDisplayValue('Mine')).toBeInTheDocument();
    });

    test('a rejected drop is reverted', async () => {
        jest.spyOn(Client4, 'patchPersonalNote').mockRejectedValue(new Error('nope'));
        renderPage();
        fireEvent.click(screen.getByText('fire-datesSet'));
        await screen.findByText('Mine');
        fireEvent.click(screen.getByText('fire-drop'));
        await waitFor(() => expect(mockRevert).toHaveBeenCalled());
        expect(Client4.patchPersonalNote).toHaveBeenCalledWith('team1', 'n1', {date: '2026-11-27'});
        expect(screen.getByText('nope')).toBeInTheDocument();
    });
});
