// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import React from 'react';
import type {ComponentProps} from 'react';

import {renderWithContext, userEvent} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import EpisodesTab from './team_episodes_tab';

const mockLoadedDepartments = jest.fn((): unknown[] | undefined => undefined);
jest.mock('components/profile_popover/use_custom_roles', () => ({
    useTeamDepartments: () => [],
    useLoadedTeamDepartments: () => mockLoadedDepartments(),
}));

describe('components/TeamSettings/EpisodesTab', () => {
    const patchTeam = jest.fn().mockReturnValue({data: true});
    const defaultProps: ComponentProps<typeof EpisodesTab> = {
        team: TestHelper.getTeamMock({id: 'team_id', name: 'team_name', display_name: 'team_display_name', description: 'team_description'}),
        actions: {patchTeam},
        areThereUnsavedChanges: true,
        showTabSwitchError: false,
        setAreThereUnsavedChanges: jest.fn(),
        setShowTabSwitchError: jest.fn(),
    };

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

        test('template fields show only with tasks and revisions on', async () => {
            const {unmount} = renderWithContext(<EpisodesTab {...defaultProps}/>);
            expect(screen.queryByTestId('episodeFoldersPanel')).not.toBeInTheDocument();
            await userEvent.click(screen.getByTestId('tasksEnabledCheckbox'));
            expect(screen.queryByTestId('episodeTasksPanel')).not.toBeInTheDocument();
            await userEvent.click(screen.getByTestId('revisionsEnabledCheckbox'));
            expect(screen.getByTestId('episodeTasksPanel')).toBeInTheDocument();
            unmount();

            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);
            expect(screen.getByTestId('episodeFoldersPanel')).toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Layout'})).toBeInTheDocument();
            expect(screen.getByRole('heading', {name: 'Default episode folders'})).toBeInTheDocument();
            expect(screen.getByRole('heading', {name: 'Default episode tasks'})).toBeInTheDocument();
        });

        test('editing a template marks unsaved changes and saves it in the patch', async () => {
            const setAreThereUnsavedChanges = jest.fn();
            renderWithContext(<EpisodesTab {...{...defaultProps, team, setAreThereUnsavedChanges}}/>);

            await userEvent.click(screen.getByRole('button', {name: 'Add task'}));
            expect(setAreThereUnsavedChanges).toHaveBeenCalledWith(true);
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({episode_tasks: expect.stringContaining('"title":"New task"')}));
            expect(patchTeam.mock.lastCall[0]).not.toHaveProperty('episode_folders');
        });

        test('an old text template opened and not touched shows no save panel', () => {
            renderWithContext(<EpisodesTab {...{...defaultProps, team, areThereUnsavedChanges: false}}/>);

            expect(screen.queryByTestId('SaveChangesPanel__save-btn')).not.toBeInTheDocument();
        });

        test('saving a changed folder list sends the serialized JSON', async () => {
            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);

            await userEvent.click(screen.getByRole('button', {name: 'Add folder'}));
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({
                episode_folders: '[{"path":"Layout"},{"path":"New folder"}]',
            }));
        });

        test('saving clears a missing folder and a dangling waits-for', async () => {
            const stale = {...team, episode_tasks: '[{"key":"a","title":"A","folder":"Gone","waits_for":["zz"]}]'};
            renderWithContext(<EpisodesTab {...{...defaultProps, team: stale}}/>);

            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));

            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({episode_tasks: '[{"key":"a","title":"A"}]'}));
        });

        test('saving clears a department id when the team has no departments left, but not while they are unknown', async () => {
            const stale = {...team, episode_tasks: '[{"key":"a","title":"A","department_id":"' + 'd'.repeat(26) + '"}]'};
            mockLoadedDepartments.mockReturnValue([]);
            const {unmount} = renderWithContext(<EpisodesTab {...{...defaultProps, team: stale}}/>);
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));
            expect(patchTeam).toHaveBeenLastCalledWith(expect.objectContaining({episode_tasks: '[{"key":"a","title":"A"}]'}));
            unmount();

            patchTeam.mockClear();
            mockLoadedDepartments.mockReturnValue(undefined);
            renderWithContext(<EpisodesTab {...{...defaultProps, team: stale}}/>);
            await userEvent.click(screen.getByTestId('SaveChangesPanel__save-btn'));
            expect(patchTeam).not.toHaveBeenCalled();
        });

        test('a rejected folder template shows the error under the panel', async () => {
            patchTeam.mockReturnValueOnce({error: {server_error_id: 'model.team.is_valid.episode_folders.app_error', message: 'Invalid default episode folders.'}});
            renderWithContext(<EpisodesTab {...{...defaultProps, team}}/>);

            await userEvent.click(screen.getByRole('button', {name: 'Add folder'}));
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
