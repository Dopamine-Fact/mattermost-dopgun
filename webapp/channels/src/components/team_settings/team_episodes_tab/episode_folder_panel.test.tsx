// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, within} from '@testing-library/react';
import React from 'react';

import {renderWithContext, userEvent} from 'tests/react_testing_utils';

import EpisodeFolderPanel from './episode_folder_panel';
import type {EpisodeFolder} from './episode_folders';

const BG = 'b'.repeat(26);
const ANIM = 'a'.repeat(26);

jest.mock('components/profile_popover/use_custom_roles', () => ({
    useTeamDepartments: () => [
        {id: 'b'.repeat(26), name: 'BG', color: '#000', ranks: []},
        {id: 'a'.repeat(26), name: 'ANIM', color: '#000', ranks: []},
    ],
}));

describe('EpisodeFolderPanel', () => {
    const folders: EpisodeFolder[] = [{path: 'BG'}, {path: 'BG/Layout'}, {path: 'Anim'}, {path: 'Anim/Layout'}];

    const setup = (list: EpisodeFolder[] = folders) => {
        const onChange = jest.fn();
        renderWithContext(
            <EpisodeFolderPanel
                teamId='team_id'
                folders={list}
                onChange={onChange}
            />,
        );
        return onChange;
    };
    const select = (path: string) => userEvent.click(screen.getByRole('button', {name: path}));
    const group = (name: string) => within(screen.getByRole('group', {name}));

    test('choosing departments under Who sees it restricts the folder', async () => {
        const onChange = setup();
        await select('BG/Layout');
        await userEvent.click(group('Who sees it').getByRole('radio', {name: 'Chosen departments'}));
        await userEvent.click(group('Who sees it').getByRole('checkbox', {name: 'BG'}));

        expect(onChange).toHaveBeenLastCalledWith(folders.map((f) => (f.path === 'BG/Layout' ? {path: 'BG/Layout', view_departments: [BG]} : f)));
    });

    test('narrowing the viewers drops writers who can no longer see the folder', async () => {
        const onChange = setup([{path: 'A', write_departments: [BG, ANIM]}]);
        await select('A');
        await userEvent.click(group('Who sees it').getByRole('radio', {name: 'Chosen departments'}));
        await userEvent.click(group('Who sees it').getByRole('checkbox', {name: 'BG'}));

        expect(onChange).toHaveBeenLastCalledWith([{path: 'A', view_departments: [BG], write_departments: [BG]}]);
    });

    test('Nobody makes the folder read-only', async () => {
        const onChange = setup();
        await select('BG/Layout');
        await userEvent.click(group('Who may change it').getByRole('radio', {name: 'Nobody'}));

        expect(onChange).toHaveBeenLastCalledWith(folders.map((f) => (f.path === 'BG/Layout' ? {path: 'BG/Layout', read_only: true} : f)));
    });

    test('a mirror takes its source and gives up its writers', async () => {
        const onChange = setup([{path: 'BG/Layout'}, {path: 'Anim/Layout', view_departments: [ANIM], write_departments: [ANIM]}]);
        await select('Anim/Layout');
        await userEvent.click(group('Contents').getByRole('radio', {name: 'Mirror of'}));
        await userEvent.selectOptions(group('Contents').getByRole('combobox'), 'BG/Layout');

        expect(onChange).toHaveBeenLastCalledWith([{path: 'BG/Layout'}, {path: 'Anim/Layout', view_departments: [ANIM], mirror_of: 'BG/Layout'}]);
    });

    test('an unknown department id shows as a removable deleted department', async () => {
        const gone = 'g'.repeat(26);
        const onChange = setup([{path: 'A', view_departments: [gone]}]);
        await select('A');
        await userEvent.click(group('Who sees it').getByRole('checkbox', {name: 'Deleted department'}));

        expect(onChange).toHaveBeenLastCalledWith([{path: 'A'}]);
    });

    test('adding, renaming and deleting folders', async () => {
        const onChange = setup([{path: 'A'}]);
        await userEvent.click(screen.getByRole('button', {name: 'Add subfolder to A'}));
        expect(onChange).toHaveBeenLastCalledWith([{path: 'A'}, {path: 'A/New folder'}]);

        await userEvent.click(screen.getByRole('button', {name: 'Rename A'}));
        await userEvent.clear(screen.getByRole('textbox', {name: 'Folder name'}));
        await userEvent.type(screen.getByRole('textbox', {name: 'Folder name'}), 'B{Enter}');
        expect(onChange).toHaveBeenLastCalledWith([{path: 'B'}]);

        await userEvent.click(screen.getByRole('button', {name: 'Delete A'}));
        expect(onChange).toHaveBeenLastCalledWith([]);
    });

    test('narrowing the viewers so no writer is left makes the folder read-only', async () => {
        const onChange = setup([{path: 'A', view_departments: [BG, ANIM], write_departments: [ANIM]}]);
        await select('A');
        await userEvent.click(group('Who sees it').getByRole('checkbox', {name: 'ANIM'}));

        expect(onChange).toHaveBeenLastCalledWith([{path: 'A', view_departments: [BG], read_only: true}]);
        expect(group('Who may change it').getByRole('radio', {name: 'Nobody'})).toBeChecked();
    });

    test('a change that would push the template over the size limit is refused', async () => {
        const folder = (n: number, pad = 0): EpisodeFolder => ({path: 'A' + 'p'.repeat(pad), view_departments: Array.from({length: n}, () => 'x'.repeat(26))});
        const size = (f: EpisodeFolder) => JSON.stringify([f]).length;

        // Pad the template to 99990 characters, so adding a folder crosses 100000.
        let n = 0;
        while (size(folder(n + 1)) <= 99990) {
            n++;
        }
        const onChange = setup([folder(n, 99990 - size(folder(n)))]);
        await userEvent.click(screen.getByRole('button', {name: 'Add folder'}));

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('too large');
    });
});
