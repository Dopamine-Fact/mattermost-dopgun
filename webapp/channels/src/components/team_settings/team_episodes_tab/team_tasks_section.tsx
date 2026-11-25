// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import CheckboxSettingItem from 'components/widgets/modals/components/checkbox_setting_item';

type Props = {
    tasksEnabled: boolean;
    handleTasksEnabledChange: (enabled: boolean) => void;
    revisionsEnabled: boolean;
    handleRevisionsEnabledChange: (enabled: boolean) => void;
    taskApprovalEnabled: boolean;
    handleTaskApprovalEnabledChange: (enabled: boolean) => void;
    canvasEnabled: boolean;
    handleCanvasEnabledChange: (enabled: boolean) => void;
};

const TeamTasksSection = ({tasksEnabled, handleTasksEnabledChange, revisionsEnabled, handleRevisionsEnabledChange, taskApprovalEnabled, handleTaskApprovalEnabledChange, canvasEnabled, handleCanvasEnabledChange}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <>
            <CheckboxSettingItem
                className='tasks-setting-item'
                title={formatMessage({id: 'general_tab.tasksTitle', defaultMessage: 'Tasks'})}
                description={formatMessage({
                    id: 'general_tab.tasksInfo',
                    defaultMessage: 'When enabled, team members get a shared task list in the sidebar with sections, assignees and due dates.',
                })}
                descriptionAboveContent={true}
                inputFieldTitle={
                    <FormattedMessage
                        id='general_tab.tasksEnabled'
                        defaultMessage='Enable tasks for this team'
                    />
                }
                inputFieldData={{name: 'tasksEnabled', dataTestId: 'tasksEnabledCheckbox'}}
                inputFieldValue={tasksEnabled}
                handleChange={handleTasksEnabledChange}
            />
            {tasksEnabled && (
                <CheckboxSettingItem
                    className='tasks-setting-item'
                    title={formatMessage({id: 'general_tab.revisionsTitle', defaultMessage: 'Revision channels'})}
                    description={formatMessage({
                        id: 'general_tab.revisionsInfo',
                        defaultMessage: 'When enabled, task managers can create revision channels: chat channels with a video where revisions are pinned to moments and assigned as tasks.',
                    })}
                    descriptionAboveContent={true}
                    inputFieldTitle={
                        <FormattedMessage
                            id='general_tab.revisionsEnabled'
                            defaultMessage='Enable revision channels for this team'
                        />
                    }
                    inputFieldData={{name: 'revisionsEnabled', dataTestId: 'revisionsEnabledCheckbox'}}
                    inputFieldValue={revisionsEnabled}
                    handleChange={handleRevisionsEnabledChange}
                />
            )}
            {tasksEnabled && (
                <CheckboxSettingItem
                    className='tasks-setting-item'
                    title={formatMessage({id: 'general_tab.taskApprovalTitle', defaultMessage: 'Task approval'})}
                    description={formatMessage({
                        id: 'general_tab.taskApprovalInfo',
                        defaultMessage: 'When enabled, a task moved to Done waits for a supervisor\'s and then a director\'s approval before it counts as finished. Approved tasks are locked until a director reopens them.',
                    })}
                    descriptionAboveContent={true}
                    inputFieldTitle={
                        <FormattedMessage
                            id='general_tab.taskApprovalEnabled'
                            defaultMessage='Require approval of done tasks'
                        />
                    }
                    inputFieldData={{name: 'taskApprovalEnabled', dataTestId: 'taskApprovalEnabledCheckbox'}}
                    inputFieldValue={taskApprovalEnabled}
                    handleChange={handleTaskApprovalEnabledChange}
                />
            )}
            <CheckboxSettingItem
                className='tasks-setting-item'
                title={formatMessage({id: 'general_tab.canvasTitle', defaultMessage: 'Canvas channels'})}
                description={formatMessage({
                    id: 'general_tab.canvasInfo',
                    defaultMessage: 'When enabled, team members can create canvas channels: chat channels with a shared whiteboard for drawing and diagrams.',
                })}
                descriptionAboveContent={true}
                inputFieldTitle={
                    <FormattedMessage
                        id='general_tab.canvasEnabled'
                        defaultMessage='Enable canvas channels'
                    />
                }
                inputFieldData={{name: 'canvasEnabled', dataTestId: 'canvasEnabledCheckbox'}}
                inputFieldValue={canvasEnabled}
                handleChange={handleCanvasEnabledChange}
            />
        </>
    );
};

export default TeamTasksSection;
