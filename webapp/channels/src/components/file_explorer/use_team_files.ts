// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useMemo, useState} from 'react';

import type {DriveItem, TeamFilesFolder, TeamFilesKind, TeamFilesLayout} from '@mattermost/types/drive';

import {Client4} from 'mattermost-redux/client';

// Pages of the team template that are not a channel drive; '~' cannot start a channel name.
export const PRODUCTION_PAGE = '~production';
export const CHANNELS_PAGE = '~channels';
export const SHARED_PAGE = '~shared';
export const isTemplatePage = (name?: string) => Boolean(name?.startsWith('~'));

/** The team's Files page layout; opening it makes the user a member of the team files channel. */
export function useTeamFilesLayout(teamId?: string) {
    const [layout, setLayout] = useState<TeamFilesLayout>();
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        if (!teamId) {
            return undefined;
        }
        let cancelled = false;
        setLoaded(false);
        Client4.getTeamFilesLayout(teamId).then((l) => !cancelled && setLayout(l), () => !cancelled && setLayout(undefined)).finally(() => !cancelled && setLoaded(true));
        return () => {
            cancelled = true;
        };
    }, [teamId]);
    return {layout, loaded};
}

export type TemplateNode = {folder: TeamFilesFolder; top: TeamFilesFolder};

/** Template folders by drive folder id, each with its top folder. */
export function useTemplateNodes(layout?: TeamFilesLayout) {
    return useMemo(() => {
        const nodes = new Map<string, TemplateNode>();
        const walk = (list: TeamFilesFolder[] | undefined, top?: TeamFilesFolder) => list?.forEach((f) => {
            if (f.id) {
                nodes.set(f.id, {folder: f, top: top ?? f});
            }
            walk(f.children, top ?? f);
        });
        walk(layout?.folders);
        return nodes;
    }, [layout]);
}

export const topOfKind = (layout: TeamFilesLayout | undefined, kind: TeamFilesKind) => layout?.folders.find((f) => f.kind === kind);

/** A folder other teams share into this one (parentId '' lists the shared folders themselves); read-only. */
export function useSharedFolder(teamId: string, parentId: string, enabled: boolean) {
    const [state, setState] = useState<{key: string; items: DriveItem[]; path: DriveItem[]; error?: string}>();
    const key = `${teamId}/${parentId}`;
    useEffect(() => {
        if (!enabled || !teamId) {
            return undefined;
        }
        let cancelled = false;
        Client4.getSharedDriveFolder(teamId, parentId).then(
            (l) => !cancelled && setState({key, items: l.items, path: l.path}),
            (err) => !cancelled && setState({key, items: [], path: [], error: err?.message || String(err)}),
        );
        return () => {
            cancelled = true;
        };
    }, [enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers teamId and parentId
    const current = enabled && state?.key === key ? state : undefined;
    return {items: current?.items ?? [], path: current?.path ?? [], error: current?.error, loading: enabled && !current};
}
