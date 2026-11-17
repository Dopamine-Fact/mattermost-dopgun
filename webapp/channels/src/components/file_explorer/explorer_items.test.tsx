// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

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
});
