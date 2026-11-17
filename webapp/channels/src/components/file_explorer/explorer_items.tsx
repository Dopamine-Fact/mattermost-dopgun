// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useRef, useState} from 'react';
import {useIntl} from 'react-intl';
import type {IntlShape} from 'react-intl';

import {FolderOutlineIcon, GlobeIcon, LockOutlineIcon, MessageTextOutlineIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';

import {getFileThumbnailUrl} from 'mattermost-redux/utils/file_utils';

import {fileSizeToString, getFileType, getIconClassName} from 'utils/utils';

import ExplorerRenameInput from './explorer_rename_input';
import type {ExplorerEntry} from './use_explorer_data';

export type ExplorerView = 'icons' | 'details';

/** name, modified, type, size, creator, or a key of a custom column (e.g. the Recycle Bin's). */
export type SortKey = string;
export type ExplorerSort = {by: SortKey; desc: boolean};

/** A Details view column after Name. */
export type ExplorerColumn = {key: SortKey; label: string; render: (entry: ExplorerEntry) => React.ReactNode};

type Props = {
    entries: ExplorerEntry[];
    view: ExplorerView;
    selected: Set<string>;
    sort: ExplorerSort;
    sortable?: (by: SortKey) => boolean;
    onSort: (by: SortKey) => void;
    onSelect: (entry: ExplorerEntry, event: React.MouseEvent | React.KeyboardEvent) => void;
    onOpen: (entry: ExplorerEntry) => void;
    onContextMenu: (entry: ExplorerEntry, event: React.MouseEvent) => void;
    getUserName: (userId: string) => string;

    /** Columns after Name in the Details view; the default ones when omitted. */
    columns?: ExplorerColumn[];

    /** The entry whose name is being edited, and what to do with the result. */
    renamingKey?: string;
    onRenameDone: (entry: ExplorerEntry, name?: string) => void;

    /** Makes files and folders draggable; omitted where nothing may be dragged (e.g. the Recycle Bin). */
    onDragStart?: (entry: ExplorerEntry, event: React.DragEvent) => void;

    /** The entry a drag is hovering over, highlighted as the drop target. */
    dropKey?: string;
};

export function entryModified(entry: ExplorerEntry): number {
    return entry.driveItem?.update_at ?? entry.fileInfo?.create_at ?? 0;
}

export function entryType(entry: ExplorerEntry, intl: IntlShape): string {
    switch (entry.kind) {
    case 'channel':
        return intl.formatMessage({id: 'file_explorer.type.channel', defaultMessage: 'Channel'});
    case 'folder':
    case 'chat':
    case 'trash':
        return intl.formatMessage({id: 'file_explorer.type.folder', defaultMessage: 'File folder'});
    default: {
        const ext = (entry.fileInfo?.extension || entry.name.split('.').pop() || '').toUpperCase();
        return intl.formatMessage({id: 'file_explorer.type.file', defaultMessage: '{ext} file'}, {ext});
    }
    }
}

export function entryCreator(entry: ExplorerEntry): string {
    return entry.driveItem?.creator_id ?? entry.fileInfo?.user_id ?? '';
}

export function EntryIcon({entry, large}: {entry: ExplorerEntry; large?: boolean}) {
    const size = large ? 48 : 18;
    switch (entry.kind) {
    case 'channel':
        return entry.channel?.type === 'P' ? <LockOutlineIcon size={size}/> : <GlobeIcon size={size}/>;
    case 'chat':
        return <MessageTextOutlineIcon size={size}/>;
    case 'trash':
        return <TrashCanOutlineIcon size={size}/>;
    case 'folder':
        return <FolderOutlineIcon size={size}/>;
    }
    const info = entry.fileInfo;
    if (large && info?.has_preview_image) {
        return (
            <img
                className='ExplorerItems__thumb'
                src={getFileThumbnailUrl(info.id)}
                alt=''
                loading='lazy'
            />
        );
    }
    return <div className={classNames('file-icon', getIconClassName(getFileType(info?.extension || '')), {small: !large})}/>;
}

export function formatDate(intl: IntlShape, time: number) {
    return time ? intl.formatDate(time, {dateStyle: 'medium', timeStyle: 'short'}) : '';
}

const ExplorerItems = ({entries, view, selected, sort, sortable = () => true, onSort, onSelect, onOpen, onContextMenu, getUserName, columns, renamingKey, onRenameDone, onDragStart, dropKey}: Props) => {
    const intl = useIntl();
    const nameColumn: ExplorerColumn = {key: 'name', label: intl.formatMessage({id: 'file_explorer.column.name', defaultMessage: 'Name'}), render: () => null};
    const allColumns = [nameColumn, ...(columns ?? [
        {key: 'modified', label: intl.formatMessage({id: 'file_explorer.column.modified', defaultMessage: 'Date modified'}), render: (e) => formatDate(intl, entryModified(e))},
        {key: 'type', label: intl.formatMessage({id: 'file_explorer.column.type', defaultMessage: 'Type'}), render: (e) => entryType(e, intl)},
        {key: 'size', label: intl.formatMessage({id: 'file_explorer.column.size', defaultMessage: 'Size'}), render: (e) => (e.fileInfo ? fileSizeToString(e.fileInfo.size) : '')},
        {key: 'creator', label: intl.formatMessage({id: 'file_explorer.column.creator', defaultMessage: 'Uploaded by'}), render: (e) => getUserName(entryCreator(e))},
    ] as ExplorerColumn[])];
    const gridTemplateColumns = `minmax(200px, 3fr) repeat(${allColumns.length - 1}, minmax(100px, 1fr))`;
    const [focusKey, setFocusKey] = useState<string>();
    const refs = useRef(new Map<string, HTMLElement>());
    const moved = useRef(false);

    const focusIndex = Math.max(0, entries.findIndex((e) => e.key === focusKey));

    useEffect(() => {
        if (moved.current && focusKey) {
            refs.current.get(focusKey)?.focus();
            moved.current = false;
        }
    }, [focusKey]);

    const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
        if (event.altKey) {
            return; // Alt+arrows navigate history
        }
        const step = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
        if (step) {
            event.preventDefault();
            const next = entries[Math.min(entries.length - 1, Math.max(0, index + step))];
            moved.current = true;
            setFocusKey(next.key);
            onSelect(next, event);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            onOpen(entries[index]);
        }
    };

    const cellProps = (entry: ExplorerEntry, index: number) => ({
        ref: (el: HTMLElement | null) => {
            if (el) {
                refs.current.set(entry.key, el);
            } else {
                refs.current.delete(entry.key);
            }
        },
        role: 'gridcell',
        'aria-label': entry.name,
        'aria-selected': selected.has(entry.key),
        tabIndex: index === focusIndex ? 0 : -1,
        onKeyDown: (event: React.KeyboardEvent) => handleKeyDown(event, index),
    });

    const mouseProps = (entry: ExplorerEntry) => ({
        'data-entry-key': entry.key,
        onContextMenu: (event: React.MouseEvent) => {
            event.preventDefault();
            moved.current = true;
            setFocusKey(entry.key);
            onContextMenu(entry, event);
        },
        onClick: (event: React.MouseEvent) => {
            moved.current = true;
            setFocusKey(entry.key);
            onSelect(entry, event);
        },
        onDoubleClick: () => onOpen(entry),
        draggable: Boolean(onDragStart) && (entry.kind === 'file' || entry.kind === 'folder') && renamingKey !== entry.key,
        onDragStart: (event: React.DragEvent) => onDragStart?.(entry, event),
    });

    const renameInput = (entry: ExplorerEntry) => (
        <ExplorerRenameInput
            name={entry.name}
            keepExtension={entry.kind === 'file'}
            onDone={(name) => onRenameDone(entry, name)}
        />
    );

    if (view === 'icons') {
        return (
            <div
                className='ExplorerItems ExplorerItems--icons'
                role='grid'
                aria-label={intl.formatMessage({id: 'file_explorer.items', defaultMessage: 'Items'})}
            >
                <div
                    role='row'
                    className='ExplorerItems__iconsRow'
                >
                    {entries.map((entry, index) => (
                        <div
                            key={entry.key}
                            className={classNames('ExplorerItems__tile', {selected: selected.has(entry.key), dropTarget: dropKey === entry.key})}
                            title={entry.name}
                            {...cellProps(entry, index)}
                            {...mouseProps(entry)}
                        >
                            <span className='ExplorerItems__tileIcon'>
                                <EntryIcon
                                    entry={entry}
                                    large={true}
                                />
                            </span>
                            {renamingKey === entry.key ? renameInput(entry) : <span className='ExplorerItems__tileName'>{entry.name}</span>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div
            className='ExplorerItems ExplorerItems--details'
            role='grid'
            aria-label={intl.formatMessage({id: 'file_explorer.items', defaultMessage: 'Items'})}
        >
            <div
                role='row'
                className='ExplorerItems__row ExplorerItems__header'
                style={{gridTemplateColumns}}
            >
                {allColumns.map((col) => {
                    let ariaSort: 'ascending' | 'descending' | undefined;
                    if (sort.by === col.key) {
                        ariaSort = sort.desc ? 'descending' : 'ascending';
                    }
                    return (
                        <div
                            key={col.key}
                            role='columnheader'
                            aria-sort={ariaSort}
                        >
                            <button
                                type='button'
                                disabled={!sortable(col.key)}
                                onClick={() => onSort(col.key)}
                            >
                                {col.label}
                                {ariaSort && <span aria-hidden={true}>{sort.desc ? ' ▾' : ' ▴'}</span>}
                            </button>
                        </div>
                    );
                })}
            </div>
            {entries.map((entry, index) => (
                <div
                    key={entry.key}
                    role='row'
                    className={classNames('ExplorerItems__row', {selected: selected.has(entry.key), dropTarget: dropKey === entry.key})}
                    style={{gridTemplateColumns}}
                    {...mouseProps(entry)}
                >
                    <div
                        className='ExplorerItems__name'
                        {...cellProps(entry, index)}
                    >
                        <EntryIcon entry={entry}/>
                        {renamingKey === entry.key ? renameInput(entry) : <span>{entry.name}</span>}
                    </div>
                    {allColumns.slice(1).map((col) => (
                        <div
                            key={col.key}
                            role='gridcell'
                        >
                            {col.render(entry)}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

export default ExplorerItems;
