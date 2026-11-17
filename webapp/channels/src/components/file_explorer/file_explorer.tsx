// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Redirect, useHistory, useParams} from 'react-router-dom';

import type {DriveChatFileSort} from '@mattermost/types/drive';
import type {FileInfo} from '@mattermost/types/files';
import type {Post} from '@mattermost/types/posts';

import {getMissingProfilesByIds} from 'mattermost-redux/actions/users';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';
import {getUsers} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {selectLhsItem} from 'actions/views/lhs';
import {openModal} from 'actions/views/modals';

import FilePreviewModal from 'components/file_preview_modal';

import {ModalIdentifiers} from 'utils/constants';

import {LhsItemType, LhsPage} from 'types/store/lhs';

import ExplorerAddressBar from './explorer_address_bar';
import type {Crumb} from './explorer_address_bar';
import ExplorerItems, {entryCreator, entryModified, entryType} from './explorer_items';
import type {ExplorerSort, ExplorerView, SortKey} from './explorer_items';
import ExplorerPreviewPane from './explorer_preview_pane';
import ExplorerStatusBar from './explorer_status_bar';
import ExplorerToolbar from './explorer_toolbar';
import ExplorerTree from './explorer_tree';
import {CHAT_FOLDER, TRASH_FOLDER, useExplorerChannels, useExplorerData} from './use_explorer_data';
import type {ExplorerEntry} from './use_explorer_data';

import './file_explorer.scss';

const VIEW_KEY = 'file_explorer.view';
const PREVIEW_KEY = 'file_explorer.preview';
const PREVIEW_MIN_WIDTH = 1100;
const CHAT_SORTS: Partial<Record<SortKey, DriveChatFileSort>> = {name: 'name', size: 'size', modified: 'create_at'};

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

type Params = {team: string; channelName?: string; folderId?: string};

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
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const inChat = folderId === CHAT_FOLDER;
    const chatSort = useMemo(() => ({by: CHAT_SORTS[sort.by] ?? 'create_at', desc: sort.desc}), [sort]);
    const data = useExplorerData(channel?.id, folderId, chatSort);

    useEffect(() => {
        dispatch(selectLhsItem(LhsItemType.Page, LhsPage.Files));
    }, [dispatch]);

    useEffect(() => {
        setSelected(new Set());
        setSearch('');
    }, [channel?.id, folderId]);

    // Keep the selection on items that survived a reload.
    useEffect(() => {
        setSelected((prev) => {
            const keys = new Set(data.items.map((e) => e.key));
            const kept = [...prev].filter((k) => keys.has(k));
            return kept.length === prev.size ? prev : new Set(kept);
        });
    }, [data.items]);

    useEffect(() => {
        const ids = [...new Set(data.items.map(entryCreator).filter(Boolean))];
        if (ids.length) {
            dispatch(getMissingProfilesByIds(ids));
        }
    }, [data.items, dispatch]);

    const getUserName = useCallback((id: string) => (users[id] ? displayUsername(users[id], nameSetting) : ''), [users, nameSetting]);

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
            if (folderId !== TRASH_FOLDER) {
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
        } else if (folderId === TRASH_FOLDER) {
            crumbs.push({label: intl.formatMessage({id: 'file_explorer.recycleBin', defaultMessage: 'Recycle Bin'}), to: `${channelUrl}/${TRASH_FOLDER}`});
        } else {
            data.path.forEach((p) => crumbs.push({label: p.name, to: `${channelUrl}/${p.id}`}));
        }
        if (folderId) {
            upTo = crumbs[crumbs.length - 2].to;
        }
    }

    const selectedEntries = visible.filter((e) => selected.has(e.key));

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
        } else if (folderId === TRASH_FOLDER) {
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
                view={view}
                selected={selected}
                sort={sort}
                sortable={(by) => !inChat || Boolean(CHAT_SORTS[by])}
                onSort={(by) => setSort((s) => ({by, desc: s.by === by ? !s.desc : false}))}
                onSelect={(entry) => setSelected(new Set([entry.key]))}
                onOpen={openEntry}
                getUserName={getUserName}
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
        <div className='FileExplorer app__content'>
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
            />
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
                >
                    {content}
                </main>
                {previewOpen && wide && (
                    <ExplorerPreviewPane
                        entries={selectedEntries}
                        onOpen={openEntry}
                        getUserName={getUserName}
                    />
                )}
            </div>
            <ExplorerStatusBar
                count={visible.length}
                selected={selectedEntries}
            />
        </div>
    );
};

export default FileExplorer;
