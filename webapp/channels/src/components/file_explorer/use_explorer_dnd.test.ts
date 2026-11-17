// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {dropEffectFor, resolveDropEffect} from './use_explorer_dnd';

describe('resolveDropEffect', () => {
    test.each([
        [{sameChannel: true}, 'move'],
        [{sameChannel: false}, 'copy'],
        [{sameChannel: true, ctrl: true}, 'copy'],
        [{sameChannel: false, shift: true}, 'move'],
        [{sameChannel: true, fromChat: true}, 'copy'],
        [{sameChannel: true, shift: true, fromChat: true}, 'copy'],
    ])('%o → %s', (input, expected) => {
        expect(resolveDropEffect(input)).toBe(expected);
    });
});

describe('dropEffectFor', () => {
    const drag = {channelId: 'c1', parentId: 'p', itemIds: ['a'], chatFileIds: []};
    const keys = {ctrl: false, shift: false};

    test('moves into an unrelated folder of the same channel', () => {
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'b', ancestors: ['p']}, keys)).toBe('move');
    });

    test('rejects dropping a folder on itself', () => {
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'a', ancestors: ['p']}, keys)).toBeUndefined();
    });

    test('rejects dropping a folder on its own descendant', () => {
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'b', ancestors: ['p', 'a']}, keys)).toBeUndefined();
    });

    test('rejects read-only targets', () => {
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'chat', ancestors: []}, keys)).toBeUndefined();
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'trash', ancestors: []}, keys)).toBeUndefined();
    });

    test('moving into the folder the items are already in does nothing, copying duplicates', () => {
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'p', ancestors: []}, keys)).toBeUndefined();
        expect(dropEffectFor(drag, {channelId: 'c1', folderId: 'p', ancestors: []}, {ctrl: true, shift: false})).toBe('copy');
    });

    test('chat files always copy', () => {
        expect(dropEffectFor({channelId: 'c1', parentId: 'chat', itemIds: [], chatFileIds: ['f']}, {channelId: 'c1', folderId: '', ancestors: []}, {ctrl: false, shift: true})).toBe('copy');
    });
});
