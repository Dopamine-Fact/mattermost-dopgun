// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {FileInfo} from '@mattermost/types/files';
import type {Task, TaskSection, TaskSectionVideo} from '@mattermost/types/tasks';

import {createPost} from 'mattermost-redux/actions/posts';
import {Client4} from 'mattermost-redux/client';

import {createTask, deleteTask, setTaskSectionVideo} from 'actions/tasks';

import {act, fireEvent, renderWithContext, screen, waitFor, within} from 'tests/react_testing_utils';
import {TestHelper} from 'utils/test_helper';

import Revisions from './revisions';
import {formatVideoTime} from './task_utils';

jest.mock('actions/tasks', () => ({
    ...jest.requireActual('actions/tasks'),
    createTask: jest.fn(() => () => Promise.resolve({data: {id: 'new'}})),
    deleteTask: jest.fn(() => () => Promise.resolve({data: true})),
    setTaskSectionVideo: jest.fn(() => () => Promise.resolve({data: {}})),
}));
jest.mock('mattermost-redux/actions/posts', () => ({
    ...jest.requireActual('mattermost-redux/actions/posts'),
    createPost: jest.fn(() => () => Promise.resolve({data: {}})),
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
    department_id: '',
    waits_for: [],
    folder_id: '',
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
const renderRevisions = (canManage = true, extra: Task[] = [], detail?: React.ReactNode) => {
    renderWithContext(
        <Revisions
            teamId='team1'
            tasks={[task('late', 'sec1', 83500), task('early', 'sec1', 1200), task('other', 'sec2', 0), task('plain', 'sec1', 0, ''), ...extra]}
            section={channel}
            usersById={{user1: uploader}}
            selectedId=''
            onSelect={onSelect}
            canManage={canManage}
            detail={detail}
        />,
    );
    const video = document.querySelector('video')!;
    return {video, time: defineTime(video, 10)};
};

describe('Revisions', () => {
    beforeEach(() => {
        jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        URL.createObjectURL = jest.fn(() => 'blob:preview');
        URL.revokeObjectURL = jest.fn();
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

        fireEvent.keyDown(screen.getByRole('textbox', {name: 'Revision description'}), {key: 'ArrowRight'});
        expect(time()).toBeCloseTo(10 - (1 / 30));
    });

    test('adds a revision at the current moment and opens it', async () => {
        renderRevisions();
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: ' Logo too small '}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));

        await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
        expect(createTask).toHaveBeenCalledWith({team_id: 'team1', title: 'Logo too small', section_id: 'sec1', video_time: 10000, video_file_id: 'file1'});
        expect(screen.getByRole('textbox', {name: 'Revision description'})).toHaveValue('');
    });

    test('members without manage_revisions can watch but not add', () => {
        renderRevisions(false);
        expect(screen.queryByRole('textbox', {name: 'Revision description'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Revision late'})).toBeInTheDocument();
    });
    test('a channel without a video yet offers the upload instead of a player and revision form', async () => {
        jest.spyOn(Client4, 'getTaskSectionVideos').mockResolvedValue([]);
        renderWithContext(
            <Revisions
                teamId='team1'
                tasks={[task('plain', 'sec1', 0, '')]}
                section={{...channel, video_file_id: ''}}
                usersById={{}}
                selectedId=''
                onSelect={onSelect}
                canManage={true}
            />,
        );
        expect(document.querySelector('video')).toBeNull();
        expect(screen.queryByRole('textbox', {name: 'Revision description'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'New revision'})).not.toBeInTheDocument();
        expect(screen.getByText('No video yet. Upload one to start adding revisions.')).toBeInTheDocument();

        const file = new File(['x'], 'cut1.mp4', {type: 'video/mp4'});
        fireEvent.change(screen.getByLabelText('Upload new version'), {target: {files: [file]}});
        await waitFor(() => expect(setTaskSectionVideo).toHaveBeenCalledWith('sec1', file, expect.any(Function)));
    });

    test('managers can upload a new version; others cannot', async () => {
        renderRevisions();
        const file = new File(['x'], 'cut2.mp4', {type: 'video/mp4'});
        fireEvent.change(screen.getByLabelText('Upload new version'), {target: {files: [file]}});
        await waitFor(() => expect(setTaskSectionVideo).toHaveBeenCalledWith('sec1', file, expect.any(Function)));
    });

    test('a version upload shows its percent and the time left', async () => {
        let progress: (loaded: number, total: number) => void = () => undefined;
        let finish: (result: unknown) => void = () => undefined;
        jest.mocked(setTaskSectionVideo).mockImplementationOnce(((_id: string, _video: File, onProgress: typeof progress) => {
            progress = onProgress;
            return () => new Promise((resolve) => {
                finish = resolve;
            });
        }) as unknown as typeof setTaskSectionVideo);
        const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
        renderRevisions();
        fireEvent.change(screen.getByLabelText('Upload new version'), {target: {files: [new File(['x'], 'cut2.mp4', {type: 'video/mp4'})]}});

        // Half the bytes in 10 seconds leaves 10 more.
        now.mockReturnValue(11000);
        act(() => progress(50, 100));
        expect(screen.getByText('Uploading 50% · 10 seconds left')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');

        act(() => progress(100, 100));
        expect(screen.getByText('Processing…')).toBeInTheDocument();

        await act(async () => finish({data: {}}));
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.getByText('Upload new version')).toBeInTheDocument();
        now.mockRestore();
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
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Earlier cut'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));

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
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Still on v2'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({title: 'Still on v2', video_file_id: 'file1'})));
    });

    test("this viewer's own upload switches them to the new version", async () => {
        jest.mocked(setTaskSectionVideo).mockImplementationOnce(() => (() => Promise.resolve({data: {...channel, video_file_id: 'file2'}})) as unknown as ReturnType<typeof setTaskSectionVideo>);
        renderRevisions();
        fireEvent.change(screen.getByLabelText('Upload new version'), {target: {files: [new File(['x'], 'cut3.mp4', {type: 'video/mp4'})]}});
        await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('file_id=file2')));
    });

    test('searching keeps only revisions whose title matches', () => {
        renderRevisions();
        fireEvent.change(screen.getByRole('searchbox', {name: 'Search revisions'}), {target: {value: 'LATE'}});
        expect(screen.getAllByRole('button', {name: /^Revision /}).map((b) => b.textContent)).toEqual(['Revision late']);
    });

    test('the status filter keeps one status', () => {
        renderRevisions(true, [task('fixed', 'sec1', 300, 'file1', 'done')]);
        fireEvent.change(screen.getByRole('combobox', {name: 'Status'}), {target: {value: 'done'}});
        expect(screen.getAllByRole('button', {name: /^Revision /}).map((b) => b.textContent)).toEqual(['Revision fixed']);
        expect(screen.getByRole('listitem')).toHaveTextContent('Done');
    });

    test('no match says so', () => {
        renderRevisions();
        fireEvent.change(screen.getByRole('searchbox', {name: 'Search revisions'}), {target: {value: 'zzz'}});
        expect(screen.getByText('No revisions match')).toBeInTheDocument();
        expect(screen.queryByText(/No revisions yet/)).toBeNull();
    });

    test('a card shows its version, date and status pill', async () => {
        renderRevisions();
        const card = screen.getByRole('button', {name: 'Revision early'}).closest('li')!;
        expect(card).toHaveTextContent('Revision requested');
        expect(card).toHaveClass('TaskStatus--todo');
        await waitFor(() => expect(card).toHaveTextContent('v2'));
        expect(within(card).getByText(/1970/)).toBeInTheDocument();
    });

    test('managers can delete from the card menu; others get no menu', async () => {
        renderRevisions();
        const card = screen.getByRole('button', {name: 'Revision early'}).closest('li')!;
        fireEvent.click(within(card).getByRole('button', {name: 'More actions'}));
        fireEvent.click(await screen.findByRole('menuitem', {name: 'Delete'}));
        await waitFor(() => expect(deleteTask).toHaveBeenCalledWith('early'));
    });

    test('viewers get no card menu', () => {
        renderRevisions(false);
        expect(screen.queryByRole('button', {name: 'More actions'})).toBeNull();
    });

    test('the form pins the current moment when asked and creates the revision there', async () => {
        const {video} = renderRevisions();
        video.currentTime = 3.5;
        fireEvent.click(screen.getByRole('button', {name: 'Use current time'}));
        expect(screen.getByText('0:03.50')).toBeInTheDocument();
        video.currentTime = 9;
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Logo too small'}});
        expect(screen.getByText('14 / 500')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));

        await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({title: 'Logo too small', video_time: 3500})));
    });

    test('without a pinned moment the revision takes the player time', async () => {
        const {video} = renderRevisions();
        video.currentTime = 2;
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Shadow'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({video_time: 2000})));
    });

    // A revision channel's task talks in the channel, so the image is the revision's first message there.
    test('a reference image is posted to the channel as the first message of the new revision', async () => {
        const info = {id: 'info1'} as FileInfo;
        const upload = jest.spyOn(Client4, 'uploadFile').mockResolvedValue({file_infos: [info], client_ids: []});
        renderRevisions();
        const file = new File(['x'], 'ref.png', {type: 'image/png'});
        fireEvent.change(screen.getByLabelText('Reference image'), {target: {files: [file]}});
        expect(screen.getByText('ref.png')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Logo'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));

        await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
        const form = upload.mock.calls[0][0] as FormData;
        expect(form.get('channel_id')).toBe('chan1');
        expect((form.get('files') as File).name).toBe('ref.png');
        expect(createPost).toHaveBeenCalledWith(expect.objectContaining({channel_id: 'chan1', message: '', props: {task_id: 'new'}}), [info]);
        expect((createPost as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(onSelect.mock.invocationCallOrder[0]);
    });

    test('an image that fails to attach keeps the revision and says so', async () => {
        jest.spyOn(Client4, 'uploadFile').mockRejectedValue(new Error('too big'));
        renderRevisions();
        fireEvent.change(screen.getByLabelText('Reference image'), {target: {files: [new File(['x'], 'ref.png', {type: 'image/png'})]}});
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Logo'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));

        await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
        expect(screen.getByRole('alert')).toHaveTextContent('The revision was created but the image could not be attached');
    });

    test('a non-image or a file over 10 MB is refused', async () => {
        const upload = jest.spyOn(Client4, 'uploadFile');
        renderRevisions();
        fireEvent.change(screen.getByLabelText('Reference image'), {target: {files: [new File(['x'], 'notes.txt', {type: 'text/plain'})]}});
        expect(screen.getByRole('alert')).toHaveTextContent('PNG, JPG or WEBP up to 10 MB');

        const big = new File(['x'], 'big.png', {type: 'image/png'});
        Object.defineProperty(big, 'size', {value: (10 * 1024 * 1024) + 1});
        fireEvent.change(screen.getByLabelText('Reference image'), {target: {files: [big]}});
        expect(screen.queryByText('big.png')).toBeNull();

        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Logo'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));
        await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
        expect(upload).not.toHaveBeenCalled();
        expect(createPost).not.toHaveBeenCalled();
    });

    test('Cancel clears the form', () => {
        renderRevisions();
        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Logo'}});
        fireEvent.change(screen.getByLabelText('Reference image'), {target: {files: [new File(['x'], 'ref.png', {type: 'image/png'})]}});
        fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
        expect(screen.getByRole('textbox', {name: 'Revision description'})).toHaveValue('');
        expect(screen.queryByRole('button', {name: 'Remove image'})).toBeNull();
    });

    test('clicking the filmstrip seeks', () => {
        const {video, time} = renderRevisions();
        Object.defineProperty(video, 'duration', {value: 10});
        fireEvent.loadedMetadata(video);
        const strip = document.querySelector('.TaskRevisions__strip') as HTMLElement;
        jest.spyOn(strip, 'getBoundingClientRect').mockReturnValue({left: 0, width: 200} as DOMRect);
        fireEvent.click(strip, {clientX: 100});
        expect(time()).toBe(5);
    });

    test('a passed detail replaces the form', () => {
        renderRevisions(true, [], <div>{'detail here'}</div>);
        expect(document.querySelector('.TaskRevisions__panel')).toHaveTextContent('detail here');
        expect(screen.queryByRole('textbox', {name: 'Revision description'})).toBeNull();
    });

    test('viewers with nothing selected are asked to pick a revision', () => {
        renderRevisions(false);
        expect(document.querySelector('.TaskRevisions__panel')).toHaveTextContent('Select a revision');
    });

    test('switching versions drops the pinned moment and follows the new video', async () => {
        const {video} = renderRevisions();
        await waitFor(() => expect(within(screen.getByRole('combobox', {name: 'Version'})).getAllByRole('option')).toHaveLength(2));
        video.currentTime = 3.5;
        fireEvent.click(screen.getByRole('button', {name: 'Use current time'}));
        expect(screen.getByText('0:03.50')).toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', {name: 'Version'}), {target: {value: 'file0'}});
        const next = document.querySelector('video')!;
        defineTime(next, 2);
        fireEvent.loadedMetadata(next);
        expect(screen.getByText('0:02.00')).toBeInTheDocument();

        fireEvent.change(screen.getByRole('textbox', {name: 'Revision description'}), {target: {value: 'Logo'}});
        fireEvent.click(screen.getByRole('button', {name: 'Create revision'}));
        await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({video_time: 2000, video_file_id: 'file0'})));
    });

    test('the reference image input stays reachable from the keyboard', () => {
        renderRevisions();
        expect(screen.getByLabelText('Reference image')).toBeVisible();
    });
});
