// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ChannelMemberReadReceipt} from '@mattermost/types/channels';
import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {General} from 'mattermost-redux/constants';
import {createSelector} from 'mattermost-redux/selectors/create_selector';

export type ReadReceiptStatus = 'sent' | 'delivered' | 'read';

export type PostReadReceipt = {
    status: ReadReceiptStatus;
    readCount: number;
    deliveredCount: number;
    recipientCount: number;
};

/**
 * Works out whether a post has been delivered to and read by the other members of its channel.
 *
 * A member has read the post once they have viewed the channel at or after the time it was sent.
 * It has been delivered to them if they have been active since it was sent, or are connected now.
 * The post counts as delivered or read only once that is true for every other member.
 */
export function computePostReadReceipt(
    receipts: Record<string, ChannelMemberReadReceipt> | undefined,
    statuses: Record<string, string>,
    authorId: string,
    createAt: number,
): PostReadReceipt | undefined {
    if (!receipts) {
        return undefined;
    }

    let recipientCount = 0;
    let readCount = 0;
    let deliveredCount = 0;

    for (const receipt of Object.values(receipts)) {
        if (receipt.user_id === authorId) {
            continue;
        }

        recipientCount++;

        if (receipt.last_viewed_at >= createAt) {
            readCount++;
            deliveredCount++;
            continue;
        }

        const status = statuses[receipt.user_id] ?? receipt.status;
        if (receipt.last_activity_at >= createAt || (status && status !== General.OFFLINE)) {
            deliveredCount++;
        }
    }

    if (recipientCount === 0) {
        return undefined;
    }

    let status: ReadReceiptStatus = 'sent';
    if (readCount === recipientCount) {
        status = 'read';
    } else if (deliveredCount === recipientCount) {
        status = 'delivered';
    }

    return {status, readCount, deliveredCount, recipientCount};
}

export function hasChannelReadReceipts(state: GlobalState, channelId: string): boolean {
    return Boolean(state.entities.channels.readReceipts[channelId]);
}

export function makeGetPostReadReceipt() {
    return createSelector(
        'makeGetPostReadReceipt',
        (state: GlobalState, post: Post) => state.entities.channels.readReceipts[post.channel_id],
        (state: GlobalState) => state.entities.users.statuses,
        (state: GlobalState, post: Post) => post.user_id,
        (state: GlobalState, post: Post) => post.create_at,
        computePostReadReceipt,
    );
}
