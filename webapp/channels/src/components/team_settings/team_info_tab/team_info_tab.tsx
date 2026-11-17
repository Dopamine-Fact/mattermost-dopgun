// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';
import type {ChangeEvent} from 'react';
import {defineMessages} from 'react-intl';

import type {Team} from '@mattermost/types/teams';

import type {BaseSettingItemProps} from 'components/widgets/modals/components/base_setting_item';
import SaveChangesPanel, {type SaveChangesPanelState} from 'components/widgets/modals/components/save_changes_panel';

import Constants from 'utils/constants';
import {imageURLForTeam} from 'utils/utils';

import TeamDailyReportsSection from './team_daily_reports_section';
import TeamDescriptionSection from './team_description_section';
import TeamFilesSection from './team_files_section';
import TeamNameSection from './team_name_section';
import TeamPictureSection from './team_picture_section';
import TeamTasksSection from './team_tasks_section';

import type {PropsFromRedux, OwnProps} from '.';

import './team_info_tab.scss';

const ACCEPTED_TEAM_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/bmp'];
const translations = defineMessages({
    Required: {
        id: 'general_tab.required',
        defaultMessage: 'This field is required',
    },
    TeamNameRestrictions: {
        id: 'general_tab.teamNameRestrictions',
        defaultMessage: 'Team Name must be {min} or more characters up to a maximum of {max}. You can add a longer team description.',
        values: {min: Constants.MIN_TEAMNAME_LENGTH, max: Constants.MAX_TEAMNAME_LENGTH},
    },
    TeamIconInvalidFileType: {
        id: 'general_tab.teamIconInvalidFileType',
        defaultMessage: 'Only BMP, JPG or PNG images may be used for team icons',
    },
    TeamIconTooLarge: {
        id: 'general_tab.teamIconTooLarge',
        defaultMessage: 'Unable to upload team icon. File is too large.',
    },
    TeamIconError: {
        id: 'general_tab.teamIconError',
        defaultMessage: 'An error occurred while selecting the image.',
    },
});

type Props = PropsFromRedux & OwnProps;

const DEFAULT_DAILY_REPORT_TIME = '18:00';

