// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {flip, offset, shift} from '@floating-ui/react';
import React, {useCallback, useState} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {EmoticonHappyOutlineIcon} from '@mattermost/compass-icons/components';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {WithTooltip} from '@mattermost/shared/components/tooltip';
import type {CustomEmoji, Emoji, SystemEmoji} from '@mattermost/types/emojis';

import {getCustomEmojisEnabled} from 'mattermost-redux/selectors/entities/emojis';
import {getConfig} from 'mattermost-redux/selectors/entities/general';
import {getEmojiName, isSystemEmoji} from 'mattermost-redux/utils/emoji_utils';

import {submitPost} from 'actions/views/create_comment';

import useEmojiPicker, {useEmojiPickerOffset} from 'components/emoji_picker/use_emoji_picker';
import KeyboardShortcutSequence, {KEYBOARD_SHORTCUTS} from 'components/keyboard_shortcuts/keyboard_shortcuts_sequence';

import {unifiedToUnicode} from 'utils/emoji_utils';
import {focusAndInsertText} from 'utils/exec_commands';
import {horizontallyWithin} from 'utils/floating';

import type {GlobalState} from 'types/store';

const useEditorEmojiPicker = (
    textboxId: string,
    isDisabled: boolean,
    shouldShowPreview: boolean,
    insertWysiwygText?: (text: string) => void,

    // Stickers post immediately, so they are only offered when the composer can create a new post.
    stickerTarget?: {channelId: string; rootId: string},
) => {
    const intl = useIntl();

    const enableEmojiPicker = useSelector((state: GlobalState) => getConfig(state).EnableEmojiPicker === 'true');
    const enableGifPicker = useSelector((state: GlobalState) => getConfig(state).EnableGifPicker === 'true');
    const enableStickers = useSelector(getCustomEmojisEnabled) && Boolean(stickerTarget);
    const dispatch = useDispatch();

    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    const toggleEmojiPicker = useCallback((e?: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => {
        e?.stopPropagation();
        setShowEmojiPicker((prev) => !prev);
    }, []);

    const insertTextAtCaret = useCallback((text: string) => {
        if (insertWysiwygText) {
            insertWysiwygText(text);
            return;
        }

        const textbox = document.getElementById(textboxId) as HTMLTextAreaElement | undefined;
        if (!textbox) {
            return;
        }

        const needsSpaceBefore = textbox.selectionStart !== 0 && !(/\s/).test(textbox.value[textbox.selectionStart - 1]);
        const textToBeAdded = needsSpaceBefore ? ` ${text} ` : `${text} `;

        focusAndInsertText(textbox, textToBeAdded);
    }, [textboxId, insertWysiwygText]);

    const handleEmojiClick = useCallback((emoji: Emoji) => {
        if (isSystemEmoji(emoji)) {
            insertTextAtCaret(unifiedToUnicode((emoji as SystemEmoji).unified));
        } else {
            const emojiAlias = getEmojiName(emoji);
            if (!emojiAlias) {
                return;
            }
            insertTextAtCaret(`:${emojiAlias}:`);
        }

        setShowEmojiPicker(false);
    }, [insertTextAtCaret, textboxId]);

    const handleGifClick = useCallback((gif: string) => {
        insertTextAtCaret(gif);

        setShowEmojiPicker(false);
    }, [insertTextAtCaret]);

    const stickerChannelId = stickerTarget?.channelId;
    const stickerRootId = stickerTarget?.rootId;
    const handleStickerClick = useCallback((emoji: CustomEmoji) => {
        if (!stickerChannelId) {
            return;
        }
        const now = Date.now();
        dispatch(submitPost(stickerChannelId, stickerRootId ?? '', {
            message: `:${emoji.name}:`,
            props: {sticker: true},
            fileInfos: [],
            uploadsInProgress: [],
            channelId: stickerChannelId,
            rootId: stickerRootId ?? '',
            createAt: now,
            updateAt: now,
        }, undefined, undefined, {keepDraft: true}));

        setShowEmojiPicker(false);
    }, [dispatch, stickerChannelId, stickerRootId]);

    const {
        emojiPicker,
        getReferenceProps,
        setReference,
    } = useEmojiPicker({
        showEmojiPicker,
        setShowEmojiPicker,

        enableGifPicker,
        onGifClick: handleGifClick,
        onEmojiClick: handleEmojiClick,
        onStickerClick: enableStickers ? handleStickerClick : undefined,

        overrideMiddleware: [
            offset(useEmojiPickerOffset),
            shift(),
            horizontallyWithin({
                boundary: document.getElementById(textboxId),
            }),
            flip({
                fallbackAxisSideDirection: 'end',
            }),
        ],
    });

    let emojiPickerControls = null;
    if (enableEmojiPicker && !isDisabled) {
        emojiPickerControls = (
            <>
                <WithTooltip
                    title={
                        <KeyboardShortcutSequence
                            shortcut={KEYBOARD_SHORTCUTS.msgShowEmojiPicker}
                            hoistDescription={true}
                            isInsideTooltip={true}
                        />
                    }
                >
                    <IconButton
                        id='emojiPickerButton'
                        ref={setReference}
                        size='small'
                        icon={
                            <Icon glyph={<EmoticonHappyOutlineIcon color='currentColor'/>}/>
                        }
                        onClick={toggleEmojiPicker}
                        aria-label={intl.formatMessage({id: 'emoji_picker.emojiPicker.button.ariaLabel', defaultMessage: 'select an emoji'})}
                        disabled={shouldShowPreview}
                        toggled={showEmojiPicker}
                        {...getReferenceProps()}
                    />
                </WithTooltip>
                {emojiPicker}
            </>
        );
    }

    return {emojiPicker: emojiPickerControls, enableEmojiPicker, toggleEmojiPicker};
};

export default useEditorEmojiPicker;
