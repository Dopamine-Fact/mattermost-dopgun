// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import CheckboxSettingItem from 'components/widgets/modals/components/checkbox_setting_item';

import TeamFilesTemplate from './team_files_template';

type Props = {
    teamId: string;
    filesEnabled: boolean;
    handleFilesEnabledChange: (enabled: boolean) => void;
};

const TeamFilesSection = ({teamId, filesEnabled, handleFilesEnabledChange}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <>
            <CheckboxSettingItem
                className='tasks-setting-item'
                title={formatMessage({id: 'general_tab.filesTitle', defaultMessage: 'Files'})}
                description={formatMessage({
                    id: 'general_tab.filesInfo',
                    defaultMessage: 'When enabled, team members get a file explorer in the sidebar where every channel they belong to is a folder for uploading, organising and previewing files.',
                })}
                descriptionAboveContent={true}
                inputFieldTitle={
                    <FormattedMessage
                        id='general_tab.filesEnabled'
                        defaultMessage='Enable the file explorer for this team'
                    />
                }
                inputFieldData={{name: 'filesEnabled', dataTestId: 'filesEnabledCheckbox'}}
                inputFieldValue={filesEnabled}
                handleChange={handleFilesEnabledChange}
            />
            {filesEnabled && <TeamFilesTemplate teamId={teamId}/>}
        </>
    );
};

export default TeamFilesSection;
