// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {AppUsageInterval} from '@mattermost/types/app_usage';

import {Client4} from 'mattermost-redux/client';

import DesktopApp from 'utils/desktop_api';

import {startAppUsageRelay} from './app_usage_relay';

const NOW = new Date(2026, 10, 20, 12).getTime();
const interval = (i: number, endAt = NOW - 1000): AppUsageInterval => ({app: 'chrome', title: `t${i}`, start_at: endAt - 500 - i, end_at: endAt - i});

// Advances one relay tick and lets its promise chain settle.
async function tick(ms = 60000) {
    await jest.advanceTimersByTimeAsync(ms);
}

describe('startAppUsageRelay', () => {
    let fromDesktop: jest.SpyInstance;
    let post: jest.SpyInstance;
    let stop: () => void;

    beforeEach(() => {
        jest.useFakeTimers({now: NOW});
        fromDesktop = jest.spyOn(DesktopApp, 'getAppUsage').mockResolvedValue([]);
        post = jest.spyOn(Client4, 'postAppUsage').mockResolvedValue({status: 'OK'});
    });

    afterEach(() => {
        stop?.();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('posts what the desktop hands over each tick', async () => {
        fromDesktop.mockResolvedValueOnce([interval(1), interval(2)]);
        stop = startAppUsageRelay();
        await tick();
        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith([interval(1), interval(2)]);
    });

    test('keeps intervals after a failed post and resends them with the next tick', async () => {
        fromDesktop.mockResolvedValueOnce([interval(1), interval(2)]).mockResolvedValueOnce([interval(3)]);
        post.mockRejectedValueOnce(new Error('offline'));
        stop = startAppUsageRelay();
        await tick();
        await tick();
        expect(post).toHaveBeenCalledTimes(2);
        expect(post).toHaveBeenLastCalledWith([interval(1), interval(2), interval(3)]);
    });

    test('sends at most 200 per post', async () => {
        fromDesktop.mockResolvedValueOnce(Array.from({length: 450}, (_, i) => interval(i)));
        stop = startAppUsageRelay();
        await tick();
        expect(post.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    });

    test('drops intervals older than 24 hours', async () => {
        const old = interval(9, NOW - (25 * 60 * 60 * 1000));
        fromDesktop.mockResolvedValueOnce([old, interval(1)]);
        stop = startAppUsageRelay();
        await tick();
        expect(post).toHaveBeenCalledWith([interval(1)]);
    });

    test('does nothing when the desktop returns nothing', async () => {
        stop = startAppUsageRelay();
        await tick();
        expect(post).not.toHaveBeenCalled();
    });

    test('stops ticking after cleanup', async () => {
        stop = startAppUsageRelay();
        stop();
        await tick();
        expect(fromDesktop).not.toHaveBeenCalled();
    });
});
