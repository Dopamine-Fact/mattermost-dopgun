// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useRef, useState} from 'react';
import {useIntl} from 'react-intl';
import {useDispatch} from 'react-redux';

import type {ServerError} from '@mattermost/types/errors';

import {Client4} from 'mattermost-redux/client';

import {uploadFile} from 'actions/file_actions';

import {generateId} from 'utils/utils';

/** A file to upload; relPath keeps the dropped folder path, e.g. "A/B/c.png". */
export type UploadRequest = {file: File; relPath: string};

export type Upload = {
    id: string;
    name: string;
    percent: number;
    status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
    error?: string;
};

const CANCELLED = new Error('cancelled');

/**
 * Uploads files into a drive folder one after another, creating the folders in their relPath first.
 * A failed file shows its error and the rest carry on; onComplete runs when a batch is through.
 */
export function useExplorerUploads(onComplete?: () => void) {
    const intl = useIntl();
    const dispatch = useDispatch();
    const [uploads, setUploads] = useState<Upload[]>([]);
    const aborts = useRef(new Map<string, () => void>());
    const cancelled = useRef(new Set<string>());

    const update = (id: string, patch: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? {...u, ...patch} : u)));

    const send = (file: File, channelId: string, id: string) => new Promise<string>((resolve, reject) => {
        const xhr = dispatch(uploadFile({
            file,
            name: file.name,
            type: file.type,
            rootId: '',
            channelId,
            clientId: id,
            onProgress: (info) => update(id, {percent: info.percent ?? 0}),
            onSuccess: (response) => resolve(response.file_infos[0].id),
            onError: (err: string | ServerError) => reject(new Error((typeof err === 'string' ? err : err.message) || intl.formatMessage({id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.'}))),
        })) as unknown as XMLHttpRequest;
        aborts.current.set(id, () => {
            xhr.abort();
            reject(CANCELLED);
        });
    });

    const enqueue = useCallback(async (files: UploadRequest[], channelId: string, parentId: string) => {
        const batch = files.map((f) => ({...f, id: generateId()}));
        setUploads((list) => [...list, ...batch.map((b): Upload => ({id: b.id, name: b.relPath, percent: 0, status: 'queued'}))]);

        // One creation per folder path, shared by every file in it; a dropped folder whose name is taken becomes "A (2)".
        const folders = new Map<string, Promise<string>>();
        const folderFor = (dirs: string[]): Promise<string> => {
            if (!dirs.length) {
                return Promise.resolve(parentId);
            }
            const key = dirs.join('/');
            if (!folders.has(key)) {
                folders.set(key, folderFor(dirs.slice(0, -1)).then((parent) => Client4.createDriveFolder(channelId, parent, dirs[dirs.length - 1])).then((item) => item.id));
            }
            return folders.get(key)!;
        };

        for (const b of batch) {
            if (cancelled.current.has(b.id)) {
                continue;
            }
            update(b.id, {status: 'uploading'});
            try {
                /* eslint-disable no-await-in-loop -- one upload at a time keeps progress readable and the server unloaded */
                const folderId = await folderFor(b.relPath.split('/').slice(0, -1).filter(Boolean));
                const fileId = await send(b.file, channelId, b.id);
                if (!cancelled.current.has(b.id)) {
                    await Client4.addDriveFile(channelId, folderId, fileId);
                    update(b.id, {status: 'done', percent: 100});
                }
                /* eslint-enable no-await-in-loop */
            } catch (err) {
                if (err !== CANCELLED) {
                    update(b.id, {status: 'error', error: (err as Error)?.message || String(err)});
                }
            } finally {
                aborts.current.delete(b.id);
            }
        }
        onComplete?.();
    }, [onComplete]); // eslint-disable-line react-hooks/exhaustive-deps -- send/update only use setters, refs and intl

    const cancel = useCallback((id: string) => {
        cancelled.current.add(id);
        aborts.current.get(id)?.();
        update(id, {status: 'cancelled'});
    }, []);

    /** Drops finished, failed and cancelled rows from the list. */
    const clearFinished = useCallback(() => setUploads((list) => list.filter((u) => u.status === 'queued' || u.status === 'uploading')), []);

    return {uploads, enqueue, cancel, clearFinished};
}

export type ExplorerUploads = ReturnType<typeof useExplorerUploads>;
