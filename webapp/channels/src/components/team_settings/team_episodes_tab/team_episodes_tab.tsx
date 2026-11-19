// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useMemo, useState} from 'react';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';

import {Button} from '@mattermost/compass-ui/components/button';

import {Client4} from 'mattermost-redux/client';

import ConfirmModal from 'components/confirm_modal';
import {refreshTeamDepartments, useLoadedTeamDepartments} from 'components/profile_popover/use_custom_roles';
import BaseSettingItem from 'components/widgets/modals/components/base_setting_item';
import SaveChangesPanel, {type SaveChangesPanelState} from 'components/widgets/modals/components/save_changes_panel';

import {DOPAMINE_DEPARTMENTS, buildDopamineTemplate} from './dopamine_preset';
import {parseEpisodeFolders, serializeEpisodeFolders} from './episode_folders';
import type {EpisodeFolder} from './episode_folders';
import {parseEpisodeTasks, sanitizeEpisodeTasks, serializeEpisodeTasks} from './episode_tasks';
import type {EpisodeTask} from './episode_tasks';
import TeamEpisodeTemplatesSection from './team_episode_templates_section';
import TeamTasksSection from './team_tasks_section';

import type {PropsFromRedux, OwnProps} from '.';

import './team_episodes_tab.scss';

const translations = defineMessages({
    EpisodeFoldersInvalid: {
        id: 'general_tab.episodeFoldersInvalid',
        defaultMessage: 'Invalid default episode folders. Use at most 100 folders and 100000 characters in total, with valid names, make sure everyone who may change a folder can see it, and mirror only a plain folder that is not inside or around the mirror.',
    },
    EpisodeTasksInvalid: {
        id: 'general_tab.episodeTasksInvalid',
        defaultMessage: 'Invalid default episode tasks. Use at most 100 tasks and 100000 characters in total, give every task a title and 0 to 365 days, avoid tasks that wait for each other in a loop, and pick only folders that hold their own files.',
    },
    PresetFailed: {
        id: 'team_settings.episodePreset.error',
        defaultMessage: "Could not load the Dopamine template. Check that you can manage this team's departments and try again.",
    },
});

type Props = PropsFromRedux & OwnProps;

