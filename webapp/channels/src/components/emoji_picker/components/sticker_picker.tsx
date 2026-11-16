// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {CustomEmoji} from '@mattermost/types/emojis';

import {getCustomEmojis} from 'mattermost-redux/actions/emojis';
import {getCustomEmojis as selectCustomEmojis} from 'mattermost-redux/selectors/entities/emojis';
import {getEmojiImageUrl} from 'mattermost-redux/utils/emoji_utils';

import type {GlobalState} from 'types/store';

import './sticker_picker.scss';

// shortcut: loads only the first 200 custom emojis, add paging/search when a server has more.
const STICKERS_PER_PAGE = 200;

type Props = {
    onStickerClick: (emoji: CustomEmoji) => void;
};

export default function StickerPicker({onStickerClick}: Props) {
    const dispatch = useDispatch();
    const customEmojis = useSelector((state: GlobalState) => selectCustomEmojis(state));

    useEffect(() => {
        dispatch(getCustomEmojis(0, STICKERS_PER_PAGE));
    }, [dispatch]);

    const stickers = useMemo(() => Object.values(customEmojis).sort((a, b) => a.name.localeCompare(b.name)), [customEmojis]);

    if (stickers.length === 0) {
        return (
            <div className='sticker-picker__empty'>
                <FormattedMessage
                    id='sticker_picker.empty'
                    defaultMessage='No stickers yet. Add custom emojis to use them as stickers.'
                />
            </div>
        );
    }

    return (
        <div
            className='sticker-picker'
            data-testid='stickerPicker'
        >
            {stickers.map((emoji) => (
                <button
                    key={emoji.id}
                    type='button'
                    className='style--none sticker-picker__item'
                    aria-label={emoji.name}
                    title={emoji.name}
                    onClick={() => onStickerClick(emoji)}
                >
                    <img
                        src={getEmojiImageUrl(emoji)}
                        alt=''
                        loading='lazy'
                    />
                </button>
            ))}
        </div>
    );
}
