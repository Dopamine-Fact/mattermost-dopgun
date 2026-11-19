// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect, useHistory, useParams} from 'react-router-dom';

import {AlertOutlineIcon, CheckIcon, ChevronDownIcon, ContentCopyIcon, DownloadOutlineIcon, FolderMoveOutlineIcon, FolderPlusOutlineIcon, PencilOutlineIcon, RestoreIcon, TrashCanOutlineIcon, UploadOutlineIcon} from '@mattermost/compass-icons/components';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import type {DriveChatFileSort} from '@mattermost/types/drive';
import type {FileInfo} from '@mattermost/types/files';
import type {Post} from '@mattermost/types/posts';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {selectLhsItem} from 'actions/views/lhs';
import {openModal} from 'actions/views/modals';

import ConfirmModalRedux from 'components/confirm_modal_redux';
import FilePreviewModal from 'components/file_preview_modal';
import InfoToast from 'components/info_toast/info_toast';

import {ModalIdentifiers} from 'utils/constants';

import {LhsItemType, LhsPage} from 'types/store/lhs';

import {copy, cut, download, paste, uniqueName, useClipboard} from './explorer_actions';
import ExplorerAddressBar from './explorer_address_bar';
import type {Crumb} from './explorer_address_bar';
import ExplorerContextMenu from './explorer_context_menu';
import type {ContextMenuItem} from './explorer_context_menu';
import ExplorerDropOverlay from './explorer_drop_overlay';
import ExplorerItems, {entryCreator, entryModified, entryType} from './explorer_items';
import type {ExplorerSort, ExplorerView, SortKey} from './explorer_items';
import ExplorerPreviewPane from './explorer_preview_pane';
import ExplorerStatusBar from './explorer_status_bar';
import ExplorerToolbar from './explorer_toolbar';
import {useTrashColumns} from './explorer_trash_view';
import ExplorerTree from './explorer_tree';
import ExplorerUploadPanel from './explorer_upload_panel';
import {CHAT_FOLDER, TRASH_FOLDER, useExplorerChannels, useExplorerData} from './use_explorer_data';
import type {ExplorerEntry} from './use_explorer_data';
import {endDrag, handleDrag, startDrag} from './use_explorer_dnd';
import type {DropResult, DropTarget} from './use_explorer_dnd';
import {useExplorerSelection, useRubberBand} from './use_explorer_selection';
import {useExplorerUploads} from './use_explorer_uploads';
import type {UploadRequest} from './use_explorer_uploads';

import './file_explorer.scss';

const VIEW_KEY = 'file_explorer.view';
const PREVIEW_KEY = 'file_explorer.preview';
const PREVIEW_MIN_WIDTH = 1100;
const CHAT_SORTS: Partial<Record<SortKey, DriveChatFileSort>> = {name: 'name', size: 'size', modified: 'create_at'};
const NO_ENTRIES: ExplorerEntry[] = [];

function readPref(key: string, fallback: string): string {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function writePref(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // storage blocked (private mode): the choice lasts for this page only
    }
}

