// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {act, fireEvent, screen, within} from '@testing-library/react';
import React from 'react';
import type * as Y from 'yjs';

import type {UserProfile} from '@mattermost/types/users';

import {renderWithContext} from 'tests/react_testing_utils';

import CanvasBoard from './canvas_board';
import CanvasProperties from './canvas_properties';
import {readElements} from './model';
import type {ElementStyle, ElementType} from './model';
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

// jsdom has no PointerEvent: a MouseEvent carrying the pointer fields React reads.
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

const pressed = (name: string) => screen.getByRole('button', {name}).getAttribute('aria-pressed');
const has = (name: string) => screen.queryByRole('radiogroup', {name}) !== null;

function renderPanel(types: ElementType[], values: Partial<ElementStyle> = {}, selectionCount = 0) {
    const onChange = jest.fn();
    const onAction = jest.fn();
    const view = renderWithContext(
        <CanvasProperties
            types={types}
            values={values}
            selectionCount={selectionCount}
            onChange={onChange}
            onAction={onAction}
        />,
    );
    return {onChange, onAction, unmount: view.unmount};
}

describe('CanvasProperties', () => {
    test('a rect shows background, fill and edges, not arrowheads or font', () => {
        renderPanel(['rect']);
        expect(has('Background')).toBe(true);
        expect(has('Fill')).toBe(true);
        expect(has('Edges')).toBe(true);
        expect(has('Start arrowhead')).toBe(false);
        expect(has('Font size')).toBe(false);
    });

    test('an arrow shows arrowheads, not background', () => {
        renderPanel(['arrow']);
        expect(has('Start arrowhead')).toBe(true);
        expect(has('End arrowhead')).toBe(true);
        expect(has('Background')).toBe(false);
    });

    test('text shows font options but no stroke width', () => {
        renderPanel(['text']);
        expect(has('Font size')).toBe(true);
        expect(has('Font')).toBe(true);
        expect(has('Text align')).toBe(true);
        expect(has('Stroke width')).toBe(false);
    });

    test('a pen and a rect together hide background, edges and sloppiness', () => {
        renderPanel(['pen', 'rect']);
        expect(has('Stroke')).toBe(true);
        expect(has('Stroke width')).toBe(true);
        expect(has('Background')).toBe(false);
        expect(has('Edges')).toBe(false);
        expect(has('Sloppiness')).toBe(false);
    });

    test('values mark the matching option pressed; a missing value marks none', () => {
        const {unmount} = renderPanel(['rect'], {strokeWidth: 4});
        expect(pressed('Extra bold')).toBe('true');
        expect(pressed('Thin')).toBe('false');
        unmount();

        renderPanel(['rect'], {});
        for (const name of ['Thin', 'Bold', 'Extra bold']) {
            expect(pressed(name)).toBe('false');
        }
    });

    test('clicking an option, a colour and moving the opacity slider call onChange', () => {
        const {onChange} = renderPanel(['rect']);
        fireEvent.click(screen.getByRole('button', {name: 'Dashed'}));
        expect(onChange).toHaveBeenLastCalledWith({strokeStyle: 'dashed'});

        fireEvent.change(screen.getByRole('slider', {name: 'Opacity'}), {target: {value: '50'}});
        expect(onChange).toHaveBeenLastCalledWith({opacity: 50}, true);

        fireEvent.click(screen.getByRole('button', {name: '#e03131'}));
        expect(onChange).toHaveBeenLastCalledWith({stroke: '#e03131'});
    });

    test('one selected shows layers and actions but not align', () => {
        const {onAction} = renderPanel(['rect'], {}, 1);
        expect(has('Layers')).toBe(true);
        expect(has('Align')).toBe(false);
        fireEvent.click(screen.getByRole('button', {name: 'Bring to front'}));
        expect(onAction).toHaveBeenCalledWith('front');
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        expect(onAction).toHaveBeenLastCalledWith('delete');
    });

    test('align shows with two selected; layers and actions need a selection', () => {
        const {unmount} = renderPanel(['rect'], {}, 2);
        expect(has('Align')).toBe(true);
        unmount();

        renderPanel(['rect'], {}, 0);
        expect(has('Layers')).toBe(false);
        expect(has('Actions')).toBe(false);
    });
});

