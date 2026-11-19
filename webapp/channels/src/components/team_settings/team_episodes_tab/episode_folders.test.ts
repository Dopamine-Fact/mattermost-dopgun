// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
    addEpisodeFolder,
    mirrorSources,
    parseEpisodeFolders,
    removeEpisodeFolder,
    renameEpisodeFolder,
    serializeEpisodeFolders,
} from './episode_folders';
import type {EpisodeFolder} from './episode_folders';

describe('episode folders', () => {
    const template: EpisodeFolder[] = [
        {path: 'BG'},
        {path: 'BG/Layout', view_departments: ['bg'], write_departments: ['bg']},
        {path: 'Anim'},
        {path: 'Anim/Layout', view_departments: ['anim'], read_only: true, mirror_of: 'BG/Layout'},
    ];

    test('old text lines become rule-less entries', () => {
        expect(parseEpisodeFolders('A\nA/B')).toEqual([{path: 'A'}, {path: 'A/B'}]);
        expect(parseEpisodeFolders(undefined)).toEqual([]);
    });

    test('a JSON template round trips unchanged', () => {
        const text = serializeEpisodeFolders(template);
        expect(parseEpisodeFolders(text)).toEqual(template);
        expect(serializeEpisodeFolders(parseEpisodeFolders(text))).toBe(text);
    });

    test('no folders serialize to an empty string', () => {
        expect(serializeEpisodeFolders([])).toBe('');
    });

    test('empty rule fields are omitted', () => {
        expect(serializeEpisodeFolders([{path: 'A', view_departments: [], read_only: false}])).toBe('[{"path":"A"}]');
    });

    test('new folders get a free name', () => {
        const first = addEpisodeFolder([{path: 'A'}], 'A');
        expect(first.path).toBe('A/New folder');
        const second = addEpisodeFolder(first.folders, 'A');
        expect(second.path).toBe('A/New folder (2)');
        expect(second.folders.map((f) => f.path)).toEqual(['A', 'A/New folder', 'A/New folder (2)']);
        expect(addEpisodeFolder([], '').path).toBe('New folder');
    });

    test('renaming moves descendants and mirror references', () => {
        const renamed = renameEpisodeFolder(template, 'BG', 'Background');
        expect(renamed.map((f) => f.path)).toEqual(['Background', 'Background/Layout', 'Anim', 'Anim/Layout']);
        expect(renamed[3].mirror_of).toBe('Background/Layout');
    });

    test('removing a folder drops its subtree and clears mirrors of it', () => {
        const removed = removeEpisodeFolder(template, 'BG');
        expect(removed.map((f) => f.path)).toEqual(['Anim', 'Anim/Layout']);
        expect(removed[1]).not.toHaveProperty('mirror_of');
        expect(removed[1].read_only).toBe(true);
    });

    test('mirror sources exclude itself, relatives and mirrors', () => {
        const folders = [...template, {path: 'Other'}];
        expect(mirrorSources(folders, 'Other')).toEqual(['BG', 'BG/Layout', 'Anim']);
        expect(mirrorSources(folders, 'BG/Layout')).toEqual(['Anim', 'Other']);
        expect(mirrorSources(folders, 'Anim')).toEqual(['BG', 'BG/Layout', 'Other']);
    });
});
