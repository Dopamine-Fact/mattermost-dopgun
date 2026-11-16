// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import BaseSettingItem from 'components/widgets/modals/components/base_setting_item';
import CheckboxSettingItem from 'components/widgets/modals/components/checkbox_setting_item';

type Props = {
    dailyReportsEnabled: boolean;
    handleDailyReportsEnabledChange: (enabled: boolean) => void;
    dailyReportTime: string;
    dailyReportTimezone: string;
    handleDailyReportTimeChange: (time: string) => void;
};

const TeamDailyReportsSection = ({dailyReportsEnabled, handleDailyReportsEnabledChange, dailyReportTime, dailyReportTimezone, handleDailyReportTimeChange}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <>
            <CheckboxSettingItem
                className='tasks-setting-item'
                title={formatMessage({id: 'general_tab.dailyReportsTitle', defaultMessage: 'Daily reports'})}
                description={formatMessage({
                    id: 'general_tab.dailyReportsInfo',
                    defaultMessage: 'When enabled, team members write an end-of-day report that team managers approve. Reports left pending for 30 minutes are approved automatically.',
                })}
                descriptionAboveContent={true}
                inputFieldTitle={
                    <FormattedMessage
                        id='general_tab.dailyReportsEnabled'
                        defaultMessage='Enable daily reports for this team'
                    />
                }
                inputFieldData={{name: 'dailyReportsEnabled', dataTestId: 'dailyReportsEnabledCheckbox'}}
                inputFieldValue={dailyReportsEnabled}
                handleChange={handleDailyReportsEnabledChange}
            />
            {dailyReportsEnabled && (
                <BaseSettingItem
                    className='tasks-setting-item daily-report-time-item'
                    title={formatMessage({id: 'general_tab.dailyReportTime', defaultMessage: 'Report deadline'})}
                    description={formatMessage(
                        {id: 'general_tab.dailyReportTimezone', defaultMessage: 'Timezone: {timezone}'},
                        {timezone: dailyReportTimezone},
                    )}
                    descriptionAboveContent={true}
                    content={
                        <input
                            type='time'
                            className='form-control'
                            data-testid='dailyReportTimeInput'
                            value={dailyReportTime}
                            onChange={(e) => e.target.value && handleDailyReportTimeChange(e.target.value)}
                        />
                    }
                />
            )}
        </>
    );
};

export default TeamDailyReportsSection;
