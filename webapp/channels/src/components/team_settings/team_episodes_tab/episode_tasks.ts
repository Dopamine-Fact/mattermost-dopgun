// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Mirrors the server's model.EpisodeTask; the server validator (model.isValidEpisodeTasks) is the authority.
export type EpisodeTask = {

    /** names the task for waits_for; stable across renames */
    key: string;
    title: string;
    department_id?: string;
    assignee_id?: string;

    /** days after the episode opens; 0 is the opening day, undefined is no deadline */
    due_days?: number;
    waits_for?: string[];

    /** path of an own-files folder of the folder template */
    folder?: string;
};

export const MAX_EPISODE_TASKS = 100;
export const MAX_DUE_DAYS = 365;

/** Reads the JSON template, or else (like the server) the old one-title-per-line text as keys line0, line1, ... */
export function parseEpisodeTasks(text?: string): EpisodeTask[] {
    const value = (text ?? '').trim();
    if (value.startsWith('[')) {
        try {
            return JSON.parse(value) as EpisodeTask[];
        } catch {
            // not JSON: an old text template whose first line starts with "["
        }
    }
    return value.split('\n').map((line) => line.trim()).filter(Boolean).map((title, i) => ({key: 'line' + i, title}));
}

/** The task without its empty optional fields. */
export function tidyEpisodeTask(t: EpisodeTask): EpisodeTask {
    const out: EpisodeTask = {key: t.key, title: t.title};
    if (t.department_id) {
        out.department_id = t.department_id;
    }
    if (t.assignee_id) {
        out.assignee_id = t.assignee_id;
    }
    if (t.due_days !== undefined) {
        out.due_days = t.due_days;
    }
    if (t.waits_for?.length) {
        out.waits_for = t.waits_for;
    }
    if (t.folder) {
        out.folder = t.folder;
    }
    return out;
}

/** The JSON the server stores; '' for no tasks. */
export function serializeEpisodeTasks(tasks: EpisodeTask[]): string {
    return tasks.length ? JSON.stringify(tasks.map(tidyEpisodeTask)) : '';
}

/** True when following waits_for from some task leads back to it. */
export function episodeTaskCycle(tasks: EpisodeTask[]): boolean {
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    const state = new Map<string, 'open' | 'done'>();
    const visit = (key: string): boolean => {
        if (state.get(key) === 'open') {
            return true;
        }
        if (state.get(key) === 'done') {
            return false;
        }
        state.set(key, 'open');
        const cyclic = (byKey.get(key)?.waits_for ?? []).some(visit);
        state.set(key, 'done');
        return cyclic;
    };
    return tasks.some((t) => visit(t.key));
}
