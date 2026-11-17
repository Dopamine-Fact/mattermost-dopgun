// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useSyncExternalStore} from 'react';

import {Client4} from 'mattermost-redux/client';
import {getFileDownloadUrl} from 'mattermost-redux/utils/file_utils';

import type {ExplorerEntry} from './use_explorer_data';

export type ExplorerClipboard = {mode: 'cut' | 'copy'; channelId: string; itemIds: string[]; chatFileIds: string[]};

// One clipboard for the whole app, like the OS one: it survives folder and channel changes.
let clipboard: ExplorerClipboard | undefined;
const listeners = new Set<() => void>();

function setClipboard(next?: ExplorerClipboard) {
    clipboard = next;
    listeners.forEach((l) => l());
}

export const getClipboard = () => clipboard;
export const clearClipboard = () => setClipboard(undefined);

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
export const useClipboard = () => useSyncExternalStore(subscribe, getClipboard);

function toClipboard(mode: ExplorerClipboard['mode'], channelId: string, entries: ExplorerEntry[]): ExplorerClipboard {
    return {
        mode,
        channelId,
        itemIds: entries.flatMap((e) => (e.driveItem ? [e.driveItem.id] : [])),
        chatFileIds: entries.flatMap((e) => (!e.driveItem && e.fileInfo ? [e.fileInfo.id] : [])),
    };
}

export const cut = (channelId: string, entries: ExplorerEntry[]) => setClipboard(toClipboard('cut', channelId, entries));
export const copy = (channelId: string, entries: ExplorerEntry[]) => setClipboard(toClipboard('copy', channelId, entries));

/** Cut moves the items and empties the clipboard; copy copies them and keeps it for pasting again. */
export async function paste(targetChannelId: string, targetParentId: string) {
    const c = clipboard;
    if (!c) {
        return;
    }
    if (c.mode === 'cut') {
        await Client4.moveDriveItems(c.channelId, c.itemIds, targetChannelId, targetParentId);
        clearClipboard();
        return;
    }
    await Client4.copyDriveItems(c.channelId, c.itemIds, c.chatFileIds, targetChannelId, targetParentId);
}

function clickLink(href: string, filename = '') {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/** One file downloads directly; anything else in the drive goes as a zip. */
export async function download(channelId: string, entries: ExplorerEntry[]) {
    if (entries.length === 1 && entries[0].fileInfo) {
        clickLink(getFileDownloadUrl(entries[0].fileInfo.id));
        return;
    }

    // shortcut: chat attachments have no drive item, so each downloads on its own; zip them server-side if people select many.
    entries.forEach((e) => !e.driveItem && e.fileInfo && clickLink(getFileDownloadUrl(e.fileInfo.id)));
    const itemIds = entries.flatMap((e) => (e.driveItem ? [e.driveItem.id] : []));
    if (!itemIds.length) {
        return;
    }
    const blob = await Client4.downloadDriveZip(channelId, itemIds);
    const url = URL.createObjectURL(blob);
    clickLink(url, 'files.zip');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "New folder", then "New folder (2)", "New folder (3)"… skipping names already taken (case-insensitive). */
export function uniqueName(base: string, taken: string[]): string {
    const names = new Set(taken.map((n) => n.toLowerCase()));
    let name = base;
    for (let i = 2; names.has(name.toLowerCase()); i++) {
        name = `${base} (${i})`;
    }
    return name;
}
