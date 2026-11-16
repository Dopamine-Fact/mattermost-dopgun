// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {useSelector, useStore} from 'react-redux';

import {Client4} from 'mattermost-redux/client';
import {getCurrentUser, getCurrentUserId, getUsers} from 'mattermost-redux/selectors/entities/users';

import {getConnectionId} from 'selectors/general';

import WebClient from 'client/web_websocket_client';
import {generateId} from 'utils/utils';

import type {GlobalState} from 'types/store';

import CanvasFooter from './canvas_footer';
import CanvasProperties from './canvas_properties';
import type {PanelAction} from './canvas_properties';
import CanvasToolbar, {TOOLS} from './canvas_toolbar';
import type {Tool} from './canvas_toolbar';
import {align, bounds, hitTest, inRect, resizeAll, unionBounds} from './geometry';
import type {Bounds, Handle, Point, ResizePatch} from './geometry';
import {
    DEFAULT_STYLE,
    FONT_FAMILIES,
    LOCAL,
    MAX_TEXT_LENGTH,
    addElement,
    createCanvasDoc,
    deleteElements,
    duplicateElements,
    randomSeed,
    readElements,
    reorder,
    updateElements,
    updateInBatches,
    writeInBatches,
} from './model';
import type {CanvasElement, ElementStyle, ElementType} from './model';
import {CanvasRenderer} from './renderer';
import type {RemoteCursor, RemoteSelection} from './renderer';
import {CanvasSync} from './sync';
import type {SyncStatus} from './sync';

import './canvas.scss';

const CAPTURE_MS = 500; // Yjs's default undo capture window
const MAX_PEN_POINTS = 1000;
const FLUSH_MS = 200; // how often a pen stroke or resize in progress reaches the doc
const HIT_PX = 6;
const MAX_SELECTION = 50;
const PEER_COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5c940d'];
const HANDLES: Array<[Handle, number, number]> = [['nw', 0, 0], ['ne', 1, 0], ['sw', 0, 1], ['se', 1, 1]];
const DRAW_TOOLS: Partial<Record<Tool, ElementType>> = {pen: 'pen', rect: 'rect', ellipse: 'ellipse', line: 'line', arrow: 'arrow', text: 'text'};
const ARROWS: Record<string, [number, number]> = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};

const messages = defineMessages({
    board: {id: 'canvas.board', defaultMessage: 'Canvas'},
    textInput: {id: 'canvas.textInput', defaultMessage: 'Text'},
    loading: {id: 'canvas.status.loading', defaultMessage: 'Loading…'},
    offline: {id: 'canvas.status.offline', defaultMessage: 'Offline'},
    error: {id: 'canvas.status.error', defaultMessage: 'Changes not saved — retrying'},
    unsupported: {id: 'canvas.unsupported', defaultMessage: 'This browser can’t display the canvas.'},
});

/** A stable colour per user, so everyone sees the same colour for a peer. */
export function colorFor(userId: string) {
    let h = 0;
    for (let i = 0; i < userId.length; i++) {
        h = ((h * 31) + userId.charCodeAt(i)) >>> 0;
    }
    return PEER_COLORS[h % PEER_COLORS.length];
}

// In memory and shared by every board on the page, so elements can be copied between canvases.
let clipboard: CanvasElement[] = [];

const handleAt = (b: Bounds, p: Point, tol: number) =>
    HANDLES.find(([, fx, fy]) => Math.abs(p.x - (b.x + (fx * b.w))) <= tol && Math.abs(p.y - (b.y + (fy * b.h))) <= tol)?.[0];

// The stroke in progress: abs holds absolute points, flushed is how many of them the doc has.
type PenGesture = {kind: 'pen'; el: CanvasElement; abs: number[]; flushed: number; flushedAt: number};

// pending is the latest size the doc does not have yet.
type ResizeGesture = {kind: 'resize'; start: Point; orig: CanvasElement[]; handle: Handle; pending?: ResizePatch[]; flushedAt: number};

type Gesture = (
    {kind: 'move'; start: Point; orig: CanvasElement[]} |
    ResizeGesture |
    {kind: 'marquee'; start: Point; base: string[]} |
    {kind: 'draw'; start: Point; type: ElementType; id?: string} |
    PenGesture |
    {kind: 'erase'} |
    {kind: 'text'; start: Point}
) & {pointerId: number};

