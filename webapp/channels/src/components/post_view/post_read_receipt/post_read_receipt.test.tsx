// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {ChannelMemberReadReceipt} from '@mattermost/types/channels';

import {fetchChannelReadReceiptsIfNeeded} from 'mattermost-redux/actions/channels';

import {renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import PostReadReceipt from './post_read_receipt';

jest.mock('mattermost-redux/actions/channels', () => ({
    ...jest.requireActual('mattermost-redux/actions/channels'),
    fetchChannelReadReceiptsIfNeeded: jest.fn(() => ({type: 'MOCK_FETCH_READ_RECEIPTS'})),
}));

describe('PostReadReceipt', () => {
    const post = TestHelper.getPostMock({
        id: 'post1',
        channel_id: 'channel1',
        user_id: 'author',
        create_at: 1000,
    });

    function receipt(userId: string, overrides: Partial<ChannelMemberReadReceipt> = {}): ChannelMemberReadReceipt {
        return {
            user_id: userId,
            last_viewed_at: 0,
            last_activity_at: 0,
            status: 'offline',
            ...overrides,
        };
    }

    function stateWith(receipts?: ChannelMemberReadReceipt[]) {
        return {
            entities: {
                channels: {
                    readReceipts: receipts ? {channel1: Object.fromEntries(receipts.map((r) => [r.user_id, r]))} : {},
                },
                users: {
                    statuses: {},
                },
            },
        };
    }

    beforeEach(() => {
        jest.mocked(fetchChannelReadReceiptsIfNeeded).mockClear();
    });

    test('should fetch receipts and render nothing until they are loaded', () => {
        const {container} = renderWithContext(<PostReadReceipt post={post}/>, stateWith());

        expect(container).toBeEmptyDOMElement();
        expect(fetchChannelReadReceiptsIfNeeded).toHaveBeenCalledWith('channel1');
    });

    test('should show a clock while the post is being sent', () => {
        renderWithContext(<PostReadReceipt post={{...post, pending_post_id: post.id}}/>, stateWith());

        expect(screen.getByTestId('postReadReceipt')).toHaveAttribute('aria-label', 'Sending');
        expect(fetchChannelReadReceiptsIfNeeded).not.toHaveBeenCalled();
    });

    test('should show sent, delivered and read in a direct message', () => {
        const {rerender, replaceStoreState} = renderWithContext(
            <PostReadReceipt post={post}/>,
            stateWith([receipt('author'), receipt('user1')]),
        );
        expect(screen.getByTestId('postReadReceipt')).toHaveAttribute('aria-label', 'Sent');

        replaceStoreState(stateWith([receipt('author'), receipt('user1', {status: 'online'})]));
        rerender(<PostReadReceipt post={post}/>);
        expect(screen.getByTestId('postReadReceipt')).toHaveAttribute('aria-label', 'Delivered');

        replaceStoreState(stateWith([receipt('author'), receipt('user1', {last_viewed_at: 1000})]));
        rerender(<PostReadReceipt post={post}/>);
        const indicator = screen.getByTestId('postReadReceipt');
        expect(indicator).toHaveAttribute('aria-label', 'Read');
        expect(indicator).toHaveClass('PostReadReceipt--read');
        expect(fetchChannelReadReceiptsIfNeeded).not.toHaveBeenCalled();
    });

    test('should show how many members have read the post in a channel', () => {
        renderWithContext(
            <PostReadReceipt post={post}/>,
            stateWith([
                receipt('author'),
                receipt('user1', {last_viewed_at: 2000}),
                receipt('user2', {last_activity_at: 1500}),
                receipt('user3'),
            ]),
        );

        const indicator = screen.getByTestId('postReadReceipt');
        expect(indicator).toHaveAttribute('aria-label', 'Read by 1 of 3, delivered to 2');
        expect(indicator).toHaveTextContent('1');
    });
});
