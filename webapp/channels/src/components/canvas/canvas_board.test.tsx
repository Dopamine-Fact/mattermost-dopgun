// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {act, createEvent, fireEvent, screen, within} from '@testing-library/react';
import React from 'react';
import type * as Y from 'yjs';

import type {FileInfo} from '@mattermost/types/files';

import {UserTypes} from 'mattermost-redux/action_types';
import {getMissingProfilesByIds, getProfilesInChannel} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getFileUrl} from 'mattermost-redux/utils/file_utils';

import {openModal} from 'actions/views/modals';

import {renderWithContext} from 'tests/react_testing_utils';
import {ModalIdentifiers} from 'utils/constants';

import CanvasBoard, {colorFor} from './canvas_board';
import {uploadImages} from './canvas_uploads';
import {unionBounds} from './geometry';
import {DEFAULT_STYLE, MAX_LABEL_LENGTH, MAX_TEXT_LENGTH, REMOTE, addElement, deleteElements, readElements} from './model';
import type {CanvasElement} from './model';
import {SCENE_HEADER, sceneParts} from './storyboard';
import {CanvasSync} from './sync';

const mockRenderer = {
    draw: jest.fn(),
    drawCursors: jest.fn(),
    drawRemoteSelections: jest.fn(),
    toWorld: jest.fn((x: number, y: number) => ({x, y})),
    toScreen: jest.fn((x: number, y: number) => ({x, y})),
    setPanMode: jest.fn(),
    pauseDrag: jest.fn(),
    getZoom: jest.fn(() => 1),
    setZoom: jest.fn(),
    zoomBy: jest.fn(),
    fitTo: jest.fn(),
    destroy: jest.fn(),
};

jest.mock('./renderer', () => ({
    CanvasRenderer: {create: jest.fn(() => Promise.resolve(mockRenderer))},
}));

jest.mock('./sync', () => {
    const {Awareness} = jest.requireActual('y-protocols/awareness');
    return {
        CanvasSync: jest.fn().mockImplementation((doc) => ({
            doc,
            status: 'synced',
            awareness: new Awareness(doc),
            start: jest.fn(),
            destroy: jest.fn(),
        })),
    };
});

jest.mock('client/web_websocket_client', () => ({}));

jest.mock('actions/views/modals', () => ({openModal: jest.fn((arg) => ({type: 'MOCK_OPEN_MODAL', arg}))}));
jest.mock('mattermost-redux/actions/users', () => ({
    ...jest.requireActual('mattermost-redux/actions/users'),
    getProfilesInChannel: jest.fn(() => () => Promise.resolve({data: []})),
    getMissingProfilesByIds: jest.fn(),
}));
jest.mock('components/file_preview_modal', () => () => null);

jest.mock('./canvas_uploads', () => ({
    ...jest.requireActual('./canvas_uploads'),
    uploadImages: jest.fn(),
}));

// jsdom has no PointerEvent: a MouseEvent carrying the pointer fields React reads. Defaults to the primary mouse pointer.
class FakePointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
    }
}
window.PointerEvent ??= FakePointerEvent as unknown as typeof PointerEvent;

// ownerId must look like a server id (26 lowercase alphanumerics) to survive parsing.
const BOB = 'b'.repeat(26);
const GHOST = 'c'.repeat(26);
const state = {entities: {users: {currentUserId: 'user1', profiles: {user1: {id: 'user1', username: 'alice'}, [BOB]: {id: BOB, username: 'bob'}}, profilesInChannel: {channel1: new Set(['user1', BOB])}}}};

async function renderBoard(readOnly = false, channelId = 'channel1') {
    const {unmount} = renderWithContext(
        <CanvasBoard
            channelId={channelId}
            readOnly={readOnly}
        />,
        state,
    );
    await act(async () => {}); // renderer.create resolves
    const sync = jest.mocked(CanvasSync).mock.results.at(-1)!.value;
    const doc: Y.Doc = sync.doc;
    return {
        unmount,
        root: screen.getByRole('application'),
        surface: screen.getByTestId('canvasSurface'),
        doc,
        els: () => readElements(doc.getMap('elements')),
    };
}

const drag = (surface: HTMLElement, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(surface, {button: 0, clientX: from[0], clientY: from[1]});
    fireEvent.pointerMove(surface, {clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2});
    fireEvent.pointerMove(surface, {clientX: to[0], clientY: to[1]});
    fireEvent.pointerUp(surface, {clientX: to[0], clientY: to[1]});
};

const pick = (el: CanvasElement) => ({x: el.x, y: el.y, w: el.w, h: el.h});
const box = (el: CanvasElement) => [el.x, el.y, el.w, el.h].map(Math.round); // scaling leaves float noise