/** The pen element for a stroke: x, y, w, h are its bounding box and points are relative to it. */
function penElement(g: PenGesture): CanvasElement {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.abs.length; i += 2) {
        minX = Math.min(minX, g.abs[i]);
        maxX = Math.max(maxX, g.abs[i]);
        minY = Math.min(minY, g.abs[i + 1]);
        maxY = Math.max(maxY, g.abs[i + 1]);
    }
    return {...g.el, x: minX, y: minY, w: maxX - minX, h: maxY - minY, points: g.abs.map((v, i) => v - (i % 2 ? minY : minX))};
}

type Editing = {id: string; x: number; y: number; isNew: boolean; style: ElementStyle; text: string};

type Props = {
    channelId: string;
    readOnly: boolean;
};

function Board({channelId, readOnly}: Props) {
    const {formatMessage} = useIntl();
    const userId = useSelector(getCurrentUserId);
    const me = useSelector(getCurrentUser);
    const users = useSelector(getUsers);
    const store = useStore<GlobalState>();

    const [{doc, elements, undo}] = useState(createCanvasDoc);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [, setViewTick] = useState(0);
    const [els, setEls] = useState<CanvasElement[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [marquee, setMarquee] = useState<Bounds>();
    const [tool, setTool] = useState<Tool>('select');
    const [space, setSpace] = useState(false);
    const [style, setStyle] = useState<ElementStyle>(DEFAULT_STYLE);

    // The line tool has its own end arrowhead: the style's one belongs to the arrow tool.
    const [lineEnd, setLineEnd] = useState<ElementStyle['endArrow']>('none');
    const [editing, setEditing] = useState<Editing>();
    const [preview, setPreview] = useState<CanvasElement[]>([]);
    const [status, setStatus] = useState<SyncStatus>('loading');
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const rootRef = useRef<HTMLDivElement>(null);
    const surfaceRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);
    const rendererRef = useRef<CanvasRenderer | undefined>(undefined);
    const syncRef = useRef<CanvasSync | undefined>(undefined);
    const gestureRef = useRef<Gesture | undefined>(undefined);
    const gestureStackRef = useRef(0);
    const pointersRef = useRef(new Set<number>());
    const pointerRef = useRef<Point | undefined>(undefined);

    // Handlers read these rather than state, which can lag behind the doc within one event.
    const elsRef = useRef<CanvasElement[]>([]);
    const selRef = useRef<string[]>([]);
    const editingRef = useRef<Editing | undefined>(undefined);

    const activeTool: Tool = readOnly ? 'hand' : tool;
    const pan = readOnly || tool === 'hand' || space;
    const renderer = ready ? rendererRef.current : undefined;

    const select = (ids: string[]) => {
        selRef.current = ids;
        setSelected(ids);
    };
    const edit = (ed?: Editing) => {
        editingRef.current = ed;
        setEditing(ed);
    };
    const pick = (ids: string[]) => elsRef.current.filter((el) => ids.includes(el.id));
    const topZ = () => elsRef.current[elsRef.current.length - 1]?.z ?? 0;

    // A gesture (a draw, move or resize) is one undo step however long it takes; a discrete action is one of its own.
    const beginGesture = (g: Gesture) => {
        undo.stopCapturing();
        undo.captureTimeout = Infinity;
        gestureStackRef.current = undo.undoStack.length;
        gestureRef.current = g;
        renderer?.pauseDrag(true);
    };
    const endGesture = () => {
        gestureRef.current = undefined;
        setPreview([]);
        undo.stopCapturing();
        undo.captureTimeout = CAPTURE_MS;
        renderer?.pauseDrag(false);
    };

    // A second pointer (a pinch) cancels the gesture: undo what it wrote and drop the redo step that leaves.
    const cancelGesture = () => {
        const g = gestureRef.current;
        if (!g) {
            return;
        }
        endGesture();
        if (undo.undoStack.length > gestureStackRef.current) {
            undo.undo();
            undo.redoStack.length = 0;
            setCanRedo(false);
        }
        if (g.kind === 'marquee') {
            setMarquee(undefined);
            select(g.base);
        }
    };
    const discrete = (fn: () => void) => {
        undo.stopCapturing();
        fn();
        undo.stopCapturing();
    };

    const duplicateSelection = () => {
        let ids: string[] = [];
        discrete(() => {
            ids = duplicateElements(doc, selRef.current);
        });
        select(ids);
    };
    const deleteSelection = () => {
        const sel = selRef.current;
        discrete(() => deleteElements(doc, sel));
        select([]);
    };

    const newElement = (type: ElementType, at: Point, extra: Partial<CanvasElement> = {}): CanvasElement => ({
        ...style,
        ...(type === 'line' ? {endArrow: lineEnd} : {}),
        id: generateId(),
        type,
        x: at.x,
        y: at.y,
        w: 0,
        h: 0,
        z: topZ() + 1,
        seed: randomSeed(),
        ...extra,
    });
    const create = (type: ElementType, at: Point, extra: Partial<CanvasElement> = {}) => {
        const el = newElement(type, at, extra);
        addElement(doc, el);
        return el.id;
    };

    // Every write re-sends the whole points array, so the doc gets the stroke at most every FLUSH_MS, not per move.
    const flushPen = (g: PenGesture) => {
        if (g.flushed === g.abs.length) {
            return;
        }
        const el = penElement(g);
        if (g.flushed) {
            updateElements(doc, [el.id], el);
        } else {
            addElement(doc, el);
        }
        g.flushed = g.abs.length;
        g.flushedAt = Date.now();
    };

    // Resizing a stroke rewrites its points too: the same throttle, in transactions sized for one sync post.
    const flushResize = (g: ResizeGesture) => {
        if (g.pending) {
            updateInBatches(doc, g.pending);
            [g.pending, g.flushedAt] = [undefined, Date.now()];
        }
    };

    const moveBy = (orig: CanvasElement[], dx: number, dy: number) => doc.transact(() => {
        orig.forEach((el) => updateElements(doc, [el.id], {x: el.x + dx, y: el.y + dy}));
    }, LOCAL);

    const erase = (p: Point, zoom: number) => {
        const id = hitTest(elsRef.current, p, HIT_PX / zoom);
        if (id) {
            deleteElements(doc, [id]);
        }
    };

    const drawPeers = () => {
        const sync = syncRef.current;
        if (!renderer || !sync) {
            return;
        }
        const byId = new Map(elsRef.current.map((el) => [el.id, el]));
        const cursors: RemoteCursor[] = [];
        const selections: RemoteSelection[] = [];
        sync.awareness.getStates().forEach((s, clientId) => {
            // userId is the one the server vouched for; everything else in the state is the peer's claim.
            if (clientId === doc.clientID || typeof s.userId !== 'string') {
                return;
            }
            const color = colorFor(s.userId);
            const name = users[s.userId]?.username ?? String(s.user?.name ?? '').slice(0, 64);
            const c = s.cursor;
            if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
                cursors.push({userId: s.userId, name, color, x: c.x, y: c.y});
            }
            if (Array.isArray(s.selection)) {
                for (const id of s.selection.slice(0, MAX_SELECTION)) {
                    const el = byId.get(id);
                    if (el) {
                        selections.push({color, box: bounds(el)});
                    }
                }
            }
        });
        renderer.drawCursors(cursors);
        renderer.drawRemoteSelections(selections);
    };
    const drawPeersRef = useRef(drawPeers);
    drawPeersRef.current = drawPeers;

    useEffect(() => {
        const onUpdate = () => {
            elsRef.current = readElements(elements);
            setEls(elsRef.current);
            const kept = selRef.current.filter((id) => elements.has(id));
            if (kept.length !== selRef.current.length) {
                select(kept);
            }
        };
        const onStack = () => {
            setCanUndo(undo.canUndo());
            setCanRedo(undo.canRedo());
        };
        doc.on('update', onUpdate);
        undo.on('stack-item-added', onStack);
        undo.on('stack-item-popped', onStack);
        undo.on('stack-cleared', onStack);
        return () => {
            doc.off('update', onUpdate);
            undo.off('stack-item-added', onStack);
            undo.off('stack-item-popped', onStack);
            undo.off('stack-cleared', onStack);
        };
    }, [doc, elements, undo]);

    useEffect(() => {
        let alive = true;
        let created: CanvasRenderer | undefined;
        CanvasRenderer.create(surfaceRef.current!).then((r) => {
            created = r;
            if (!alive) {
                r.destroy();
                return;
            }
            rendererRef.current = r;
            r.onViewportChange = () => setViewTick((t) => t + 1);
            setReady(true);
        }, (err) => {
            // eslint-disable-next-line no-console
            console.error('canvas renderer failed to start', err);
            setFailed(true);
        });
        return () => {
            alive = false;
            if (created && rendererRef.current === created) {
                created.destroy();
            }
            rendererRef.current = undefined;
        };
    }, []);

    useEffect(() => {
        const sync = new CanvasSync(doc, channelId, {client: Client4, ws: WebClient, userId, connectionId: () => getConnectionId(store.getState())});
        syncRef.current = sync;
        sync.onStatus = setStatus;
        sync.awareness.setLocalState({
            ...sync.awareness.getLocalState(),
            cursor: null,
            selection: selRef.current,
        });
        const onChange = (_: unknown, origin: unknown) => {
            if (origin !== 'local') {
                drawPeersRef.current();
            }
        };
        sync.awareness.on('change', onChange);
        sync.start();
        return () => {
            sync.awareness.off('change', onChange);
            sync.destroy();
            syncRef.current = undefined;
        };
    }, [doc, channelId, userId, store]);

    // Kept apart from the sync effect so a rename updates the awareness state instead of restarting the sync.
    useEffect(() => {
        syncRef.current?.awareness.setLocalStateField('user', {id: userId, name: me?.username ?? '', color: colorFor(userId)});
    }, [userId, me?.username]);

    useEffect(() => {
        // A stroke being drawn or a resize in progress shows from local state; the doc only gets it every FLUSH_MS.
        const hidden = new Set([editing?.id, ...preview.map((el) => el.id)]);
        renderer?.draw([...els.filter((el) => !hidden.has(el.id)), ...preview], selected, marquee);
        drawPeersRef.current();
    }, [renderer, els, selected, marquee, editing, preview]);

    useEffect(() => {
        renderer?.setPanMode(pan);
    }, [renderer, pan]);

    useEffect(() => {
        syncRef.current?.awareness.setLocalStateField('selection', selected);
    }, [selected]);

    useEffect(() => {
        rootRef.current?.focus({preventScroll: true});
    }, []);

    useEffect(() => {
        textRef.current?.focus();
    }, [editing?.id]);

    // Grow the textarea to fit its text: shrink, then size to the scroll size.
    useLayoutEffect(() => {
        const ta = textRef.current;
        if (ta) {
            ta.style.width = '0';
            ta.style.height = '0';
            ta.style.width = `${ta.scrollWidth + 2}px`;
            ta.style.height = `${ta.scrollHeight}px`;
        }
    });

    const commitText = () => {
        const ed = editingRef.current;
        if (!ed) {
            return;
        }
        edit(undefined);
        const text = textRef.current?.value ?? ed.text;
        const zoom = renderer?.getZoom() ?? 1;
        const lines = text.split('\n');
        const w = ((textRef.current?.scrollWidth ?? 0) / zoom) || (Math.max(...lines.map((l) => l.length)) * ed.style.fontSize * 0.6);
        const h = ((textRef.current?.scrollHeight ?? 0) / zoom) || (lines.length * ed.style.fontSize * 1.25);
        const keep = Boolean(text.trim());
        discrete(() => {
            if (!keep) {
                if (!ed.isNew) {
                    deleteElements(doc, [ed.id]);
                }
            } else if (ed.isNew) {
                create('text', ed, {id: ed.id, text, w, h});
            } else {
                updateElements(doc, [ed.id], {text, w, h});
            }
        });
        select(keep ? [ed.id] : []);
        setTool('select');
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!renderer || e.button !== 0 || pan || editingRef.current) {
            return;
        }
        const pointers = pointersRef.current;
        if (e.isPrimary) {
            pointers.clear(); // a new primary pointer starts a fresh contact, whatever ups were missed
        }
        pointers.add(e.pointerId);
        if (pointers.size > 1) {
            cancelGesture();
            return;
        }
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const pointerId = e.pointerId;
        const p = renderer.toWorld(e.clientX, e.clientY);
        const tol = HIT_PX / renderer.getZoom();
        const all = elsRef.current;
        const sel = selRef.current;
        switch (activeTool) {
        case 'select': {
            const handle = sel.length ? handleAt(unionBounds(pick(sel)), p, tol) : undefined;
            if (handle) {
                beginGesture({kind: 'resize', pointerId, start: p, orig: pick(sel), handle, flushedAt: 0});
                return;
            }
            const id = hitTest(all, p, tol);
            if (id && e.shiftKey) {
                select(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
            } else if (id) {
                const ids = sel.includes(id) ? sel : [id];
                select(ids);
                beginGesture({kind: 'move', pointerId, start: p, orig: pick(ids)});
            } else {
                const base = e.shiftKey ? sel : [];
                select(base);
                beginGesture({kind: 'marquee', pointerId, start: p, base});
            }
            return;
        }
        case 'eraser':
            beginGesture({kind: 'erase', pointerId});
            erase(p, renderer.getZoom());
            return;
        case 'pen': {
            const g: PenGesture = {kind: 'pen', el: newElement('pen', p), abs: [p.x, p.y], flushed: 0, flushedAt: 0};
            beginGesture({...g, pointerId});
            setPreview([penElement(g)]);
            return;
        }
        case 'text':
            // The editor opens on pointer-up: focusing it now would lose to the focus change of this press.
            beginGesture({kind: 'text', pointerId, start: p});
            return;
        case 'hand':
            return;
        default:
            beginGesture({kind: 'draw', pointerId, start: p, type: activeTool});
        }
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!renderer) {
            return;
        }
        const p = renderer.toWorld(e.clientX, e.clientY);
        pointerRef.current = p;
        syncRef.current?.awareness.setLocalStateField('cursor', p);
        const g = gestureRef.current;
        if (!g || g.kind === 'text' || e.pointerId !== g.pointerId) {
            return;
        }
        if (g.kind === 'erase') {
            erase(p, renderer.getZoom());
            return;
        }
        if (g.kind === 'pen') {
            if (g.abs.length >= MAX_PEN_POINTS * 2) {
                // Long strokes continue as a new element, which keeps each rewrite of the points array small.
                flushPen(g);
                g.abs = g.abs.slice(-2);
                g.el = newElement('pen', {x: g.abs[0], y: g.abs[1]});
                g.flushed = 0;
                g.flushedAt = 0;
            }
            g.abs.push(p.x, p.y);
            setPreview([penElement(g)]);
            if (Date.now() - g.flushedAt >= FLUSH_MS) {
                flushPen(g);
            }
            return;
        }
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (g.kind === 'move') {
            moveBy(g.orig, dx, dy);
        } else if (g.kind === 'resize') {
            g.pending = resizeAll(g.orig, g.handle, dx, dy);
            setPreview(g.orig.map((el, i) => ({...el, ...g.pending?.[i]})));
            if (Date.now() - g.flushedAt >= FLUSH_MS) {
                flushResize(g);
            }
        } else if (g.kind === 'marquee') {
            const rect = {x: g.start.x, y: g.start.y, w: dx, h: dy};
            setMarquee(rect);
            select([...new Set([...g.base, ...inRect(elsRef.current, rect)])]);
        } else if (g.id) {
            updateElements(doc, [g.id], {w: dx, h: dy, points: g.type === 'line' || g.type === 'arrow' ? [0, 0, dx, dy] : undefined});
        } else if (dx || dy) {
            g.id = create(g.type, g.start, {w: dx, h: dy, ...(g.type === 'line' || g.type === 'arrow' ? {points: [0, 0, dx, dy]} : {})});
        }
    };

    // Also handles pointercancel and lostpointercapture, so a gesture whose pointerup never arrives still ends.
    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        pointersRef.current.delete(e.pointerId);
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.pointerId) {
            return;
        }
        if (g.kind === 'pen') {
            flushPen(g);
        } else if (g.kind === 'resize') {
            flushResize(g);
        }
        endGesture();
        if (g.kind === 'marquee') {
            setMarquee(undefined);
        } else if (g.kind === 'draw' && g.id) {
            select([g.id]);
            setTool('select');
        } else if (g.kind === 'text') {
            edit({id: generateId(), x: g.start.x, y: g.start.y, isNew: true, style, text: ''});
        }
    };

    const onPointerLeave = () => {
        syncRef.current?.awareness.setLocalStateField('cursor', null);
    };

    const onDoubleClick = (e: React.MouseEvent) => {
        if (!renderer || activeTool !== 'select') {
            return;
        }
        const id = hitTest(elsRef.current, renderer.toWorld(e.clientX, e.clientY), HIT_PX / renderer.getZoom());
        const el = elsRef.current.find((x) => x.id === id);
        if (el?.type === 'text') {
            select([]);
            edit({id: el.id, x: el.x, y: el.y, isNew: false, style: el, text: el.text ?? ''});
        }
    };

    const fit = (list: CanvasElement[]) => {
        if (list.length) {
            renderer?.fitTo(unionBounds(list));
        }
    };

    const copy = () => {
        clipboard = pick(selRef.current);
    };

    const paste = () => {
        if (!clipboard.length) {
            return;
        }
        const u = unionBounds(clipboard);
        const at = pointerRef.current ?? {x: u.x + (u.w / 2) + 10, y: u.y + (u.h / 2) + 10};
        const dx = at.x - (u.x + (u.w / 2));
        const dy = at.y - (u.y + (u.h / 2));
        const top = topZ();
        const copies = clipboard.map((el, i) => ({...el, id: generateId(), seed: randomSeed(), x: el.x + dx, y: el.y + dy, z: top + 1 + i}));
        discrete(() => writeInBatches(doc, copies));
        select(copies.map((el) => el.id));
    };

    // A live edit (a slider drag, a colour pick) is one undo step until onStyleCommit.
    const liveRef = useRef(false);
    const onStyleChange = (change: Partial<ElementStyle>, live = false) => {
        const sel = selRef.current;
        const lineHead = !sel.length && activeTool === 'line' ? change.endArrow : undefined;
        if (lineHead) {
            setLineEnd(lineHead);
        }
        const patch = {...change};
        if (lineHead) {
            delete patch.endArrow;
        }
        setStyle((s) => ({...s, ...patch}));
        if (!sel.length) {
            return;
        }
        if (!live) {
            discrete(() => updateElements(doc, sel, patch));
            return;
        }
        if (!liveRef.current) {
            liveRef.current = true;
            undo.stopCapturing();
            undo.captureTimeout = Infinity;
        }
        updateElements(doc, sel, patch);
    };
    const onStyleCommit = () => {
        if (liveRef.current) {
            liveRef.current = false;
            undo.stopCapturing();
            undo.captureTimeout = CAPTURE_MS;
        }
    };

    const onPanelAction = (a: PanelAction) => {
        const sel = selRef.current;
        if (a === 'duplicate') {
            duplicateSelection();
        } else if (a === 'delete') {
            deleteSelection();
        } else if (a === 'back' || a === 'backward' || a === 'forward' || a === 'front') {
            discrete(() => reorder(doc, sel, a));
        } else {
            const moved = align(pick(sel), a);
            discrete(() => doc.transact(() => Object.entries(moved).forEach(([id, p]) => updateElements(doc, [id], p)), LOCAL));
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
            return;
        }
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const canEdit = !readOnly && !gestureRef.current;
        const arrow = ARROWS[e.key];
        const toolIndex = TOOLS.findIndex((t) => t.key === key);
        const digit = Number(e.key);

        if (mod && (key === '=' || key === '+')) {
            renderer?.zoomBy(1.1);
        } else if (mod && key === '-') {
            renderer?.zoomBy(1 / 1.1);
        } else if (mod && key === '0') {
            renderer?.setZoom(1);
        } else if (mod && canEdit && key === 'z') {
            if (e.shiftKey) {
                undo.redo();
            } else {
                undo.undo();
            }
        } else if (mod && canEdit && key === 'y') {
            undo.redo();
        } else if (mod && canEdit && key === 'd') {
            duplicateSelection();
        } else if (mod && canEdit && key === 'c') {
            copy();
        } else if (mod && canEdit && key === 'v') {
            paste();
        } else if (mod || e.altKey) {
            return;
        } else if (e.shiftKey && e.code === 'Digit1') {
            fit(elsRef.current);
        } else if (e.shiftKey && e.code === 'Digit2') {
            fit(pick(selRef.current));
        } else if (e.key === ' ') {
            setSpace(true);
        } else if (e.key === 'Escape') {
            select([]);
        } else if (!canEdit) {
            return;
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            deleteSelection();
        } else if (arrow) {
            const step = e.shiftKey ? 10 : 1;
            discrete(() => moveBy(pick(selRef.current), arrow[0] * step, arrow[1] * step));
        } else if (toolIndex >= 0 || (digit >= 1 && digit <= 9)) {
            setTool(TOOLS[toolIndex >= 0 ? toolIndex : digit - 1].tool);
        } else {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    const onKeyUp = (e: React.KeyboardEvent) => {
        if (e.key === ' ') {
            setSpace(false);
        }
    };

    const onTextKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            commitText();
            rootRef.current?.focus({preventScroll: true});
        }
    };

    let textarea;
    if (editing && renderer) {
        const pos = renderer.toScreen(editing.x, editing.y);
        textarea = (
            <textarea
                ref={textRef}
                className='CanvasBoard__text'
                aria-label={formatMessage(messages.textInput)}
                value={editing.text}
                maxLength={MAX_TEXT_LENGTH}
                wrap='off'
                spellCheck={false}
                style={{
                    left: pos.x,
                    top: pos.y,
                    fontSize: editing.style.fontSize * renderer.getZoom(),
                    fontFamily: FONT_FAMILIES[editing.style.fontFamily],
                    color: editing.style.stroke,
                    textAlign: editing.style.textAlign,
                }}
                onChange={(e) => edit({...editing, text: e.target.value})}
                onBlur={commitText}
                onKeyDown={onTextKeyDown}
            />
        );
    }

    // What the panel edits: the selection if there is one, else the style of the next element drawn.
    const picked = els.filter((el) => selected.includes(el.id));
    let panelTypes: ElementType[] = [...new Set(picked.map((el) => el.type))];
    if (!picked.length && activeTool in DRAW_TOOLS) {
        panelTypes = [DRAW_TOOLS[activeTool]!];
    }
    const panelValues: Partial<ElementStyle> = picked.length ? {} : {...style, ...(activeTool === 'line' ? {endArrow: lineEnd} : {})};
    if (picked.length) {
        for (const key of Object.keys(DEFAULT_STYLE) as Array<keyof ElementStyle>) {
            if (picked.every((el) => el[key] === picked[0][key])) {
                Object.assign(panelValues, {[key]: picked[0][key]});
            }
        }
    }

    let chip;
    if (failed) {
        chip = formatMessage(messages.unsupported);
    } else if (status !== 'synced') {
        chip = formatMessage(messages[status]);
    }

    return (
        <div
            ref={rootRef}
            className={`CanvasBoard CanvasBoard--${pan ? 'pan' : activeTool}`}
            role='application'
            aria-label={formatMessage(messages.board)}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
        >
            <div
                ref={surfaceRef}
                className='CanvasBoard__surface'
                data-testid='canvasSurface'
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onLostPointerCapture={onPointerUp}
                onPointerLeave={onPointerLeave}
                onDoubleClick={onDoubleClick}
            />
            {textarea}
            {panelTypes.length > 0 && !readOnly && (
                <CanvasProperties
                    types={panelTypes}
                    values={panelValues}
                    selectionCount={picked.length}
                    onChange={onStyleChange}
                    onCommit={onStyleCommit}
                    onAction={onPanelAction}
                />
            )}
            <CanvasToolbar
                tool={activeTool}
                readOnly={readOnly}
                onSelect={setTool}
            />
            <CanvasFooter
                zoom={renderer?.getZoom() ?? 1}
                readOnly={readOnly}
                canUndo={canUndo}
                canRedo={canRedo}
                onZoomOut={() => renderer?.zoomBy(1 / 1.1)}
                onZoomIn={() => renderer?.zoomBy(1.1)}
                onZoomReset={() => renderer?.setZoom(1)}
                onUndo={() => undo.undo()}
                onRedo={() => undo.redo()}
            />
            {chip && (
                <div
                    className={`CanvasBoard__status CanvasBoard__status--${failed ? 'error' : status}`}
                    role='status'
                >
                    {chip}
                </div>
            )}
        </div>
    );
}

/** A whiteboard synced over the channel's canvas log. Remounts per channel so its doc, sync and renderer start fresh. */
export default function CanvasBoard(props: Props) {
    return (
        <Board
            key={props.channelId}
            {...props}
        />
    );
}
