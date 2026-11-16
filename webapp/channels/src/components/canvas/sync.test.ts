// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fromBase64, toBase64} from 'lib0/buffer';
import * as Y from 'yjs';

import type {CanvasState} from '@mattermost/types/canvas';

import type {CanvasElement} from './model';
import {DEFAULT_STYLE, addElement, createCanvasDoc, duplicateElements, readElements, updateElements} from './model';
import type {SyncDeps, SyncStatus} from './sync';
import {CanvasSync} from './sync';

const CH = 'channel1';
const UPDATE_MAX_BYTES = 8 * 1024 * 1024; // model.CanvasUpdateMaxBytes
const POST_TARGET_BYTES = 512 * 1024;
const BAD_UPDATE = toBase64(new Uint8Array([255, 255]));

const rect = (id: string, props: Partial<CanvasElement> = {}): CanvasElement => ({
    ...DEFAULT_STYLE, id, type: 'rect', x: 0, y: 0, w: 10, h: 10, z: 0, seed: 1, ...props,
});

type Msg = {event: string; data: {channel_id: string; data: string; seq?: number; user_id?: string}};
type Listener = (msg: Msg) => void;

class FakeWs {
    messageListeners = new Set<Listener>();
    reconnectListeners = new Set<() => void>();
    hold = new Set<number>(); // canvas seqs held back until release()
    held: Msg[] = [];

    constructor(private server: FakeServer, readonly userId: string) {}

    addMessageListener = (fn: Listener) => this.messageListeners.add(fn);
    removeMessageListener = (fn: Listener) => this.messageListeners.delete(fn);
    addReconnectListener = (fn: () => void) => this.reconnectListeners.add(fn);
    removeReconnectListener = (fn: () => void) => this.reconnectListeners.delete(fn);
    sendMessage = jest.fn((action: string, data: {channel_id: string; data: string}) => {
        expect(action).toBe('canvas_awareness');
        this.server.fanOut(this, {event: 'canvas_awareness', data: {...data, user_id: this.userId}});
    });

    emit(msg: Msg) {
        if (msg.event === 'canvas_updated' && this.hold.has(msg.data.seq ?? 0)) {
            this.held.push(msg);
            return;
        }
        this.messageListeners.forEach((fn) => fn(msg));
    }

    release(seq: number) {
        this.hold.delete(seq);
        this.held.filter((msg) => msg.data.seq === seq).forEach((msg) => this.emit(msg));
    }
}

/** In-memory canvas log: assigns seqs and fans updates out to every socket except the sender's. */
class FakeServer {
    updates: Array<{seq: number; data: string}> = [];
    snapshot?: string;
    snapshotSeq = 0;
    failWith: unknown[] = []; // errors the next posts reject with
    sockets: FakeWs[] = [];

    fanOut(from: FakeWs | undefined, msg: Msg) {
        this.sockets.filter((ws) => ws !== from).forEach((ws) => ws.emit(msg));
    }

    append(from: FakeWs | undefined, data: string) {
        const seq = this.updates.length + 1;
        this.updates.push({seq, data});
        this.fanOut(from, {event: 'canvas_updated', data: {channel_id: CH, seq, data}});
        return seq;
    }

    connect(userId: string) {
        const ws = new FakeWs(this, userId);
        this.sockets.push(ws);
        const client = {
            getCanvasState: jest.fn(async (channelId: string, after = 0): Promise<CanvasState> => {
                expect(channelId).toBe(CH);
                const from = after < this.snapshotSeq ? this.snapshotSeq : after;
                return {
                    snapshot: after < this.snapshotSeq ? this.snapshot : undefined,
                    snapshot_seq: this.snapshotSeq,
                    updates: this.updates.filter((u) => u.seq > from),
                    last_seq: this.updates.length,
                };
            }),
            postCanvasUpdate: jest.fn(async (channelId: string, data: string) => {
                expect(channelId).toBe(CH);
                if (this.failWith.length) {
                    throw this.failWith.shift();
                }
                if (fromBase64(data).length > UPDATE_MAX_BYTES) {
                    throw {status_code: 413}; // eslint-disable-line no-throw-literal
                }
                return {seq: this.append(ws, data)};
            }),
            saveCanvasSnapshot: jest.fn(async (channelId: string, data: string, uptoSeq: number) => {
                const applied = this.snapshotSeq < uptoSeq && uptoSeq <= this.updates.length;
                if (applied) {
                    this.snapshot = data;
                    this.snapshotSeq = uptoSeq;
                }
                return {applied};
            }),
        };
        return {ws, client, deps: {client, ws, userId, connectionId: () => `conn-${userId}`} as unknown as SyncDeps};
    }
}

