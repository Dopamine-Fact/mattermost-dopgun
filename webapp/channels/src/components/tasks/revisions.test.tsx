// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Task, TaskSection} from '@mattermost/types/tasks';

import {createTask, setTaskSectionVideo} from 'actions/tasks';

import {fireEvent, renderWithContext, screen, waitFor} from 'tests/react_testing_utils';

import Revisions from './revisions';
import {formatVideoTime} from './task_utils';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    createTask: jest.fn(() => () => Promise.resolve({data: {id: 'new'}})),
    setTaskSectionVideo: jest.fn(() => () => Promise.resolve({data: {}})),
}));
jest.mock('./use_frame_thumbnails', () => ({
    useFrameThumbnails: () => ({1200: 'data:image/jpeg;base64,early'}),
}));

const channel: TaskSection = {id: 'sec1', team_id: 'team1', name: 'Trailer', sort_order: 0, channel_id: 'chan1', video_file_id: 'file1', create_at: 1, update_at: 1};
const task = (id: string, sectionId: string, videoTime: number): Task => ({
    id,
    team_id: 'team1',
    section_id: sectionId,
    title: `Revision ${id}`,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status: 'todo',
    sort_order: 1,
    video_time: videoTime,
    creator_id: 'user1',
    create_at: 1,
    update_at: 1,
});

const onSelect = jest.fn();
const renderRevisions = (canManage = true) => {
    renderWithContext(
        <Revisions
            teamId='team1'
            tasks={[task('late', 'sec1', 83500), task('early', 'sec1', 1200), task('other', 'sec2', 0)]}
            section={channel}
            usersById={{}}
            selectedId=''
            onSelect={onSelect}
            canManage={canManage}
        />,
    );
    const video = document.querySelector('video')!;
    let time = 10;
    Object.defineProperty(video, 'currentTime', {get: () => time,
        set: (t) => {
            time = t;
        }});
    return {video, time: () => time};
};

describe('Revisions', () => {
    beforeEach(() => {
        jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    });
    afterEach(() => jest.clearAllMocks());

    test('formatVideoTime shows minutes, seconds and hundredths', () => {
        expect(formatVideoTime(0)).toBe('0:00.00');
        expect(formatVideoTime(83500)).toBe('1:23.50');
        expect(formatVideoTime(3725010)).toBe('62:05.01');
    });

    test('lists only the channel\'s revisions in video order and seeks to them', () => {
        const {time} = renderRevisions();
        expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/task_sections/sec1/video?v=file1'));

        const names = screen.getAllByRole('button', {name: /^Revision /}).map((b) => b.textContent);
        expect(names).toEqual(['Revision early', 'Revision late']);

        fireEvent.click(screen.getByRole('button', {name: 'Go to 1:23.50'}));
        expect(time()).toBe(83.5);
        fireEvent.click(screen.getByRole('button', {name: 'Revision early'}));
        expect(time()).toBe(1.2);
        expect(onSelect).toHaveBeenCalledWith('early');
    });

    test('each revision shows the video frame at its moment; clicking the frame seeks and opens it', () => {
        const {time} = renderRevisions();
        const frame = screen.getByRole('button', {name: 'Go to 0:01.20'});
        expect(frame.querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,early');
        expect(frame).toHaveTextContent('0:01.20');

        // A frame that is not drawn yet keeps its place and time.
        expect(screen.getByRole('button', {name: 'Go to 1:23.50'}).querySelector('img')).toBeNull();

        fireEvent.click(frame);
        expect(time()).toBe(1.2);
        expect(onSelect).toHaveBeenCalledWith('early');
    });

    test('arrow keys step one frame, except while typing', () => {
        const {time} = renderRevisions();
        fireEvent.keyDown(document.body, {key: 'ArrowRight'});
        expect(time()).toBeCloseTo(10 + (1 / 30));
        fireEvent.keyDown(document.body, {key: 'ArrowLeft'});
        fireEvent.keyDown(document.body, {key: 'ArrowLeft'});
        expect(time()).toBeCloseTo(10 - (1 / 30));
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

        fireEvent.keyDown(screen.getByRole('textbox', {name: 'Revision'}), {key: 'ArrowRight'});
        expect(time()).toBeCloseTo(10 - (1 / 30));
    });

    test('adds a revision at the current moment and opens it', async () => {
        renderRevisions();
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision'}), {target: {value: ' Logo too small '}});
        fireEvent.click(screen.getByRole('button', {name: 'Add revision'}));

        await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
        expect(createTask).toHaveBeenCalledWith({team_id: 'team1', title: 'Logo too small', section_id: 'sec1', video_time: 10000});
        expect(screen.getByRole('textbox', {name: 'Revision'})).toHaveValue('');
    });

    test('members without manage_revisions can watch but not add', () => {
        renderRevisions(false);
        expect(screen.queryByRole('textbox', {name: 'Revision'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Revision late'})).toBeInTheDocument();
    });
    test('managers can replace the video; others cannot', async () => {
        renderRevisions();
        const file = new File(['x'], 'cut2.mp4', {type: 'video/mp4'});
        fireEvent.change(screen.getByLabelText('Replace video'), {target: {files: [file]}});
        await waitFor(() => expect(setTaskSectionVideo).toHaveBeenCalledWith('sec1', file));
    });

    test('viewers get no replace control', () => {
        renderRevisions(false);
        expect(screen.queryByLabelText('Replace video')).toBeNull();
    });
});
