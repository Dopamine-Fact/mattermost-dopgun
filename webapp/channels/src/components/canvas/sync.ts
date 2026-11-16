// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fromBase64, toBase64} from 'lib0/buffer';
import {Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, modifyAwarenessUpdate} from 'y-protocols/awareness';
import * as Y from 'yjs';

import type {Client4, WebSocketClient, WebSocketMessage} from '@mattermost/client';
import {WebSocketEvents} from '@mattermost/client';
import type {CanvasState} from '@mattermost/types/canvas';

import {REMOTE} from './model';

/** 'error': the server refuses the queued edits (a non-transient 4xx); they stay queued, later edits queue behind them, and the post keeps retrying. */
export type SyncStatus = 'loading' | 'synced' | 'offline' | 'error';

export type SyncDeps = {
    client: Pick<Client4, 'getCanvasState' | 'postCanvasUpdate' | 'saveCanvasSnapshot'>;
    ws: Pick<WebSocketClient, 'addMessageListener' | 'removeMessageListener' | 'addReconnectListener' | 'removeReconnectListener' | 'sendMessage'>;
    userId: string;

    /** The websocket connection to leave out of the broadcast of our own posts. */
    connectionId?: () => string;
};

const FLUSH_MS = 50;
const AWARENESS_MS = 50;
const GAP_MS = 2000;
const COMPACT_EVERY = 200;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const POST_TARGET_BYTES = 512 * 1024; // a flush merges queued updates up to this size
const UPDATE_MAX_BYTES = 8 * 1024 * 1024; // the server's model.CanvasUpdateMaxBytes, a backstop for one un-splittable update
const AWARENESS_MAX_BYTES = 4 * 1024;
const MAX_SELECTION = 50;

// Syncs, mounted or draining after unmount, that hold updates the server has not accepted yet.
const unsent = new Set<CanvasSync>();
const warnUnsent = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = ''; // older browsers prompt only when returnValue is set
};

/**
 * Keeps a Y.Doc in step with the server's canvas log: local updates are posted in batches, remote ones arrive
 * over the websocket with a seq, and any seq gap or reconnect is closed by refetching the log after lastSeq.
 */
export class CanvasSync {
    status: SyncStatus = 'loading';
    onStatus?: (s: SyncStatus) => void;
    readonly awareness: Awareness;

    private lastSeq = 0; // highest seq such that every seq up to it is in the doc
    private snapshotSeq = 0;
    private received = new Set<number>(); // seqs above lastSeq already in the doc
    private queue: Uint8Array[] = []; // local updates not yet accepted by the server

    private loaded = false;
    private destroyed = false;
    private posting = false;
    private fetching = false;
    private fetchAgain = false;
    private postFailed = false;
    private postRefused = false;
    private fetchFailed = false;
    private compacting = false;
    private compactAfter = 0;
    private postBackoff = BACKOFF_MIN_MS;
    private fetchBackoff = BACKOFF_MIN_MS;

    private flushTimer?: ReturnType<typeof setTimeout>;
    private postRetryTimer?: ReturnType<typeof setTimeout>;
    private fetchRetryTimer?: ReturnType<typeof setTimeout>;
    private gapTimer?: ReturnType<typeof setTimeout>;
    private awarenessTimer?: ReturnType<typeof setTimeout>;

    constructor(private doc: Y.Doc, private channelId: string, private deps: SyncDeps) {
        this.awareness = new Awareness(doc);
        this.awareness.setLocalStateField('userId', deps.userId);
        this.awareness.on('update', this.handleAwarenessUpdate);
        doc.on('update', this.handleDocUpdate);
    }

    async start(): Promise<void> {
        // Listen before fetching so nothing published meanwhile is missed; Yjs holds updates whose dependencies are not there yet.
        this.deps.ws.addMessageListener(this.handleMessage);
        this.deps.ws.addReconnectListener(this.handleReconnect);
        this.sendAwareness();
        await this.fetchState();
    }

