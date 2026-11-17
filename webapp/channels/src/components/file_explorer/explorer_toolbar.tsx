// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {AppsIcon, EyeOutlineIcon, FormatListBulletedIcon, RefreshIcon} from '@mattermost/compass-icons/components';

import type {ExplorerView} from './explorer_items';

type Props = {
    view: ExplorerView;
    onViewChange: (view: ExplorerView) => void;
    previewOpen: boolean;
    onTogglePreview: () => void;
    onRefresh: () => void;

    /** Actions added by later features (file operations, upload) render first. */
    children?: React.ReactNode;
};

const ExplorerToolbar = ({view, onViewChange, previewOpen, onTogglePreview, onRefresh, children}: Props) => {
    const intl = useIntl();
    const button = (label: string, icon: React.ReactNode, onClick: () => void, pressed?: boolean) => (
        <button
            type='button'
            className={classNames('ExplorerToolbar__button', {active: pressed})}
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            onClick={onClick}
        >
            {icon}
        </button>
    );

    return (
        <div
            className='ExplorerToolbar'
            role='toolbar'
            aria-label={intl.formatMessage({id: 'file_explorer.toolbar', defaultMessage: 'File actions'})}
        >
            <h1 className='ExplorerToolbar__title'>
                <FormattedMessage
                    id='file_explorer.title'
                    defaultMessage='Files'
                />
            </h1>
            {children}
            <span className='ExplorerToolbar__spacer'/>
            {button(intl.formatMessage({id: 'file_explorer.refresh', defaultMessage: 'Refresh'}), <RefreshIcon size={18}/>, onRefresh)}
            {button(intl.formatMessage({id: 'file_explorer.view.icons', defaultMessage: 'Large icons'}), <AppsIcon size={18}/>, () => onViewChange('icons'), view === 'icons')}
            {button(intl.formatMessage({id: 'file_explorer.view.details', defaultMessage: 'Details'}), <FormatListBulletedIcon size={18}/>, () => onViewChange('details'), view === 'details')}
            {button(intl.formatMessage({id: 'file_explorer.previewPane', defaultMessage: 'Preview pane'}), <EyeOutlineIcon size={18}/>, onTogglePreview, previewOpen)}
        </div>
    );
};

export default ExplorerToolbar;
