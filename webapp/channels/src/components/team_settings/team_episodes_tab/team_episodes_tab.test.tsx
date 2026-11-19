// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import React from 'react';
import type {ComponentProps} from 'react';

import {renderWithContext, userEvent} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import EpisodesTab from './team_episodes_tab';

jest.mock('components/profile_popover/use_custom_roles', () => ({
    useTeamDepartments: () => [],
}));

describe('components/TeamSettings/EpisodesTab', () => {
    const patchTeam = jest.fn().mockReturnValue({data: true});
    const getTeam = jest.fn();
    const defaultProps: ComponentProps<typeof EpisodesTab> = {
        team: TestHelper.getTeamMock({id: 'team_id', name: 'team_name', display_name: 'team_display_name', description: 'team_description'}),
        actions: {patchTeam, getTeam},
        areThereUnsavedChanges: true,
        showTabSwitchError: false,
        setAreThereUnsavedChanges: jest.fn(),
        setShowTabSwitchError: jest.fn(),
    };

    // The tab reads the templates from a fresh copy of the team.
    beforeEach(() => getTeam.mockResolvedValue({data: defaultProps.team}));

    test('revision channels can be turned on only together with tasks', async () => {
        renderWithContext(<EpisodesTab {...defaultProps}/>);
        expect(screen.queryByTestId('revisionsEnabledCheckbox')).not.toBeInTheDocument();

        await userEvent.click(screen.getByTestId('tasksEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('revisionsEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledWith(expect.objectContaining({tasks_enabled: true, revisions_enabled: true}));
    });

    test('canvas channels can be toggled independently of tasks', async () => {
        renderWithContext(<EpisodesTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('canvasEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledWith(expect.objectContaining({tasks_enabled: false, canvas_enabled: true}));
    });

    test('saving sends only the episode fields', async () => {
        renderWithContext(<EpisodesTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('canvasEnabledCheckbox'));
        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).toHaveBeenCalledTimes(1);
        expect(patchTeam).toHaveBeenCalledWith({id: 'team_id', tasks_enabled: false, revisions_enabled: false, canvas_enabled: true});
    });

    test('the save panel shows only after the first edit', async () => {
        const setAreThereUnsavedChanges = jest.fn();
        const {rerender} = renderWithContext(
            <EpisodesTab {...{...defaultProps, areThereUnsavedChanges: false, setAreThereUnsavedChanges}}/>,
        );
        expect(screen.queryByTestId('SaveChangesPanel__save-btn')).not.toBeInTheDocument();

        await userEvent.click(screen.getByTestId('canvasEnabledCheckbox'));
        expect(setAreThereUnsavedChanges).toHaveBeenCalledWith(true);
        rerender(<EpisodesTab {...{...defaultProps, areThereUnsavedChanges: true, setAreThereUnsavedChanges}}/>);

        expect(screen.getByTestId('SaveChangesPanel__save-btn')).toBeInTheDocument();
    });

    test('saving with nothing changed sends nothing', async () => {
        renderWithContext(<EpisodesTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

        expect(patchTeam).not.toHaveBeenCalled();
    });

    describe('episode templates', () => {
        const team = TestHelper.getTeamMock({id: 'team_id', display_name: 'team_display_name', tasks_enabled: true, revisions_enabled: true, episode_folders: 'Layout', episode_tasks: ''});
        beforeEach(() => getTeam.mockResolvedValue({data: team}));

        test('the templates come from a fresh copy of the team, not the stripped one in the store', async () => {
            // A team websocket event strips the templates for every member, managers included.
            const stripped = {...team, episode_folders: '', episode_tasks: ''};
            renderWithContext(<EpisodesTab {...{...defaultProps, team: stripped}}/>);

            expect(getTeam).toHaveBeenCalledWith('team_id');
            expect(await screen.findByRole('button', {name: 'Layout'})).toBeInTheDocument();

            await userEvent.type(screen.getByTestId('episodeTasksInput'), 'Storyboard');
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));
            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({episode_tasks: 'Storyboard'}));
            expect(patchTeam.mock.lastCall[0]).not.toHaveProperty('episode_folders');
        });

        test('the templates cannot be edited until the fresh team has loaded', () => {
            getTeam.mockReturnValue(new Promise(() => {}));
            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);

            expect(screen.queryByTestId('episodeFoldersPanel')).not.toBeInTheDocument();
            expect(screen.queryByTestId('episodeTasksInput')).not.toBeInTheDocument();
        });

        test('template fields show only with tasks and revisions on', async () => {
            const {unmount} = renderWithContext(<EpisodesTab {...defaultProps}/>);
            expect(screen.queryByTestId('episodeFoldersPanel')).not.toBeInTheDocument();
            await userEvent.click(screen.getByTestId('tasksEnabledCheckbox'));
            expect(screen.queryByTestId('episodeTasksInput')).not.toBeInTheDocument();
            await userEvent.click(screen.getByTestId('revisionsEnabledCheckbox'));
            expect(screen.getByTestId('episodeTasksInput')).toBeInTheDocument();
            unmount();

            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);
            expect(await screen.findByTestId('episodeFoldersPanel')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Layout'})).toBeInTheDocument();
            expect(screen.getByRole('heading', {name: 'Default episode folders'})).toBeInTheDocument();
            expect(screen.getByRole('heading', {name: 'Default episode tasks'})).toBeInTheDocument();
        });

        test('editing a template marks unsaved changes and saves it in the patch', async () => {
            const setAreThereUnsavedChanges = jest.fn();
            renderWithContext(<EpisodesTab {...{...defaultProps, team, setAreThereUnsavedChanges}}/>);

            await userEvent.type(await screen.findByTestId('episodeTasksInput'), 'Storyboard');
            expect(setAreThereUnsavedChanges).toHaveBeenCalledWith(true);
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({episode_tasks: 'Storyboard'}));
            expect(patchTeam.mock.lastCall[0]).not.toHaveProperty('episode_folders');
        });

        test('an old text template opened and not touched shows no save panel', async () => {
            renderWithContext(<EpisodesTab {...{...defaultProps, team, areThereUnsavedChanges: false}}/>);
            await screen.findByTestId('episodeFoldersPanel');

            expect(screen.queryByTestId('SaveChangesPanel__save-btn')).not.toBeInTheDocument();
        });

        test('saving a changed folder list sends the serialized JSON', async () => {
            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);

            await userEvent.click(await screen.findByRole('button', {name: 'Add folder'}));
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({
                episode_folders: '[{"path":"Layout"},{"path":"New folder"}]',
            }));
        });

        test('a rejected folder template shows the error under the panel', async () => {
            patchTeam.mockReturnValueOnce({error: {server_error_id: 'model.team.is_valid.episode_folders.app_error', message: 'Invalid default episode folders.'}});
            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);

            await userEvent.click(await screen.findByRole('button', {name: 'Add folder'}));
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            const error = await screen.findByTestId('mm-modal-generic-section-item__error');
            expect(error).toHaveTextContent('Invalid default episode folders.');
            expect(error.closest('.episode-folders-setting-item')).not.toBeNull();
        });
    });

    test('cancel restores the canvas toggle', async () => {
        renderWithContext(<EpisodesTab {...defaultProps}/>);

        await userEvent.click(screen.getByTestId('canvasEnabledCheckbox'));
        expect(screen.getByTestId('canvasEnabledCheckbox')).toBeChecked();
        await userEvent.click(screen.getByTestId('SaveChangesPanel__cancel-btn'));

        expect(screen.getByTestId('canvasEnabledCheckbox')).not.toBeChecked();
    });
});
