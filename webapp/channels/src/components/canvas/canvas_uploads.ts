// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {FileInfo} from '@mattermost/types/files';

import {Client4} from 'mattermost-redux/client';

import {generateId} from 'utils/utils';

export const UPLOAD_CONCURRENCY = 3;

export type Uploaded = {file: File; info: FileInfo};

export function isImageFile(f: File): boolean {
    return f.type === 'image/png' || f.type === 'image/jpeg';
}

// Uploads files to the canvas channel (never posted); the server enforces MaxFileSize, so a rejection lands in `failed`.
export async function uploadImages(
    channelId: string,
    files: File[],
    onProgress: (done: number, total: number) => void,
): Promise<{uploaded: Uploaded[]; failed: File[]}> {
    const results: Array<FileInfo | undefined> = new Array(files.length);
    let next = 0;
    let done = 0;

    const worker = async () => {
        while (next < files.length) {
            const i = next++;
            const formData = new FormData();
            formData.append('channel_id', channelId);
            formData.append('client_ids', generateId());
            formData.append('files', files[i], files[i].name);
            try {
                // eslint-disable-next-line no-await-in-loop
                const res = await Client4.uploadFile(formData);
                results[i] = res.file_infos?.[0];
            } catch {
                results[i] = undefined;
            }
            onProgress(++done, files.length);
        }
    };
    await Promise.all(Array.from({length: Math.min(UPLOAD_CONCURRENCY, files.length)}, worker));

    const uploaded: Uploaded[] = [];
    const failed: File[] = [];
    files.forEach((file, i) => {
        const info = results[i];
        if (info) {
            uploaded.push({file, info});
        } else {
            failed.push(file);
        }
    });
    return {uploaded, failed};
}
