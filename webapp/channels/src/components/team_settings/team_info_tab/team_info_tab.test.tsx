// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import React from 'react';
import type {ComponentProps} from 'react';

import {renderWithContext, userEvent} from 'tests/react_testing_utils';
import Constants from 'utils/constants';
import {TestHelper} from 'utils/test_helper';

import InfoTab from './team_info_tab';

describe('components/TeamSettings', () => {
    const getTeam = jest.fn().mockResolvedValue({data: true});
    const patchTeam = jest.fn().mockReturnValue({data: true});
    const removeTeamIcon = jest.fn().mockReturnValue({data: true});
    const setTeamIcon = jest.fn().mockReturnValue({data: true});
    const baseActions = {
        getTeam,
        patchTeam,
        removeTeamIcon,
        setTeamIcon,
    };
    const defaultProps: ComponentProps<typeof InfoTab> = {
        team: TestHelper.getTeamMock({id: 'team_id', name: 'team_name', display_name: 'team_display_name', description: 'team_description'}),
        maxFileSize: 50,
        actions: baseActions,
        areThereUnsavedChanges: true,
        showTabSwitchError: false,
        setAreThereUnsavedChanges: jest.fn(),
        setShowTabSwitchError: jest.fn(),
    };

    beforeEach(() => {
        global.URL.createObjectURL = jest.fn();
    });

    test('should show an error when pdf file is uploaded', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const file = new File(['pdf'], 'pdf.pdf', {type: 'application/pdf'});
        const input = screen.getByTestId('uploadPicture');
        await userEvent.upload(input, file, {applyAccept: false});

        const error = screen.getByTestId('mm-modal-generic-section-item__error');
        expect(error).toBeVisible();
        expect(error).toHaveTextContent('Only BMP, JPG or PNG images may be used for team icons');
    });

    test('should show an error when too large file is uploaded with 40mb', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const file = new File(['test'], 'test.png', {type: 'image/png'});
        Object.defineProperty(file, 'size', {value: defaultProps.maxFileSize + 1});
        const input = screen.getByTestId('uploadPicture');
        await userEvent.upload(input, file);

        const error = screen.getByTestId('mm-modal-generic-section-item__error');
        expect(error).toBeVisible();
        expect(error).toHaveTextContent('Unable to upload team icon. File is too large.');
    });

    test('should call setTeamIcon when an image is uploaded and saved', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const file = new File(['test'], 'test.png', {type: 'image/png'});
        const input = screen.getByTestId('uploadPicture');
        await userEvent.upload(input, file);

        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        expect(setTeamIcon).toHaveBeenCalledTimes(1);
        expect(setTeamIcon).toHaveBeenCalledWith(defaultProps.team?.id, file);
    });

    test('should call setTeamIcon when an image is removed', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const file = new File(['test'], 'test.png', {type: 'image/png'});
        const input = screen.getByTestId('uploadPicture');
        await userEvent.upload(input, file);

        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        const removeImageButton = screen.getByTestId('removeImageButton');
        await userEvent.click(removeImageButton);

        expect(removeTeamIcon).toHaveBeenCalledTimes(1);
        expect(removeTeamIcon).toHaveBeenCalledWith(defaultProps.team?.id);
    });

    test('should show an error when team name is empty', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const input = screen.getByTestId('teamNameInput');

        await userEvent.clear(input);
        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        const error = screen.getByTestId('mm-modal-generic-section-item__error');
        expect(error).toBeVisible();
        expect(error).toHaveTextContent('This field is required');
    });

    test('should show an error when team name is too short', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const input = screen.getByTestId('teamNameInput');
        await userEvent.clear(input);
        await userEvent.type(input, 'a');
        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        const error = screen.getByTestId('mm-modal-generic-section-item__error');
        expect(error).toBeVisible();
        expect(error).toHaveTextContent(`Team Name must be ${Constants.MIN_TEAMNAME_LENGTH} or more characters up to a maximum of ${Constants.MAX_TEAMNAME_LENGTH}. You can add a longer team description.`);
    });

    test('should call patchTeam when team name is changed and clicked saved', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const input = screen.getByTestId('teamNameInput');
        await userEvent.clear(input);
        await userEvent.type(input, 'new_team_name');
        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        expect(patchTeam).toHaveBeenCalledTimes(1);
        expect(patchTeam).toHaveBeenCalledWith({id: defaultProps.team?.id, display_name: 'new_team_name', description: defaultProps.team?.description, tasks_enabled: false, revisions_enabled: false, canvas_enabled: false});
    });

    test('should call patchTeam when team description is changed and clicked saved', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const input = screen.getByTestId('teamDescriptionInput');
        await userEvent.clear(input);
        await userEvent.type(input, 'new_team_description');
        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        expect(patchTeam).toHaveBeenCalledTimes(1);
        expect(patchTeam).toHaveBeenCalledWith({id: defaultProps.team?.id, display_name: defaultProps.team?.display_name, description: 'new_team_description', tasks_enabled: false, revisions_enabled: false, canvas_enabled: false});
    });

    test('should call patchTeam when team name and description are change and clicked saved', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        const nameInput = screen.getByTestId('teamNameInput');
        const descriptionInput = screen.getByTestId('teamDescriptionInput');
        await userEvent.clear(nameInput);
        await userEvent.type(nameInput, 'new_team_name');
        await userEvent.clear(descriptionInput);
        await userEvent.type(descriptionInput, 'new_team_description');
        const saveButton = screen.getByTestId('SaveChangesPanel__save-btn');
        await userEvent.click(saveButton);

        expect(patchTeam).toHaveBeenCalledTimes(1);
        expect(patchTeam).toHaveBeenCalledWith({id: defaultProps.team?.id, display_name: 'new_team_name', description: 'new_team_description', tasks_enabled: false, revisions_enabled: false, canvas_enabled: false});
    });

    test('revision channels can be turned on only together with tasks', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);
        expect(screen.queryByTestId('revisionsEnabledCheckbox')).not.toBeInTheDocument();

        await userEvent.click(screen.getByTestId('tasksEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('revisionsEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledWith(expect.objectContaining({tasks_enabled: true, revisions_enabled: true}));
    });

    test('sends the timezone only when the daily report settings change', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('dailyReportsEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledWith(expect.objectContaining({daily_reports_enabled: true, daily_report_time: '18:00', daily_report_timezone: expect.any(String)}));
    });

    test('canvas channels can be toggled independently of tasks', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('canvasEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledWith(expect.objectContaining({tasks_enabled: false, canvas_enabled: true}));
    });

    test('turning files on sends files_enabled', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('filesEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledWith(expect.objectContaining({files_enabled: true}));
    });

    describe('episode templates', () => {
        const team = TestHelper.getTeamMock({id: 'team_id', display_name: 'team_display_name', tasks_enabled: true, revisions_enabled: true, episode_folders: 'Layout', episode_tasks: ''});

        test('template fields show only with tasks and revisions on', async () => {
            const {unmount} = renderWithContext(<InfoTab {...defaultProps}/>);
            expect(screen.queryByTestId('episodeFoldersInput')).not.toBeInTheDocument();
            await userEvent.click(screen.getByTestId('tasksEnabledCheckbox'));
            expect(screen.queryByTestId('episodeTasksInput')).not.toBeInTheDocument();
            await userEvent.click(screen.getByTestId('revisionsEnabledCheckbox'));
            expect(screen.getByTestId('episodeTasksInput')).toBeInTheDocument();
            unmount();

            renderWithContext(<InfoTab {...{...defaultProps, team}}/>);
            expect(screen.getByTestId('episodeFoldersInput')).toHaveValue('Layout');
            expect(screen.getByRole('heading', {name: 'Default episode folders'})).toBeInTheDocument();
            expect(screen.getByRole('heading', {name: 'Default episode tasks'})).toBeInTheDocument();
        });

        test('editing a template marks unsaved changes and saves it in the patch', async () => {
            const setAreThereUnsavedChanges = jest.fn();
            renderWithContext(<InfoTab {...{...defaultProps, team, setAreThereUnsavedChanges}}/>);

            await userEvent.type(screen.getByTestId('episodeTasksInput'), 'Storyboard');
            expect(setAreThereUnsavedChanges).toHaveBeenCalledWith(true);
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({episode_tasks: 'Storyboard'}));
            expect(patchTeam.mock.lastCall[0]).not.toHaveProperty('episode_folders');
        });

        test('a rejected folder template shows the error under the field', async () => {
            patchTeam.mockReturnValueOnce({error: {server_error_id: 'model.team.is_valid.episode_folders.app_error', message: 'Invalid default episode folders.'}});
            renderWithContext(<InfoTab {...{...defaultProps, team}}/>);

            await userEvent.type(screen.getByTestId('episodeFoldersInput'), '/bad:name');
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            const error = await screen.findByTestId('mm-modal-generic-section-item__error');
            expect(error).toHaveTextContent('Invalid default episode folders.');
            expect(error.closest('.episode-folders-setting-item')).not.toBeNull();
        });
    });

    test('cancel restores the canvas toggle', async () => {
        renderWithContext(<InfoTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('canvasEnabledCheckbox'));
        expect(screen.getByTestId('canvasEnabledCheckbox')).toBeChecked();
        await userEvent.click(screen.getByTestId('SaveChangesPanel__cancel-btn'));

        expect(screen.getByTestId('canvasEnabledCheckbox')).not.toBeChecked();
    });
});