async function renderBoard(readOnly = false) {
    renderWithContext(
        <CanvasBoard
            channelId='channel1'
            readOnly={readOnly}
        />,
        {entities: {users: {currentUserId: 'user1', profiles: {user1: {id: 'user1', username: 'alice'}}}}},
    );
    await act(async () => {});
    const doc: Y.Doc = jest.mocked(CanvasSync).mock.results.at(-1)!.value.doc;
    return {
        root: screen.getByRole('application'),
        surface: screen.getByTestId('canvasSurface'),
        els: () => readElements(doc.getMap('elements')),
    };
}

const drag = (surface: HTMLElement, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(surface, {button: 0, clientX: from[0], clientY: from[1]});
    fireEvent.pointerMove(surface, {clientX: to[0], clientY: to[1]});
    fireEvent.pointerUp(surface, {clientX: to[0], clientY: to[1]});
};

describe('CanvasBoard properties panel', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('is hidden for the select tool with nothing selected', async () => {
        await renderBoard();
        expect(screen.queryByRole('region', {name: 'Properties'})).not.toBeInTheDocument();
    });

    test('is hidden when read only', async () => {
        await renderBoard(true);
        expect(screen.queryByRole('region', {name: 'Properties'})).not.toBeInTheDocument();
    });

    test('a red stroke on two selected rects is one undo step', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [100, 100], [160, 140]);

        // A marquee around both.
        drag(surface, [0, 0], [300, 300]);
        expect(has('Align')).toBe(true);
        const before = els().map((e) => e.stroke);

        fireEvent.click(screen.getByRole('button', {name: '#e03131'}));
        expect(els().map((e) => e.stroke)).toEqual(['#e03131', '#e03131']);

        fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
        expect(els().map((e) => e.stroke)).toEqual(before);
    });

    test('a mixed selection highlights nothing where the values differ', async () => {
        const {root, surface} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);
        fireEvent.click(screen.getByRole('button', {name: 'Thin'}));
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [100, 100], [160, 140]);
        fireEvent.click(screen.getByRole('button', {name: 'Extra bold'}));
        drag(surface, [0, 0], [300, 300]);

        const widths = within(screen.getByRole('radiogroup', {name: 'Stroke width'}));
        for (const name of ['Thin', 'Bold', 'Extra bold']) {
            expect(widths.getByRole('button', {name})).toHaveAttribute('aria-pressed', 'false');
        }
    });

    test('a style chosen with nothing selected applies to the next element drawn', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        fireEvent.click(screen.getByRole('button', {name: 'Cartoonist'}));
        drag(surface, [10, 10], [60, 40]);

        expect(els()).toHaveLength(1);
        expect(els()[0].roughness).toBe(2);
    });

    test('Duplicate and Delete in the panel act like Ctrl+D and Delete', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);

        fireEvent.click(screen.getByRole('button', {name: 'Duplicate'}));
        expect(els()).toHaveLength(2);
        expect(els()[1].x).toBe(20);

        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
        expect(els()).toHaveLength(1);
    });

    test('the line tool keeps its own end arrowhead, shown and applied', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'l'});
        expect(within(screen.getByRole('radiogroup', {name: 'End arrowhead'})).getByRole('button', {name: 'None'})).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(within(screen.getByRole('radiogroup', {name: 'End arrowhead'})).getByRole('button', {name: 'Triangle'}));
        drag(surface, [10, 10], [60, 40]);

        expect(els()[0].endArrow).toBe('triangle');
    });

    test('a slider drag and a colour pick are each one undo step', async () => {
        const {root, surface, els} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);

        const slider = screen.getByRole('slider', {name: 'Opacity'});
        for (const v of ['90', '70', '40']) {
            fireEvent.change(slider, {target: {value: v}});
        }
        fireEvent.blur(slider);
        expect(els()[0].opacity).toBe(40);
        fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
        expect(els()[0].opacity).toBe(100);

        const color = within(screen.getByRole('radiogroup', {name: 'Stroke'})).getByLabelText('Custom colour');
        fireEvent.change(color, {target: {value: '#111111'}});
        fireEvent.change(color, {target: {value: '#222222'}});
        fireEvent.blur(color);
        expect(els()[0].stroke).toBe('#222222');
        fireEvent.keyDown(root, {key: 'z', ctrlKey: true});
        expect(els()[0].stroke).toBe('#000000');
    });

    test('keys typed in the panel do not reach the board shortcuts', async () => {
        const {root, surface} = await renderBoard();
        fireEvent.keyDown(root, {key: 'r'});
        drag(surface, [10, 10], [60, 40]);

        fireEvent.keyDown(screen.getByRole('button', {name: 'Thin'}), {key: 'e'});
        expect(screen.getByRole('button', {name: 'Eraser'})).toHaveAttribute('aria-pressed', 'false');
    });

    describe('storyboard cards', () => {
        const members = [{id: 'user1', username: 'alice'}, {id: 'user2', username: 'bob'}] as UserProfile[];
        const renderScene = (props: Partial<React.ComponentProps<typeof CanvasProperties>> = {}) => {
            const onSceneChange = jest.fn();
            renderWithContext(
                <CanvasProperties
                    types={['scene']}
                    values={{}}
                    selectionCount={1}
                    onChange={jest.fn()}
                    onAction={jest.fn()}
                    scene={{done: false, members}}
                    onSceneChange={onSceneChange}
                    {...props}
                />,
            );
            return {onSceneChange};
        };

        test('shows created and edited lines', () => {
            renderScene({info: {createdBy: 'alice', createdAt: 1700000000000, updatedBy: 'bob', updatedAt: 1700000100000}});
            expect(screen.getByText(/Created by alice/)).toBeInTheDocument();
            expect(screen.getByText(/Last edited by bob/)).toBeInTheDocument();
        });

        test('shows Uploaded by for an image', () => {
            renderWithContext(
                <CanvasProperties
                    types={['image']}
                    values={{}}
                    selectionCount={1}
                    onChange={jest.fn()}
                    onAction={jest.fn()}
                    info={{uploadedBy: 'carol'}}
                />,
            );
            expect(screen.getByText(/Uploaded by carol/)).toBeInTheDocument();
        });

        test('a scene shows the frame colour and no opacity; an image shows opacity and no stroke', () => {
            const {unmount} = renderPanel(['scene'], {}, 1);
            expect(has('Frame colour')).toBe(true);
            expect(screen.queryByRole('slider', {name: 'Opacity'})).not.toBeInTheDocument();
            unmount();
            renderPanel(['image'], {}, 1);
            expect(has('Stroke')).toBe(false);
            expect(screen.getByRole('slider', {name: 'Opacity'})).toBeInTheDocument();
        });

        test('an owned card hides the frame colour, which the owner colour replaces', () => {
            renderScene({scene: {ownerId: 'user1', done: false, members}});
            expect(has('Frame colour')).toBe(false);
        });

        test('picks an owner from members, with None', () => {
            const {onSceneChange} = renderScene({scene: {ownerId: 'user1', done: false, members}});
            const select = screen.getByRole('combobox', {name: 'Owner'});
            expect(select).toHaveValue('user1');
            expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'alice', 'bob']);

            fireEvent.change(select, {target: {value: 'user2'}});
            expect(onSceneChange).toHaveBeenLastCalledWith({ownerId: 'user2'});
            fireEvent.change(select, {target: {value: ''}});
            expect(onSceneChange).toHaveBeenLastCalledWith({ownerId: undefined});
        });

        test('an owner who is not a member stays in the picker, by id when unknown', () => {
            renderScene({scene: {ownerId: 'gone', done: false, members}});
            const select = screen.getByRole('combobox', {name: 'Owner'});
            expect(select).toHaveValue('gone');
            expect(within(select).getByRole('option', {name: 'gone'})).toBeInTheDocument();
        });

        test('toggles done', () => {
            const {onSceneChange} = renderScene();
            fireEvent.click(screen.getByRole('checkbox', {name: 'Done'}));
            expect(onSceneChange).toHaveBeenCalledWith({done: true});
        });

        test('read-only shows info, owner and done without controls', () => {
            renderScene({readOnly: true, scene: {ownerId: 'user2', ownerName: 'bob', done: true, members}, info: {createdBy: 'alice', createdAt: 1700000000000}});
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
            expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
            expect(screen.queryByRole('button')).not.toBeInTheDocument();
            expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
            expect(screen.getByText(/Created by alice/)).toBeInTheDocument();
            expect(screen.getByText(/bob/)).toBeInTheDocument();
            expect(screen.getByText('Done')).toBeInTheDocument();
        });
    });
});
