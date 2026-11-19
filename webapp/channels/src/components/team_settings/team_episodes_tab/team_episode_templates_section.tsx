// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import type {ChangeEvent} from 'react';
import {useIntl} from 'react-intl';

import Input from 'components/widgets/inputs/input/input';
import BaseSettingItem, {type BaseSettingItemProps} from 'components/widgets/modals/components/base_setting_item';

import EpisodeFolderPanel from './episode_folder_panel';
import type {EpisodeFolder} from './episode_folders';

// Matches the server's TeamEpisodeTemplateMaxRunes.
const MAX_TEMPLATE_LENGTH = 4000;

type Props = {
    teamId: string;
    folders: EpisodeFolder[];
    tasks: string;
    handleFoldersChange: (folders: EpisodeFolder[]) => void;
    handleTasksChange: (text: string) => void;
    foldersError?: BaseSettingItemProps['error'];
    tasksError?: BaseSettingItemProps['error'];
};

// TeamEpisodeTemplatesSection edits what every new episode channel starts with: drive folders (with who sees and changes each) and tasks, one per line.
const TeamEpisodeTemplatesSection = ({teamId, folders, tasks, handleFoldersChange, handleTasksChange, foldersError, tasksError}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <>
            <BaseSettingItem
                className='episode-folders-setting-item'
                title={formatMessage({id: 'general_tab.episodeFolders', defaultMessage: 'Default episode folders'})}
                description={formatMessage({
                    id: 'team_settings.episodeFolders.info',
                    defaultMessage: "Created in every new episode channel's files, with the rules below. Rules apply to new episodes only.",
                })}
                content={(
                    <EpisodeFolderPanel
                        teamId={teamId}
                        folders={folders}
                        onChange={handleFoldersChange}
                    />
                )}
                error={foldersError}
            />
            <BaseSettingItem
                className='episode-tasks-setting-item'
                title={formatMessage({id: 'general_tab.episodeTasks', defaultMessage: 'Default episode tasks'})}
                description={formatMessage({
                    id: 'general_tab.episodeTasksInfo',
                    defaultMessage: 'One task per line, added unassigned to every new episode channel\'s task list.',
                })}
                content={(
                    <Input
                        id='teamEpisodeTasks'
                        data-testid='episodeTasksInput'
                        type='textarea'
                        maxLength={MAX_TEMPLATE_LENGTH}
                        value={tasks}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleTasksChange(e.target.value)}
                        label={formatMessage({id: 'general_tab.episodeTasks', defaultMessage: 'Default episode tasks'})}
                    />
                )}
                error={tasksError}
            />
        </>
    );
};

export default TeamEpisodeTemplatesSection;
