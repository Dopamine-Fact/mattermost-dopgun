// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Department} from '@mattermost/types/custom_roles';

import {DOPAMINE_DEPARTMENTS, DOPAMINE_FOLDERS, buildDopamineTemplate} from './dopamine_preset';

describe('dopamine_preset', () => {
    const departments = DOPAMINE_DEPARTMENTS.map((d, i) => ({...d, id: `dep${i}`}) as Department);

    test('every task gets its department id, matched by name ignoring case', () => {
        const {tasks} = buildDopamineTemplate(departments.map((d) => ({...d, name: ` ${d.name.toUpperCase()} `})));

        expect(tasks).toHaveLength(46);
        expect(tasks.every((t) => t.department_id?.startsWith('dep'))).toBe(true);
        expect(tasks.some((t) => 'department' in t)).toBe(false);
    });

    test('a department the team lacks leaves its tasks without one', () => {
        const {tasks} = buildDopamineTemplate(departments.slice(1));

        expect(tasks.find((t) => t.key === 'treatment')?.department_id).toBeUndefined();
        expect(tasks.find((t) => t.key === 'board')?.department_id).toBe('dep1');
    });

    test('the template references only its own folders and tasks', () => {
        const {folders, tasks} = buildDopamineTemplate(departments);
        const plain = new Set(folders.filter((f) => !f.mirror_of).map((f) => f.path));
        const keys = new Set(tasks.map((t) => t.key));

        expect(folders).toHaveLength(96);
        expect(folders.filter((f) => !f.path.includes('/') && f.path !== '06_ARCHIVE').every((f) => folders.some((m) => m.path === `06_ARCHIVE/${f.path}` && m.mirror_of === f.path && m.read_only))).toBe(true);
        expect(folders).not.toBe(DOPAMINE_FOLDERS);
        expect(folders.filter((f) => f.mirror_of).every((f) => plain.has(f.mirror_of!))).toBe(true);
        expect(tasks.filter((t) => t.folder).every((t) => plain.has(t.folder!))).toBe(true);
        expect(tasks.every((t) => (t.waits_for ?? []).every((k) => keys.has(k) && k !== t.key))).toBe(true);
        expect(keys.size).toBe(tasks.length);
    });
});
