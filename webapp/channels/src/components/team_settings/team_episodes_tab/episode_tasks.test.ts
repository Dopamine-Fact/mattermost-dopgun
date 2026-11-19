// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {episodeTaskCycle, parseEpisodeTasks, sanitizeEpisodeTasks, serializeEpisodeTasks} from './episode_tasks';

describe('episode_tasks', () => {
    test('old text parses to title-only entries keyed line0..', () => {
        expect(parseEpisodeTasks('Storyboard\n\n  Animatic  \n')).toEqual([
            {key: 'line0', title: 'Storyboard'},
            {key: 'line1', title: 'Animatic'},
        ]);
        expect(parseEpisodeTasks(undefined)).toEqual([]);
    });

    test('serialize(parse(json)) is stable and leaves empty optional fields out', () => {
        const json = '[{"key":"a","title":"A","department_id":"d","assignee_id":"u","due_days":0,"waits_for":["b"],"folder":"BG"},{"key":"b","title":"B"}]';
        expect(serializeEpisodeTasks(parseEpisodeTasks(json))).toBe(json);
        expect(serializeEpisodeTasks([{key: 'a', title: 'A', department_id: '', waits_for: [], folder: ''}])).toBe('[{"key":"a","title":"A"}]');
        expect(serializeEpisodeTasks([])).toBe('');
    });

    test('old text becomes JSON only when serialized, which the tab does after an edit', () => {
        const tasks = parseEpisodeTasks('Storyboard\nAnimatic');

        expect(serializeEpisodeTasks(tasks)).toBe('[{"key":"line0","title":"Storyboard"},{"key":"line1","title":"Animatic"}]');
    });

    test('sanitize clears a deleted department, a missing folder and a dangling waits-for', () => {
        const tasks = [{key: 'a', title: 'A', department_id: 'gone', folder: 'Old', waits_for: ['b', 'zz']}, {key: 'b', title: 'B', department_id: 'd', folder: 'BG'}];

        expect(sanitizeEpisodeTasks(tasks, ['d'], ['BG'])).toEqual([{key: 'a', title: 'A', waits_for: ['b']}, {key: 'b', title: 'B', department_id: 'd', folder: 'BG'}]);

        // departments not loaded yet: left alone
        expect(sanitizeEpisodeTasks(tasks, undefined, ['BG'])[0].department_id).toBe('gone');
    });

    test('a cycle a -> b -> a is detected, a chain is not', () => {
        expect(episodeTaskCycle([{key: 'a', title: 'A', waits_for: ['b']}, {key: 'b', title: 'B', waits_for: ['a']}])).toBe(true);
        expect(episodeTaskCycle([{key: 'a', title: 'A', waits_for: ['a']}])).toBe(true);
        expect(episodeTaskCycle([{key: 'a', title: 'A', waits_for: ['b']}, {key: 'b', title: 'B'}])).toBe(false);
    });
});
