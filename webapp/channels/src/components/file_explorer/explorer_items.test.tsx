// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {DriveItem} from '@mattermost/types/drive';

import {getFileThumbnailUrl} from 'mattermost-redux/utils/file_utils';

import {fireEvent, renderWithContext, screen} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import ExplorerItems from './explorer_items';
import type {ExplorerEntry} from './use_explorer_data';

const image = TestHelper.getFileInfoMock({id: 'f1', name: 'cat.png', extension: 'png', has_preview_image: true, mime_type: 'image/png'});
const doc = TestHelper.getFileInfoMock({id: 'f2', name: 'notes.txt', extension: 'txt', has_preview_image: false});
const entries: ExplorerEntry[] = [
    {key: 'i1', kind: 'file', name: 'cat.png', fileInfo: image, readOnly: false, canModify: true},
    {key: 'i2', kind: 'file', name: 'notes.txt', fileInfo: doc, readOnly: false, canModify: true},
];

const renderItems = (view: 'icons' | 'details', onSort = jest.fn()) => renderWithContext(
    <ExplorerItems
        entries={entries}
        view={view}
        selected={new Set()}
        sort={{by: 'name', desc: false}}
        onSort={onSort}
        onSelect={jest.fn()}
        onOpen={jest.fn()}
        onContextMenu={jest.fn()}
        onRenameDone={jest.fn()}
        getUserName={() => 'me'}
    />,
);

describe('ExplorerItems', () => {
    test('large icons show the thumbnail of an image and an icon otherwise', () => {
        renderItems('icons');
        const cat = screen.getByRole('gridcell', {name: 'cat.png'});
        expect(cat.querySelector('img')).toHaveAttribute('src', getFileThumbnailUrl('f1'));
        expect(screen.getByRole('gridcell', {name: 'notes.txt'}).querySelector('img')).toBeNull();
    });

    test('Details header click asks to sort by that column', () => {
        const onSort = jest.fn();
        renderItems('details', onSort);
        fireEvent.click(screen.getByRole('button', {name: 'Size'}));
        expect(onSort).toHaveBeenCalledWith('size');
    });

    test('only one item is tabbable at a time', () => {
        renderItems('icons');
        expect(screen.getAllByRole('gridcell').map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1']);
    });

    test('a read-only folder says so and a mirror says what it shows', () => {
        const item = (extra: Partial<DriveItem>): DriveItem => ({id: 'x', channel_id: 'c1', parent_id: '', type: 'folder', name: 'F', file_id: '', creator_id: 'me', create_at: 1, update_at: 1, delete_at: 0, deleted_by: '', ...extra});
        const folders: ExplorerEntry[] = [
            {key: 'a', kind: 'folder', name: 'Locked', driveItem: item({id: 'a', read_only: true}), readOnly: false, canModify: false},
            {key: 'b', kind: 'folder', name: 'Mirror', driveItem: item({id: 'b', mirror_of: 's'}), readOnly: false, canModify: false},
            {key: 'c', kind: 'folder', name: 'Plain', driveItem: item({id: 'c'}), readOnly: false, canModify: true},
        ];
        renderWithContext(
            <ExplorerItems
                entries={folders}
                view='details'
                selected={new Set()}
                sort={{by: 'name', desc: false}}
                onSort={jest.fn()}
                onSelect={jest.fn()}
                onOpen={jest.fn()}
                onContextMenu={jest.fn()}
                onRenameDone={jest.fn()}
                getUserName={() => 'me'}
            />,
        );
        expect(screen.getByTitle('Read-only folder')).toBeInTheDocument();
        expect(screen.getByTitle('Shows another folder')).toBeInTheDocument();
        expect(screen.getAllByTitle(/folder/i)).toHaveLength(2);
    });
});

describe('ExplorerItems task files', () => {
    const state = {
        entities: {
            teams: {currentTeamId: 'team1', teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team'})}},
            channels: {channels: {c1: TestHelper.getChannelMock({id: 'c1', team_id: 'team1', name: 'town'})}},
            tasks: {byId: {t1: {id: 't1', title: 'Storyboard', video_file_id: ''}}, sectionsById: {}},
        },
    };
    const taskEntry: ExplorerEntry = {key: 'task:f3', kind: 'task_file', name: 'board.png', fileInfo: TestHelper.getFileInfoMock({id: 'f3', name: 'board.png', extension: 'png', channel_id: 'c1'}), taskId: 't1', readOnly: false, canModify: true};

    test('a task file row carries a chip with the task title that opens the task', () => {
        renderWithContext(
            <ExplorerItems
                entries={[taskEntry]}
                view='details'
                selected={new Set()}
                sort={{by: 'name', desc: false}}
                onSort={jest.fn()}
                onSelect={jest.fn()}
                onOpen={jest.fn()}
                onContextMenu={jest.fn()}
                onRenameDone={jest.fn()}
                getUserName={() => 'me'}
            />,
            state as never,
        );
        expect(screen.getByRole('link', {name: 'Storyboard'})).toHaveAttribute('href', '/team/channels/town?task=t1');
    });

    test('a task file cannot be dragged', () => {
        renderWithContext(
            <ExplorerItems
                entries={[taskEntry]}
                view='icons'
                selected={new Set()}
                sort={{by: 'name', desc: false}}
                onSort={jest.fn()}
                onSelect={jest.fn()}
                onOpen={jest.fn()}
                onContextMenu={jest.fn()}
                onRenameDone={jest.fn()}
                onDragStart={jest.fn()}
                getUserName={() => 'me'}
            />,
            state as never,
        );
        expect(screen.getByRole('gridcell', {name: 'board.png'})).toHaveAttribute('draggable', 'false');
    });
});
