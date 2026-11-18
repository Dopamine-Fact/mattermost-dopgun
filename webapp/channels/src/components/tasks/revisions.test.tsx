// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Task, TaskSection, TaskSectionVideo} from '@mattermost/types/tasks';

import {Client4} from 'mattermost-redux/client';

import {createTask, setTaskSectionVideo} from 'actions/tasks';

import {fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

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
const task = (id: string, sectionId: string, videoTime: number, videoFileId = 'file1', status: Task['status'] = 'todo'): Task => ({
    id,
    team_id: 'team1',
    section_id: sectionId,
    title: `Revision ${id}`,
    description: '',
    assignee_id: '',
    start_at: 0,
    due_at: 0,
    status,
    sort_order: 1,
    video_time: videoTime,
    video_file_id: videoFileId,
    creator_id: 'user1',
    create_at: 1,
    update_at: 1,
});

const version = (n: number, fileId: string, createAt: number): TaskSectionVideo => ({
    id: `v${n}`,
    section_id: 'sec1',
    file_id: fileId,
    version: n,
    creator_id: 'user1',
    create_at: createAt,
    file: {id: fileId, name: `cut${n}.mp4`} as TaskSectionVideo['file'],
});
const versions = [version(1, 'file0', new Date(2026, 10, 1).getTime()), version(2, 'file1', new Date(2026, 10, 15).getTime())];
const uploader = TestHelper.getUserMock({id: 'user1', username: 'editor'});

const defineTime = (video: HTMLVideoElement, start: number) => {
    let time = start;
    Object.defineProperty(video, 'currentTime', {get: () => time,
        set: (t) => {
            time = t;
        }});
    return () => time;
};

const onSelect = jest.fn();
const renderRevisions = (canManage = true, extra: Task[] = []) => {
    renderWithContext(
        <Revisions
            teamId='team1'
            tasks={[task('late', 'sec1', 83500), task('early', 'sec1', 1200), task('other', 'sec2', 0), task('plain', 'sec1', 0, ''), ...extra]}
            section={channel}
            usersById={{user1: uploader}}
            selectedId=''
            onSelect={onSelect}
            canManage={canManage}
        />,
    );
    const video = document.querySelector('video')!;
    return {video, time: defineTime(video, 10)};
};

describe('Revisions', () => {
    beforeEach(() => {
        jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        jest.spyOn(Client4, 'getTaskSectionVideos').mockResolvedValue(versions);
    });
    afterEach(() => jest.clearAllMocks());

    test('formatVideoTime shows minutes, seconds and hundredths', () => {
        expect(formatVideoTime(0)).toBe('0:00.00');
        expect(formatVideoTime(83500)).toBe('1:23.50');
        expect(formatVideoTime(3725010)).toBe('62:05.01');
    });

    test('lists only the channel\'s revisions in video order and seeks to them', () => {
        const {time} = renderRevisions();
        expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('/task_sections/sec1/video?file_id=file1'));

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
        expect(createTask).toHaveBeenCalledWith({team_id: 'team1', title: 'Logo too small', section_id: 'sec1', video_time: 10000, video_file_id: 'file1'});
        expect(screen.getByRole('textbox', {name: 'Revision'})).toHaveValue('');
    });

    test('members without manage_revisions can watch but not add', () => {
        renderRevisions(false);
        expect(screen.queryByRole('textbox', {name: 'Revision'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Revision late'})).toBeInTheDocument();
    });
    test('managers can upload a new version; others cannot', async () => {
        renderRevisions();
        const file = new File(['x'], 'cut2.mp4', {type: 'video/mp4'});
        fireEvent.change(screen.getByLabelText('Upload new version'), {target: {files: [file]}});
        await waitFor(() => expect(setTaskSectionVideo).toHaveBeenCalledWith('sec1', file));
    });

    test('viewers get no upload control', () => {
        renderRevisions(false);
        expect(screen.queryByLabelText('Upload new version')).toBeNull();
    });

    test('lists versions newest first', async () => {
        renderRevisions();
        const picker = screen.getByRole('combobox', {name: 'Version'});
        await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));
        const labels = within(picker).getAllByRole('option').map((o) => o.textContent);
        expect(labels[0]).toMatch(/^v2 · .+ · editor$/);
        expect(labels[1]).toMatch(/^v1 · .+ · editor$/);
        expect(picker).toHaveValue('file1');
        expect(Client4.getTaskSectionVideos).toHaveBeenCalledWith('sec1');
    });

    test('shows an older open revision with its version badge on the latest version', async () => {
        renderRevisions(true, [task('older', 'sec1', 500, 'file0'), task('olderDone', 'sec1', 600, 'file0', 'done')]);
        await waitFor(() => expect(screen.getByText('v1')).toBeInTheDocument());
        expect(screen.getByRole('button', {name: 'Revision older'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Revision olderDone'})).toBeNull();
        expect(screen.queryByRole('button', {name: 'Revision plain'})).toBeNull();

        // On the older version only its own revisions show, done or not.
        fireEvent.change(screen.getByRole('combobox', {name: 'Version'}), {target: {value: 'file0'}});
        const names = screen.getAllByRole('button', {name: /^Revision /}).map((b) => b.textContent);
        expect(names).toEqual(['Revision older', 'Revision olderDone']);
    });

    test('picking an older revision switches the video to its version', async () => {
        renderRevisions(true, [task('older', 'sec1', 500, 'file0')]);
        await waitFor(() => expect(screen.getByText('v1')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', {name: 'Revision older'}));

        expect(onSelect).toHaveBeenCalledWith('older');
        expect(screen.getByRole('combobox', {name: 'Version'})).toHaveValue('file0');
        const video = document.querySelector('video')!;
        expect(video).toHaveAttribute('src', expect.stringContaining('/task_sections/sec1/video?file_id=file0'));
        const time = defineTime(video, 0);
        fireEvent.loadedMetadata(video);
        expect(time()).toBe(0.5);
    });

    test('a new revision is created on the selected version', async () => {
        renderRevisions();
        await waitFor(() => expect(within(screen.getByRole('combobox', {name: 'Version'})).getAllByRole('option')).toHaveLength(2));
        fireEvent.change(screen.getByRole('combobox', {name: 'Version'}), {target: {value: 'file0'}});
        defineTime(document.querySelector('video')!, 2);
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision'}), {target: {value: 'Earlier cut'}});
        fireEvent.click(screen.getByRole('button', {name: 'Add revision'}));

        await waitFor(() => expect(createTask).toHaveBeenCalledWith({team_id: 'team1', title: 'Earlier cut', section_id: 'sec1', video_time: 2000, video_file_id: 'file0'}));
    });

    test("someone else's upload adds the version but keeps this viewer on theirs", async () => {
        const props = {teamId: 'team1', tasks: [], usersById: {user1: uploader}, selectedId: '', onSelect, canManage: true};
        const {rerender} = renderWithContext(<Revisions {...{...props, section: channel}}/>);
        const picker = screen.getByRole('combobox', {name: 'Version'});
        await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(2));

        jest.mocked(Client4.getTaskSectionVideos).mockResolvedValue([...versions, version(3, 'file2', new Date(2026, 10, 16).getTime())]);
        rerender(<Revisions {...{...props, section: {...channel, video_file_id: 'file2'}}}/>);
        await waitFor(() => expect(within(picker).getAllByRole('option')).toHaveLength(3));

        expect(picker).toHaveValue('file1');
        expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('file_id=file1'));
        defineTime(document.querySelector('video')!, 2);
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision'}), {target: {value: 'Still on v2'}});
        fireEvent.click(screen.getByRole('button', {name: 'Add revision'}));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({title: 'Still on v2', video_file_id: 'file1'})));
    });

    test("this viewer's own upload switches them to the new version", async () => {
        jest.mocked(setTaskSectionVideo).mockImplementationOnce(() => (() => Promise.resolve({data: {...channel, video_file_id: 'file2'}})) as unknown as ReturnType<typeof setTaskSectionVideo>);
        renderRevisions();
        fireEvent.change(screen.getByLabelText('Upload new version'), {target: {files: [new File(['x'], 'cut3.mp4', {type: 'video/mp4'})]}});
        await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('file_id=file2')));
    });
});
