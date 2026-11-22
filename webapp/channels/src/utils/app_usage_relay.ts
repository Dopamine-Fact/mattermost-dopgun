// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AppUsageInterval} from '@mattermost/types/app_usage';

import {Client4} from 'mattermost-redux/client';

import DesktopApp from 'utils/desktop_api';

const BATCH = 200;
const KEEP_MS = 24 * 60 * 60 * 1000;

/** Every everyMs, pulls the desktop app's recorded app usage and posts it; failed posts are retried next tick. Returns a stop function. */
export function startAppUsageRelay(everyMs = 60000): () => void {
    let pending: AppUsageInterval[] = [];
    let busy = false;

    const tick = async () => {
        if (busy) {
            return;
        }
        busy = true;
        try {
            pending = pending.concat(await DesktopApp.getAppUsage());
            const oldest = Date.now() - KEEP_MS;
            pending = pending.filter((i) => i.end_at >= oldest);
            while (pending.length) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await Client4.postAppUsage(pending.slice(0, BATCH));
                } catch (err) {
                    // A 400 means the rows are invalid (e.g. a fast clock) and would block everything behind them forever.
                    if ((err as {status_code?: number})?.status_code !== 400) {
                        throw err;
                    }
                }
                pending = pending.slice(BATCH);
            }
        } catch {
            // Kept in pending; the next tick retries.
        } finally {
            busy = false;
        }
    };

    const timer = setInterval(tick, everyMs);
    return () => clearInterval(timer);
}