describe('CanvasBoard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(getMissingProfilesByIds).mockReturnValue({type: 'MOCK_NOOP'} as never);
    });

    test('toolbar renders all 10 tools', async () => {
        await renderBoard();
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar.querySelectorAll('button')).toHaveLength(10);
        for (const name of ['Select', 'Hand (pan)', 'Pen', 'Rectangle', 'Ellipse', 'Line', 'Arrow', 'Text', 'Eraser', 'Frame']) {
            expect(screen.getByRole('button', {name})).toBeInTheDocument();
        }
    });

    test('a preset frame is placed centred on a click, below everything else', async () => {
        const {root, surface, doc, els} = await renderBoard();
        addElement(doc, {...DEFAULT_STYLE, id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 5, seed: 1});
        fireEvent.keyDown(root, {key: 'f'});
        fireEvent.click(within(screen.getByRole('group', {name: 'Frame size'})).getByRole('button', {name: /16:9/}));
        fireEvent.pointerDown(surface, {button: 0, clientX: 1000, clientY: 1000});
        fireEvent.pointerUp(surface, {clientX: 1000, clientY: 1000});

        const frame = els().find((el) => el.type === 'frame')!;
        expect(pick(frame)).toEqual({x: 360, y: 640, w: 1280, h: 720});
        expect(frame).toMatchObject({label: '16:9', fill: '#ffffff', z: 4});
        expect(screen.getByRole('button', {name: 'Select'})).toHaveAttribute('aria-pressed', 'true');
    });

    test('a custom frame is drawn by dragging; a click alone adds nothing', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'f'});
        fireEvent.pointerDown(surface, {button: 0, clientX: 30, clientY: 30});
        fireEvent.pointerUp(surface, {clientX: 30, clientY: 30});
        expect(els()).toHaveLength(0);

        drag(surface, [10, 10], [210, 110]);
        expect(els()).toHaveLength(1);
        expect(els()[0]).toMatchObject({type: 'frame', label: 'Frame', x: 10, y: 10, w: 200, h: 100});
    });

    test('a box-selected group is dragged from the empty space between its elements', async () => {
        const {root, surface, doc, els} = await renderBoard();
        addElement(doc, {...DEFAULT_STYLE, id: 'a', type: 'rect', x: 0, y: 0, w: 20, h: 20, z: 1, seed: 1});
        addElement(doc, {...DEFAULT_STYLE, id: 'b', type: 'rect', x: 100, y: 0, w: 20, h: 20, z: 2, seed: 1});
        fireEvent.keyDown(root, {key: 'v'});
        drag(surface, [-10, -10], [130, 30]);
        drag(surface, [60, 10], [160, 60]);

        expect(els().map(pick)).toEqual([{x: 100, y: 50, w: 20, h: 20}, {x: 200, y: 50, w: 20, h: 20}]);
        expect(mockRenderer.draw.mock.calls.at(-1)![1]).toEqual(['a', 'b']);
    });

    test('R then drag adds a rect; Delete removes it; Ctrl+Z restores it', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);

        expect(els()).toHaveLength(1);
        const [el] = els();
        expect(el.type).toBe('rect');
        expect(pick(el)).toEqual({x: 10, y: 10, w: 50, h: 30});
        expect(el).toMatchObject(DEFAULT_STYLE);

        fireEvent.keyDown(root, {key: 'Delete'});
        expect(els()).toHaveLength(0);

        fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
        expect(els()).toHaveLength(1);
        expect(pick(els()[0])).toEqual({x: 10, y: 10, w: 50, h: 30});
    });

    test('Ctrl+D duplicates at +10; arrows nudge by 1 and Shift+arrows by 10', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);

        fireEvent.keyDown(root, {key: 'd', ctrlKey: true});
        expect(els()).toHaveLength(2);
        const copy = els()[1];
        expect(copy.x).toBe(20);
        expect(copy.y).toBe(20);

        fireEvent.keyDown(root, {key: 'ArrowRight'});
        expect(els().find((e) => e.id === copy.id)!.x).toBe(21);
        fireEvent.keyDown(root, {key: 'ArrowRight', shiftKey: true});
        expect(els().find((e) => e.id === copy.id)!.x).toBe(31);
        expect(els()[0].x).toBe(10); // only the selection moves
    });

    test('footer zoom controls', async () => {
        await renderBoard();
        fireEvent.click(screen.getByRole('button', {name: 'Zoom in'}));
        expect(mockRenderer.zoomBy).toHaveBeenCalledWith(1.1);
        fireEvent.click(screen.getByRole('button', {name: 'Zoom out'}));
        expect(mockRenderer.zoomBy).toHaveBeenCalledWith(1 / 1.1);
        fireEvent.click(screen.getByRole('button', {name: '100%'}));
        expect(mockRenderer.setZoom).toHaveBeenCalledWith(1);
    });

    test('Shift+1 fits all elements', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);
        fireEvent.keyDown(root, {key: 'o'});
        drag(surface, [100, 200], [150, 260]);
        expect(els()).toHaveLength(2);

        fireEvent.keyDown(root, {key: '!', code: 'Digit1', shiftKey: true});
        expect(mockRenderer.fitTo).toHaveBeenCalledWith(unionBounds(els()));
    });

    test('R while the text editor is focused does not change the tool', async () => {
        const {root, surface} = await renderBoard();
        fireEvent.keyDown(root, {key: 't'});
        fireEvent.pointerDown(surface, {button: 0, clientX: 30, clientY: 30});
        fireEvent.pointerUp(surface, {clientX: 30, clientY: 30});

        const textarea = screen.getByRole('textbox', {name: 'Text'});
        expect(textarea).toHaveFocus();
        expect(textarea).toHaveAttribute('maxLength', String(MAX_TEXT_LENGTH));
        fireEvent.keyDown(textarea, {key: 'r'});

        expect(screen.getByRole('button', {name: 'Text'})).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', {name: 'Rectangle'})).toHaveAttribute('aria-pressed', 'false');
    });

    test('awareness carries the user, the world cursor and the selection', async () => {
        const {root, surface} = await renderBoard();
        const awareness = jest.mocked(CanvasSync).mock.results.at(-1)!.value.awareness;
        expect(awareness.getLocalState()).toMatchObject({user: {id: 'user1', name: 'alice', color: colorFor('user1')}, cursor: null, selection: []});

        mockRenderer.toWorld.mockImplementation((x: number, y: number) => ({x: x * 2, y: y * 2}));
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);
        mockRenderer.toWorld.mockImplementation((x: number, y: number) => ({x, y}));

        expect(awareness.getLocalState().cursor).toEqual({x: 120, y: 80});
        expect(awareness.getLocalState().selection).toHaveLength(1);
        fireEvent.pointerLeave(surface);
        expect(awareness.getLocalState().cursor).toBeNull();
    });

    test('the line tool draws without an arrowhead; the arrow tool keeps the style one', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'l'});
        drag(surface, [10, 10], [60, 40]);
        fireEvent.keyDown(root, {key: 'a'});
        drag(surface, [100, 100], [150, 130]);

        const [line, arrow] = els();
        expect(line).toMatchObject({type: 'line', endArrow: 'none', points: [0, 0, 50, 30]});
        expect(arrow).toMatchObject({type: 'arrow', endArrow: DEFAULT_STYLE.endArrow});
    });

    test('a malformed element from a peer is skipped instead of breaking the board', async () => {
        const {root, surface, doc, els} = await renderBoard();
        act(() => {
            doc.transact(() => doc.getMap<unknown>('elements').set('bad', 5), REMOTE);
        });
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);
        expect(els()).toHaveLength(1);
        expect(mockRenderer.draw.mock.calls.at(-1)![0].map((el: CanvasElement) => el.id)).toEqual([els()[0].id]);
    });

    describe('resize', () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        test('previews locally, writes at most every 200 ms and is one undo step', async () => {
            const {root, surface, doc, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'r'});
            drag(surface, [10, 10], [60, 40]); // leaves the rect selected
            jest.useFakeTimers();
            let writes = 0;
            doc.on('update', () => writes++);

            fireEvent.pointerDown(surface, {button: 0, clientX: 60, clientY: 40}); // the se handle
            for (let i = 1; i <= 20; i++) {
                fireEvent.pointerMove(surface, {clientX: 60 + i, clientY: 40 + i});
            }
            expect(writes).toBe(1); // the first move; the rest wait for the next 200 ms
            expect(box(els()[0])).toEqual([10, 10, 51, 31]);
            expect(box(mockRenderer.draw.mock.calls.at(-1)![0].at(-1))).toEqual([10, 10, 70, 50]); // the preview is current

            jest.advanceTimersByTime(200);
            fireEvent.pointerMove(surface, {clientX: 85, clientY: 65});
            expect(writes).toBe(2);
            expect(box(els()[0])).toEqual([10, 10, 75, 55]);

            fireEvent.pointerMove(surface, {clientX: 90, clientY: 70});
            fireEvent.pointerUp(surface, {clientX: 90, clientY: 70});
            expect(writes).toBe(3);
            expect(box(els()[0])).toEqual([10, 10, 80, 60]);

            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(els()).toHaveLength(1);
            expect(box(els()[0])).toEqual([10, 10, 50, 30]);
        });
    });

    describe('pen', () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        test('writes the stroke at most every 200 ms, keeps every point and is one undo step', async () => {
            const {root, surface, doc, els} = await renderBoard();
            jest.useFakeTimers();
            fireEvent.keyDown(root, {key: 'p'});
            let writes = 0;
            doc.on('update', () => writes++);

            fireEvent.pointerDown(surface, {button: 0, clientX: 0, clientY: 0});
            for (let i = 1; i <= 50; i++) {
                fireEvent.pointerMove(surface, {clientX: i, clientY: i * 2});
            }
            expect(writes).toBe(1); // the first move creates the element; the rest wait for the next 200 ms
            expect(mockRenderer.draw.mock.calls.at(-1)![0].at(-1).points).toHaveLength(51 * 2); // the preview has them all
            fireEvent.pointerUp(surface, {clientX: 50, clientY: 100});

            expect(writes).toBe(2);
            expect(els()).toHaveLength(1);
            const [el] = els();
            expect(el).toMatchObject({type: 'pen', x: 0, y: 0, w: 50, h: 100});
            expect(el.points).toHaveLength(51 * 2);
            expect(el.points!.slice(-2)).toEqual([50, 100]);

            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(els()).toHaveLength(0);
        });

        test('collaborators see the stroke grow every 200 ms', async () => {
            const {root, surface, els} = await renderBoard();
            jest.useFakeTimers();
            fireEvent.keyDown(root, {key: 'p'});
            fireEvent.pointerDown(surface, {button: 0, clientX: 0, clientY: 0});
            fireEvent.pointerMove(surface, {clientX: 1, clientY: 1});
            fireEvent.pointerMove(surface, {clientX: 2, clientY: 2});
            expect(els()[0].points).toHaveLength(2 * 2);

            jest.advanceTimersByTime(200);
            fireEvent.pointerMove(surface, {clientX: 3, clientY: 3});
            expect(els()[0].points).toHaveLength(4 * 2);
            fireEvent.pointerUp(surface, {clientX: 3, clientY: 3});
        });

        test('a stroke past 1000 points continues as a second element', async () => {
            const {root, surface, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'p'});
            fireEvent.pointerDown(surface, {button: 0, clientX: 0, clientY: 0});
            for (let i = 1; i <= 1100; i++) {
                fireEvent.pointerMove(surface, {clientX: i, clientY: 0});
            }
            fireEvent.pointerUp(surface, {clientX: 1100, clientY: 0});

            const strokes = els();
            expect(strokes).toHaveLength(2);
            expect(strokes[0].points).toHaveLength(1000 * 2);
            expect(strokes[1].x).toBe(999); // picks up from the last point of the first
            expect(strokes[1].points).toHaveLength(102 * 2);
        });
    });

    describe('pointers', () => {
        const touch = (pointerId: number, x = 0, y = 0) => ({button: 0, clientX: x, clientY: y, pointerId, isPrimary: pointerId === 1, pointerType: 'touch'});

        test('a second pointer during a rect drag cancels it and starts nothing of its own', async () => {
            const {root, surface, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'r'});
            drag(surface, [200, 200], [220, 220]);
            const before = els();

            fireEvent.keyDown(root, {key: 'r'});
            fireEvent.pointerDown(surface, touch(1, 10, 10));
            fireEvent.pointerMove(surface, touch(1, 60, 40));
            expect(els()).toHaveLength(2);

            fireEvent.pointerDown(surface, touch(2, 100, 100));
            expect(els()).toEqual(before); // the partial rect is gone
            fireEvent.pointerMove(surface, touch(2, 150, 150));
            fireEvent.pointerMove(surface, touch(1, 80, 80));
            fireEvent.pointerUp(surface, touch(2));
            fireEvent.pointerMove(surface, touch(1, 90, 90));
            fireEvent.pointerUp(surface, touch(1));
            expect(els()).toEqual(before);

            fireEvent.keyDown(root, {key: 'z', ctrlKey: true, shiftKey: true}); // the cancelled rect is not left to redo
            expect(els()).toEqual(before);
            expect(screen.getByRole('button', {name: 'Redo'})).toBeDisabled();
        });

        test('two pointers down create nothing and leave earlier work alone', async () => {
            const {root, surface, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'r'});
            drag(surface, [200, 200], [220, 220]);
            const before = els();

            fireEvent.keyDown(root, {key: 'r'});
            fireEvent.pointerDown(surface, touch(1, 10, 10));
            fireEvent.pointerDown(surface, touch(2, 100, 100));
            fireEvent.pointerMove(surface, touch(1, 60, 40));
            fireEvent.pointerMove(surface, touch(2, 150, 150));
            fireEvent.pointerUp(surface, touch(1));
            fireEvent.pointerUp(surface, touch(2));
            expect(els()).toEqual(before);
            expect(mockRenderer.pauseDrag).toHaveBeenLastCalledWith(false);
        });

        test('moves and ups from another pointer that never pressed leave the gesture alone', async () => {
            const {root, surface, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'r'});
            fireEvent.pointerDown(surface, touch(1, 10, 10));
            fireEvent.pointerMove(surface, touch(1, 60, 40));

            const hover = {clientX: 300, clientY: 300, pointerId: 7, isPrimary: false, pointerType: 'pen'};
            fireEvent.pointerMove(surface, hover);
            expect(pick(els()[0])).toEqual({x: 10, y: 10, w: 50, h: 30});
            fireEvent.pointerUp(surface, hover);
            fireEvent.pointerMove(surface, touch(1, 70, 50)); // still the same gesture
            expect(pick(els()[0])).toEqual({x: 10, y: 10, w: 60, h: 40});
            fireEvent.pointerUp(surface, touch(1));
        });

        test('losing pointer capture ends the gesture', async () => {
            const {root, surface, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'r'});
            fireEvent.pointerDown(surface, {button: 0, clientX: 10, clientY: 10});
            fireEvent.pointerMove(surface, {clientX: 60, clientY: 40});
            expect(mockRenderer.pauseDrag).toHaveBeenLastCalledWith(true);
            fireEvent.lostPointerCapture(surface, {pointerId: 1});
            expect(mockRenderer.pauseDrag).toHaveBeenLastCalledWith(false);

            fireEvent.pointerMove(surface, {clientX: 100, clientY: 100});
            expect(pick(els()[0])).toEqual({x: 10, y: 10, w: 50, h: 30});

            fireEvent.keyDown(root, {key: 'Delete'});
            expect(els()).toHaveLength(0);
        });
    });

    test('readOnly shows only the hand tool and the zoom controls', async () => {
        await renderBoard(true);
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar.querySelectorAll('button')).toHaveLength(1);
        expect(screen.getByRole('button', {name: 'Hand (pan)'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Zoom in'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Zoom out'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Undo'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Redo'})).not.toBeInTheDocument();
        expect(mockRenderer.setPanMode).toHaveBeenCalledWith(true);
    });

    describe('importing images', () => {
        const png = (name: string, type = 'image/png') => new File(['x'], name, {type});
        const drop = async (target: HTMLElement, files: File[], at: [number, number] = [100, 100]) => {
            await act(async () => {
                // jsdom has no DragEvent, so the point is set on the event by hand
                const ev = createEvent.drop(target, {dataTransfer: {files, types: ['Files']}});
                Object.defineProperties(ev, {clientX: {value: at[0]}, clientY: {value: at[1]}});
                fireEvent(target, ev);
            });
        };
        const scenes = (list: CanvasElement[]) => list.filter((e) => e.type === 'scene');
        const images = (list: CanvasElement[]) => list.filter((e) => e.type === 'image');

        beforeEach(() => {
            let n = 0;
            jest.mocked(uploadImages).mockImplementation(async (_channel, files, onProgress) => {
                const uploaded: Array<{file: File; info: FileInfo}> = [];
                const failed: File[] = [];
                files.forEach((file, i) => {
                    if (file.name.startsWith('bad')) {
                        failed.push(file);
                    } else {
                        n = (n % 9) + 1;
                        const wide = file.name.startsWith('SC10');
                        uploaded.push({file, info: {id: String(n).repeat(26), width: wide ? 200 : 100, height: 100, name: file.name} as FileInfo});
                    }
                    onProgress(i + 1, files.length);
                });
                return {uploaded, failed};
            });
        });

        test('dropping images creates one card and one image each, in name order', async () => {
            const {surface, els} = await renderBoard();
            await drop(surface, [png('SC10.png'), png('SC2.png')]);

            const cards = scenes(els()).sort((a, b) => a.x - b.x);
            expect(cards.map((c) => c.label)).toEqual(['SC2', 'SC10']);
            expect(cards[0].x).toBeGreaterThanOrEqual(100);
            expect(cards.every((c) => c.createdBy === 'user1')).toBe(true);
            const imgs = images(els());
            expect(imgs).toHaveLength(2);
            for (const c of cards) {
                const img = imgs.find((i) => i.sceneId === c.id)!;
                expect(img.fileId).toHaveLength(26);
                expect(img.aspect).toBe(c.label === 'SC10' ? 2 : 1);
            }
        });

        test('images are drawn above their cards', async () => {
            const {surface, els} = await renderBoard();
            await drop(surface, [png('a.png'), png('b.png')]);
            const list = els();
            expect(images(list)).toHaveLength(2);
            for (const img of images(list)) {
                expect(img.z).toBeGreaterThan(list.find((s) => s.id === img.sceneId)!.z);
            }
        });

        test('one undo removes the whole drop', async () => {
            const {root, surface, els} = await renderBoard();
            await drop(surface, [png('a.png'), png('b.png'), png('c.png')]);
            expect(els()).toHaveLength(6);
            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(els()).toHaveLength(0);
        });

        test('dropping on a card stacks the images into it', async () => {
            const {surface, els} = await renderBoard();
            await drop(surface, [png('a.png')]);
            const card = scenes(els())[0];
            const img = sceneParts(card).image;
            await drop(surface, [png('b.png')], [img.x + 5, img.y + 5]);

            expect(scenes(els())).toHaveLength(1);
            const added = images(els()).find((i) => i.name === 'b.png')!;
            expect(added.sceneId).toBe(card.id);
            expect(added.x).toBe(img.x + 24);
        });

        test('dropping on a card\'s final strip sets its final', async () => {
            const {surface, els} = await renderBoard();
            await drop(surface, [png('a.png')]);
            const f = sceneParts(scenes(els())[0]).final;
            await drop(surface, [png('final.png'), png('other.png')], [f.x + (f.w / 2), f.y + (f.h / 2)]);

            const after = scenes(els())[0];
            expect(after.finalFileId).toHaveLength(26);
            expect(after.finalName).toBe('final.png');
            expect(images(els())).toHaveLength(1);
            expect(screen.getByText(/one final image.*other\.png/)).toBeInTheDocument();
        });

        test('a final dropped on a card deleted during the upload is dropped too', async () => {
            const {surface, doc, els} = await renderBoard();
            await drop(surface, [png('a.png')]);
            const card = scenes(els())[0];
            const f = sceneParts(card).final;
            const upload = jest.mocked(uploadImages).getMockImplementation()!;
            jest.mocked(uploadImages).mockImplementationOnce(async (...args) => {
                deleteElements(doc, [card.id]);
                return upload(...args);
            });
            await drop(surface, [png('final.png')], [f.x + (f.w / 2), f.y + (f.h / 2)]);
            expect(els()).toHaveLength(0);
        });

        test('an upload that finishes during a drag waits for it, so cancelling the drag keeps the import', async () => {
            const {root, surface, doc, els} = await renderBoard();
            act(() => addElement(doc, {...DEFAULT_STYLE, id: 'A', type: 'scene', x: 0, y: 0, w: 300, h: 300, z: 1, seed: 1, label: 'A', done: false}));
            const upload = jest.mocked(uploadImages).getMockImplementation()!;
            let finish = () => {};
            jest.mocked(uploadImages).mockImplementationOnce((...args) => new Promise((resolve) => {
                finish = () => resolve(upload(...args));
            }));
            await drop(surface, [png('late.png')], [1000, 1000]);

            fireEvent.pointerDown(surface, {button: 0, clientX: 100, clientY: 20});
            fireEvent.pointerMove(surface, {clientX: 150, clientY: 50});
            await act(async () => finish());
            expect(scenes(els())).toHaveLength(1); // not written mid-drag
            fireEvent.pointerCancel(surface, {clientX: 150, clientY: 50});

            expect(els().find((e) => e.id === 'A')).toMatchObject({x: 0, y: 0});
            expect(scenes(els()).map((c) => c.label).sort()).toEqual(['A', 'late']);
            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(scenes(els()).map((c) => c.label)).toEqual(['A']);
        });

        test('non-images are refused with a message', async () => {
            const {surface, els} = await renderBoard();
            await drop(surface, [png('notes.pdf', 'application/pdf')]);
            expect(els()).toHaveLength(0);
            expect(uploadImages).not.toHaveBeenCalled();
            expect(screen.getByText(/notes\.pdf/)).toBeInTheDocument();
        });

        test('failed uploads are reported and skipped', async () => {
            const {surface, els} = await renderBoard();
            await drop(surface, [png('ok.png'), png('bad.png')]);
            expect(scenes(els())).toHaveLength(1);
            expect(screen.getByText(/bad\.png/)).toBeInTheDocument();
        });

        test('read-only users cannot drop', async () => {
            const {surface, els} = await renderBoard(true);
            let notPrevented = false;
            await act(async () => {
                notPrevented = fireEvent.drop(surface, {dataTransfer: {files: [png('a.png')], types: ['Files']}});
            });
            expect(notPrevented).toBe(true);
            expect(els()).toHaveLength(0);
            expect(uploadImages).not.toHaveBeenCalled();
        });

        test('a drop does not reach the channel\'s file upload', async () => {
            const {surface} = await renderBoard();
            const onBody = jest.fn();
            document.body.addEventListener('drop', onBody);
            await drop(surface, [png('a.png')]);
            document.body.removeEventListener('drop', onBody);
            expect(onBody).not.toHaveBeenCalled();
        });

        test('pasting image files imports them', async () => {
            const {root, els} = await renderBoard();
            await act(async () => {
                fireEvent.paste(root, {clipboardData: {files: [png('p.png')], types: ['Files']}});
            });
            expect(scenes(els())).toHaveLength(1);
            expect(images(els())).toHaveLength(1);
        });

        test('pasting without files still pastes copied elements', async () => {
            const {root, surface, els} = await renderBoard();
            fireEvent.keyDown(root, {key: 'r'});
            drag(surface, [10, 10], [60, 40]);
            fireEvent.keyDown(root, {key: 'c', ctrlKey: true});
            fireEvent.paste(root, {clipboardData: {files: [], types: ['text/plain']}});
            expect(els()).toHaveLength(2);
        });
    });

    describe('storyboard cards', () => {
        const FILE = 'f'.repeat(26);
        const FINAL = 'g'.repeat(26);
        const base = {...DEFAULT_STYLE, seed: 1, w: 0, h: 0, x: 0, y: 0, z: 0};
        const card = (id: string, x: number, z: number, extra: Partial<CanvasElement> = {}): CanvasElement => ({...base, id, type: 'scene', x, y: 0, w: 300, h: 300, z, label: id, done: false, ...extra});
        const image = (id: string, sceneId: string, x: number, z: number): CanvasElement => ({...base, id, type: 'image', x, y: 64, w: 100, h: 100, z, fileId: FILE, name: 'a.png', aspect: 1, sceneId});
        const seed = async (readOnly: boolean, ...list: CanvasElement[]) => {
            const board = await renderBoard(readOnly);
            act(() => list.forEach((el) => addElement(board.doc, el)));
            return {...board, byId: (id: string) => board.els().find((e) => e.id === id)!};
        };
        const click = (surface: HTMLElement, at: [number, number]) => {
            fireEvent.pointerDown(surface, {button: 0, clientX: at[0], clientY: at[1]});
            fireEvent.pointerUp(surface, {clientX: at[0], clientY: at[1]});
        };

        test('the panel shows the selected card owner picker and changes it in one undo step', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1, {createdBy: 'user1', createdAt: 1700000000000}), image('i', 'A', 16, 2));
            click(surface, [100, 20]);
            const select = screen.getByRole('combobox', {name: 'Owner'});
            expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'alice', 'bob']);
            expect(screen.getByText(/Created by alice/)).toBeInTheDocument();

            fireEvent.change(select, {target: {value: BOB}});
            expect(byId('A').ownerId).toBe(BOB);
            expect(byId('i').ownerId).toBeUndefined();
            expect(screen.getByRole('combobox', {name: 'Owner'})).toHaveValue(BOB);

            fireEvent.click(screen.getByRole('checkbox', {name: 'Done'}));
            expect(byId('A').done).toBe(true);

            fireEvent.change(screen.getByRole('combobox', {name: 'Owner'}), {target: {value: ''}});
            expect(byId('A').ownerId).toBeUndefined();
            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(byId('A').ownerId).toBe(BOB);
        });

        test('an owner who is not in the channel still shows, by id when not loaded', async () => {
            const {surface} = await seed(false, card('A', 0, 1, {ownerId: GHOST}));
            click(surface, [100, 20]);
            expect(screen.getByRole('combobox', {name: 'Owner'})).toHaveValue(GHOST);
            expect(screen.getByRole('option', {name: GHOST})).toBeInTheDocument();
        });

        test('read-only users see the info panel for a selected card', async () => {
            const {surface} = await seed(true, card('A', 0, 1, {ownerId: BOB, done: true}));
            expect(screen.queryByRole('region', {name: 'Properties'})).not.toBeInTheDocument();
            click(surface, [100, 20]);
            const panel = screen.getByRole('region', {name: 'Properties'});
            expect(within(panel).getByText('bob')).toBeInTheDocument();
            expect(within(panel).getByText('Done')).toBeInTheDocument();
            expect(within(panel).queryByRole('combobox')).not.toBeInTheDocument();
            expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
        });

        test('info shows the image uploader from its file info, fetched once', async () => {
            const spy = jest.spyOn(Client4, 'getFileInfo').mockResolvedValue({user_id: BOB} as FileInfo);
            const {surface} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            click(surface, [50, 100]);
            expect(await screen.findByText(/Uploaded by bob/)).toBeInTheDocument();
            click(surface, [100, 20]);
            click(surface, [50, 100]);
            expect(screen.getByText(/Uploaded by bob/)).toBeInTheDocument();
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith(FILE);
        });

        test('dragging a card moves its images with it, as one undo step', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            drag(surface, [100, 20], [150, 50]);
            expect(byId('A')).toMatchObject({x: 50, y: 30});
            expect(byId('i')).toMatchObject({x: 66, y: 94});

            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(byId('A')).toMatchObject({x: 0, y: 0});
            expect(byId('i')).toMatchObject({x: 16, y: 64});
        });

        test('arrow keys move a card with its images', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            click(surface, [100, 20]);
            fireEvent.keyDown(root, {key: 'ArrowRight', shiftKey: true});
            expect(byId('A').x).toBe(10);
            expect(byId('i').x).toBe(26);
        });

        test('a card and its image both selected do not move the image twice', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            click(surface, [100, 20]);
            fireEvent.pointerDown(surface, {button: 0, clientX: 50, clientY: 100, shiftKey: true});
            fireEvent.pointerUp(surface, {clientX: 50, clientY: 100});
            fireEvent.keyDown(root, {key: 'ArrowRight'});
            expect(byId('i').x).toBe(17);
        });

        test('dragging an image into another card re-parents it, to empty board frees it, one undo restores both', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1), card('B', 500, 2), image('i', 'A', 16, 3));
            drag(surface, [50, 100], [550, 100]);
            expect(byId('i')).toMatchObject({sceneId: 'B', x: 516});

            drag(surface, [550, 100], [1000, 100]);
            expect(byId('i').sceneId).toBeUndefined();
            expect(byId('i').x).toBe(966);

            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(byId('i')).toMatchObject({sceneId: 'B', x: 516});
            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(byId('i')).toMatchObject({sceneId: 'A', x: 16});
        });

        test('a cancelled image drag leaves position and card as they were', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1), card('B', 500, 2), image('i', 'A', 16, 3));
            fireEvent.pointerDown(surface, {button: 0, clientX: 50, clientY: 100});
            fireEvent.pointerMove(surface, {clientX: 550, clientY: 100});
            expect(byId('i').x).toBe(516);
            fireEvent.pointerCancel(surface, {clientX: 550, clientY: 100});
            expect(byId('i')).toMatchObject({sceneId: 'A', x: 16});
            expect(screen.getByRole('button', {name: 'Redo'})).toBeDisabled();
            expect(root).toBeInTheDocument();
        });

        test('a lone image copy joins the card under its centre, or none', async () => {
            const {root, surface, els, byId} = await seed(false, card('A', 0, 1), card('B', 500, 2), image('i', 'A', 16, 3));
            click(surface, [50, 100]);
            fireEvent.keyDown(root, {key: 'd', ctrlKey: true}); // lands 10 px down and right, still on A
            const dup = els().find((e) => e.type === 'image' && e.id !== 'i')!;
            expect(dup.sceneId).toBe('A');

            click(surface, [50, 100]);
            fireEvent.keyDown(root, {key: 'c', ctrlKey: true});
            fireEvent.pointerMove(surface, {clientX: 600, clientY: 100});
            fireEvent.paste(root, {clipboardData: {files: [], types: ['text/plain']}});
            fireEvent.pointerMove(surface, {clientX: 2000, clientY: 2000});
            fireEvent.paste(root, {clipboardData: {files: [], types: ['text/plain']}});

            const pasted = els().filter((e) => e.type === 'image' && e.id !== 'i' && e.id !== dup.id);
            expect(pasted.map((e) => e.sceneId)).toEqual(['B', undefined]);
            expect(byId('i').sceneId).toBe('A');
        });

        test('pasting from another channel\'s canvas leaves its images and finals out, with a notice', async () => {
            const first = await seed(false, card('A', 0, 1, {finalFileId: FINAL, finalName: 'end.jpg'}), image('i', 'A', 16, 2), card('B', 500, 3));
            click(first.surface, [100, 20]);
            fireEvent.pointerDown(first.surface, {button: 0, clientX: 600, clientY: 20, shiftKey: true});
            fireEvent.pointerUp(first.surface, {clientX: 600, clientY: 20});
            fireEvent.keyDown(first.root, {key: 'c', ctrlKey: true});
            first.unmount();

            const {root, els} = await renderBoard(false, 'channel2');
            fireEvent.paste(root, {clipboardData: {files: [], types: ['text/plain']}});
            const list = els();
            expect(list.map((e) => e.type)).toEqual(['scene', 'scene']);
            expect(list.every((e) => e.finalFileId === undefined && e.finalName === undefined)).toBe(true);
            expect(screen.getByText(/another channel/)).toBeInTheDocument();
        });

        test('pasting a lone image from another channel pastes nothing but the notice', async () => {
            const first = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            click(first.surface, [50, 100]);
            fireEvent.keyDown(first.root, {key: 'c', ctrlKey: true});
            first.unmount();

            const {root, els} = await renderBoard(false, 'channel2');
            fireEvent.paste(root, {clipboardData: {files: [], types: ['text/plain']}});
            expect(els()).toHaveLength(0);
            expect(screen.getByText(/another channel/)).toBeInTheDocument();
        });

        test('a click that jitters under 4 px moves nothing, even on an image\'s overhang', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 250, 3));
            const before = byId('i');
            fireEvent.pointerDown(surface, {button: 0, clientX: 330, clientY: 100});
            fireEvent.pointerMove(surface, {clientX: 332, clientY: 101});
            fireEvent.pointerUp(surface, {clientX: 332, clientY: 101});
            expect(byId('i')).toEqual(before);

            drag(surface, [330, 100], [340, 100]); // past the threshold it moves by the whole distance
            expect(byId('i').x).toBe(260);
        });

        test('bringing a card to front keeps its images above it', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2), {...card('R', 0, 3), type: 'rect', y: 200, h: 50});
            click(surface, [150, 20]);
            fireEvent.click(screen.getByRole('button', {name: 'Bring to front'}));
            expect(byId('A').z).toBeGreaterThan(byId('R').z);
            expect(byId('i').z).toBeGreaterThan(byId('A').z);
        });

        test('aligning cards moves their images with them, as one undo step', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2), card('B', 500, 3), image('j', 'B', 516, 4));
            click(surface, [100, 20]);
            fireEvent.pointerDown(surface, {button: 0, clientX: 600, clientY: 20, shiftKey: true});
            fireEvent.pointerUp(surface, {clientX: 600, clientY: 20});
            fireEvent.click(screen.getByRole('button', {name: 'Align left'}));
            expect(byId('B').x).toBe(0);
            expect(byId('j').x).toBe(16);
            expect(byId('i').x).toBe(16);

            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(byId('B').x).toBe(500);
            expect(byId('j').x).toBe(516);
        });

        test('clicking an image does not re-parent it', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1), card('B', 50, 5), image('i', 'A', 16, 3));
            click(surface, [60, 100]);
            expect(byId('i').sceneId).toBe('A');
        });

        test('resizing a card does not scale its images', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            click(surface, [100, 20]);
            drag(surface, [300, 300], [350, 340]);
            expect(byId('A')).toMatchObject({w: 350, h: 340});
            expect(byId('i')).toMatchObject({x: 16, w: 100, h: 100});
        });

        test('a card dragged past its opposite corner keeps its minimum size', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1));
            click(surface, [100, 20]);
            drag(surface, [300, 300], [-500, -500]);
            expect(byId('A')).toMatchObject({x: 0, y: 0, w: 2 * SCENE_HEADER, h: 2 * SCENE_HEADER});

            drag(surface, [0, 0], [900, 900]); // the nw handle, past the opposite corner
            const a = byId('A');
            expect(a.w).toBeGreaterThanOrEqual(2 * SCENE_HEADER);
            expect(a.h).toBeGreaterThanOrEqual(2 * SCENE_HEADER);
        });

        test('clicking the tick toggles done', async () => {
            const {root, surface, byId} = await seed(false, card('A', 0, 1));
            const t = sceneParts(byId('A')).tick;
            click(surface, [t.x + 20, t.y + 20]);
            expect(byId('A').done).toBe(true);
            fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
            expect(byId('A').done).toBe(false);
        });

        test('double-clicking the header edits the label', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1, {label: 'Opening'}));
            fireEvent.doubleClick(surface, {clientX: 100, clientY: 20});
            const ta = screen.getByRole('textbox', {name: 'Card label'});
            expect(ta).toHaveValue('Opening');

            fireEvent.change(ta, {target: {value: 'x'.repeat(MAX_LABEL_LENGTH + 20)}});
            fireEvent.keyDown(ta, {key: 'Escape'});
            expect(byId('A').label).toBe('x'.repeat(MAX_LABEL_LENGTH));
            expect(screen.queryByRole('textbox', {name: 'Card label'})).not.toBeInTheDocument();
        });

        test('Enter commits the label, which keeps no line breaks', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1, {label: 'Old'}));
            fireEvent.doubleClick(surface, {clientX: 100, clientY: 20});
            const ta = screen.getByRole('textbox', {name: 'Card label'});
            fireEvent.change(ta, {target: {value: 'Open\r\ning'}});
            const enter = createEvent.keyDown(ta, {key: 'Enter'});
            fireEvent(ta, enter);
            expect(enter.defaultPrevented).toBe(true);
            expect(byId('A').label).toBe('Opening');
            expect(screen.queryByRole('textbox', {name: 'Card label'})).not.toBeInTheDocument();
        });

        test('double-clicking an image opens the file preview', async () => {
            const {surface} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            fireEvent.doubleClick(surface, {clientX: 50, clientY: 100});
            expect(openModal).toHaveBeenCalledWith(expect.objectContaining({modalId: ModalIdentifiers.FILE_PREVIEW_MODAL}));
            const arg = jest.mocked(openModal).mock.calls[0][0] as unknown as {dialogProps: {fileInfos: Array<{link: string; extension: string}>}};
            expect(arg.dialogProps.fileInfos[0].link).toBe(getFileUrl(FILE));
            expect(arg.dialogProps.fileInfos[0].extension).toBe('png');
        });

        test('double-clicking a final strip opens it only when the card has a final', async () => {
            const {surface, byId} = await seed(false, card('A', 0, 1), card('B', 500, 1, {finalFileId: FINAL, finalName: 'end.jpg'}));
            const f = sceneParts(byId('A')).final;
            fireEvent.doubleClick(surface, {clientX: f.x + 10, clientY: f.y + 10});
            expect(openModal).not.toHaveBeenCalled();

            const g = sceneParts(byId('B')).final;
            fireEvent.doubleClick(surface, {clientX: g.x + 10, clientY: g.y + 10});
            expect(openModal).toHaveBeenCalledTimes(1);
        });

        test('copy and paste of a card copies its images, attached to the copy', async () => {
            const {root, surface, els} = await seed(false, card('A', 0, 1), image('i', 'A', 16, 2));
            click(surface, [100, 20]);
            fireEvent.keyDown(root, {key: 'c', ctrlKey: true});
            fireEvent.paste(root, {clipboardData: {files: [], types: ['text/plain']}});

            const list = els();
            expect(list).toHaveLength(4);
            const copy = list.find((e) => e.type === 'scene' && e.id !== 'A')!;
            const kid = list.find((e) => e.type === 'image' && e.id !== 'i')!;
            expect(kid.sceneId).toBe(copy.id);
            expect(list.find((e) => e.id === 'i')!.sceneId).toBe('A');
        });

        describe('names', () => {
            const casper = () => jest.mocked(getMissingProfilesByIds).mockImplementation((ids: string[]) => ({
                type: UserTypes.RECEIVED_PROFILES_LIST,
                data: ids.filter((id) => id === GHOST).map((id) => ({id, username: 'casper'})),
            }) as never);

            test('read-only users load the channel members and see usernames, not ids', async () => {
                casper();
                const {surface} = await seed(true, card('A', 0, 1, {ownerId: GHOST}));
                expect(getProfilesInChannel).toHaveBeenCalledWith('channel1', 0, 200);
                click(surface, [100, 20]);
                const panel = screen.getByRole('region', {name: 'Properties'});
                expect(within(panel).getByText('casper')).toBeInTheDocument();
                expect(within(panel).queryByText(GHOST)).not.toBeInTheDocument();
            });

            test('a non-member owner and authors are fetched once, then named everywhere', async () => {
                casper();
                const {doc, surface} = await seed(false, card('A', 0, 1, {ownerId: GHOST}), card('B', 500, 2, {ownerId: GHOST}));
                expect(getMissingProfilesByIds).toHaveBeenCalledTimes(1);
                expect(getMissingProfilesByIds).toHaveBeenCalledWith([GHOST]);
                act(() => doc.getMap<Y.Map<unknown>>('elements').get('A')!.set('updatedBy', BOB));
                expect(getMissingProfilesByIds).toHaveBeenLastCalledWith([BOB, GHOST]);

                const drawn: Array<CanvasElement & {ownerName?: string}> = mockRenderer.draw.mock.calls.at(-1)![0];
                expect(drawn.find((e) => e.id === 'A')!.ownerName).toBe('casper');
                click(surface, [100, 20]);
                expect(screen.getByRole('option', {name: 'casper'})).toBeInTheDocument();
            });
        });

        test('an owned card is drawn in the owner\'s colour with their name', async () => {
            await seed(false, card('A', 0, 1, {ownerId: BOB}), card('B', 500, 1, {ownerId: GHOST}));
            const drawn: Array<CanvasElement & {ownerName?: string}> = mockRenderer.draw.mock.calls.at(-1)![0];
            expect(drawn.find((e) => e.id === 'A')).toMatchObject({stroke: colorFor(BOB), ownerName: 'bob'});
            const ghost = drawn.find((e) => e.id === 'B')!;
            expect(ghost.stroke).toBe(colorFor(GHOST));
            expect(ghost.ownerName).toBeUndefined();
        });

        describe('read-only', () => {
            const selection = () => mockRenderer.draw.mock.calls.at(-1)![1];

            test('users select by clicking, not by dragging', async () => {
                const {surface} = await seed(true, card('A', 0, 1), image('i', 'A', 16, 2));
                click(surface, [50, 100]);
                expect(selection()).toEqual(['i']);
                click(surface, [900, 900]);
                expect(selection()).toEqual([]);

                fireEvent.pointerDown(surface, {button: 0, clientX: 50, clientY: 100});
                fireEvent.pointerMove(surface, {clientX: 60, clientY: 100});
                fireEvent.pointerUp(surface, {clientX: 60, clientY: 100});
                expect(selection()).toEqual([]);
            });

            test('clicking the tick selects the card without toggling it', async () => {
                const {surface, byId} = await seed(true, card('A', 0, 1));
                const t = sceneParts(byId('A')).tick;
                click(surface, [t.x + 20, t.y + 20]);
                expect(selection()).toEqual(['A']);
                expect(byId('A').done).toBe(false);
            });

            test('users can open an image\'s original and a final, but a header opens no editor', async () => {
                const {surface, byId} = await seed(true, card('A', 0, 1, {finalFileId: FINAL, finalName: 'end.jpg'}), image('i', 'A', 16, 2));
                fireEvent.doubleClick(surface, {clientX: 50, clientY: 100});
                expect(openModal).toHaveBeenCalledTimes(1);
                const f = sceneParts(byId('A')).final;
                fireEvent.doubleClick(surface, {clientX: f.x + 10, clientY: f.y + 10});
                expect(openModal).toHaveBeenCalledTimes(2);

                fireEvent.doubleClick(surface, {clientX: 100, clientY: 20});
                expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
            });
        });
    });
});