async function startClient(server: FakeServer, userId: string) {
    const {doc, elements, undo} = createCanvasDoc();
    const conn = server.connect(userId);
    const sync = new CanvasSync(doc, CH, conn.deps);
    const statuses: SyncStatus[] = [];
    sync.onStatus = (s) => statuses.push(s);
    await sync.start();
    return {doc, elements, undo, sync, statuses, ...conn};
}

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const ids = (elements: Parameters<typeof readElements>[0]) => readElements(elements).map((el) => el.id);

/** Whether the page would ask before unloading. */
const unloadBlocked = () => {
    const e = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(e);
    return e.defaultPrevented;
};

describe('CanvasSync', () => {
    let server: FakeServer;
    const syncs: CanvasSync[] = [];

    beforeEach(() => {
        jest.useFakeTimers();
        server = new FakeServer();
    });

    afterEach(async () => {
        syncs.splice(0).forEach((s) => s.destroy());
        server.failWith = [];
        await tick(60000); // let detached syncs drain, so none outlives its test
        jest.useRealTimers();
    });

    const start = async (userId: string) => {
        const c = await startClient(server, userId);
        syncs.push(c.sync);
        return c;
    };

    test('loads the snapshot and updates, and flushes edits made before start', async () => {
        const seed = createCanvasDoc();
        addElement(seed.doc, rect('s'));
        server.snapshot = toBase64(Y.encodeStateAsUpdate(seed.doc));
        server.snapshotSeq = 1;
        server.updates.push({seq: 1, data: server.snapshot});
        const later = createCanvasDoc();
        addElement(later.doc, rect('u'));
        server.updates.push({seq: 2, data: toBase64(Y.encodeStateAsUpdate(later.doc))});

        const {doc, elements} = createCanvasDoc();
        const conn = server.connect('a');
        const sync = new CanvasSync(doc, CH, conn.deps);
        syncs.push(sync);
        addElement(doc, rect('early'));
        expect(sync.status).toBe('loading');

        await sync.start();
        expect(conn.client.getCanvasState).toHaveBeenCalledWith(CH, 0);
        expect(sync.status).toBe('synced');
        expect(readElements(elements).map((el) => el.id)).toEqual(['early', 's', 'u']);

        await tick(50);
        expect(conn.client.postCanvasUpdate).toHaveBeenCalledTimes(1);
        expect(server.updates).toHaveLength(3);
    });

    test('concurrent edits on two clients converge', async () => {
        const a = await start('a');
        const b = await start('b');
        addElement(a.doc, rect('shared'));
        await tick(50);
        expect(readElements(b.elements).map((el) => el.id)).toEqual(['shared']);

        addElement(a.doc, rect('new', {z: 1}));
        updateElements(b.doc, ['shared'], {x: 40, y: 40});
        await tick(50);

        expect(readElements(a.elements)).toEqual(readElements(b.elements));
        expect(readElements(a.elements)).toEqual([rect('shared', {x: 40, y: 40}), rect('new', {z: 1})]);
    });

    test('a failed post stays queued and retries with backoff', async () => {
        const a = await start('a');
        const b = await start('b');
        server.failWith = [new Error('network down'), new Error('network down')];

        addElement(a.doc, rect('r'));
        await tick(50);
        expect(a.sync.status).toBe('offline');

        // Edits made while offline join the queue.
        updateElements(a.doc, ['r'], {x: 7});
        await tick(999);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(2);
        expect(readElements(b.elements)).toEqual([]);

        await tick(2000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(3);
        expect(readElements(b.elements)).toEqual([rect('r', {x: 7})]);
        expect(a.statuses).toEqual(['synced', 'offline', 'synced']);
    });

    test('a reconnect retries a failed post at once', async () => {
        const a = await start('a');
        server.failWith = [new Error('network down')];
        addElement(a.doc, rect('r'));
        await tick(50);
        expect(a.sync.status).toBe('offline');

        a.ws.reconnectListeners.forEach((fn) => fn());
        await tick(0);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(2);
        expect(a.sync.status).toBe('synced');
    });

    test('a seq gap lasting 2 s refetches after lastSeq and converges', async () => {
        const a = await start('a');
        const b = await start('b');
        b.ws.hold.add(2);

        for (const id of ['r1', 'r2', 'r3']) {
            addElement(a.doc, rect(id));
            await tick(50); // eslint-disable-line no-await-in-loop
        }
        expect(readElements(b.elements).map((el) => el.id)).toEqual(['r1']); // r3 waits for r2's structs
        expect(b.client.getCanvasState).toHaveBeenCalledTimes(1);

        await tick(1999);
        expect(b.client.getCanvasState).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(b.client.getCanvasState).toHaveBeenLastCalledWith(CH, 1);
        expect(readElements(b.elements)).toEqual(readElements(a.elements));
        expect(readElements(b.elements)).toHaveLength(3);
    });

    test('a reconnect refetches after lastSeq', async () => {
        const a = await start('a');
        const b = await start('b');
        addElement(a.doc, rect('r1'));
        await tick(50);
        addElement(a.doc, rect('r2'));
        await tick(50);

        b.ws.reconnectListeners.forEach((fn) => fn());
        await tick(0);
        expect(b.client.getCanvasState).toHaveBeenLastCalledWith(CH, 2);
    });

    test('only a client whose own post crosses the 200 mark compacts, never while a gap is open', async () => {
        const a = await start('a');
        const b = await start('b');
        a.ws.hold.add(250);

        // A third writer that is not a CanvasSync, so no time passes between updates.
        const writer = createCanvasDoc();
        writer.doc.on('update', (update: Uint8Array) => server.append(undefined, toBase64(update)));
        for (let i = 1; i <= 250; i++) {
            addElement(writer.doc, rect(`r${i}`, {z: i}));
        }
        await tick(0);

        // 250 remote updates: nobody who only receives uploads a snapshot.
        expect(a.client.saveCanvasSnapshot).not.toHaveBeenCalled();
        expect(b.client.saveCanvasSnapshot).not.toHaveBeenCalled();

        // A's own post is seq 251, but 250 is still missing: due for compaction, yet a gap is open.
        addElement(a.doc, rect('a1', {z: 251}));
        await tick(50);
        expect(server.updates).toHaveLength(251);
        expect(a.client.saveCanvasSnapshot).not.toHaveBeenCalled();

        // Closing the gap by receiving does not compact either; A's next post does.
        a.ws.release(250);
        await tick(0);
        expect(a.client.saveCanvasSnapshot).not.toHaveBeenCalled();
        addElement(a.doc, rect('a2', {z: 252}));
        await tick(50);
        expect(a.client.saveCanvasSnapshot).toHaveBeenCalledTimes(1);
        expect(a.client.saveCanvasSnapshot).toHaveBeenCalledWith(CH, expect.any(String), 252);
        const fromSnapshot = createCanvasDoc();
        Y.applyUpdate(fromSnapshot.doc, fromBase64(server.snapshot!));
        expect(readElements(fromSnapshot.elements)).toHaveLength(252);

        expect(b.client.saveCanvasSnapshot).not.toHaveBeenCalled();
        expect(readElements(b.elements)).toEqual(readElements(a.elements));
    });

    test('a gap closed by a refetch picks up the snapshot', async () => {
        const a = await start('a');
        const b = await start('b');
        b.ws.hold.add(5);

        const writer = createCanvasDoc();
        writer.doc.on('update', (update: Uint8Array) => server.append(undefined, toBase64(update)));
        for (let i = 1; i <= 199; i++) {
            addElement(writer.doc, rect(`r${i}`, {z: i}));
        }
        addElement(a.doc, rect('a', {z: 200})); // A's post is seq 200, so A compacts
        await tick(50);
        expect(server.snapshotSeq).toBe(200);
        expect(b.client.saveCanvasSnapshot).not.toHaveBeenCalled();

        await tick(2000);
        expect(b.client.getCanvasState).toHaveBeenLastCalledWith(CH, 4);
        expect(readElements(b.elements)).toEqual(readElements(a.elements));
        expect(b.client.saveCanvasSnapshot).not.toHaveBeenCalled();
    });

    test('ignores updates for other channels', async () => {
        const a = await start('a');
        const other = createCanvasDoc();
        addElement(other.doc, rect('x'));
        a.ws.emit({event: 'canvas_updated', data: {channel_id: 'other', seq: 1, data: toBase64(Y.encodeStateAsUpdate(other.doc))}});
        expect(readElements(a.elements)).toEqual([]);
    });

    test('awareness travels to peers with a capped selection and is cleared on destroy', async () => {
        const a = await start('a');
        const b = await start('b');
        const bId = b.sync.awareness.clientID;

        const selection = Array.from({length: 80}, (_, i) => `id${i}`);
        b.sync.awareness.setLocalStateField('cursor', {x: 1, y: 2});
        b.sync.awareness.setLocalStateField('selection', selection);
        b.sync.awareness.setLocalStateField('userId', 'spoofed');
        await tick(50);

        const state = a.sync.awareness.getStates().get(bId);
        expect(state).toMatchObject({cursor: {x: 1, y: 2}, userId: 'b'});
        expect(state!.selection).toEqual(selection.slice(0, 50));
        expect(b.sync.awareness.getLocalState()!.selection).toHaveLength(80);

        b.sync.destroy();
        expect(a.sync.awareness.getStates().has(bId)).toBe(false);
        expect(b.ws.messageListeners.size).toBe(0);
        expect(b.ws.reconnectListeners.size).toBe(0);
    });

    test('skips an awareness update over 4096 bytes', async () => {
        const a = await start('a');
        a.ws.sendMessage.mockClear();
        a.sync.awareness.setLocalStateField('name', 'x'.repeat(5000));
        await tick(50);
        expect(a.ws.sendMessage).not.toHaveBeenCalled();
    });

    test('a malformed payload does not throw out of the websocket listener', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const a = await start('a');
        expect(() => a.ws.emit({event: 'canvas_awareness', data: {channel_id: CH, user_id: 'b', data: 'AAAA'}})).not.toThrow();
        expect(() => a.ws.emit({event: 'canvas_updated', data: {channel_id: CH, seq: 1, data: '!!'}})).not.toThrow();
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockClear();
    });

    test('a malformed update in the initial load is skipped and its seq still counts', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const writer = createCanvasDoc();
        writer.doc.on('update', (update: Uint8Array) => server.append(undefined, toBase64(update)));
        addElement(writer.doc, rect('r1'));
        server.append(undefined, BAD_UPDATE);
        addElement(writer.doc, rect('r3', {z: 1}));

        const a = await start('a');
        expect(a.sync.status).toBe('synced');
        expect(readElements(a.elements).map((el) => el.id)).toEqual(['r1', 'r3']);
        expect(warn).toHaveBeenCalledTimes(1);

        // lastSeq reached 3, and nothing refetches on its own.
        await tick(10000);
        expect(a.client.getCanvasState).toHaveBeenCalledTimes(1);
        a.ws.reconnectListeners.forEach((fn) => fn());
        await tick(0);
        expect(a.client.getCanvasState).toHaveBeenLastCalledWith(CH, 3);
        warn.mockClear();
    });

    test('a malformed update reached by a refetch is skipped and the gap closes', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const a = await start('a');
        const b = await start('b');
        b.ws.hold.add(2);

        const writer = createCanvasDoc();
        writer.doc.on('update', (update: Uint8Array) => server.append(undefined, toBase64(update)));
        addElement(writer.doc, rect('r1'));
        server.append(undefined, BAD_UPDATE);
        addElement(writer.doc, rect('r3', {z: 1}));
        expect(warn).toHaveBeenCalledTimes(1); // A got the bad update over the websocket

        await tick(2000);
        expect(b.client.getCanvasState).toHaveBeenLastCalledWith(CH, 1);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(readElements(b.elements)).toEqual(readElements(a.elements));
        expect(readElements(b.elements).map((el) => el.id)).toEqual(['r1', 'r3']);

        await tick(10000);
        expect(b.client.getCanvasState).toHaveBeenCalledTimes(2);
        warn.mockClear();
    });

    test('a large duplicate is split into posts under the server cap and undone in one step', async () => {
        const a = await start('a');
        const b = await start('b');
        const points = Array.from({length: 4000}, () => Math.random() * 1000);
        for (let i = 0; i < 40; i++) {
            addElement(a.doc, rect(`p${i}`, {type: 'pen', z: i, points}));
        }
        await tick(500);
        expect(readElements(b.elements)).toHaveLength(40);
        a.undo.stopCapturing();

        let transactions = 0;
        const countUpdate = () => transactions++;
        a.doc.on('update', countUpdate);
        const ids = duplicateElements(a.doc, readElements(a.elements).map((el) => el.id));
        a.doc.off('update', countUpdate);
        expect(ids).toHaveLength(40);
        expect(transactions).toBeGreaterThan(2);

        const posted = a.client.postCanvasUpdate.mock.calls.length;
        await tick(1000);
        const calls = a.client.postCanvasUpdate.mock.calls.slice(posted);
        expect(calls.length).toBeGreaterThan(1);
        calls.forEach(([, data]) => expect(fromBase64(data).length).toBeLessThanOrEqual(POST_TARGET_BYTES));
        expect(a.statuses).not.toContain('error');
        expect(a.sync.status).toBe('synced');
        expect(readElements(b.elements)).toHaveLength(80);
        expect(readElements(b.elements)).toEqual(readElements(a.elements));

        a.undo.undo();
        expect(readElements(a.elements)).toHaveLength(40);
        expect(readElements(a.elements).some((el) => ids.includes(el.id))).toBe(false);
    });

    test('a post the server refuses sets status error; a network failure sets offline', async () => {
        const a = await start('a');
        server.failWith = [{status_code: 413}];
        addElement(a.doc, rect('r'));
        await tick(50);
        expect(a.sync.status).toBe('error');

        await tick(1000);
        expect(a.sync.status).toBe('synced');
        expect(server.updates).toHaveLength(1);

        server.failWith = [new Error('network down')];
        addElement(a.doc, rect('s'));
        await tick(50);
        expect(a.sync.status).toBe('offline');
        expect(a.statuses).toEqual(['synced', 'error', 'synced', 'offline']);
    });

    test('a refused post keeps status error while later edits queue behind it', async () => {
        const a = await start('a');
        const b = await start('b');
        server.failWith = [{status_code: 413}, {status_code: 413}];
        addElement(a.doc, rect('r'));
        await tick(50);
        addElement(a.doc, rect('s', {z: 1}));
        await tick(1000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(2);
        expect(a.sync.status).toBe('error');
        expect(ids(b.elements)).toEqual([]);

        await tick(2000);
        expect(ids(b.elements)).toEqual(['r', 's']);
        expect(a.statuses).toEqual(['synced', 'error', 'synced']);
    });

    test('an update over the server cap is refused without uploading it', async () => {
        const a = await start('a');
        addElement(a.doc, rect('big', {type: 'text', text: 'x'.repeat(UPDATE_MAX_BYTES)}));
        await tick(50);
        expect(a.sync.status).toBe('error');
        expect(a.client.postCanvasUpdate).not.toHaveBeenCalled();

        // Closing the board gives it up: it can never be sent.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        a.sync.destroy();
        await tick(1000); // the next retry
        expect(warn).toHaveBeenCalledTimes(1);
        expect(unloadBlocked()).toBe(false);
        warn.mockClear();
    });

    test('posts carry the connection id so the server leaves out the echo', async () => {
        const a = await start('a');
        addElement(a.doc, rect('r'));
        await tick(50);
        expect(a.client.postCanvasUpdate).toHaveBeenLastCalledWith(CH, expect.any(String), 'conn-a');
    });

    test('destroy while offline keeps posting the unsent edits until the network recovers', async () => {
        const a = await start('a');
        const b = await start('b');
        server.failWith = [new Error('network down'), new Error('network down'), new Error('network down')];
        addElement(a.doc, rect('r'));
        await tick(50);
        expect(a.sync.status).toBe('offline');
        addElement(a.doc, rect('s', {z: 1}));

        a.sync.destroy();
        expect(a.ws.messageListeners.size).toBe(0);
        await tick(1000 + 2000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(3);
        expect(ids(b.elements)).toEqual([]);

        await tick(4000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(4);
        expect(ids(b.elements)).toEqual(['r', 's']);

        // Detached, it no longer dedupes its own echo: a board reopened on this connection needs the broadcast.
        expect(a.client.postCanvasUpdate).toHaveBeenLastCalledWith(CH, expect.any(String), '');
        await tick(60000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(4);
    });

    test('a refusal stops the drainer of a destroyed sync', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const a = await start('a');
        server.failWith = [new Error('network down'), {status_code: 403}];
        addElement(a.doc, rect('r'));
        await tick(50);
        a.sync.destroy();

        await tick(1000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledTimes(1);
        await tick(60000);
        expect(a.client.postCanvasUpdate).toHaveBeenCalledTimes(2);
        expect(server.updates).toHaveLength(0);
        expect(unloadBlocked()).toBe(false);
        warn.mockClear();
    });

    test('asks before unload while updates are unsent, including after destroy, until they are taken', async () => {
        const a = await start('a');
        expect(unloadBlocked()).toBe(false);

        server.failWith = [new Error('network down')];
        addElement(a.doc, rect('r'));
        expect(unloadBlocked()).toBe(true);
        await tick(50);
        expect(a.sync.status).toBe('offline');
        a.sync.destroy();
        expect(unloadBlocked()).toBe(true);

        await tick(1000);
        expect(server.updates).toHaveLength(1);
        expect(unloadBlocked()).toBe(false);
    });
});