    /**
     * Detaches from the doc and the websocket. Unsent updates are not dropped: the post loop keeps retrying them
     * with backoff until the server accepts them all or refuses one (a non-transient 4xx).
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.awareness.setLocalState(null);
        this.sendAwareness();
        this.destroyed = true;
        this.onStatus = undefined;
        [this.flushTimer, this.fetchRetryTimer, this.gapTimer, this.awarenessTimer].forEach(clearTimeout);
        this.flushTimer = undefined;
        this.deps.ws.removeMessageListener(this.handleMessage);
        this.deps.ws.removeReconnectListener(this.handleReconnect);
        this.doc.off('update', this.handleDocUpdate);
        this.awareness.destroy();
        if (!this.posting && !this.postRetryTimer) {
            this.flush();
        }
    }

    private trackUnsent() {
        const before = unsent.size;
        if (this.queue.length) {
            unsent.add(this);
        } else {
            unsent.delete(this);
        }
        if (!before && unsent.size) {
            window.addEventListener('beforeunload', warnUnsent);
        } else if (before && !unsent.size) {
            window.removeEventListener('beforeunload', warnUnsent);
        }
    }

    private setStatus() {
        let status: SyncStatus = this.loaded ? 'synced' : 'loading';
        if (this.postFailed || this.fetchFailed) {
            status = this.postFailed && this.postRefused ? 'error' : 'offline';
        }
        if (status !== this.status) {
            this.status = status;
            this.onStatus?.(status);
        }
    }

    private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === REMOTE) {
            return;
        }
        this.queue.push(update);
        this.trackUnsent();
        this.scheduleFlush();
    };

    private scheduleFlush() {
        if ((this.loaded || this.destroyed) && !this.flushTimer && !this.posting && !this.postRetryTimer && this.queue.length) {
            this.flushTimer = setTimeout(this.flush, FLUSH_MS);
        }
    }

    private flush = async () => {
        this.flushTimer = undefined;
        this.postRetryTimer = undefined;
        if (this.posting || !this.queue.length) {
            return;
        }

        // Post the oldest updates that fit one request; the rest go in the next flush. A lone update over the target still goes.
        let n = 0;
        for (let size = 0; n < this.queue.length && (n === 0 || size + this.queue[n].length <= POST_TARGET_BYTES); n++) {
            size += this.queue[n].length;
        }
        const update = n === 1 ? this.queue[0] : Y.mergeUpdates(this.queue.slice(0, n));

        this.posting = true;
        let seq: number | undefined;
        try {
            if (update.length > UPDATE_MAX_BYTES) {
                throw {status_code: 413}; // eslint-disable-line no-throw-literal
            }

            // Once detached nothing here dedupes the echo, and a board reopened on this connection needs it.
            const connectionId = this.destroyed ? '' : this.deps.connectionId?.() ?? '';
            ({seq} = await this.deps.client.postCanvasUpdate(this.channelId, toBase64(update), connectionId));
        } catch (err) {
            // Keep the batch (merged) at the head of the queue and retry later, even when the server refuses it.
            const code = (err as {status_code?: number} | undefined)?.status_code ?? 0;
            this.postRefused = code >= 400 && code < 500 && code !== 408 && code !== 429;
        }
        this.posting = false;

        if (seq === undefined && this.destroyed && this.postRefused) {
            // Detached, so nobody sees an 'error' status: drop what the server will never take rather than retry forever.
            // eslint-disable-next-line no-console
            console.warn(`canvas ${this.channelId}: the server refused ${this.queue.length} unsent update(s) after the board closed`);
            this.queue = [];
            this.trackUnsent();
            return;
        }
        if (seq === undefined) {
            this.queue.splice(0, n, update);
            this.postFailed = true;
            this.setStatus();
            this.postRetryTimer = setTimeout(this.flush, this.postBackoff);
            this.postBackoff = Math.min(this.postBackoff * 2, BACKOFF_MAX_MS);
            return;
        }

        this.queue.splice(0, n);
        this.trackUnsent();
        this.postBackoff = BACKOFF_MIN_MS;
        this.postFailed = false;
        this.postRefused = false;
        this.setStatus();
        this.scheduleFlush();
        if (!this.destroyed) {
            this.markReceived(seq);

            // Only a writer grows the log, so only a writer compacts: viewers never all upload at the same mark.
            this.maybeCompact();
        }
    };

    private markReceived(seq: number) {
        if (seq > this.lastSeq) {
            this.received.add(seq);
        }
        while (this.received.delete(this.lastSeq + 1)) {
            this.lastSeq++;
        }
        this.checkGap();
    }

    private checkGap() {
        if (!this.received.size || !this.loaded) {
            clearTimeout(this.gapTimer);
            this.gapTimer = undefined;
        } else if (!this.gapTimer) {
            this.gapTimer = setTimeout(() => {
                this.gapTimer = undefined;
                this.fetchState();
            }, GAP_MS);
        }
    }

    private handleMessage = (msg: WebSocketMessage) => {
        try {
            if (msg.event === WebSocketEvents.CanvasUpdated) {
                if (msg.data.channel_id !== this.channelId) {
                    return;
                }
                if (msg.data.seq > this.lastSeq && !this.received.has(msg.data.seq)) {
                    this.applyRemote(msg.data.data, msg.data.seq);
                }
                this.markReceived(msg.data.seq);
            } else if (msg.event === WebSocketEvents.CanvasAwareness) {
                if (msg.data.channel_id !== this.channelId) {
                    return;
                }

                // Label the peer with the user id the server vouches for, not one it claims.
                const userId = msg.data.user_id;
                const update = modifyAwarenessUpdate(fromBase64(msg.data.data), (state) => state && {...state, userId});
                applyAwarenessUpdate(this.awareness, update, REMOTE);
            }
        } catch {
            // A malformed payload must not break the other websocket listeners.
        }
    };

    private handleReconnect = () => {
        this.fetchState();
        if (this.postRetryTimer) {
            clearTimeout(this.postRetryTimer);
            this.postBackoff = BACKOFF_MIN_MS;
            this.flush();
        }
    };

    private fetchState = async () => {
        this.fetchRetryTimer = undefined;
        if (this.destroyed) {
            return;
        }
        if (this.fetching) {
            this.fetchAgain = true;
            return;
        }
        this.fetching = true;
        clearTimeout(this.gapTimer);
        this.gapTimer = undefined;

        let state: CanvasState | undefined;
        try {
            state = await this.deps.client.getCanvasState(this.channelId, this.lastSeq);
        } catch {
            // Retried below with backoff.
        }
        this.fetching = false;
        if (this.destroyed) {
            return;
        }

        if (state) {
            this.applyState(state);
            this.fetchBackoff = BACKOFF_MIN_MS;
            this.fetchFailed = false;
        } else {
            this.fetchFailed = true;
            this.fetchRetryTimer = setTimeout(this.fetchState, this.fetchBackoff);
            this.fetchBackoff = Math.min(this.fetchBackoff * 2, BACKOFF_MAX_MS);
        }
        this.setStatus();

        if (this.fetchAgain && state) {
            this.fetchAgain = false;
            this.fetchState();
        }
    };

    /** A malformed entry in the log is skipped (its seq still counts) so it cannot wedge every client forever. */
    private applyRemote(data: string, seq: number) {
        try {
            Y.applyUpdate(this.doc, fromBase64(data), REMOTE);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(`canvas ${this.channelId}: skipping malformed update at seq ${seq}`, err);
        }
    }

