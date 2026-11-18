// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useState} from 'react';

import type {CustomRole} from '@mattermost/types/custom_roles';
import {CUSTOM_ROLES_CHANGED} from '@mattermost/types/custom_roles';

import {Client4} from 'mattermost-redux/client';

import WebSocketClient from 'client/web_websocket_client';

// One request per session, shared by every popover; a role change anywhere drops it and refreshes the open ones.
let cached: Promise<CustomRole[]> | undefined;
const subscribers = new Set<() => void>();
let listening = false;

function load() {
    cached ??= Client4.getCustomRoles().then(
        (roles) => [...roles].sort((a, b) => a.position - b.position),
        (err) => {
            cached = undefined;
            throw err;
        },
    );
    return cached;
}

function listen() {
    if (listening) {
        return;
    }
    listening = true;
    WebSocketClient.addMessageListener((msg: {event: string}) => {
        if (msg.event === CUSTOM_ROLES_CHANGED) {
            cached = undefined;
            subscribers.forEach((refresh) => refresh());
        }
    });
}

/** Every studio role, highest rank first; empty until loaded. */
export function useCustomRoles(): CustomRole[] {
    const [roles, setRoles] = useState<CustomRole[]>([]);
    useEffect(() => {
        let live = true;
        const refresh = () => {
            load().then((r) => live && setRoles(r), () => {});
        };
        listen();
        subscribers.add(refresh);
        refresh();
        return () => {
            live = false;
            subscribers.delete(refresh);
        };
    }, []);
    return roles;
}

/** The roles, in rank order, that a user's space-separated role names include. */
export const rolesOf = (roles: CustomRole[], roleNames: string) => {
    const held = new Set(roleNames.split(' '));
    return roles.filter((r) => held.has(r.role_name));
};

/** Mirrors the server: a outranks b when it sits higher and neither department excludes the other. */
export const outranks = (a: CustomRole, b: CustomRole) =>
    a.position < b.position && (!a.department || !b.department || a.department === b.department);
