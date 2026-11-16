// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import React from 'react';

import {renderWithContext, userEvent} from 'tests/react_testing_utils';

import StickerPicker from './sticker_picker';

jest.mock('mattermost-redux/actions/emojis', () => ({
    getCustomEmojis: jest.fn(() => ({type: 'MOCK_GET_CUSTOM_EMOJIS'})),
}));

describe('StickerPicker', () => {
    const emoji = {id: 'e1', name: 'party_parrot', creator_id: 'u1', create_at: 0, update_at: 0, delete_at: 0, category: 'custom' as const};

    test('sends the clicked custom emoji as a sticker', async () => {
        const onStickerClick = jest.fn();
        renderWithContext(
            <StickerPicker onStickerClick={onStickerClick}/>,
            {entities: {general: {config: {EnableCustomEmoji: 'true'}}, emojis: {customEmoji: {e1: emoji}}}},
        );

        await userEvent.click(screen.getByRole('button', {name: 'party_parrot'}));
        expect(onStickerClick).toHaveBeenCalledWith(emoji);
    });

    test('shows an empty state without custom emojis', () => {
        renderWithContext(
            <StickerPicker onStickerClick={jest.fn()}/>,
            {entities: {emojis: {customEmoji: {}}}},
        );

        expect(screen.getByText('No stickers yet. Add custom emojis to use them as stickers.')).toBeInTheDocument();
    });
});
