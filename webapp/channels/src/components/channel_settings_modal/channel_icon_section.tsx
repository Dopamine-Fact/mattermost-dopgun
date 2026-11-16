// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';
import type {ChangeEvent} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';
import {getConfig} from 'mattermost-redux/selectors/entities/general';

import {channelIconUrl} from 'components/channel_type_icon';
import TeamPictureSection from 'components/team_settings/team_info_tab/team_picture_section';
import type {BaseSettingItemProps} from 'components/widgets/modals/components/base_setting_item';

import type {GlobalState} from 'types/store';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/bmp'];

const messages = defineMessages({
    title: {id: 'channel_settings.icon.title', defaultMessage: 'Channel Icon'},
    invalidType: {id: 'channel_settings.icon.invalid_type', defaultMessage: 'Only BMP, JPG or PNG images may be used for channel icons'},
    tooLarge: {id: 'channel_settings.icon.too_large', defaultMessage: 'Unable to upload channel icon. File is too large.'},
    error: {id: 'channel_settings.icon.error', defaultMessage: 'Unable to update channel icon.'},
});

type Props = {
    channel: Channel;
    disabled: boolean;
};

// Uploads immediately on pick; the channel_updated websocket event refreshes the stored channel.
const ChannelIconSection = ({channel, disabled}: Props) => {
    const {formatMessage} = useIntl();
    const maxFileSize = parseInt(useSelector((state: GlobalState) => getConfig(state).MaxFileSize) ?? '', 10);
    const [file, setFile] = useState<File>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<BaseSettingItemProps['error']>();

    const run = useCallback(async (request: () => Promise<unknown>) => {
        setLoading(true);
        try {
            await request();
            setError(undefined);
        } catch {
            setError(messages.error);
        } finally {
            setFile(undefined);
            setLoading(false);
        }
    }, []);

    const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const picked = e.target.files?.[0];
        if (!picked) {
            return;
        }
        if (!ACCEPTED_IMAGE_TYPES.includes(picked.type)) {
            setError(messages.invalidType);
            return;
        }
        if (picked.size > maxFileSize) {
            setError(messages.tooLarge);
            return;
        }
        setFile(picked);
        run(() => Client4.setChannelIcon(channel.id, picked));
    }, [channel.id, maxFileSize, run]);

    const handleRemove = useCallback(() => {
        run(() => Client4.removeChannelIcon(channel.id));
    }, [channel.id, run]);

    return (
        <TeamPictureSection
            imageSrc={channelIconUrl(channel)}
            title={formatMessage(messages.title)}
            file={file}
            teamName={channel.display_name}
            disabled={disabled || loading}
            onFileChange={handleFileChange}
            onRemove={handleRemove}
            clientError={error}
        />
    );
};

export default ChannelIconSection;
