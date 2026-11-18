// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {fetchTeamTasks} from 'actions/tasks';
import {forwardPost} from 'actions/views/posts';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import ForwardPostModal from './index';

jest.mock('actions/views/posts', () => ({
    forwardPost: jest.fn(() => () => Promise.resolve({data: true})),
}));
jest.mock('actions/views/channel', () => ({
    joinChannelById: jest.fn(() => () => Promise.resolve({data: true})),
    switchToChannel: jest.fn(() => () => Promise.resolve({data: true})),
}));
jest.mock('actions/tasks', () => ({
    fetchTeamTasks: jest.fn(() => () => Promise.resolve({data: []})),
}));
jest.mock('components/post_view/post_message_preview', () => () => null);
jest.mock('./forward_post_comment_input', () => () => null);
jest.mock('./forward_post_channel_select', () => ({
    __esModule: true,
    makeSelectedChannelOption: (channel: {id: string; display_name: string}) => ({label: channel.display_name, value: channel.id, details: channel}),
    default: ({onSelect}: {onSelect: (option: unknown) => void}) => (
        <>
            <button onClick={() => onSelect({label: 'Episode', value: 'ep', details: {id: 'ep', type: 'O', team_id: 'team1'}})}>{'pick episode'}</button>
            <button onClick={() => onSelect({label: 'Plain', value: 'plain', details: {id: 'plain', type: 'O', team_id: 'team1'}})}>{'pick plain'}</button>
        </>
    ),
}));

const section = {id: 'sec1', team_id: 'team1', name: 'Ep 1', sort_order: 0, channel_id: 'ep', video_file_id: '', create_at: 1, update_at: 1};
const task = (id: string, title: string) => ({id, team_id: 'team1', section_id: 'sec1', title, sort_order: 0});
const post = TestHelper.getPostMock({id: 'p1', channel_id: 'from'});
const member = (id: string) => TestHelper.getChannelMembershipMock({channel_id: id, user_id: 'me', roles: 'channel_user'});

const renderModal = (sections: Record<string, typeof section> = {sec1: section}) => renderWithContext(
    <ForwardPostModal post={post}/>,
    {
        entities: {
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
            teams: {
                currentTeamId: 'team1',
                teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', tasks_enabled: true, revisions_enabled: true})},
                myMembers: {team1: TestHelper.getTeamMembershipMock({team_id: 'team1', user_id: 'me', roles: 'team_user'})},
            },
            channels: {
                channels: {
                    from: TestHelper.getChannelMock({id: 'from', team_id: 'team1', type: 'O'}),
                    ep: TestHelper.getChannelMock({id: 'ep', team_id: 'team1', type: 'O'}),
                    plain: TestHelper.getChannelMock({id: 'plain', team_id: 'team1', type: 'O'}),
                },
                myMembers: {from: member('from'), ep: member('ep'), plain: member('plain')},
            },
            roles: {roles: {
                system_user: TestHelper.getRoleMock({name: 'system_user', permissions: ['create_post']}),
                team_user: TestHelper.getRoleMock({name: 'team_user', permissions: []}),
                channel_user: TestHelper.getRoleMock({name: 'channel_user', permissions: ['create_post']}),
            }},
            tasks: {byId: {T: task('T', 'Storyboard'), U: task('U', 'Animatic')}, sectionsById: sections},
        },
    },
);

describe('ForwardPostModal into a task-list channel', () => {
    beforeEach(() => jest.clearAllMocks());

    test('asks for one of the channel\'s tasks and forwards it', async () => {
        renderModal();
        fireEvent.click(screen.getByText('pick episode'));

        const select = screen.getByRole('combobox', {name: 'Task'});
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Pick a task', 'Storyboard', 'Animatic']);
        expect(screen.getByRole('button', {name: 'Forward'})).toBeDisabled();

        fireEvent.change(select, {target: {value: 'T'}});
        fireEvent.click(screen.getByRole('button', {name: 'Forward'}));

        await waitFor(() => expect(forwardPost).toHaveBeenCalledWith(post, expect.objectContaining({id: 'ep'}), '', 'T'));
    });

    test('a plain channel asks for no task', () => {
        renderModal();
        fireEvent.click(screen.getByText('pick plain'));
        expect(screen.queryByRole('combobox', {name: 'Task'})).toBeNull();
        expect(screen.getByRole('button', {name: 'Forward'})).toBeEnabled();
    });

    test('loads the team\'s task lists when none are known', () => {
        renderModal({});
        fireEvent.click(screen.getByText('pick plain'));
        expect(fetchTeamTasks).toHaveBeenCalledWith('team1');
    });
});
