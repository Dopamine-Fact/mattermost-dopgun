// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';
import {defineMessages} from 'react-intl';

import SaveChangesPanel, {type SaveChangesPanelState} from 'components/widgets/modals/components/save_changes_panel';

import {parseEpisodeFolders, serializeEpisodeFolders} from './episode_folders';
import type {EpisodeFolder} from './episode_folders';
import TeamEpisodeTemplatesSection from './team_episode_templates_section';
import TeamTasksSection from './team_tasks_section';

import type {PropsFromRedux, OwnProps} from '.';

import './team_episodes_tab.scss';

const translations = defineMessages({
    EpisodeFoldersInvalid: {
        id: 'general_tab.episodeFoldersInvalid',
        defaultMessage: 'Invalid default episode folders. Use at most 100 folders with valid names, make sure everyone who may change a folder can see it, and mirror only a plain folder that is not inside or around the mirror.',
    },
    EpisodeTasksInvalid: {
        id: 'general_tab.episodeTasksInvalid',
        defaultMessage: 'Invalid default episode tasks. Use at most 100 lines and 4000 characters.',
    },
});

type Props = PropsFromRedux & OwnProps;

const EpisodesTab = ({team, areThereUnsavedChanges, showTabSwitchError, setShowTabSwitchError, setAreThereUnsavedChanges, actions}: Props) => {
    const [tasksEnabled, setTasksEnabled] = useState<boolean>(Boolean(team.tasks_enabled));
    const [revisionsEnabled, setRevisionsEnabled] = useState<boolean>(Boolean(team.revisions_enabled));
    const [canvasEnabled, setCanvasEnabled] = useState<boolean>(Boolean(team.canvas_enabled));
    const [episodeFolders, setEpisodeFolders] = useState<EpisodeFolder[]>(() => parseEpisodeFolders(team.episode_folders));
    const [episodeTasks, setEpisodeTasks] = useState<string>(team.episode_tasks ?? '');

    // Which template the server rejected on the last save.
    const [templateError, setTemplateError] = useState<'folders' | 'tasks'>();
    const [saveChangesPanelState, setSaveChangesPanelState] = useState<SaveChangesPanelState>();

    const handleSaveChanges = useCallback(async () => {
        const serializedFolders = serializeEpisodeFolders(episodeFolders);
        const foldersChanged = serializedFolders !== serializeEpisodeFolders(parseEpisodeFolders(team.episode_folders));
        const tasksChanged = episodeTasks !== (team.episode_tasks ?? '');
        const changed = foldersChanged || tasksChanged || tasksEnabled !== Boolean(team.tasks_enabled) || revisionsEnabled !== Boolean(team.revisions_enabled) || canvasEnabled !== Boolean(team.canvas_enabled);
        if (changed) {
            const {error} = await actions.patchTeam({
                id: team.id,
                tasks_enabled: tasksEnabled,
                revisions_enabled: revisionsEnabled,
                canvas_enabled: canvasEnabled,
                ...(foldersChanged && {episode_folders: serializedFolders}),
                ...(tasksChanged && {episode_tasks: episodeTasks}),
            });
            if (error) {
                const errorId = (error as {server_error_id?: string}).server_error_id;
                if (errorId === 'model.team.is_valid.episode_folders.app_error') {
                    setTemplateError('folders');
                } else if (errorId === 'model.team.is_valid.episode_tasks.app_error') {
                    setTemplateError('tasks');
                }
                setSaveChangesPanelState('error');
                return;
            }
        }
        setTemplateError(undefined);
        setSaveChangesPanelState('saved');
        setShowTabSwitchError(false);
        setAreThereUnsavedChanges(false);
    }, [actions, tasksEnabled, revisionsEnabled, canvasEnabled, episodeFolders, episodeTasks, team.id, team.tasks_enabled, team.revisions_enabled, team.canvas_enabled, team.episode_folders, team.episode_tasks, setShowTabSwitchError, setAreThereUnsavedChanges]);

    const handleClose = useCallback(() => {
        setSaveChangesPanelState('editing');
        setAreThereUnsavedChanges(false);
        setShowTabSwitchError(false);
    }, [setShowTabSwitchError, setAreThereUnsavedChanges]);

    const handleCancel = useCallback(() => {
        setTasksEnabled(Boolean(team.tasks_enabled));
        setRevisionsEnabled(Boolean(team.revisions_enabled));
        setCanvasEnabled(Boolean(team.canvas_enabled));
        setEpisodeFolders(parseEpisodeFolders(team.episode_folders));
        setEpisodeTasks(team.episode_tasks ?? '');
        setTemplateError(undefined);
        handleClose();
    }, [handleClose, team.tasks_enabled, team.revisions_enabled, team.canvas_enabled, team.episode_folders, team.episode_tasks]);

    // Every field marks the tab as edited before taking its new value.
    const edited = useCallback(<T, >(set: (value: T) => void) => (value: T) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        set(value);
    }, [setAreThereUnsavedChanges]);

    return (
        <div
            className='modal-info-tab-content user-settings'
            id='episodesSettings'
            aria-labelledby='episodesButton'
            role='tabpanel'
        >
            <TeamTasksSection
                tasksEnabled={tasksEnabled}
                handleTasksEnabledChange={edited(setTasksEnabled)}
                revisionsEnabled={revisionsEnabled}
                handleRevisionsEnabledChange={edited(setRevisionsEnabled)}
                canvasEnabled={canvasEnabled}
                handleCanvasEnabledChange={edited(setCanvasEnabled)}
            />
            {tasksEnabled && revisionsEnabled && (
                <TeamEpisodeTemplatesSection
                    teamId={team.id}
                    folders={episodeFolders}
                    tasks={episodeTasks}
                    handleFoldersChange={edited(setEpisodeFolders)}
                    handleTasksChange={edited(setEpisodeTasks)}
                    foldersError={templateError === 'folders' ? translations.EpisodeFoldersInvalid : undefined}
                    tasksError={templateError === 'tasks' ? translations.EpisodeTasksInvalid : undefined}
                />
            )}
            {(areThereUnsavedChanges || saveChangesPanelState === 'saved') && (
                <SaveChangesPanel
                    handleCancel={handleCancel}
                    handleSubmit={handleSaveChanges}
                    handleClose={handleClose}
                    tabChangeError={showTabSwitchError}
                    state={saveChangesPanelState}
                />
            )}
        </div>
    );
};

export default EpisodesTab;
