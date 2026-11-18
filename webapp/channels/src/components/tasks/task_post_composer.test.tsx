// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {getChannel, joinChannel} from 'mattermost-redux/actions/channels';
import {createPost} from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import TaskPostComposer from './task_post_composer';

jest.mock('mattermost-redux/actions/posts', () => ({
    ...jest.requireActual('mattermost-redux/actions/posts'),
    createPost: jest.fn(() => () => Promise.resolve({data: {created: true}})),
}));
jest.mock('mattermost-redux/actions/channels', () => ({
    ...jest.requireActual('mattermost-redux/actions/channels'),
    getChannel: jest.fn(() => () => Promise.resolve({error: new Error('forbidden')})),
    joinChannel: jest.fn(() => () => Promise.resolve({data: null})),
}));

const channel = TestHelper.getChannelMock({id: 'chan1', team_id: 'team1', type: 'O'});

const renderComposer = ({member = true, known = true, canPost = true, archived = false} = {}) => renderWithContext(
    <TaskPostComposer
        taskId='T'
        channelId='chan1'
    />,
    {
        entities: {
            users: {currentUserId: 'me', profiles: {me: TestHelper.getUserMock({id: 'me', roles: 'system_user'})}},
            roles: {roles: {system_user: TestHelper.getRoleMock({name: 'system_user', permissions: canPost ? ['create_post'] : []})}},
            channels: {
                channels: known ? {chan1: {...channel, delete_at: archived ? 1 : 0}} : {},
                myMembers: member ? {chan1: TestHelper.getChannelMembershipMock({channel_id: 'chan1', user_id: 'me'})} : {},
            },
        },
    },
);

describe('TaskPostComposer', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test('a member posts to the channel with the task named', async () => {
        renderComposer();
        const send = screen.getByRole('button', {name: 'Send'});
        expect(send).toBeDisabled();

        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'looks good'}});
        fireEvent.click(send);

        await waitFor(() => expect(createPost).toHaveBeenCalledWith(
            expect.objectContaining({channel_id: 'chan1', user_id: 'me', message: 'looks good', props: {task_id: 'T'}}),
            [],
        ));
        await waitFor(() => expect(screen.getByRole('textbox', {name: 'Message'})).toHaveValue(''));
    });

    test('files go up to the channel first and travel with the message', async () => {
        const info = {id: 'f1', name: 'frame.png'};
        const upload = jest.spyOn(Client4, 'uploadFile').mockResolvedValue({file_infos: [info], client_ids: ['c']} as any);
        renderComposer();

        const frame = new File(['x'], 'frame.png', {type: 'image/png'});
        fireEvent.change(screen.getByLabelText('Attach files'), {target: {files: [frame]}});
        expect(screen.getByText('frame.png')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));

        await waitFor(() => expect(createPost).toHaveBeenCalledWith(expect.objectContaining({message: '', props: {task_id: 'T'}}), [info]));
        const form = upload.mock.calls[0][0] as FormData;
        expect(form.get('channel_id')).toBe('chan1');
        expect(form.get('files')).toBeInstanceOf(File);
    });

    test('a non-member of an open channel is offered to join it', async () => {
        renderComposer({member: false});
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Join the channel to comment'}));
        await waitFor(() => expect(joinChannel).toHaveBeenCalledWith('me', 'team1', 'chan1'));
    });

    test('a member who may not post, or an archived channel, gets no box', () => {
        renderComposer({canPost: false});
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.getByText("You can't post in this channel.")).toBeInTheDocument();
    });

    test('an archived channel gets no box', () => {
        renderComposer({archived: true});
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.getByText("You can't post in this channel.")).toBeInTheDocument();
    });

    test('a refused message stays in the box with the reason', async () => {
        (createPost as jest.Mock).mockImplementationOnce(() => () => Promise.resolve({error: {message: 'nope'}}));
        renderComposer();
        fireEvent.change(screen.getByRole('textbox', {name: 'Message'}), {target: {value: 'keep me'}});
        fireEvent.click(screen.getByRole('button', {name: 'Send'}));

        await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
        expect(screen.getByRole('textbox', {name: 'Message'})).toHaveValue('keep me');
    });

    test('while the channel is still loading nothing claims it is private', () => {
        (getChannel as jest.Mock).mockImplementationOnce(() => () => new Promise(() => {}));
        renderComposer({member: false, known: false});
        expect(screen.queryByText('Only members of this channel can see and join its conversation.')).toBeNull();
    });

    test('a channel the user cannot see explains why there is no box', async () => {
        renderComposer({member: false, known: false});
        expect(getChannel).toHaveBeenCalledWith('chan1');
        expect(await screen.findByText('Only members of this channel can see and join its conversation.')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Join the channel to comment'})).toBeNull();
    });
});