function useWideEnough() {
    const [wide, setWide] = useState(() => window.innerWidth >= PREVIEW_MIN_WIDTH);
    useEffect(() => {
        const onResize = () => setWide(window.innerWidth >= PREVIEW_MIN_WIDTH);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return wide;
}

const KIND_RANK: Record<ExplorerEntry['kind'], number> = {chat: 0, channel: 1, folder: 1, file: 2, trash: 3};
const isDriveObject = (e: ExplorerEntry) => e.kind === 'file' || e.kind === 'folder';
const driveIds = (entries: ExplorerEntry[]) => entries.flatMap((e) => (e.driveItem ? [e.driveItem.id] : []));

type Params = {team: string; channelName?: string; folderId?: string};
type MenuState = {x: number; y: number; onItem: boolean; upload?: boolean};
type DropHover = {key: string; location: string; files: boolean};

type ViewProps = {
    channelName?: string;
    folderId: string;

    // urlFor builds the address of a channel's folder (no channel: the root); the host decides where folders live.
    urlFor: (channelName: string, folderId?: string) => string;

    // An embedded explorer shows one channel: no channel tree, and its address bar starts at the channel.
    embedded?: boolean;
};

export const FileExplorerView = ({channelName, folderId, urlFor, embedded = false}: ViewProps) => {
    const intl = useIntl();
    const dispatch = useDispatch();
    const history = useHistory();
    const users = useSelector(getUsers);
    const nameSetting = useSelector(getTeammateNameDisplaySetting);
    const channels = useExplorerChannels();
    const channel = channelName ? channels.find((c) => c.name === channelName) : undefined;

    const [view, setView] = useState<ExplorerView>(() => (readPref(VIEW_KEY, 'icons') === 'details' ? 'details' : 'icons'));
    const [previewOpen, setPreviewOpen] = useState(() => readPref(PREVIEW_KEY, 'true') === 'true');
    const wide = useWideEnough();
    const [sort, setSort] = useState<ExplorerSort>({by: 'name', desc: false});
    const [search, setSearch] = useState('');
    const [renamingKey, setRenamingKey] = useState<string>();
    const [menu, setMenu] = useState<MenuState>();
    const [drop, setDrop] = useState<DropHover>();
    const clipboard = useClipboard();
    const fileInput = useRef<HTMLInputElement>(null);
    const folderInput = useRef<HTMLInputElement>(null);

    const inChat = folderId === CHAT_FOLDER;
    const inTrash = folderId === TRASH_FOLDER;
    const inDrive = Boolean(channel) && !inChat && !inTrash;
    const chatSort = useMemo(() => ({by: CHAT_SORTS[sort.by] ?? 'create_at', desc: sort.desc}), [sort]);
    const data = useExplorerData(channel?.id, folderId, chatSort);
    const uploads = useExplorerUploads(data.reload);

    // Managers bypass write rules, but nothing on a mirror path can be changed, by anyone.
    const writable = inDrive && !data.inMirror && (data.canManage || data.access !== 'read');

    // Opening a folder unmounts the focused item; keep keyboard users inside the list, like Explorer.
    const mainRef = useRef<HTMLElement>(null);
    const focusedLocation = useRef('');
    useEffect(() => {
        const location = `${channelName ?? ''}/${folderId}`;
        if (data.loading || focusedLocation.current === location) {
            return;
        }
        focusedLocation.current = location;
        if (!document.activeElement || document.activeElement === document.body) {
            (mainRef.current?.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]') ?? mainRef.current)?.focus();
        }
    });

    useEffect(() => {
        const ids = [...new Set(data.items.flatMap((e) => [entryCreator(e), e.driveItem?.deleted_by ?? '']).filter(Boolean))];
        if (ids.length) {
            dispatch(getMissingProfilesByIds(ids));
        }
    }, [data.items, dispatch]);

    const getUserName = useCallback((id: string) => (users[id] ? displayUsername(users[id], nameSetting) : ''), [users, nameSetting]);
    const trashColumns = useTrashColumns(inTrash ? channel : undefined, inTrash ? data.items : NO_ENTRIES, getUserName);

    // The page reaches the recycle bin from its channel tree; an embedded explorer has no tree, so its root lists it.
    const trashName = intl.formatMessage({id: 'file_explorer.recycleBin', defaultMessage: 'Recycle Bin'});
    const entries = useMemo(() => (
        embedded && channel && !folderId && data.items.length ? [...data.items, {key: TRASH_FOLDER, kind: 'trash' as const, name: trashName, readOnly: true, canModify: false}] : data.items
    ), [channel, data.items, embedded, folderId, trashName]);

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = query ? entries.filter((e) => e.name.toLowerCase().includes(query)) : entries;
        if (inChat) {
            return filtered; // sorted by the server
        }
        const value = (e: ExplorerEntry): string | number => {
            switch (sort.by) {
            case 'modified': return entryModified(e);
            case 'type': return entryType(e, intl);
            case 'size': return e.fileInfo?.size ?? 0;
            case 'creator': return getUserName(entryCreator(e));
            case 'deleted': return e.driveItem?.delete_at ?? 0;
            case 'deletedBy': return getUserName(e.driveItem?.deleted_by ?? '');
            default: return e.name;
            }
        };
        return [...filtered].sort((a, b) => {
            const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
            if (rank) {
                return rank;
            }
            const va = value(a);
            const vb = value(b);
            const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, {numeric: true});
            return (sort.desc ? -cmp : cmp) || a.name.localeCompare(b.name);
        });
    }, [entries, getUserName, inChat, intl, search, sort]);

    const keys = useMemo(() => visible.map((e) => e.key), [visible]);
    const selection = useExplorerSelection(keys);
    const rubberBand = useRubberBand(selection.setFromRect);
    const {clear} = selection;
    const closeMenu = useCallback(() => setMenu(undefined), []);

    useEffect(() => {
        clear();
        setSearch('');
        setRenamingKey(undefined);
        setMenu(undefined);
    }, [channel?.id, folderId, clear]);

    const rootUrl = urlFor('');

    const openEntry = (entry: ExplorerEntry) => {
        switch (entry.kind) {
        case 'channel':
            history.push(urlFor(entry.channel!.name));
            return;
        case 'chat':
            history.push(urlFor(channel!.name, CHAT_FOLDER));
            return;
        case 'trash':
            history.push(urlFor(channel!.name, TRASH_FOLDER));
            return;
        case 'folder':
            if (!inTrash) {
                history.push(urlFor(channel!.name, entry.driveItem!.id));
            }
            return;
        }
        if (!entry.fileInfo || !channel) {
            return;
        }
        const fileInfos = visible.map((e) => e.fileInfo).filter((f): f is FileInfo => Boolean(f));
        dispatch(openModal({
            modalId: ModalIdentifiers.FILE_PREVIEW_MODAL,
            dialogType: FilePreviewModal,
            dialogProps: {
                post: {channel_id: channel.id} as Post,
                fileInfos,
                startIndex: fileInfos.indexOf(entry.fileInfo),
            },
        }));
    };

    const crumbs: Crumb[] = embedded ? [] : [{label: intl.formatMessage({id: 'file_explorer.title', defaultMessage: 'Files'}), to: rootUrl}];
    let upTo: string | undefined;
    if (channel) {
        crumbs.push({label: channel.display_name, to: urlFor(channel.name)});
        upTo = embedded ? undefined : rootUrl;
        if (inChat) {
            crumbs.push({label: intl.formatMessage({id: 'file_explorer.chatAttachments', defaultMessage: 'Chat attachments'}), to: urlFor(channel.name, CHAT_FOLDER)});
        } else if (inTrash) {
            crumbs.push({label: intl.formatMessage({id: 'file_explorer.recycleBin', defaultMessage: 'Recycle Bin'}), to: urlFor(channel.name, TRASH_FOLDER)});
        } else {
            data.path.forEach((p) => crumbs.push({label: p.name, to: urlFor(channel.name, p.id)}));
        }
        if (folderId) {
            // Until the folder's path loads, an embedded address bar holds only the channel.
            upTo = crumbs[crumbs.length - 2]?.to ?? urlFor(channel.name);
        }
    }

    const selected = visible.filter((e) => selection.selected.has(e.key));
    const canChange = selected.length > 0 && selected.every((e) => e.driveItem && e.canModify);
    const can = {
        open: selected.length === 1,
        cut: inDrive && canChange,
        copy: !inTrash && selected.length > 0 && selected.every(isDriveObject),
        paste: writable && Boolean(clipboard),
        rename: inDrive && selected.length === 1 && canChange,
        remove: inDrive && canChange,
        download: !inTrash && selected.length > 0 && selected.every(isDriveObject),
        newFolder: writable,
        restore: inTrash && canChange,
        purge: inTrash && canChange,
        empty: inTrash && data.items.some((e) => e.canModify),
    };

    const toast = (message: string, undo?: () => void) => dispatch(openModal({
        modalId: ModalIdentifiers.INFO_TOAST,
        dialogType: InfoToast,
        dialogProps: {content: {icon: undo ? <CheckIcon size={18}/> : <AlertOutlineIcon size={18}/>, message, undo}},
    }));

    /** Runs a server call, shows its error as a toast, and refreshes the folder. */
    const run = async (action: () => Promise<unknown>, reload = true) => {
        try {
            await action();
            return true;
        } catch (err) {
            toast((err as Error)?.message || String(err));
            return false;
        } finally {
            if (reload) {
                data.reload();
            }
        }
    };

    const confirmPermanentDelete = (onConfirm: () => Promise<unknown>, count?: number) => dispatch(openModal({
        modalId: ModalIdentifiers.CONFIRM,
        dialogType: ConfirmModalRedux,
        dialogProps: {
            title: intl.formatMessage({id: 'file_explorer.purge.title', defaultMessage: 'Delete permanently?'}),
            message: count === undefined ? intl.formatMessage({id: 'file_explorer.empty.confirm', defaultMessage: 'Everything in the Recycle Bin that you can delete will be gone for good. This can\'t be undone.'}) : intl.formatMessage({id: 'file_explorer.purge.message', defaultMessage: '{count, plural, one {This item} other {These # items}} will be gone for good. This can\'t be undone.'}, {count}),
            confirmButtonText: intl.formatMessage({id: 'file_explorer.purge.confirm', defaultMessage: 'Delete'}),
            destructive: true,
            onConfirm,
        },
    }));

    const channelId = channel?.id ?? '';
    const actions = {
        open: () => openEntry(selected[0]),
        cut: () => cut(channelId, selected),
        copy: () => copy(channelId, selected),
        paste: () => run(() => paste(channelId, folderId)),
        rename: () => setRenamingKey(selected[0].key),
        download: () => run(() => download(channelId, selected), false),
        newFolder: () => run(async () => {
            const name = uniqueName(intl.formatMessage({id: 'file_explorer.newFolder.name', defaultMessage: 'New folder'}), data.items.map((e) => e.name));
            const item = await Client4.createDriveFolder(channelId, folderId, name);
            selection.setFromRect([item.id], false);
            setRenamingKey(item.id);
        }),
        remove: (permanent: boolean) => {
            const ids = driveIds(selected);
            if (permanent || inTrash) {
                confirmPermanentDelete(() => run(() => Client4.deleteDriveItems(channelId, ids, true)), ids.length);
                return;
            }
            run(() => Client4.deleteDriveItems(channelId, ids, false)).then((ok) => ok && toast(
                intl.formatMessage({id: 'file_explorer.deleted', defaultMessage: 'Moved {count, plural, one {# item} other {# items}} to the Recycle Bin'}, {count: ids.length}),
                () => run(() => Client4.restoreDriveItems(channelId, ids)),
            ));
        },
        restore: () => run(() => Client4.restoreDriveItems(channelId, driveIds(selected))),
        empty: () => confirmPermanentDelete(() => run(() => Client4.emptyDriveTrash(channelId))),
        up: () => upTo && history.push(upTo),
    };

    const dropOn = (target: DropTarget, result: DropResult) => {
        if (result.kind === 'items') {
            const p = result.payload;
            run(() => (result.effect === 'move' ? Client4.moveDriveItems(p.channelId, p.itemIds, target.channelId, target.folderId) : Client4.copyDriveItems(p.channelId, p.itemIds, p.chatFileIds, target.channelId, target.folderId)));
            return;
        }
        result.files.then((files) => uploads.enqueue(files, target.channelId, target.folderId), (err) => toast(err?.message || String(err)));
    };

    /** The drop target under the pointer in the main area: a folder or channel tile, else the open folder. */
    const pathIds = data.path.map((p) => p.id);
    const dropTargetAt = (el: Element): {key: string; target: DropTarget; location: string[]} | undefined => {
        const key = el.closest<HTMLElement>('[data-entry-key]')?.dataset.entryKey;
        const entry = visible.find((e) => e.key === key);
        const here = [channel?.display_name ?? '', ...data.path.map((p) => p.name)];
        if (entry?.kind === 'channel') {
            return {key: entry.key, target: {channelId: entry.channel!.id, folderId: '', ancestors: []}, location: [entry.name]};
        }
        if (entry?.kind === 'folder' && writable) {
            return {key: entry.key, target: {channelId, folderId: entry.key, ancestors: pathIds}, location: [...here, entry.name]};
        }
        return writable ? {key: '', target: {channelId, folderId, ancestors: pathIds}, location: here} : undefined;
    };
    const dragHandlers = {
        onDragOver: (e: React.DragEvent) => {
            const hit = dropTargetAt(e.target as Element);
            const result = handleDrag(e, hit?.target);
            const next = hit && result ? {key: hit.key, location: hit.location.join(' › '), files: result.kind === 'files'} : undefined;
            setDrop((prev) => (prev?.key === next?.key && prev?.files === next?.files ? prev : next));
        },
        onDragLeave: (e: React.DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDrop(undefined);
            }
        },
        onDrop: (e: React.DragEvent) => {
            const hit = dropTargetAt(e.target as Element);
            const result = handleDrag(e, hit?.target);
            setDrop(undefined);
            if (hit && result) {
                dropOn(hit.target, result);
            }
        },
        onDragEnd: () => {
            endDrag();
            setDrop(undefined);
        },
    };
    const onDragStart = channel && !inTrash ? (entry: ExplorerEntry, e: React.DragEvent) => {
        const dragged = selection.selected.has(entry.key) ? selected : [entry];
        if (!selection.selected.has(entry.key)) {
            selection.click(entry.key);
        }
        startDrag(e, {channelId, parentId: folderId, itemIds: driveIds(dragged), chatFileIds: dragged.flatMap((d) => (!d.driveItem && d.fileInfo ? [d.fileInfo.id] : []))});
    } : undefined;

    const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files: UploadRequest[] = [...(e.target.files ?? [])].map((file) => ({file, relPath: file.webkitRelativePath || file.name}));
        e.target.value = '';
        if (files.length) {
            uploads.enqueue(files, channelId, folderId);
        }
    };

    const onRenameDone = (entry: ExplorerEntry, name?: string) => {
        setRenamingKey(undefined);
        if (name && name !== entry.name && entry.driveItem) {
            run(() => Client4.renameDriveItem(channelId, entry.driveItem!.id, name));
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (renamingKey || (e.target as HTMLElement).closest('input, textarea, select, [role="menu"]')) {
            return;
        }
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const openMenuAtFocus = () => {
            const r = (e.target as HTMLElement).getBoundingClientRect();
            setMenu({x: r.left + 8, y: r.bottom, onItem: selected.length > 0});
        };

        // [enabled, action] per key; a known key is always consumed, even when its action is disabled.
        let shortcuts: Record<string, [boolean, () => unknown]>;
        if (e.altKey) {
            shortcuts = {ArrowLeft: [true, history.goBack], ArrowRight: [true, history.goForward], ArrowUp: [Boolean(upTo), actions.up]};
        } else if (e.ctrlKey || e.metaKey) {
            shortcuts = {
                a: [true, selection.selectAll],
                c: [can.copy, actions.copy],
                x: [can.cut, actions.cut],
                v: [can.paste, actions.paste],
                ...(e.shiftKey ? {n: [can.newFolder, actions.newFolder]} : {}),
            };
        } else {
            shortcuts = {
                Backspace: [Boolean(upTo), actions.up],
                F2: [can.rename, actions.rename],
                Delete: [can.remove || can.purge, () => actions.remove(e.shiftKey)],
                F5: [true, data.reload],
                Escape: [true, selection.clear],
                ContextMenu: [true, openMenuAtFocus],
            };
        }
        const shortcut = shortcuts[key];
        if (shortcut) {
            e.preventDefault();
            if (shortcut[0]) {
                shortcut[1]();
            }
        }
    };

    const label = (id: string, defaultMessage: string) => intl.formatMessage({id, defaultMessage});
    const L = {
        open: label('file_explorer.open', 'Open'),
        download: label('file_explorer.download', 'Download'),
        cut: label('file_explorer.cut', 'Cut'),
        copy: label('file_explorer.copy', 'Copy'),
        paste: label('file_explorer.paste', 'Paste'),
        rename: label('file_explorer.rename', 'Rename'),
        remove: label('file_explorer.delete', 'Delete'),
        newFolder: label('file_explorer.newFolder', 'New folder'),
        refresh: label('file_explorer.refresh', 'Refresh'),
        restore: label('file_explorer.restore', 'Restore'),
        purge: label('file_explorer.purge', 'Delete permanently'),
        empty: label('file_explorer.emptyTrash', 'Empty Recycle Bin'),
        upload: label('file_explorer.upload', 'Upload'),
    };

    let menuItems: ContextMenuItem[] = [];
    if (menu?.upload) {
        menuItems = [
            {key: 'files', label: label('file_explorer.upload.files', 'Files'), onClick: () => fileInput.current?.click()},
            {key: 'folder', label: label('file_explorer.upload.folder', 'Folder'), onClick: () => folderInput.current?.click()},
        ];
    } else if (menu?.onItem && inTrash) {
        menuItems = [
            {key: 'restore', label: L.restore, onClick: actions.restore, disabled: !can.restore},
            {key: 'purge', label: L.purge, onClick: () => actions.remove(true), disabled: !can.purge, destructive: true},
        ];
    } else if (menu?.onItem) {
        menuItems = [
            {key: 'open', label: L.open, onClick: actions.open, disabled: !can.open},
            {key: 'download', label: L.download, onClick: actions.download, disabled: !can.download},
            {key: 'cut', label: L.cut, onClick: actions.cut, disabled: !can.cut, divider: true},
            {key: 'copy', label: L.copy, onClick: actions.copy, disabled: !can.copy},
            {key: 'rename', label: L.rename, onClick: actions.rename, disabled: !can.rename, divider: true},
            {key: 'delete', label: L.remove, onClick: () => actions.remove(false), disabled: !can.remove, destructive: true},
        ];
    } else if (menu) {
        menuItems = [
            ...(inTrash ? [{key: 'empty', label: L.empty, onClick: actions.empty, disabled: !can.empty, destructive: true}] : []),
            ...(inDrive ? [
                {key: 'paste', label: L.paste, onClick: actions.paste, disabled: !can.paste},
                {key: 'newFolder', label: L.newFolder, onClick: actions.newFolder, disabled: !can.newFolder},
            ] : []),
            {key: 'refresh', label: L.refresh, onClick: data.reload, divider: inDrive || inTrash},
        ];
    }

    const toolButton = (key: keyof typeof L, enabled: boolean, onClick: () => unknown, icon?: React.ReactNode, destructive?: boolean) => (
        <Button
            key={key}
            size='x-small'
            emphasis='tertiary'
            destructive={destructive}
            disabled={!enabled}
            leadingIcon={icon && <Icon glyph={icon}/>}
            onClick={onClick}
        >
            {L[key]}
        </Button>
    );
    let toolbarActions: React.ReactNode = null;
    if (inTrash) {
        toolbarActions = [
            toolButton('restore', can.restore, actions.restore, <RestoreIcon/>),
            toolButton('purge', can.purge, () => actions.remove(true), <TrashCanOutlineIcon/>, true),
            toolButton('empty', can.empty, actions.empty, undefined, true),
        ];
    } else if (channel) {
        toolbarActions = [
            <Button
                key='upload'
                size='x-small'
                emphasis='tertiary'
                disabled={!writable}
                aria-haspopup='menu'
                leadingIcon={<Icon glyph={<UploadOutlineIcon/>}/>}
                trailingIcon={<Icon glyph={<ChevronDownIcon/>}/>}
                onClick={(e: React.MouseEvent) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({x: r.left, y: r.bottom, onItem: false, upload: true});
                }}
            >
                {L.upload}
            </Button>,
            toolButton('newFolder', can.newFolder, actions.newFolder, <FolderPlusOutlineIcon/>),
            toolButton('cut', can.cut, actions.cut, <FolderMoveOutlineIcon/>),
            toolButton('copy', can.copy, actions.copy, <ContentCopyIcon/>),
            toolButton('paste', can.paste, actions.paste),
            toolButton('rename', can.rename, actions.rename, <PencilOutlineIcon/>),
            toolButton('remove', can.remove, () => actions.remove(false), <TrashCanOutlineIcon/>),
            toolButton('download', can.download, actions.download, <DownloadOutlineIcon/>),
        ];
    }

    let content: React.ReactNode;
    if (data.error) {
        content = (
            <div className='FileExplorer__message'>
                <p>{data.error}</p>
                <button
                    type='button'
                    className='btn btn-tertiary'
                    onClick={data.reload}
                >
                    <FormattedMessage
                        id='file_explorer.retry'
                        defaultMessage='Retry'
                    />
                </button>
            </div>
        );
    } else if (data.loading && !data.items.length) {
        content = (
            <div className='FileExplorer__message'>
                <FormattedMessage
                    id='file_explorer.loading'
                    defaultMessage='Loading…'
                />
            </div>
        );
    } else if (visible.length === 0) {
        let empty;
        if (search) {
            empty = (
                <FormattedMessage
                    id='file_explorer.empty.search'
                    defaultMessage='No items match your search.'
                />
            );
        } else if (inTrash) {
            empty = (
                <FormattedMessage
                    id='file_explorer.empty.trash'
                    defaultMessage='The Recycle Bin is empty.'
                />
            );
        } else if (inChat) {
            empty = (
                <FormattedMessage
                    id='file_explorer.empty.chat'
                    defaultMessage='No files have been shared in this channel yet.'
                />
            );
        } else if (data.sourceMissing) {
            empty = (
                <FormattedMessage
                    id='file_explorer.empty.sourceMissing'
                    defaultMessage='The folder this one shows was deleted.'
                />
            );
        } else if (channel) {
            empty = (
                <FormattedMessage
                    id='file_explorer.empty.folder'
                    defaultMessage='This folder is empty. Drop files here or use Upload.'
                />
            );
        } else {
            empty = (
                <FormattedMessage
                    id='file_explorer.empty.channels'
                    defaultMessage='You are not a member of any channel in this team.'
                />
            );
        }
        content = <div className='FileExplorer__message'>{empty}</div>;
    } else {
        content = (
            <ExplorerItems
                entries={visible}
                view={inTrash ? 'details' : view}
                columns={inTrash ? trashColumns : undefined}
                selected={selection.selected}
                sort={sort}
                sortable={(by) => (inChat ? Boolean(CHAT_SORTS[by]) : by !== 'location')}
                onSort={(by) => setSort((s) => ({by, desc: s.by === by ? !s.desc : false}))}
                onSelect={(entry, event) => selection.click(entry.key, {ctrl: 'button' in event && (event.ctrlKey || event.metaKey), shift: event.shiftKey})}
                onOpen={openEntry}
                onContextMenu={(entry, event) => {
                    if (!selection.selected.has(entry.key)) {
                        selection.click(entry.key);
                    }
                    setMenu({x: event.clientX, y: event.clientY, onItem: true});
                }}
                getUserName={getUserName}
                renamingKey={renamingKey}
                onRenameDone={onRenameDone}
                onDragStart={onDragStart}
                dropKey={drop?.key}
            />
        );
    }

    const onScroll = (e: React.UIEvent<HTMLElement>) => {
        const el = e.currentTarget;
        if (data.hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
            data.loadMore();
        }
    };

    return (
        <div
            className='FileExplorer app__content'
            onKeyDown={onKeyDown}
        >
            <ExplorerToolbar
                view={view}
                onViewChange={(v) => {
                    setView(v);
                    writePref(VIEW_KEY, v);
                }}
                previewOpen={previewOpen}
                onTogglePreview={() => {
                    setPreviewOpen(!previewOpen);
                    writePref(PREVIEW_KEY, String(!previewOpen));
                }}
                onRefresh={data.reload}
            >
                {toolbarActions && <div className='ExplorerToolbar__actions'>{toolbarActions}</div>}
            </ExplorerToolbar>
            <ExplorerAddressBar
                crumbs={crumbs}
                upTo={upTo}
                search={search}
                onSearch={setSearch}
            />
            <div className='FileExplorer__body'>
                {!embedded && (
                    <ExplorerTree
                        baseUrl={rootUrl}
                        channels={channels}
                        channelId={channel?.id}
                        folderId={folderId}
                        changeCount={data.changeCount}
                        onDrop={dropOn}
                    />
                )}
                <main
                    ref={mainRef}
                    tabIndex={-1}
                    className={classNames('FileExplorer__main', {dropTarget: drop?.key === ''})}
                    {...dragHandlers}
                    onScroll={onScroll}
                    onMouseDown={rubberBand.onMouseDown}
                    onContextMenu={(e) => {
                        if (!(e.target as HTMLElement).closest('[data-entry-key]')) {
                            e.preventDefault();
                            selection.clear();
                            setMenu({x: e.clientX, y: e.clientY, onItem: false});
                        }
                    }}
                >
                    {content}
                </main>
                {drop?.files && <ExplorerDropOverlay location={drop.location}/>}
                {previewOpen && wide && (
                    <ExplorerPreviewPane
                        entries={selected}
                        onOpen={openEntry}
                        getUserName={getUserName}
                    />
                )}
            </div>
            <ExplorerStatusBar
                count={visible.length}
                selected={selected}
            />
            {rubberBand.box && (
                <div
                    className='FileExplorer__rubberBand'
                    style={rubberBand.box}
                />
            )}
            <ExplorerUploadPanel
                uploads={uploads.uploads}
                onCancel={uploads.cancel}
                onClose={uploads.clearFinished}
            />
            <input
                ref={fileInput}
                type='file'
                className='FileExplorer__picker'
                multiple={true}
                hidden={true}
                onChange={onPick}
            />
            <input
                ref={folderInput}
                type='file'
                className='FileExplorer__picker'
                hidden={true}
                onChange={onPick}
                {...{webkitdirectory: ''}}
            />
            {menu && (
                <ExplorerContextMenu
                    x={menu.x}
                    y={menu.y}
                    label={intl.formatMessage({id: 'file_explorer.menu', defaultMessage: 'Item actions'})}
                    items={menuItems}
                    onClose={closeMenu}
                />
            )}
        </div>
    );
};

// FileExplorer is the Files page: its URL picks the channel and folder, and it marks Files in the sidebar.
const FileExplorer = () => {
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const channels = useExplorerChannels();
    const {channelName, folderId = ''} = useParams<Params>();
    const baseUrl = `/${team?.name}/files`;
    const urlFor = useCallback((name: string, folder?: string) => [baseUrl, name, folder].filter(Boolean).join('/'), [baseUrl]);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Files));
    }, [dispatch]);

    if (team && !team.files_enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }
    if (channelName && !channels.some((c) => c.name === channelName)) {
        return <Redirect to={baseUrl}/>;
    }
    return (
        <FileExplorerView
            channelName={channelName}
            folderId={folderId}
            urlFor={urlFor}
        />
    );
};

export default FileExplorer;