const EpisodesTab = ({team, areThereUnsavedChanges, showTabSwitchError, setShowTabSwitchError, setAreThereUnsavedChanges, actions}: Props) => {
    const {formatMessage} = useIntl();
    const [tasksEnabled, setTasksEnabled] = useState<boolean>(Boolean(team.tasks_enabled));
    const [revisionsEnabled, setRevisionsEnabled] = useState<boolean>(Boolean(team.revisions_enabled));
    const [canvasEnabled, setCanvasEnabled] = useState<boolean>(Boolean(team.canvas_enabled));
    const [episodeFolders, setEpisodeFolders] = useState<EpisodeFolder[]>(() => parseEpisodeFolders(team.episode_folders));

    // Kept as the stored text, so a template nobody edits is never re-serialized into a change.
    const [episodeTasks, setEpisodeTasks] = useState<string>(team.episode_tasks ?? '');
    const departments = useLoadedTeamDepartments(team.id);
    const parsedTasks = useMemo(() => parseEpisodeTasks(episodeTasks), [episodeTasks]);

    // Which template the server rejected on the last save.
    const [templateError, setTemplateError] = useState<'folders' | 'tasks'>();
    const [saveChangesPanelState, setSaveChangesPanelState] = useState<SaveChangesPanelState>();
    const [presetConfirm, setPresetConfirm] = useState(false);
    const [presetLoading, setPresetLoading] = useState(false);
    const [presetFailed, setPresetFailed] = useState(false);

    const handleSaveChanges = useCallback(async () => {
        const serializedFolders = serializeEpisodeFolders(episodeFolders);
        const foldersChanged = serializedFolders !== serializeEpisodeFolders(parseEpisodeFolders(team.episode_folders));

        // Saving clears department, folder and waits-for references that point at nothing.
        const cleaned = serializeEpisodeTasks(sanitizeEpisodeTasks(parsedTasks, departments?.map((d) => d.id), episodeFolders.filter((f) => !f.mirror_of).map((f) => f.path)));
        const tasksChanged = episodeTasks !== (team.episode_tasks ?? '') || cleaned !== serializeEpisodeTasks(parsedTasks);
        const changed = foldersChanged || tasksChanged || tasksEnabled !== Boolean(team.tasks_enabled) || revisionsEnabled !== Boolean(team.revisions_enabled) || canvasEnabled !== Boolean(team.canvas_enabled);
        if (changed) {
            const {error} = await actions.patchTeam({
                id: team.id,
                tasks_enabled: tasksEnabled,
                revisions_enabled: revisionsEnabled,
                canvas_enabled: canvasEnabled,
                ...(foldersChanged && {episode_folders: serializedFolders}),
                ...(tasksChanged && {episode_tasks: cleaned}),
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
    }, [actions, parsedTasks, departments, tasksEnabled, revisionsEnabled, canvasEnabled, episodeFolders, episodeTasks, team.id, team.tasks_enabled, team.revisions_enabled, team.canvas_enabled, team.episode_folders, team.episode_tasks, setShowTabSwitchError, setAreThereUnsavedChanges]);

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

    // Creates the preset's missing departments (matched by name, so a second load adds none), then fills both templates; saving stays with the user.
    const loadPreset = async () => {
        setPresetConfirm(false);
        setPresetFailed(false);
        setPresetLoading(true);
        try {
            const existing = new Set((await Client4.getTeamDepartments(team.id)).map((d) => d.name.trim().toLowerCase()));
            for (const department of DOPAMINE_DEPARTMENTS) {
                if (!existing.has(department.name.toLowerCase())) {
                    // eslint-disable-next-line no-await-in-loop
                    await Client4.createDepartment(team.id, department);
                }
            }
            const all = await Client4.getTeamDepartments(team.id);

            // The save drops department ids its department list does not know, so reload that list first.
            await refreshTeamDepartments(team.id);
            const {folders, tasks} = buildDopamineTemplate(all);
            setTemplateError(undefined);
            edited(setEpisodeFolders)(folders);
            edited(setEpisodeTasks)(serializeEpisodeTasks(tasks));
        } catch {
            setPresetFailed(true);
        } finally {
            setPresetLoading(false);
        }
    };

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
                <BaseSettingItem
                    className='episode-preset-setting-item'
                    title={formatMessage({id: 'team_settings.episodePreset.title', defaultMessage: 'Dopamine template'})}
                    description={formatMessage({
                        id: 'team_settings.episodePreset.info',
                        defaultMessage: "Adds Dopamine's departments if they are missing and fills in its default episode folders and tasks below. Nothing changes for episodes until you save.",
                    })}
                    content={(
                        <Button
                            emphasis='tertiary'
                            size='small'
                            onClick={() => setPresetConfirm(true)}
                            disabled={presetLoading}
                            data-testid='episodePresetButton'
                        >
                            <FormattedMessage
                                id='team_settings.episodePreset.button'
                                defaultMessage='Load Dopamine template'
                            />
                        </Button>
                    )}
                    error={presetFailed ? translations.PresetFailed : undefined}
                />
            )}
            {tasksEnabled && revisionsEnabled && (
                <TeamEpisodeTemplatesSection
                    teamId={team.id}
                    folders={episodeFolders}
                    tasks={parsedTasks}
                    handleFoldersChange={edited(setEpisodeFolders)}
                    handleTasksChange={(next: EpisodeTask[]) => edited(setEpisodeTasks)(serializeEpisodeTasks(next))}
                    foldersError={templateError === 'folders' ? translations.EpisodeFoldersInvalid : undefined}
                    tasksError={templateError === 'tasks' ? translations.EpisodeTasksInvalid : undefined}
                />
            )}
            <ConfirmModal
                show={presetConfirm}
                title={(
                    <FormattedMessage
                        id='team_settings.episodePreset.confirmTitle'
                        defaultMessage='Load the Dopamine template?'
                    />
                )}
                message={(
                    <FormattedMessage
                        id='team_settings.episodePreset.confirmMessage'
                        defaultMessage='The default episode folders and tasks below will be replaced by the Dopamine template, and its missing departments will be created right away. The new template takes effect only after you save.'
                    />
                )}
                confirmButtonText={(
                    <FormattedMessage
                        id='team_settings.episodePreset.confirmButton'
                        defaultMessage='Load template'
                    />
                )}
                onConfirm={loadPreset}
                onCancel={() => setPresetConfirm(false)}
                isStacked={true}
            />
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