const InfoTab = ({team, areThereUnsavedChanges, maxFileSize, showTabSwitchError, setShowTabSwitchError, setAreThereUnsavedChanges, actions}: Props) => {
    const [name, setName] = useState<Team['display_name']>(team.display_name);
    const [description, setDescription] = useState<Team['description']>(team.description);
    const [tasksEnabled, setTasksEnabled] = useState<boolean>(Boolean(team.tasks_enabled));
    const [revisionsEnabled, setRevisionsEnabled] = useState<boolean>(Boolean(team.revisions_enabled));
    const [canvasEnabled, setCanvasEnabled] = useState<boolean>(Boolean(team.canvas_enabled));
    const [dailyReportsEnabled, setDailyReportsEnabled] = useState<boolean>(Boolean(team.daily_reports_enabled));
    const [dailyReportTime, setDailyReportTime] = useState<string>(team.daily_report_time || DEFAULT_DAILY_REPORT_TIME);
    const [filesEnabled, setFilesEnabled] = useState<boolean>(Boolean(team.files_enabled));
    const [teamIconFile, setTeamIconFile] = useState<File | undefined>();
    const [loading, setLoading] = useState<boolean>(false);
    const [imageClientError, setImageClientError] = useState<BaseSettingItemProps['error'] | undefined>();
    const [nameClientError, setNameClientError] = useState<BaseSettingItemProps['error'] | undefined>();
    const [saveChangesPanelState, setSaveChangesPanelState] = useState<SaveChangesPanelState>();

    const handleNameDescriptionSubmit = useCallback(async (): Promise<boolean> => {
        if (name.trim() === team.display_name && description === team.description && tasksEnabled === Boolean(team.tasks_enabled) && revisionsEnabled === Boolean(team.revisions_enabled) && canvasEnabled === Boolean(team.canvas_enabled) && dailyReportsEnabled === Boolean(team.daily_reports_enabled) && dailyReportTime === (team.daily_report_time || DEFAULT_DAILY_REPORT_TIME) && filesEnabled === Boolean(team.files_enabled)) {
            return true;
        }

        if (!name) {
            setNameClientError(translations.Required);
            return false;
        } else if (name.length < Constants.MIN_TEAMNAME_LENGTH) {
            setNameClientError(translations.TeamNameRestrictions);
            return false;
        }
        setNameClientError(undefined);
        const dailyReportsChanged = dailyReportsEnabled !== Boolean(team.daily_reports_enabled) || dailyReportTime !== (team.daily_report_time || DEFAULT_DAILY_REPORT_TIME);

        // The timezone travels only with the daily-report fields, so renaming the team never moves its reporting timezone.
        const {error} = await actions.patchTeam({
            id: team.id,
            display_name: name,
            description,
            tasks_enabled: tasksEnabled,
            revisions_enabled: revisionsEnabled,
            canvas_enabled: canvasEnabled,
            ...(dailyReportsChanged && {
                daily_reports_enabled: dailyReportsEnabled,
                daily_report_time: dailyReportTime,
                daily_report_timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
            ...(filesEnabled !== Boolean(team.files_enabled) && {files_enabled: filesEnabled}),
        });
        if (error) {
            return false;
        }
        return true;
    }, [actions, description, name, tasksEnabled, revisionsEnabled, canvasEnabled, dailyReportsEnabled, dailyReportTime, filesEnabled, team.description, team.display_name, team.id, team.tasks_enabled, team.revisions_enabled, team.canvas_enabled, team.daily_reports_enabled, team.daily_report_time, team.files_enabled]);

    const handleTeamIconSubmit = useCallback(async (): Promise<boolean> => {
        if (!teamIconFile) {
            return true;
        }
        setLoading(true);
        setImageClientError(undefined);
        const {error} = await actions.setTeamIcon(team.id, teamIconFile);
        setLoading(false);
        if (error) {
            return false;
        }
        return true;
    }, [actions, team, teamIconFile]);

    const handleSaveChanges = useCallback(async () => {
        const nameDescriptionSuccess = await handleNameDescriptionSubmit();
        const teamIconSuccess = await handleTeamIconSubmit();
        if (!teamIconSuccess || !nameDescriptionSuccess) {
            setSaveChangesPanelState('error');
            return;
        }
        setSaveChangesPanelState('saved');
        setShowTabSwitchError(false);

        setAreThereUnsavedChanges(false);
    }, [handleNameDescriptionSubmit, handleTeamIconSubmit, setShowTabSwitchError, setAreThereUnsavedChanges]);

    const handleClose = useCallback(() => {
        setSaveChangesPanelState('editing');
        setAreThereUnsavedChanges(false);
        setShowTabSwitchError(false);
    }, [setShowTabSwitchError, setAreThereUnsavedChanges]);

    const handleCancel = useCallback(() => {
        setName(team.display_name ?? team.name);
        setDescription(team.description);
        setTasksEnabled(Boolean(team.tasks_enabled));
        setRevisionsEnabled(Boolean(team.revisions_enabled));
        setCanvasEnabled(Boolean(team.canvas_enabled));
        setDailyReportsEnabled(Boolean(team.daily_reports_enabled));
        setDailyReportTime(team.daily_report_time || DEFAULT_DAILY_REPORT_TIME);
        setFilesEnabled(Boolean(team.files_enabled));
        setTeamIconFile(undefined);
        setImageClientError(undefined);
        setNameClientError(undefined);
        handleClose();
    }, [handleClose, team.description, team.display_name, team.name, team.tasks_enabled, team.revisions_enabled, team.canvas_enabled, team.daily_reports_enabled, team.daily_report_time, team.files_enabled]);

    const handleTeamIconRemove = useCallback(async () => {
        setLoading(true);
        setImageClientError(undefined);
        setTeamIconFile(undefined);
        handleClose();

        const {error} = await actions.removeTeamIcon(team.id);
        setLoading(false);
        if (error) {
            setSaveChangesPanelState('error');
            setAreThereUnsavedChanges(true);
            setShowTabSwitchError(true);
        }
    }, [actions, handleClose, setShowTabSwitchError, setAreThereUnsavedChanges, team.id]);

    const updateTeamIcon = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        if (e && e.target && e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            if (!ACCEPTED_TEAM_IMAGE_TYPES.includes(file.type)) {
                setImageClientError(translations.TeamIconInvalidFileType);
            } else if (file.size > maxFileSize) {
                setImageClientError(translations.TeamIconTooLarge);
            } else {
                setTeamIconFile(file);
                setImageClientError(undefined);
                setSaveChangesPanelState('editing');
                setAreThereUnsavedChanges(true);
            }
        } else {
            setTeamIconFile(undefined);
            setImageClientError(translations.TeamIconError);
        }
    }, [maxFileSize, setAreThereUnsavedChanges]);

    const handleNameChanges = useCallback((name: string) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setName(name);
    }, [setAreThereUnsavedChanges]);

    const handleDescriptionChanges = useCallback((description: string) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setDescription(description);
    }, [setAreThereUnsavedChanges]);

    const handleTasksEnabledChange = useCallback((enabled: boolean) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setTasksEnabled(enabled);
    }, [setAreThereUnsavedChanges]);

    const handleRevisionsEnabledChange = useCallback((enabled: boolean) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setRevisionsEnabled(enabled);
    }, [setAreThereUnsavedChanges]);

    const handleCanvasEnabledChange = useCallback((enabled: boolean) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setCanvasEnabled(enabled);
    }, [setAreThereUnsavedChanges]);

    const handleDailyReportsEnabledChange = useCallback((enabled: boolean) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setDailyReportsEnabled(enabled);
    }, [setAreThereUnsavedChanges]);

    const handleFilesEnabledChange = useCallback((enabled: boolean) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setFilesEnabled(enabled);
    }, [setAreThereUnsavedChanges]);

    const handleDailyReportTimeChange = useCallback((time: string) => {
        setAreThereUnsavedChanges(true);
        setSaveChangesPanelState('editing');
        setDailyReportTime(time);
    }, [setAreThereUnsavedChanges]);

    return (
        <div
            className='modal-info-tab-content user-settings'
            id='infoSettings'
            aria-labelledby='infoButton'
            role='tabpanel'
        >
            <div className='team-info-top-row'>
                <div className='name-description-container'>
                    <TeamNameSection
                        name={name}
                        clientError={nameClientError}
                        handleNameChanges={handleNameChanges}
                    />
                    <TeamDescriptionSection
                        description={description}
                        handleDescriptionChanges={handleDescriptionChanges}
                    />
                </div>
                <TeamPictureSection
                    imageSrc={imageURLForTeam(team)}
                    file={teamIconFile}
                    disabled={loading}
                    onFileChange={updateTeamIcon}
                    onRemove={handleTeamIconRemove}
                    teamName={team.display_name ?? team.name}
                    clientError={imageClientError}
                />
            </div>
            <div className='team-features-container'>
                <TeamTasksSection
                    tasksEnabled={tasksEnabled}
                    handleTasksEnabledChange={handleTasksEnabledChange}
                    revisionsEnabled={revisionsEnabled}
                    handleRevisionsEnabledChange={handleRevisionsEnabledChange}
                    canvasEnabled={canvasEnabled}
                    handleCanvasEnabledChange={handleCanvasEnabledChange}
                />
                <TeamDailyReportsSection
                    dailyReportsEnabled={dailyReportsEnabled}
                    handleDailyReportsEnabledChange={handleDailyReportsEnabledChange}
                    dailyReportTime={dailyReportTime}
                    dailyReportTimezone={team.daily_report_timezone ?? ''}
                    handleDailyReportTimeChange={handleDailyReportTimeChange}
                />
                <TeamFilesSection
                    filesEnabled={filesEnabled}
                    handleFilesEnabledChange={handleFilesEnabledChange}
                />
            </div>
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

export default InfoTab;
