// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {getFileDownloadUrl, getFilePreviewUrl} from 'mattermost-redux/utils/file_utils';

import {fileSizeToString} from 'utils/utils';

import {EntryIcon, entryCreator, entryModified, entryType} from './explorer_items';
import type {ExplorerEntry} from './use_explorer_data';

type Props = {
    entries: ExplorerEntry[];
    onOpen: (entry: ExplorerEntry) => void;
    getUserName: (userId: string) => string;
};

export const totalSize = (entries: ExplorerEntry[]) => entries.reduce((sum, e) => sum + (e.fileInfo?.size ?? 0), 0);

const ExplorerPreviewPane = ({entries, onOpen, getUserName}: Props) => {
    const intl = useIntl();
    const label = intl.formatMessage({id: 'file_explorer.preview', defaultMessage: 'Preview'});

    if (entries.length !== 1) {
        return (
            <aside
                className='ExplorerPreview ExplorerPreview--empty'
                aria-label={label}
            >
                {entries.length === 0 ? (
                    <FormattedMessage
                        id='file_explorer.preview.none'
                        defaultMessage='Select a file to see its preview.'
                    />
                ) : (
                    <FormattedMessage
                        id='file_explorer.preview.many'
                        defaultMessage='{count} items selected · {size}'
                        values={{count: entries.length, size: fileSizeToString(totalSize(entries))}}
                    />
                )}
            </aside>
        );
    }

    const [entry] = entries;
    const info = entry.fileInfo;
    const modified = entryModified(entry);
    const rows: Array<[string, string]> = [
        [intl.formatMessage({id: 'file_explorer.column.type', defaultMessage: 'Type'}), entryType(entry, intl)],
    ];
    if (info) {
        rows.push([intl.formatMessage({id: 'file_explorer.column.size', defaultMessage: 'Size'}), fileSizeToString(info.size)]);
        if (info.width && info.height) {
            rows.push([intl.formatMessage({id: 'file_explorer.dimensions', defaultMessage: 'Dimensions'}), `${info.width} × ${info.height}`]);
        }
    }
    const creator = getUserName(entryCreator(entry));
    if (creator) {
        rows.push([intl.formatMessage({id: 'file_explorer.column.creator', defaultMessage: 'Uploaded by'}), creator]);
    }
    if (modified) {
        rows.push([intl.formatMessage({id: 'file_explorer.column.modified', defaultMessage: 'Date modified'}), intl.formatDate(modified, {dateStyle: 'medium', timeStyle: 'short'})]);
    }

    return (
        <aside
            className='ExplorerPreview'
            aria-label={label}
        >
            <div className='ExplorerPreview__image'>
                {info?.has_preview_image ? (
                    <img
                        src={getFilePreviewUrl(info.id)}
                        alt={entry.name}
                    />
                ) : (
                    <EntryIcon
                        entry={entry}
                        large={true}
                    />
                )}
            </div>
            <h2 className='ExplorerPreview__name'>{entry.name}</h2>
            <dl>
                {rows.map(([term, value]) => (
                    <React.Fragment key={term}>
                        <dt>{term}</dt>
                        <dd>{value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            <div className='ExplorerPreview__actions'>
                <button
                    type='button'
                    className='btn btn-primary btn-sm'
                    onClick={() => onOpen(entry)}
                >
                    <FormattedMessage
                        id='file_explorer.open'
                        defaultMessage='Open'
                    />
                </button>
                {info && (
                    <a
                        className='btn btn-tertiary btn-sm'
                        href={getFileDownloadUrl(info.id)}
                        download={entry.name}
                    >
                        <FormattedMessage
                            id='file_explorer.download'
                            defaultMessage='Download'
                        />
                    </a>
                )}
            </div>
        </aside>
    );
};

export default ExplorerPreviewPane;
