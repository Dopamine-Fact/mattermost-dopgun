// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link, matchPath, useLocation, useRouteMatch} from 'react-router-dom';

import {FolderOutlineIcon} from '@mattermost/compass-icons/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

const FileExplorerLink = () => {
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const team = useSelector(getCurrentTeam);

    if (!team?.files_enabled) {
        return null;
    }

    const inFiles = matchPath(pathname, {path: '/:team/files'}) != null;

    return (
        <ul className='SidebarFiles NavGroupContent nav nav-pills__container'>
            <li
                id='sidebar-files-button'
                className={classNames('SidebarChannel', {active: inFiles})}
                tabIndex={-1}
            >
                <Link
                    to={`${url}/files`}
                    id='sidebarItem_files'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                >
                    <span className='icon'>
                        <FolderOutlineIcon size={18}/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            <FormattedMessage
                                id='file_explorer.sidebarLink'
                                defaultMessage='Files'
                            />
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
};

export default FileExplorerLink;
