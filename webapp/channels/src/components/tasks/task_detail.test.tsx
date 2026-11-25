// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Department} from '@mattermost/types/custom_roles';
import type {DriveItem} from '@mattermost/types/drive';
import type {Task, TaskSection} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import TaskDetail from './task_detail';

const me = TestHelper.getUserMock({id: 'me', username: 'me'});
const anim = TestHelper.getUserMock({id: 'anim', username: 'anim'});
const lead = TestHelper.getUserMock({id: 'lead', username: 'lead'});
const old = TestHelper.getUserMock({id: 'old', username: 'old'});

const task: Task = {
    id: 't1',
    team_id: 'team1',
    section_id: '',
    title: 'Walk cycle',
    description: '',
    assignee_id: 'old',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: 0,
    video_file_id: '',
    creator_id: 'me',
    create_at: 1,
    update_at: 1,
    department_id: '',
    waits_for: [],
    folder_id: '',
    parent_id: '',
    approval_status: '',
};

describe('TaskDetail assignee picker', () => {
    beforeEach(() => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
    });

    test('offers only the members the viewer may assign, plus themself and the current assignee', async () => {
        const actionable = jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderWithContext(
            <TaskDetail
                task={task}
                sections={[]}
                members={[me, anim, lead, old]}
                displayName={(u) => u.username}
                onClose={jest.fn()}
                canManage={true}
            />,
            {entities: {users: {currentUserId: 'me', profiles: {me}}}},
        );

        const picker = screen.getByRole('combobox', {name: 'Assignee'});
        await waitFor(() => expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Unassigned', 'me', 'anim', 'old']));
        expect(actionable).toHaveBeenCalledWith('team1', 'manage_tasks');
    });

    const renderDetail = (t: Task, sections: TaskSection[]) => renderWithContext(
        <TaskDetail
            task={t}
            sections={sections}
            members={[me, anim, lead, old]}
            displayName={(u) => u.username}
            onClose={jest.fn()}
            canManage={true}
        />,
        {entities: {users: {currentUserId: 'me', profiles: {me}}}},
    );
    const linked: TaskSection = {id: 'rev', team_id: 'team1', name: 'Rev', sort_order: 0, channel_id: 'ch1', video_file_id: 'file1', create_at: 1, update_at: 1};

    test('a revision asks who the viewer may give revisions to', async () => {
        const actionable = jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderDetail({...task, section_id: 'rev', video_file_id: 'file1'}, [linked]);
        await waitFor(() => expect(actionable).toHaveBeenCalledWith('team1', 'manage_revisions'));
    });

    test('an ordinary task in a revision section asks for manage_tasks', async () => {
        const actionable = jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderDetail({...task, section_id: 'rev'}, [linked]);
        await waitFor(() => expect(actionable).toHaveBeenCalledWith('team1', 'manage_tasks'));
        expect(actionable).not.toHaveBeenCalledWith('team1', 'manage_revisions');
    });

    test("a revision's section cannot be changed", async () => {
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
        renderDetail({...task, section_id: 'rev', video_file_id: 'file1'}, [linked]);
        expect(screen.getByRole('combobox', {name: 'Section'})).toBeDisabled();
    });

    test("an ordinary task's section can be changed", async () => {
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
        renderDetail({...task, section_id: 'rev'}, [linked]);
        expect(screen.getByRole('combobox', {name: 'Section'})).toBeEnabled();
    });
});

