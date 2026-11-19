// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useState} from 'react';

import type {Department, Rank} from '@mattermost/types/custom_roles';
import {DEPARTMENTS_CHANGED} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

import WebSocketClient from 'client/web_websocket_client';

// One request per team per session, shared by every user; a change in a team drops its entry and refreshes the open ones.
const cached = new Map<string, Promise<Department[]>>();
const subscribers = new Map<string, Set<() => void>>();
let listening = false;

function load(teamId: string) {
    let entry = cached.get(teamId);
    if (!entry) {
        entry = Client4.getTeamDepartments(teamId).catch((err) => {
            cached.delete(teamId);
            throw err;
        });
        cached.set(teamId, entry);
    }
    return entry;
}

function listen() {
    if (listening) {
        return;
    }
    listening = true;
    WebSocketClient.addMessageListener((msg: {event: string; data?: unknown}) => {
        if (msg.event !== DEPARTMENTS_CHANGED) {
            return;
        }
        refreshTeamDepartments((msg.data as {team_id?: string} | undefined)?.team_id ?? '');
    });
}

/** Drops the team's cached departments and reloads every open view of them; resolves once reloaded. */
export function refreshTeamDepartments(teamId: string): Promise<void> {
    cached.delete(teamId);
    const open = subscribers.get(teamId);
    if (!teamId || !open?.size) {
        return Promise.resolve();
    }
    open.forEach((refresh) => refresh());
    return load(teamId).then(() => undefined, () => undefined);
}

const NONE: Department[] = [];

/** The team's departments, Stüdyo geneli first, each with its ranks top first; empty until loaded. */
export function useTeamDepartments(teamId: string): Department[] {
    return useLoadedTeamDepartments(teamId) ?? NONE;
}

/** Like useTeamDepartments, but undefined until the load succeeds (and after a failed load), so an empty list means the team has none. */
export function useLoadedTeamDepartments(teamId: string): Department[] | undefined {
    const [departments, setDepartments] = useState<Department[]>();
    useEffect(() => {
        if (!teamId) {
            return undefined;
        }
        let live = true;
        const refresh = () => {
            load(teamId).then((d) => live && setDepartments(d), () => {});
        };
        listen();
        if (!subscribers.has(teamId)) {
            subscribers.set(teamId, new Set());
        }
        subscribers.get(teamId)!.add(refresh);
        refresh();
        return () => {
            live = false;
            subscribers.get(teamId)?.delete(refresh);
        };
    }, [teamId]);
    return departments;
}

/** The ranks a user holds, in department order then rank order (Stüdyo geneli first). */
export const ranksHeldBy = (departments: Department[], userId: string): Rank[] =>
    departments.flatMap((department) => department.ranks.filter((rank) => rank.member_ids.includes(userId)));

/** The ranks, in department order, that a member's space-separated team roles include. */
export const ranksOf = (departments: Department[], roleNames: string): Array<{department: Department; rank: Rank}> => {
    const held = new Set(roleNames.split(' '));
    return departments.flatMap((department) => department.ranks.filter((rank) => held.has(rank.role_name)).map((rank) => ({department, rank})));
};
