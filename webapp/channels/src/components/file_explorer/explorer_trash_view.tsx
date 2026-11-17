// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useMemo, useState} from 'react';
import {useIntl} from 'react-intl';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

import {fileSizeToString} from 'utils/utils';

import {formatDate} from './explorer_items';
import type {ExplorerColumn} from './explorer_items';
import type {ExplorerEntry} from './use_explorer_data';

/**
 * The Recycle Bin's Details columns. Original location is the folder path an item was deleted from;
 * a folder that no longer exists shows the channel, which is where Restore puts the item.
 */
export function useTrashColumns(channel: Channel | undefined, entries: ExplorerEntry[], getUserName: (id: string) => string): ExplorerColumn[] {
    const intl = useIntl();
    const [paths, setPaths] = useState<Record<string, string>>({});

    const parents = useMemo(() => [...new Set(entries.map((e) => e.driveItem?.parent_id ?? ''))].filter(Boolean).sort().join(','), [entries]);

    useEffect(() => {
        if (!channel || !parents) {
            return undefined;
        }
        let cancelled = false;
        Promise.all(parents.split(',').map(async (id) => {
            const names = await Client4.getDriveFolder(channel.id, id).then((l) => l.path.map((p) => p.name), () => []);
            return [id, [channel.display_name, ...names].join(' / ')] as const;
        })).then((list) => {
            if (!cancelled) {
                setPaths(Object.fromEntries(list));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [channel, parents]);

    return [
        {
            key: 'location',
            label: intl.formatMessage({id: 'file_explorer.column.location', defaultMessage: 'Original location'}),
            render: (e) => {
                const parent = e.driveItem?.parent_id;
                return parent ? paths[parent] ?? '' : channel?.display_name;
            },
        },
        {key: 'deleted', label: intl.formatMessage({id: 'file_explorer.column.deleted', defaultMessage: 'Date deleted'}), render: (e) => formatDate(intl, e.driveItem?.delete_at ?? 0)},
        {key: 'deletedBy', label: intl.formatMessage({id: 'file_explorer.column.deletedBy', defaultMessage: 'Deleted by'}), render: (e) => getUserName(e.driveItem?.deleted_by ?? '')},
        {key: 'size', label: intl.formatMessage({id: 'file_explorer.column.size', defaultMessage: 'Size'}), render: (e) => (e.fileInfo ? fileSizeToString(e.fileInfo.size) : '')},
    ];
}
