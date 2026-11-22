// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {defineMessages, useIntl} from 'react-intl';

import ColorInput from 'components/color_input';
import BaseSettingItem from 'components/widgets/modals/components/base_setting_item';

const messages = defineMessages({
    title: {id: 'channel_settings.name_color.title', defaultMessage: 'Channel Name Color'},
    description: {id: 'channel_settings.name_color.description', defaultMessage: 'Color of the channel name in the sidebar. Leave empty to use the theme color.'},
    reset: {id: 'channel_settings.name_color.reset', defaultMessage: 'Use theme color'},
});

type Props = {
    value: string;
    onChange: (color: string) => void;
    disabled: boolean;
};

// Staged like the other Info tab fields: the tab's Save panel persists it.
const ChannelNameColorSection = ({value, onChange, disabled}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <BaseSettingItem
            title={formatMessage(messages.title)}
            description={formatMessage(messages.description)}
            content={(
                <div className='ChannelSettingsModal__nameColor'>
                    <ColorInput
                        id='channel_settings_name_color'
                        value={value}
                        onChange={onChange}
                        isDisabled={disabled}
                    />
                    {value && !disabled && (
                        <button
                            type='button'
                            className='btn btn-tertiary btn-sm'
                            onClick={() => onChange('')}
                        >
                            {formatMessage(messages.reset)}
                        </button>
                    )}
                </div>
            )}
        />
    );
};

export default ChannelNameColorSection;
