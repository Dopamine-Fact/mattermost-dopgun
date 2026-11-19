// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type React from 'react';

import {CHAT_FOLDER, TRASH_FOLDER} from './use_explorer_data';
import type {UploadRequest} from './use_explorer_uploads';

const MIME = 'application/x-mattermost-drive';

/** What is being dragged out of the explorer. parentId is the folder it comes from. */
export type DragPayload = {
    channelId: string;
    parentId: string;
    itemIds: string[];
    chatFileIds: string[];

    /** Set when some dragged item cannot be changed (it sits in a mirror or read-only folder, or the viewer may not touch it): it can still be copied. */
    copyOnly?: boolean;
};

/** A folder that accepts drops; ancestors are its parent folders, used to stop dropping a folder into itself. */
export type DropTarget = {
    channelId: string;
    folderId: string;
    ancestors: string[];

    /** A mirror, read-only folder, or anything below a mirror: takes no drops. The server stays the final gate. */
    locked?: boolean;
};

export type DropEffect = 'move' | 'copy';

// The browser hides drag data until drop, so the payload lives here while a drag is in flight.
let dragging: DragPayload | undefined;

export function startDrag(event: React.DragEvent, payload: DragPayload) {
    dragging = payload;
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(MIME, payload.channelId);
}

export function endDrag() {
    dragging = undefined;
}

/** Windows rules: same channel moves, another channel copies, Ctrl forces copy, Shift forces move; chat files can only be copied. */
export function resolveDropEffect({sameChannel, ctrl = false, shift = false, fromChat = false}: {sameChannel: boolean; ctrl?: boolean; shift?: boolean; fromChat?: boolean}): DropEffect {
    if (fromChat || ctrl) {
        return 'copy';
    }
    if (shift) {
        return 'move';
    }
    return sameChannel ? 'move' : 'copy';
}

const isWritable = (target: DropTarget) => !target.locked && target.folderId !== CHAT_FOLDER && target.folderId !== TRASH_FOLDER;

/** The effect a drop of payload on target would have, or undefined when the drop is not allowed. */
export function dropEffectFor(payload: DragPayload, target: DropTarget, keys: {ctrl: boolean; shift: boolean}): DropEffect | undefined {
    if (!isWritable(target) || [target.folderId, ...target.ancestors].some((id) => payload.itemIds.includes(id))) {
        return undefined;
    }
    const sameChannel = payload.channelId === target.channelId;
    const effect = resolveDropEffect({sameChannel, ...keys, fromChat: payload.chatFileIds.length > 0});
    if (effect === 'move' && payload.copyOnly) {
        return undefined;
    }
    if (effect === 'move' && sameChannel && payload.parentId === target.folderId) {
        return undefined; // already there
    }
    return effect;
}

export type DropResult = {kind: 'items'; payload: DragPayload; effect: DropEffect} | {kind: 'files'; files: Promise<UploadRequest[]>};

/**
 * Handles dragover and drop for a target: accepts the drag (preventDefault + dropEffect) when allowed, and on drop
 * returns what was dropped. Returns undefined when the drag isn't one the target takes.
 */
export function handleDrag(event: React.DragEvent, target: DropTarget | undefined): DropResult | undefined {
    const types = [...event.dataTransfer.types];
    if (!target) {
        return undefined;
    }
    if (dragging && types.includes(MIME)) {
        const effect = dropEffectFor(dragging, target, {ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey});
        if (!effect) {
            return undefined;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = effect;
        const payload = dragging;
        if (event.type === 'drop') {
            endDrag();
        }
        return {kind: 'items', payload, effect};
    }
    if (types.includes('Files') && isWritable(target)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        return {kind: 'files', files: event.type === 'drop' ? collectFiles(event.dataTransfer) : Promise.resolve([])};
    }
    return undefined;
}

/** Whether a drag carries files from the operating system (not explorer items). */
export const isFileDrag = (event: React.DragEvent) => !dragging && [...event.dataTransfer.types].includes('Files');

/** Files of an OS drop, walking dropped folders; relPath keeps the folder path, e.g. "A/B/c.png". */
async function collectFiles(dataTransfer: DataTransfer): Promise<UploadRequest[]> {
    // Entries must be taken synchronously, inside the drop event.
    const entries = [...dataTransfer.items].flatMap((item) => {
        const entry = item.kind === 'file' ? item.webkitGetAsEntry?.() : null;
        return entry ? [entry] : [];
    });
    if (!entries.length) {
        return [...dataTransfer.files].map((file) => ({file, relPath: file.name}));
    }
    const out: UploadRequest[] = [];
    const walk = async (entry: FileSystemEntry, dir: string): Promise<void> => {
        if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
            out.push({file, relPath: dir + file.name});
            return;
        }
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        for (;;) {
            // readEntries returns at most ~100 entries per call; an empty batch means done.
            // eslint-disable-next-line no-await-in-loop
            const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
            if (!batch.length) {
                return;
            }
            // eslint-disable-next-line no-await-in-loop
            await Promise.all(batch.map((child) => walk(child, `${dir}${entry.name}/`)));
        }
    };
    await Promise.all(entries.map((entry) => walk(entry, '')));
    return out;
}
