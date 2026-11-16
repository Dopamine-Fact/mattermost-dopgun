// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ChannelMemberReadReceipt} from '@mattermost/types/channels';

import {computePostReadReceipt} from './read_receipts';

describe('selectors/read_receipts', () => {
    const authorId = 'author';
    const createAt = 1000;

    function receipt(userId: string, overrides: Partial<ChannelMemberReadReceipt> = {}): ChannelMemberReadReceipt {
        return {
            user_id: userId,
            last_viewed_at: 0,
            last_activity_at: 0,
            status: 'offline',
            ...overrides,
        };
    }

    function receipts(...list: ChannelMemberReadReceipt[]) {
        return Object.fromEntries(list.map((r) => [r.user_id, r]));
    }

    test('should return undefined when receipts have not been loaded', () => {
        expect(computePostReadReceipt(undefined, {}, authorId, createAt)).toBeUndefined();
    });

    test('should return undefined when the author is the only member', () => {
        expect(computePostReadReceipt(receipts(receipt(authorId)), {}, authorId, createAt)).toBeUndefined();
    });

    test('should be sent when the recipient has been offline since the post', () => {
        const result = computePostReadReceipt(receipts(receipt(authorId), receipt('user1', {last_activity_at: 500})), {}, authorId, createAt);

        expect(result).toEqual({status: 'sent', readCount: 0, deliveredCount: 0, recipientCount: 1});
    });

    test('should be delivered when the recipient has been active since the post', () => {
        const result = computePostReadReceipt(receipts(receipt('user1', {last_activity_at: 1500})), {}, authorId, createAt);

        expect(result?.status).toBe('delivered');
    });

    test('should be delivered when the recipient is connected now', () => {
        const result = computePostReadReceipt(receipts(receipt('user1')), {user1: 'away'}, authorId, createAt);

        expect(result?.status).toBe('delivered');
    });

    test('should prefer the live status over the one in the receipt', () => {
        const result = computePostReadReceipt(receipts(receipt('user1', {status: 'online'})), {user1: 'offline'}, authorId, createAt);

        expect(result?.status).toBe('sent');
    });

    test('should be read when the recipient has viewed the channel since the post', () => {
        const result = computePostReadReceipt(receipts(receipt('user1', {last_viewed_at: createAt})), {}, authorId, createAt);

        expect(result).toEqual({status: 'read', readCount: 1, deliveredCount: 1, recipientCount: 1});
    });

    test('should only be read once every other member has read it', () => {
        const list = receipts(
            receipt(authorId, {last_viewed_at: 2000}),
            receipt('user1', {last_viewed_at: 2000}),
            receipt('user2', {status: 'online'}),
            receipt('user3'),
        );

        expect(computePostReadReceipt(list, {}, authorId, createAt)).toEqual({status: 'sent', readCount: 1, deliveredCount: 2, recipientCount: 3});

        list.user3 = receipt('user3', {last_activity_at: 1200});
        expect(computePostReadReceipt(list, {}, authorId, createAt)?.status).toBe('delivered');

        list.user2 = receipt('user2', {last_viewed_at: 1200});
        list.user3 = receipt('user3', {last_viewed_at: 1200});
        expect(computePostReadReceipt(list, {}, authorId, createAt)?.status).toBe('read');
    });
});
