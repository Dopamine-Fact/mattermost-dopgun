// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {memo, useEffect, useMemo} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {CheckAllIcon, CheckIcon, ClockOutlineIcon} from '@mattermost/compass-icons/components';
import {WithTooltip} from '@mattermost/shared/components/tooltip';
import type {Post} from '@mattermost/types/posts';

import {fetchChannelReadReceiptsIfNeeded} from 'mattermost-redux/actions/channels';

import {hasChannelReadReceipts, makeGetPostReadReceipt} from 'selectors/read_receipts';

import type {GlobalState} from 'types/store';

import './post_read_receipt.scss';

type Props = {
    post: Post;
};

function PostReadReceipt({post}: Props) {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();

    const getPostReadReceipt = useMemo(() => makeGetPostReadReceipt(), []);
    const receipt = useSelector((state: GlobalState) => getPostReadReceipt(state, post));
    const hasReceipts = useSelector((state: GlobalState) => hasChannelReadReceipts(state, post.channel_id));

    const isPending = post.id === post.pending_post_id;

    useEffect(() => {
        if (!isPending && !hasReceipts) {
            dispatch(fetchChannelReadReceiptsIfNeeded(post.channel_id));
        }
    }, [dispatch, isPending, hasReceipts, post.channel_id]);

    if (isPending) {
        const label = formatMessage({id: 'post_read_receipt.sending', defaultMessage: 'Sending'});
        return (
            <WithTooltip title={label}>
                <span
                    className='PostReadReceipt'
                    aria-label={label}
                    data-testid='postReadReceipt'
                    data-status='sending'
                >
                    <ClockOutlineIcon size={14}/>
                </span>
            </WithTooltip>
        );
    }

    if (!receipt) {
        return null;
    }

    const {status, readCount, deliveredCount, recipientCount} = receipt;

    let label;
    if (recipientCount === 1) {
        switch (status) {
        case 'read':
            label = formatMessage({id: 'post_read_receipt.read', defaultMessage: 'Read'});
            break;
        case 'delivered':
            label = formatMessage({id: 'post_read_receipt.delivered', defaultMessage: 'Delivered'});
            break;
        default:
            label = formatMessage({id: 'post_read_receipt.sent', defaultMessage: 'Sent'});
        }
    } else if (status === 'read') {
        label = formatMessage({id: 'post_read_receipt.read_by_everyone', defaultMessage: 'Read by everyone'});
    } else {
        label = formatMessage(
            {
                id: 'post_read_receipt.read_by_some',
                defaultMessage: 'Read by {readCount} of {recipientCount}, delivered to {deliveredCount}',
            },
            {readCount, recipientCount, deliveredCount},
        );
    }

    const Icon = status === 'sent' ? CheckIcon : CheckAllIcon;
    const showReadCount = recipientCount > 1 && readCount > 0 && status !== 'read';

    return (
        <WithTooltip title={label}>
            <span
                className={classNames('PostReadReceipt', {'PostReadReceipt--read': status === 'read'})}
                aria-label={label}
                data-testid='postReadReceipt'
                data-status={status}
            >
                <Icon size={14}/>
                {showReadCount && <span className='PostReadReceipt__count'>{readCount}</span>}
            </span>
        </WithTooltip>
    );
}

export default memo(PostReadReceipt);
