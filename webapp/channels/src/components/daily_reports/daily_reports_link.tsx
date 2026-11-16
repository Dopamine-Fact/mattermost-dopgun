// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link, matchPath, useLocation, useRouteMatch} from 'react-router-dom';

import {FileTextOutlineIcon} from '@mattermost/compass-icons/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

const DailyReportsLink = () => {
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const team = useSelector(getCurrentTeam);

    if (!team?.daily_reports_enabled) {
        return null;
    }

    const inDailyReports = matchPath(pathname, {path: '/:team/daily_reports'}) != null;

    return (
        <ul className='SidebarDailyReports NavGroupContent nav nav-pills__container'>
            <li
                id='sidebar-daily-reports-button'
                className={classNames('SidebarChannel', {active: inDailyReports})}
                tabIndex={-1}
            >
                <Link
                    to={`${url}/daily_reports`}
                    id='sidebarItem_daily_reports'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                >
                    <span className='icon'>
                        <FileTextOutlineIcon size={18}/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            <FormattedMessage
                                id='daily_reports.sidebarLink'
                                defaultMessage='Daily reports'
                            />
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
};

export default DailyReportsLink;