    private applyState(state: CanvasState) {
        this.doc.transact(() => {
            if (state.snapshot && state.snapshot_seq > this.lastSeq) {
                this.applyRemote(state.snapshot, state.snapshot_seq);
            }
            for (const u of state.updates) {
                if (u.seq > this.lastSeq && !this.received.has(u.seq)) {
                    this.applyRemote(u.data, u.seq);
                }
            }
        }, REMOTE);

        this.snapshotSeq = Math.max(this.snapshotSeq, state.snapshot_seq);
        this.lastSeq = Math.max(this.lastSeq, state.last_seq);
        for (const seq of this.received) {
            if (seq <= this.lastSeq) {
                this.received.delete(seq);
            }
        }
        this.loaded = true;
        this.markReceived(this.lastSeq);
        this.scheduleFlush();
    }

    private maybeCompact() {
        // The snapshot must hold every update up to lastSeq: no gap, nothing local that the log lacks.
        if (!this.loaded || this.compacting || this.received.size || this.queue.length || this.posting) {
            return;
        }
        if (this.lastSeq - this.snapshotSeq < COMPACT_EVERY || this.lastSeq < this.compactAfter) {
            return;
        }
        const upto = this.lastSeq;
        this.compacting = true;
        this.deps.client.saveCanvasSnapshot(this.channelId, toBase64(Y.encodeStateAsUpdate(this.doc)), upto).then(
            () => {
                // Not applied means a snapshot at least as new already exists.
                this.snapshotSeq = Math.max(this.snapshotSeq, upto);
            },
            () => {
                this.compactAfter = upto + COMPACT_EVERY;
            },
        ).finally(() => {
            this.compacting = false;
        });
    }

    private handleAwarenessUpdate = ({added, updated, removed}: {added: number[]; updated: number[]; removed: number[]}, origin: unknown) => {
        const id = this.doc.clientID;
        if (origin !== REMOTE && !this.awarenessTimer && [added, updated, removed].some((ids) => ids.includes(id))) {
            this.awarenessTimer = setTimeout(() => {
                this.awarenessTimer = undefined;
                this.sendAwareness();
            }, AWARENESS_MS);
        }
    };

    private sendAwareness() {
        if (this.destroyed) {
            return;
        }
        const id = this.doc.clientID;
        const state = this.awareness.getLocalState();
        let states;
        if (state && Array.isArray(state.selection) && state.selection.length > MAX_SELECTION) {
            states = new Map([[id, {...state, selection: state.selection.slice(0, MAX_SELECTION)}]]);
        }
        const update = encodeAwarenessUpdate(this.awareness, [id], states);
        if (update.length > AWARENESS_MAX_BYTES) {
            return; // the server would refuse it
        }
        this.deps.ws.sendMessage('canvas_awareness', {channel_id: this.channelId, data: toBase64(update)});
    }
}