describe('TaskDetail department, pool, lock and folder', () => {
    const dept = (id: string, name: string): Department => ({id, name, ranks: [{role_name: 'rk_' + id}]}) as unknown as Department;
    const section: TaskSection = {id: 'ep', team_id: 'team1', name: 'Episode 1', sort_order: 0, channel_id: 'ch1', video_file_id: '', create_at: 1, update_at: 1};
    const story = {...task, id: 's', title: 'Storyboard', section_id: 'ep', status: 'in_progress' as const};
    const other = {...task, id: 'o', title: 'Other section', section_id: 'x'};
    const pool = {...task, section_id: 'ep', assignee_id: '', department_id: 'anim'};

    let patch: jest.SpyInstance;
    beforeEach(() => {
        jest.spyOn(Client4, 'getTaskComments').mockResolvedValue([]);
        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue([]);
        jest.spyOn(Client4, 'getTeamDepartments').mockResolvedValue([dept('anim', 'Animation'), dept('sound', 'Sound')]);
        patch = jest.spyOn(Client4, 'patchTask').mockResolvedValue(task);
        jest.spyOn(Client4, 'getDriveFolders').mockResolvedValue([
            {id: 'exp', name: 'EXPORTS', parent_id: 'ani'},
            {id: 'ani', name: '02_ANIMATIC', parent_id: ''},
        ] as DriveItem[]);
        const library = {id: 'lib', name: '03_LIBRARY', kind: 'library' as const, children: [{id: 'chars', name: 'CHARACTERS'}]};
        jest.spyOn(Client4, 'getTeamFilesLayout').mockResolvedValue({channel_id: 'files', production_channel_ids: [], is_admin: true, folders: [library]});
    });
    afterEach(() => jest.restoreAllMocks());

    // roles are the viewer's team roles.
    const renderIt = (t: Task, {roles = 'team_user', canManage = false, extra = {}}: {roles?: string; canManage?: boolean; extra?: Record<string, Task>} = {}) => renderWithContext(
        <TaskDetail
            task={t}
            sections={[section]}
            members={[me, anim]}
            displayName={(u) => u.username}
            onClose={jest.fn()}
            canManage={canManage}
        />,
        {
            entities: {
                users: {currentUserId: 'me', profiles: {me}},
                teams: {
                    currentTeamId: 'team1',
                    teams: {team1: TestHelper.getTeamMock({id: 'team1', name: 'team-one', files_enabled: true})},
                    myMembers: {team1: {team_id: 'team1', user_id: 'me', roles, scheme_user: true, scheme_admin: false, scheme_guest: false, mention_count: 0, msg_count: 0}},
                },
                channels: {channels: {ch1: TestHelper.getChannelMock({id: 'ch1', name: 'episode-1'})}},
                tasks: {byId: {t1: t, s: story, o: other, ...extra}, sectionsById: {ep: section}},
            },
        },
    );

    test('a pool task shows its department and Unassigned', async () => {
        renderIt(pool);
        expect(await screen.findByText('Animation')).toBeInTheDocument();
        expect(screen.getByRole('combobox', {name: 'Assignee'})).toHaveValue('');
    });

    test('a member of the department can take the task', async () => {
        renderIt(pool, {roles: 'team_user rk_anim'});
        fireEvent.click(await screen.findByRole('button', {name: 'Take it'}));
        expect(patch).toHaveBeenCalledWith('t1', {assignee_id: 'me'}, expect.anything());
    });

    test('a non-member has no Take it button', async () => {
        renderIt(pool, {roles: 'team_user rk_sound'});
        await screen.findByText('Animation');
        expect(screen.queryByRole('button', {name: 'Take it'})).not.toBeInTheDocument();
    });

    test('a locked task names what it waits for and cannot leave To do for a non-manager', async () => {
        renderIt({...pool, waits_for: ['s']}, {roles: 'team_user rk_anim'});
        expect(await screen.findByText('Waiting for: Storyboard')).toBeInTheDocument();
        const status = screen.getByRole('combobox', {name: /Status of/});
        expect(within(status).getByRole('option', {name: 'In progress'})).toBeDisabled();
        expect(within(status).getByRole('option', {name: 'Done'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Take it'})).toBeDisabled();
    });

    test('a non-manager cannot move a linked task between sections, a manager can', async () => {
        const waiting = {...pool, waits_for: ['s']};
        const first = renderIt(waiting, {roles: 'team_user rk_anim'});
        expect(await screen.findByRole('combobox', {name: 'Section'})).toBeDisabled();
        first.unmount();

        // The storyboard waits for nothing, but the pool task waits for it.
        const second = renderIt(story, {extra: {w: waiting}});
        expect(await screen.findByRole('combobox', {name: 'Section'})).toBeDisabled();
        second.unmount();

        const third = renderIt(pool);
        expect(await screen.findByRole('combobox', {name: 'Section'})).toBeEnabled();
        third.unmount();

        renderIt(waiting, {canManage: true});
        expect(await screen.findByRole('combobox', {name: 'Section'})).toBeEnabled();
    });

    test('a manager can still move a locked task', async () => {
        renderIt({...pool, waits_for: ['s']}, {canManage: true});
        const status = await screen.findByRole('combobox', {name: /Status of/});
        expect(within(status).getByRole('option', {name: 'In progress'})).toBeEnabled();
    });

    test('a manager edits the department and picks waits-for from the same section only', async () => {
        renderIt(pool, {canManage: true});
        const picker = await screen.findByRole('combobox', {name: 'Department'});
        fireEvent.change(picker, {target: {value: 'sound'}});
        expect(patch).toHaveBeenCalledWith('t1', {department_id: 'sound'}, expect.anything());

        expect(screen.queryByRole('checkbox', {name: 'Other section'})).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', {name: 'Walk cycle'})).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', {name: 'Storyboard'}));
        expect(patch).toHaveBeenCalledWith('t1', {waits_for: ['s']}, expect.anything());
    });

    test('a task that already waits for this one is not offered (no cycles)', async () => {
        const loop = {...story, waits_for: ['t1']};
        renderWithContext(
            <TaskDetail
                task={pool}
                sections={[section]}
                members={[me]}
                displayName={(u) => u.username}
                onClose={jest.fn()}
                canManage={true}
            />,
            {entities: {users: {currentUserId: 'me', profiles: {me}}, tasks: {byId: {t1: pool, s: loop}, sectionsById: {ep: section}}}},
        );
        await screen.findByRole('combobox', {name: 'Department'});
        expect(screen.queryByRole('checkbox', {name: 'Storyboard'})).not.toBeInTheDocument();
    });

    test('a task with a folder links to it in the channel Files tab', async () => {
        renderIt({...pool, folder_id: 'fold1'});
        expect(await screen.findByRole('link', {name: 'Open folder'})).toHaveAttribute('href', '/team-one/channels/episode-1?folder=fold1');
    });

    test('a manager picks the upload and library folders by path', async () => {
        renderIt({...pool, folder_id: 'ani'}, {canManage: true});

        const upload = await screen.findByRole('combobox', {name: 'Upload folder'});
        expect(Client4.getDriveFolders).toHaveBeenCalledWith('ch1');
        expect(upload).toHaveValue('ani');
        expect(within(upload).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', '02_ANIMATIC', '02_ANIMATIC/EXPORTS']);
        fireEvent.change(upload, {target: {value: 'exp'}});
        expect(patch).toHaveBeenCalledWith('t1', {folder_id: 'exp'}, expect.anything());

        const library = await screen.findByRole('combobox', {name: 'Library folder'});
        expect(within(library).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', '03_LIBRARY/CHARACTERS']);
        fireEvent.change(library, {target: {value: 'chars'}});
        expect(patch).toHaveBeenCalledWith('t1', {library_folder_id: 'chars'}, expect.anything());
    });

    test('no library select without a library, and no folder selects for a non-manager', async () => {
        jest.spyOn(Client4, 'getTeamFilesLayout').mockResolvedValue({channel_id: '', production_channel_ids: [], is_admin: false, folders: []});
        const view = renderIt(pool, {canManage: true});
        await screen.findByRole('combobox', {name: 'Upload folder'});
        await waitFor(() => expect(Client4.getTeamFilesLayout).toHaveBeenCalled());
        expect(screen.queryByRole('combobox', {name: 'Library folder'})).not.toBeInTheDocument();
        view.unmount();

        (Client4.getDriveFolders as jest.Mock).mockClear();
        renderIt(pool);
        await screen.findByRole('combobox', {name: 'Section'});
        expect(Client4.getDriveFolders).not.toHaveBeenCalled();
        expect(screen.queryByRole('combobox', {name: 'Upload folder'})).not.toBeInTheDocument();
    });

    test('a revision shows none of it', async () => {
        renderIt({...pool, video_file_id: 'file1', waits_for: ['s'], folder_id: 'fold1'}, {roles: 'team_user rk_anim', canManage: true});
        await screen.findByRole('combobox', {name: 'Assignee'});
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByText('Animation')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', {name: 'Department'})).not.toBeInTheDocument();
        expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Take it'})).not.toBeInTheDocument();
        expect(screen.queryByRole('link', {name: 'Open folder'})).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', {name: 'Upload folder'})).not.toBeInTheDocument();
    });

    test('a department that no longer exists reads Deleted department, with no Take it, and a manager can assign', async () => {
        const gone = {...pool, department_id: 'gone'};
        const view = renderIt(gone, {roles: 'team_user rk_anim'});
        expect(await screen.findByText('Deleted department')).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Take it'})).not.toBeInTheDocument();
        view.unmount();

        jest.spyOn(Client4, 'getActionableUserIds').mockResolvedValue(['anim']);
        renderIt(gone, {canManage: true});
        const assignee = await screen.findByRole('combobox', {name: 'Assignee'});
        expect(assignee).toBeEnabled();
        fireEvent.change(assignee, {target: {value: 'anim'}});
        expect(patch).toHaveBeenCalledWith('t1', {assignee_id: 'anim'}, expect.anything());
    });
});
