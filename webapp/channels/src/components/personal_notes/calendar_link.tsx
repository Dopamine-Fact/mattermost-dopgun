// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link, matchPath, useLocation, useRouteMatch} from 'react-router-dom';

import {CalendarOutlineIcon} from '@mattermost/compass-icons/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

const CalendarLink = () => {
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const team = useSelector(getCurrentTeam);

    if (!team?.notes_enabled) {
        return null;
    }

    const inCalendar = matchPath(pathname, {path: '/:team/calendar'}) != null;

    return (
        <ul className='SidebarCalendar NavGroupContent nav nav-pills__container'>
            <li
                id='sidebar-calendar-button'
                className={classNames('SidebarChannel', {active: inCalendar})}
                tabIndex={-1}
            >
                <Link
                    to={`${url}/calendar`}
                    id='sidebarItem_calendar'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                >
                    <span className='icon'>
                        <CalendarOutlineIcon size={18}/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            <FormattedMessage
                                id='personal_notes.sidebarLink'
                                defaultMessage='Calendar'
                            />
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
};

export default CalendarLink;
