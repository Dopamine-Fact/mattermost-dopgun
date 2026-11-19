// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {act, createEvent, fireEvent, screen} from '@testing-library/react';
import React from 'react';
import type * as Y from 'yjs';

import type {FileInfo} from '@mattermost/types/files';

import {renderWithContext} from 'tests/react_testing_utils';

import CanvasBoard, {colorFor} from './canvas_board';
import {uploadImages} from './canvas_uploads';
import {unionBounds} from './geometry';
import {DEFAULT_STYLE, MAX_TEXT_LENGTH, REMOTE, readElements} from './model';
import type {CanvasElement} from './model';
import {sceneParts} from './storyboard';
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

const state = {entities: {users: {currentUserId: 'user1', profiles: {user1: {id: 'user1', username: 'alice'}}}}};

async function renderBoard(readOnly = false) {
    renderWithContext(
        <CanvasBoard
            channelId='channel1'
            readOnly={readOnly}
        />,
        state,
    );
    await act(async () => {}); // renderer.create resolves
    const sync = jest.mocked(CanvasSync).mock.results.at(-1)!.value;
    const doc: Y.Doc = sync.doc;
    return {
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
    });

    test('toolbar renders all 9 tools', async () => {
        await renderBoard();
        const toolbar = screen.getByRole('toolbar');
        expect(toolbar.querySelectorAll('button')).toHaveLength(9);
        for (const name of ['Select', 'Hand (pan)', 'Pen', 'Rectangle', 'Ellipse', 'Line', 'Arrow', 'Text', 'Eraser']) {
            expect(screen.getByRole('button', {name})).toBeInTheDocument();
        }
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
            await drop(surface, [png('final.png')], [f.x + (f.w / 2), f.y + (f.h / 2)]);

            const after = scenes(els())[0];
            expect(after.finalFileId).toHaveLength(26);
            expect(after.finalName).toBe('final.png');
            expect(images(els())).toHaveLength(1);
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
});
