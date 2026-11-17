// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect, useHistory, useParams} from 'react-router-dom';

import {ContentCopyIcon, DownloadOutlineIcon, FolderMoveOutlineIcon, FolderPlusOutlineIcon, PencilOutlineIcon, RestoreIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
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
import ExplorerItems, {entryCreator, entryModified, entryType} from './explorer_items';
import type {ExplorerSort, ExplorerView, SortKey} from './explorer_items';
import ExplorerPreviewPane from './explorer_preview_pane';
import ExplorerStatusBar from './explorer_status_bar';
import ExplorerToolbar from './explorer_toolbar';
import {useTrashColumns} from './explorer_trash_view';
import ExplorerTree from './explorer_tree';
import {CHAT_FOLDER, TRASH_FOLDER, useExplorerChannels, useExplorerData} from './use_explorer_data';
import type {ExplorerEntry} from './use_explorer_data';
import {useExplorerSelection, useRubberBand} from './use_explorer_selection';

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

const KIND_RANK: Record<ExplorerEntry['kind'], number> = {chat: 0, trash: 0, channel: 1, folder: 1, file: 2};
const isDriveObject = (e: ExplorerEntry) => e.kind === 'file' || e.kind === 'folder';
const driveIds = (entries: ExplorerEntry[]) => entries.flatMap((e) => (e.driveItem ? [e.driveItem.id] : []));

type Params = {team: string; channelName?: string; folderId?: string};
type MenuState = {x: number; y: number; onItem: boolean};

const FileExplorer = () => {
    const intl = useIntl();
    const dispatch = useDispatch();
    const history = useHistory();
    const team = useSelector(getCurrentTeam);
    const users = useSelector(getUsers);
    const nameSetting = useSelector(getTeammateNameDisplaySetting);
    const channels = useExplorerChannels();
    const {channelName, folderId = ''} = useParams<Params>();
    const channel = channelName ? channels.find((c) => c.name === channelName) : undefined;

    const [view, setView] = useState<ExplorerView>(() => (readPref(VIEW_KEY, 'icons') === 'details' ? 'details' : 'icons'));
    const [previewOpen, setPreviewOpen] = useState(() => readPref(PREVIEW_KEY, 'true') === 'true');
    const wide = useWideEnough();
    const [sort, setSort] = useState<ExplorerSort>({by: 'name', desc: false});
    const [search, setSearch] = useState('');
    const [renamingKey, setRenamingKey] = useState<string>();
    const [menu, setMenu] = useState<MenuState>();
    const clipboard = useClipboard();

    const inChat = folderId === CHAT_FOLDER;
    const inTrash = folderId === TRASH_FOLDER;
    const inDrive = Boolean(channel) && !inChat && !inTrash;
    const chatSort = useMemo(() => ({by: CHAT_SORTS[sort.by] ?? 'create_at', desc: sort.desc}), [sort]);
    const data = useExplorerData(channel?.id, folderId, chatSort);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Files));
    }, [dispatch]);

    useEffect(() => {
        const ids = [...new Set(data.items.flatMap((e) => [entryCreator(e), e.driveItem?.deleted_by ?? '']).filter(Boolean))];
        if (ids.length) {
            dispatch(getMissingProfilesByIds(ids));
        }
    }, [data.items, dispatch]);

    const getUserName = useCallback((id: string) => (users[id] ? displayUsername(users[id], nameSetting) : ''), [users, nameSetting]);
    const trashColumns = useTrashColumns(inTrash ? channel : undefined, inTrash ? data.items : NO_ENTRIES, getUserName);

    const visible = useMemo(() => {
        const query = search.trim().toLowerCase();
        const filtered = query ? data.items.filter((e) => e.name.toLowerCase().includes(query)) : data.items;
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
    }, [data.items, getUserName, inChat, intl, search, sort]);

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

    if (team && !team.files_enabled) {
        return <Redirect to={`/${team.name}`}/>;
    }
    const baseUrl = `/${team?.name}/files`;
    if (channelName && !channel) {
        return <Redirect to={baseUrl}/>;
    }
    const channelUrl = channel ? `${baseUrl}/${channel.name}` : baseUrl;

    const openEntry = (entry: ExplorerEntry) => {
        switch (entry.kind) {
        case 'channel':
            history.push(`${baseUrl}/${entry.channel!.name}`);
            return;
        case 'chat':
            history.push(`${channelUrl}/${CHAT_FOLDER}`);
            return;
        case 'trash':
            history.push(`${channelUrl}/${TRASH_FOLDER}`);
            return;
        case 'folder':
            if (!inTrash) {
                history.push(`${channelUrl}/${entry.driveItem!.id}`);
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

    const crumbs: Crumb[] = [{label: intl.formatMessage({id: 'file_explorer.title', defaultMessage: 'Files'}), to: baseUrl}];
    let upTo: string | undefined;
    if (channel) {
        crumbs.push({label: channel.display_name, to: channelUrl});
        upTo = baseUrl;
        if (inChat) {
            crumbs.push({label: intl.formatMessage({id: 'file_explorer.chatAttachments', defaultMessage: 'Chat attachments'}), to: `${channelUrl}/${CHAT_FOLDER}`});
        } else if (inTrash) {
            crumbs.push({label: intl.formatMessage({id: 'file_explorer.recycleBin', defaultMessage: 'Recycle Bin'}), to: `${channelUrl}/${TRASH_FOLDER}`});
        } else {
            data.path.forEach((p) => crumbs.push({label: p.name, to: `${channelUrl}/${p.id}`}));
        }
        if (folderId) {
            upTo = crumbs[crumbs.length - 2].to;
        }
    }

    const selected = visible.filter((e) => selection.selected.has(e.key));
    const canChange = selected.length > 0 && selected.every((e) => e.driveItem && e.canModify);
    const can = {
        open: selected.length === 1,
        cut: inDrive && canChange,
        copy: !inTrash && selected.length > 0 && selected.every(isDriveObject),
        paste: inDrive && Boolean(clipboard),
        rename: inDrive && selected.length === 1 && canChange,
        remove: inDrive && canChange,
        download: !inTrash && selected.length > 0 && selected.every(isDriveObject),
        newFolder: inDrive,
        restore: inTrash && canChange,
        purge: inTrash && canChange,
        empty: inTrash && data.items.some((e) => e.canModify),
    };

    const toast = (message: string, undo?: () => void) => dispatch(openModal({
        modalId: ModalIdentifiers.INFO_TOAST,
        dialogType: InfoToast,
        dialogProps: {content: {message, undo}},
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
    };

    let menuItems: ContextMenuItem[] = [];
    if (menu?.onItem && inTrash) {
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
                {key: 'newFolder', label: L.newFolder, onClick: actions.newFolder},
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
                <ExplorerTree
                    baseUrl={baseUrl}
                    channels={channels}
                    channelId={channel?.id}
                    folderId={folderId}
                    changeCount={data.changeCount}
                />
                <main
                    className='FileExplorer__main'
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

export default FileExplorer;
