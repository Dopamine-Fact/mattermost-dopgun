// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, screen} from '@testing-library/react';
import React from 'react';

import TaskFilterContext from 'components/channel_view/task_filter_context';

import {renderWithContext} from 'tests/react_testing_utils';

import type {PostDraft} from 'types/store/draft';

import useTaskPicker from './use_task_picker';

const section = {id: 'sec1', team_id: 'team1', name: 'Ep 1', sort_order: 0, channel_id: 'chan1', video_file_id: '', create_at: 1, update_at: 1};
const task = (id: string, title: string, sectionId = 'sec1') => ({id, team_id: 'team1', section_id: sectionId, title, sort_order: 0});

const state = {
    entities: {
        teams: {currentTeamId: 'team1', teams: {team1: {id: 'team1', tasks_enabled: true, revisions_enabled: true}}},
        tasks: {
            byId: {T: task('T', 'Storyboard'), U: task('U', 'Animatic'), X: task('X', 'Elsewhere', 'other')},
            sectionsById: {sec1: section},
        },
    },
};

const draft = (props?: Record<string, unknown>): PostDraft => ({
    message: 'hi',
    fileInfos: [],
    uploadsInProgress: [],
    channelId: 'chan1',
    rootId: '',
    createAt: 0,
    updateAt: 0,
    props,
});

function Harness({value, onChange, channelId = 'chan1', rootId = ''}: {value: PostDraft; onChange: jest.Mock; channelId?: string; rootId?: string}) {
    const {control, isTaskSendable} = useTaskPicker(value, onChange, channelId, rootId);
    return (
        <>
            {control}
            <span data-testid='sendable'>{String(isTaskSendable)}</span>
        </>
    );
}

const renderPicker = (props: React.ComponentProps<typeof Harness>, filter = '') => renderWithContext(
    <TaskFilterContext.Provider value={filter}>
        <Harness {...props}/>
    </TaskFilterContext.Provider>,
    state as any,
);

describe('useTaskPicker', () => {
    test('a channel without a task list gets no picker and can always send', () => {
        renderPicker({value: draft(), onChange: jest.fn(), channelId: 'plain'});
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.getByTestId('sendable').textContent).toBe('true');
    });

    test('a reply gets no picker: it takes its root\'s task', () => {
        renderPicker({value: draft(), onChange: jest.fn(), rootId: 'root1'});
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.getByTestId('sendable').textContent).toBe('true');
    });

    test('a task-list channel cannot send until one of its tasks is picked', () => {
        const onChange = jest.fn();
        renderPicker({value: draft(), onChange});

        expect(screen.getByTestId('sendable').textContent).toBe('false');
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Pick a task', 'Storyboard', 'Animatic']);

        fireEvent.change(screen.getByRole('combobox'), {target: {value: 'U'}});
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({props: {task_id: 'U'}}), {instant: true});
    });

    test('a picked task of this channel can send; one from elsewhere cannot', () => {
        renderPicker({value: draft({task_id: 'T'}), onChange: jest.fn()});
        expect(screen.getByTestId('sendable').textContent).toBe('true');
    });

    test('a task from another section is not sendable', () => {
        renderPicker({value: draft({task_id: 'X'}), onChange: jest.fn()});
        expect(screen.getByTestId('sendable').textContent).toBe('false');
    });

    test('the Messages filter picks its task for the draft', () => {
        const onChange = jest.fn();
        renderPicker({value: draft(), onChange}, 'T');
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({props: {task_id: 'T'}}), {instant: true});
    });
});
