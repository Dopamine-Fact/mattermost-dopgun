// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';

import {fileSizeToString} from 'utils/utils';

import {totalSize} from './explorer_preview_pane';
import type {ExplorerEntry} from './use_explorer_data';

type Props = {
    count: number;
    selected: ExplorerEntry[];

    /** Upload progress summary, added by the upload feature. */
    children?: React.ReactNode;
};

const ExplorerStatusBar = ({count, selected, children}: Props) => (
    <div
        className='ExplorerStatusBar'
        role='status'
    >
        <FormattedMessage
            id='file_explorer.status.items'
            defaultMessage='{count, plural, one {# item} other {# items}}'
            values={{count}}
        />
        {selected.length > 0 && (
            <>
                {' · '}
                <FormattedMessage
                    id='file_explorer.status.selected'
                    defaultMessage='{count} selected ({size})'
                    values={{count: selected.length, size: fileSizeToString(totalSize(selected))}}
                />
            </>
        )}
        {children}
    </div>
);

export default ExplorerStatusBar;
