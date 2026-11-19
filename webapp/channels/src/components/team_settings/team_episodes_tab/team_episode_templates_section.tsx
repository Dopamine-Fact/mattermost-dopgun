// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {useIntl} from 'react-intl';

import BaseSettingItem, {type BaseSettingItemProps} from 'components/widgets/modals/components/base_setting_item';

import EpisodeFolderPanel from './episode_folder_panel';
import type {EpisodeFolder} from './episode_folders';
import EpisodeTaskPanel from './episode_task_panel';
import type {EpisodeTask} from './episode_tasks';

type Props = {
    teamId: string;
    folders: EpisodeFolder[];
    tasks: EpisodeTask[];
    handleFoldersChange: (folders: EpisodeFolder[]) => void;
    handleTasksChange: (tasks: EpisodeTask[]) => void;
    foldersError?: BaseSettingItemProps['error'];
    tasksError?: BaseSettingItemProps['error'];
};

// TeamEpisodeTemplatesSection edits what every new episode channel starts with: drive folders (with who sees and changes each) and tasks (with who may take them, deadlines and what they wait for).
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
                    defaultMessage: 'Added to every new episode channel\'s task list.',
                })}
                content={(
                    <EpisodeTaskPanel
                        teamId={teamId}
                        tasks={tasks}
                        folders={folders}
                        onChange={handleTasksChange}
                    />
                )}
                error={tasksError}
            />
        </>
    );
};

export default TeamEpisodeTemplatesSection;
