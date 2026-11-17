// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage} from 'react-intl';

import {UploadOutlineIcon} from '@mattermost/compass-icons/components';

/** The hint shown while files from the computer are dragged over a folder. */
const ExplorerDropOverlay = ({location}: {location: string}) => (
    <div
        className='ExplorerDropOverlay'
        aria-hidden={true}
    >
        <UploadOutlineIcon size={18}/>
        <FormattedMessage
            id='file_explorer.dropTo'
            defaultMessage='Drop to upload to {location}'
            values={{location}}
        />
    </div>
);

export default ExplorerDropOverlay;
