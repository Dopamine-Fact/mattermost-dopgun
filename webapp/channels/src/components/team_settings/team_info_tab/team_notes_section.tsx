// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import CheckboxSettingItem from 'components/widgets/modals/components/checkbox_setting_item';

type Props = {
    notesEnabled: boolean;
    handleNotesEnabledChange: (enabled: boolean) => void;
};

const TeamNotesSection = ({notesEnabled, handleNotesEnabledChange}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <CheckboxSettingItem
            className='tasks-setting-item'
            title={formatMessage({id: 'general_tab.notesTitle', defaultMessage: 'Personal notes and calendar'})}
            description={formatMessage({
                id: 'general_tab.notesInfo',
                defaultMessage: 'When enabled, team members get a calendar in the sidebar where they can write notes, tick them off, share them with the team and get reminders.',
            })}
            descriptionAboveContent={true}
            inputFieldTitle={
                <FormattedMessage
                    id='general_tab.notesEnabled'
                    defaultMessage='Enable personal notes and the calendar for this team'
                />
            }
            inputFieldData={{name: 'notesEnabled', dataTestId: 'notesEnabledCheckbox'}}
            inputFieldValue={notesEnabled}
            handleChange={handleNotesEnabledChange}
        />
    );
};

export default TeamNotesSection;
