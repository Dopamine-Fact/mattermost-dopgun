// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {Link, matchPath, useLocation, useRouteMatch} from 'react-router-dom';

import {HomeVariantOutlineIcon} from '@mattermost/compass-icons/components';

const DashboardLink = () => {
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const inDashboard = matchPath(pathname, {path: '/:team/dashboard'}) != null;

    return (
        <ul className='SidebarDashboard NavGroupContent nav nav-pills__container'>
            <li
                id='sidebar-dashboard-button'
                className={classNames('SidebarChannel', {active: inDashboard})}
                tabIndex={-1}
            >
                <Link
                    to={`${url}/dashboard`}
                    id='sidebarItem_dashboard'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                >
                    <span className='icon'>
                        <HomeVariantOutlineIcon size={18}/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            <FormattedMessage
                                id='dashboard.sidebarLink'
                                defaultMessage='Dashboard'
                            />
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
};

export default DashboardLink;
