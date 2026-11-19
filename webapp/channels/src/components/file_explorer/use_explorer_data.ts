// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useEffect, useMemo, useState} from 'react';
import {useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import type {Channel} from '@mattermost/types/channels';
import type {DriveChatFileSort, DriveItem, DriveListing} from '@mattermost/types/drive';
import type {FileInfo} from '@mattermost/types/files';

import {Client4} from 'mattermost-redux/client';
import {Permissions} from 'mattermost-redux/constants';
import {getMyChannels} from 'mattermost-redux/selectors/entities/channels';
import {haveIChannelPermission} from 'mattermost-redux/selectors/entities/roles';
import {getCurrentTeamId} from 'mattermost-redux/selectors/entities/teams';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import WebSocketClient from 'client/web_websocket_client';

import type {GlobalState} from 'types/store';

export const CHAT_FOLDER = 'chat';
export const TRASH_FOLDER = 'trash';
export const CHAT_PAGE_SIZE = 60;

export type ExplorerEntryKind = 'channel' | 'folder' | 'file' | 'chat' | 'trash';

export type ExplorerEntry = {
    key: string;
    kind: ExplorerEntryKind;
    name: string;
    driveItem?: DriveItem;
    fileInfo?: FileInfo;
    channel?: Channel;
    readOnly: boolean;
    canModify: boolean;
};

// drive_changed is a fork event, not in the client's WebSocketEvents union.
type DriveChangedMessage = {event: string; data?: unknown; broadcast?: {channel_id?: string}};

export type ChatSort = {by: DriveChatFileSort; desc: boolean};

type Loaded = {key: string; items: DriveItem[]; files: FileInfo[]; path: DriveItem[]; page: number; hasMore: boolean; access: DriveListing['access']; sourceMissing: boolean};

const hasRules = (it: DriveItem) => Boolean(it.view_departments?.length || it.write_departments?.length || it.read_only || it.mirror_of);

/** Open and private channels the user belongs to in the current team, by display name. */
export function useExplorerChannels(): Channel[] {
    const channels = useSelector(getMyChannels);
    return useMemo(() => channels.
        filter((c) => (c.type === 'O' || c.type === 'P') && c.delete_at === 0).
        sort((a, b) => a.display_name.localeCompare(b.display_name)), [channels]);
}

/** Parent ids a drive_changed event touched, or undefined when the event is for another channel. */
export function driveChangedParents(msg: DriveChangedMessage, channelId?: string): string[] | undefined {
    if (msg.event !== 'drive_changed' || !channelId || msg.broadcast?.channel_id !== channelId) {
        return undefined;
    }
    try {
        return JSON.parse((msg.data as {parent_ids?: string} | undefined)?.parent_ids ?? '[]');
    } catch {
        return [];
    }
}

export function useExplorerData(channelId?: string, folderId = '', chatSort: ChatSort = {by: 'create_at', desc: true}) {
    const intl = useIntl();
    const channels = useExplorerChannels();
    const me = useSelector(getCurrentUserId);
    const teamId = useSelector(getCurrentTeamId);
    const canManage = useSelector((state: GlobalState) => Boolean(channelId) && haveIChannelPermission(state, teamId, channelId, Permissions.MANAGE_CHANNEL_ROLES));

    const key = `${channelId}/${folderId}/${chatSort.by}/${chatSort.desc}`;
    const [loaded, setLoaded] = useState<Loaded>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();
    const [version, setVersion] = useState(0);
    const [changeCount, setChangeCount] = useState(0);

    const reload = useCallback(() => setVersion((v) => v + 1), []);

    useEffect(() => {
        if (!channelId) {
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        const load = async (): Promise<Loaded> => {
            if (folderId === CHAT_FOLDER) {
                const files = await Client4.getDriveChatFiles(channelId, 0, CHAT_PAGE_SIZE, chatSort.by, chatSort.desc);
                return {key, items: [], files, path: [], page: 0, hasMore: files.length === CHAT_PAGE_SIZE, access: '', sourceMissing: false};
            }
            if (folderId === TRASH_FOLDER) {
                return {key, items: await Client4.getDriveTrash(channelId), files: [], path: [], page: 0, hasMore: false, access: '', sourceMissing: false};
            }
            const listing = await Client4.getDriveFolder(channelId, folderId);
            return {key, items: listing.items, files: [], path: listing.path, page: 0, hasMore: false, access: listing.access, sourceMissing: Boolean(listing.source_missing)};
        };
        load().then((data) => {
            if (!cancelled) {
                setLoaded(data);
            }
        }, (err) => {
            if (!cancelled) {
                setError(err?.message || String(err));
            }
        }).finally(() => {
            if (!cancelled) {
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps -- key covers channelId, folderId and chatSort

    const loadMore = useCallback(async () => {
        if (!channelId || !loaded || loaded.key !== key || !loaded.hasMore || loading) {
            return;
        }
        setLoading(true);
        try {
            const page = loaded.page + 1;
            const files = await Client4.getDriveChatFiles(channelId, page, CHAT_PAGE_SIZE, chatSort.by, chatSort.desc);
            setLoaded((prev) => (prev && prev.key === key ? {...prev, files: [...prev.files, ...files], page, hasMore: files.length === CHAT_PAGE_SIZE} : prev));
        } catch (err) {
            setError((err as Error)?.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [channelId, chatSort.by, chatSort.desc, key, loaded, loading]);

    useEffect(() => {
        if (!channelId) {
            return undefined;
        }
        const listener = (msg: DriveChangedMessage) => {
            const parents = driveChangedParents(msg, channelId);
            if (!parents) {
                return;
            }
            setChangeCount((c) => c + 1);
            if (folderId === TRASH_FOLDER || parents.includes(folderId)) {
                reload();
            }
        };
        WebSocketClient.addMessageListener(listener);
        return () => WebSocketClient.removeMessageListener(listener);
    }, [channelId, folderId, reload]);

    const chatName = intl.formatMessage({id: 'file_explorer.chatAttachments', defaultMessage: 'Chat attachments'});
    const current = loaded?.key === key ? loaded : undefined;

    // The listing's path runs through the mirror when browsing inside one; everything on a mirror path is read-only, managers too.
    const inMirror = Boolean(current?.path.some((p) => p.mirror_of));

    const items = useMemo((): ExplorerEntry[] => {
        if (!channelId) {
            return channels.map((c) => ({key: c.id, kind: 'channel', name: c.display_name, channel: c, readOnly: true, canModify: false}));
        }
        if (!current) {
            return [];
        }
        if (folderId === CHAT_FOLDER) {
            return current.files.map((f) => ({key: `chat:${f.id}`, kind: 'file', name: f.name, fileInfo: f, readOnly: true, canModify: false}));
        }
        const inTrash = folderId === TRASH_FOLDER;
        const access = current.access;
        const drive = current.items.map((it): ExplorerEntry => ({
            key: it.id,
            kind: it.type,
            name: it.name,
            driveItem: it,
            fileInfo: it.file_info,
            readOnly: inTrash,
            canModify: inTrash ? it.creator_id === me || canManage : !inMirror && (canManage || (!hasRules(it) && (access === 'write' || (access === '' && it.creator_id === me)))),
        }));
        return folderId ? drive : [{key: CHAT_FOLDER, kind: 'chat', name: chatName, readOnly: true, canModify: false}, ...drive];
    }, [canManage, channelId, channels, chatName, current, folderId, inMirror, me]);

    return {
        items,
        path: current?.path ?? [],
        loading: Boolean(channelId) && (loading || !current),
        error,
        reload,
        loadMore,
        hasMore: Boolean(current?.hasMore),
        changeCount,
        canManage,
        access: current?.access ?? '',
        inMirror,
        sourceMissing: Boolean(current?.sourceMissing),
    };
}
