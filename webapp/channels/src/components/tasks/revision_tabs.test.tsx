// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createMemoryHistory} from 'history';
import React from 'react';

import type {Task, TaskSection} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import RevisionTabs from './revision_tabs';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInTeam: jest.fn(() => () => Promise.resolve({data: []})),
}));

const section: TaskSection = {id: 'sec1', team_id: 'team1', name: 'Trailer', sort_order: 0, channel_id: 'chan1', video_file_id: 'file1', create_at: 1, update_at: 1};
const revision: Task = {
    id: 't1',
    team_id: 'team1',
    section_id: 'sec1',
    title: 'Logo too small',
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: 1200,
    creator_id: 'user1',
    create_at: 1,
    update_at: 1,
};

const renderTabs = (channelId: string, {revisionsEnabled = true, url = '/team-one/channels/trailer'} = {}) => renderWithContext(
    <RevisionTabs channelId={channelId}>
        <div>{'chat'}</div>
    </RevisionTabs>,
    {
        entities: {
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: revisionsEnabled})},
            },
            tasks: {byId: {t1: revision}, sectionsById: {sec1: section}},
        },
    },
    {history: createMemoryHistory({initialEntries: [url]})},
);

describe('RevisionTabs', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
    });

    test('a channel without a revision list renders as before', () => {
        renderTabs('other');
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    test('a revision channel switches between messages and revisions', () => {
        renderTabs('chan1');
        expect(screen.getByRole('tab', {name: 'Messages'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('chat')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', {name: 'Revisions'}));
        expect(screen.queryByText('chat')).not.toBeInTheDocument();
        expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/task_sections/sec1/video'));
        expect(screen.getByRole('button', {name: 'Logo too small'})).toBeInTheDocument();
    });

    test('arrow keys step the video right after the Revisions tab is clicked', () => {
        jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        renderTabs('chan1');
        const tab = screen.getByRole('tab', {name: 'Revisions'});
        fireEvent.click(tab);
        tab.focus();

        const video = document.querySelector('video')!;
        let time = 0;
        Object.defineProperty(video, 'currentTime', {get: () => time,
            set: (t: number) => {
                time = t;
            }});
        fireEvent.keyDown(tab, {key: 'ArrowRight'});
        expect(time).toBeCloseTo(1 / 30);
    });

    test('turned off for the team, the tabs disappear', () => {
        renderTabs('chan1', {revisionsEnabled: false});
        expect(screen.getByText('chat')).toBeInTheDocument();
        expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    test('?revision= opens the Revisions tab with that revision', () => {
        renderTabs('chan1', {url: '/team-one/channels/trailer?revision=t1'});
        expect(screen.getByRole('tab', {name: 'Revisions'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('complementary', {name: 'Task details'})).toBeInTheDocument();
    });
});
