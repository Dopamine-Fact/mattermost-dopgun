// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useState} from 'react';
import {useIntl} from 'react-intl';
import {Link} from 'react-router-dom';

import {ChevronDownIcon, ChevronRightIcon, FolderOutlineIcon, GlobeIcon, LockOutlineIcon, MessageTextOutlineIcon, TrashCanOutlineIcon} from '@mattermost/compass-icons/components';
import type {Channel} from '@mattermost/types/channels';
import type {DriveItem} from '@mattermost/types/drive';

import {Client4} from 'mattermost-redux/client';

import {CHAT_FOLDER, TRASH_FOLDER} from './use_explorer_data';

type Props = {
    baseUrl: string;
    channels: Channel[];
    channelId?: string;
    folderId: string;

    /** Bumped on every drive change in the open channel, so expanded nodes re-fetch. */
    changeCount: number;
};

type RowProps = {
    depth: number;
    label: string;
    icon: React.ReactNode;
    to: string;
    active: boolean;
    expanded?: boolean;
    onToggle?: () => void;
    children?: React.ReactNode;
};

const TreeRow = ({depth, label, icon, to, active, expanded, onToggle, children}: RowProps) => (
    <li
        role='treeitem'
        aria-expanded={onToggle ? Boolean(expanded) : undefined}
        aria-selected={active}
    >
        <div
            className={classNames('ExplorerTree__row', {active})}
            style={{paddingLeft: 8 + (depth * 14)}}
        >
            {onToggle ? (
                <button
                    type='button'
                    className='ExplorerTree__toggle'
                    tabIndex={-1}
                    aria-hidden={true}
                    onClick={onToggle}
                >
                    {expanded ? <ChevronDownIcon size={14}/> : <ChevronRightIcon size={14}/>}
                </button>
            ) : <span className='ExplorerTree__toggle'/>}
            <Link
                to={to}
                className='ExplorerTree__link'
            >
                {icon}
                <span>{label}</span>
            </Link>
        </div>
        {expanded && children && <ul role='group'>{children}</ul>}
    </li>
);

function useSubfolders(channelId: string, parentId: string, open: boolean, changeCount: number) {
    const [folders, setFolders] = useState<DriveItem[]>([]);
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let cancelled = false;
        Client4.getDriveFolder(channelId, parentId).then((listing) => {
            if (!cancelled) {
                setFolders(listing.items.filter((it) => it.type === 'folder'));
            }
        }, () => {
            // shortcut: a failed tree fetch just shows no sub-folders; the main area reports errors.
        });
        return () => {
            cancelled = true;
        };
    }, [channelId, parentId, open, changeCount]);
    return folders;
}

type FolderNodeProps = {channel: Channel; item: DriveItem; depth: number; channelUrl: string; folderId: string; changeCount: number};

const FolderNode = ({channel, item, depth, channelUrl, folderId, changeCount}: FolderNodeProps) => {
    const [open, setOpen] = useState(false);
    const subfolders = useSubfolders(channel.id, item.id, open, changeCount);
    return (
        <TreeRow
            depth={depth}
            label={item.name}
            icon={<FolderOutlineIcon size={16}/>}
            to={`${channelUrl}/${item.id}`}
            active={folderId === item.id}
            expanded={open}
            onToggle={() => setOpen(!open)}
        >
            {subfolders.map((sub) => (
                <FolderNode
                    key={sub.id}
                    channel={channel}
                    item={sub}
                    depth={depth + 1}
                    channelUrl={channelUrl}
                    folderId={folderId}
                    changeCount={changeCount}
                />
            ))}
        </TreeRow>
    );
};

type ChannelNodeProps = {channel: Channel; baseUrl: string; current: boolean; folderId: string; changeCount: number};

const ChannelNode = ({channel, baseUrl, current, folderId, changeCount}: ChannelNodeProps) => {
    const intl = useIntl();
    const [open, setOpen] = useState(current);
    useEffect(() => {
        if (current) {
            setOpen(true);
        }
    }, [current]);
    const folders = useSubfolders(channel.id, '', open, current ? changeCount : 0);
    const channelUrl = `${baseUrl}/${channel.name}`;
    return (
        <TreeRow
            depth={1}
            label={channel.display_name}
            icon={channel.type === 'P' ? <LockOutlineIcon size={16}/> : <GlobeIcon size={16}/>}
            to={channelUrl}
            active={current && !folderId}
            expanded={open}
            onToggle={() => setOpen(!open)}
        >
            <TreeRow
                depth={2}
                label={intl.formatMessage({id: 'file_explorer.chatAttachments', defaultMessage: 'Chat attachments'})}
                icon={<MessageTextOutlineIcon size={16}/>}
                to={`${channelUrl}/${CHAT_FOLDER}`}
                active={current && folderId === CHAT_FOLDER}
            />
            {folders.map((item) => (
                <FolderNode
                    key={item.id}
                    channel={channel}
                    item={item}
                    depth={2}
                    channelUrl={channelUrl}
                    folderId={current ? folderId : ''}
                    changeCount={current ? changeCount : 0}
                />
            ))}
            <TreeRow
                depth={2}
                label={intl.formatMessage({id: 'file_explorer.recycleBin', defaultMessage: 'Recycle Bin'})}
                icon={<TrashCanOutlineIcon size={16}/>}
                to={`${channelUrl}/${TRASH_FOLDER}`}
                active={current && folderId === TRASH_FOLDER}
            />
        </TreeRow>
    );
};

const ExplorerTree = ({baseUrl, channels, channelId, folderId, changeCount}: Props) => {
    const intl = useIntl();
    return (
        <nav
            className='ExplorerTree'
            aria-label={intl.formatMessage({id: 'file_explorer.tree', defaultMessage: 'Folders'})}
        >
            <ul role='tree'>
                <TreeRow
                    depth={0}
                    label={intl.formatMessage({id: 'file_explorer.title', defaultMessage: 'Files'})}
                    icon={<FolderOutlineIcon size={16}/>}
                    to={baseUrl}
                    active={!channelId}
                    expanded={true}
                >
                    {channels.map((channel) => (
                        <ChannelNode
                            key={channel.id}
                            channel={channel}
                            baseUrl={baseUrl}
                            current={channel.id === channelId}
                            folderId={folderId}
                            changeCount={changeCount}
                        />
                    ))}
                </TreeRow>
            </ul>
        </nav>
    );
};

export default ExplorerTree;
