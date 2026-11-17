// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {CloseIcon} from '@mattermost/compass-icons/components';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {ProgressBar} from '@mattermost/compass-ui/components/progress-bar';

import type {Upload} from './use_explorer_uploads';

type Props = {
    uploads: Upload[];
    onCancel: (id: string) => void;
    onClose: () => void;
};

/** Bottom-right list of uploads with progress, errors and cancel. */
const ExplorerUploadPanel = ({uploads, onCancel, onClose}: Props) => {
    const intl = useIntl();
    if (!uploads.length) {
        return null;
    }
    const active = uploads.some((u) => u.status === 'queued' || u.status === 'uploading');
    const done = uploads.filter((u) => u.status === 'done').length;
    const title = intl.formatMessage({id: 'file_explorer.uploads', defaultMessage: 'Uploads'});

    const status = (u: Upload) => {
        switch (u.status) {
        case 'uploading': return (
            <ProgressBar
                size='small'
                value={u.percent}
                aria-label={u.name}
            />
        );
        case 'error': return <span className='ExplorerUploadPanel__error'>{u.error}</span>;
        case 'cancelled': return (
            <FormattedMessage
                id='file_explorer.uploads.cancelled'
                defaultMessage='Cancelled'
            />
        );
        case 'done': return (
            <FormattedMessage
                id='file_explorer.uploads.done'
                defaultMessage='Uploaded'
            />
        );
        default: return (
            <FormattedMessage
                id='file_explorer.uploads.queued'
                defaultMessage='Waiting'
            />
        );
        }
    };

    return (
        <section
            className='ExplorerUploadPanel'
            aria-label={title}
        >
            <header className='ExplorerUploadPanel__header'>
                <span role='status'>
                    <FormattedMessage
                        id='file_explorer.uploads.progress'
                        defaultMessage='{done} of {total} uploaded'
                        values={{done, total: uploads.length}}
                    />
                </span>
                {!active && (
                    <IconButton
                        size='x-small'
                        icon={<Icon glyph={<CloseIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'file_explorer.uploads.close', defaultMessage: 'Close uploads'})}
                        onClick={onClose}
                    />
                )}
            </header>
            <ul>
                {uploads.map((u) => (
                    <li key={u.id}>
                        <div className='ExplorerUploadPanel__name'>
                            <span title={u.name}>{u.name}</span>
                            {(u.status === 'queued' || u.status === 'uploading') && (
                                <IconButton
                                    size='x-small'
                                    icon={<Icon glyph={<CloseIcon/>}/>}
                                    aria-label={intl.formatMessage({id: 'file_explorer.uploads.cancel', defaultMessage: 'Cancel upload of {name}'}, {name: u.name})}
                                    onClick={() => onCancel(u.id)}
                                />
                            )}
                        </div>
                        <div className='ExplorerUploadPanel__status'>{status(u)}</div>
                    </li>
                ))}
            </ul>
        </section>
    );
};

export default ExplorerUploadPanel;
