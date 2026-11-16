// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link, matchPath, useLocation, useRouteMatch} from 'react-router-dom';

import {CheckboxMarkedCircleOutlineIcon} from '@mattermost/compass-icons/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

const TasksLink = () => {
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const team = useSelector(getCurrentTeam);

    if (!team?.tasks_enabled) {
        return null;
    }

    const inTasks = matchPath(pathname, {path: '/:team/tasks'}) != null;

    return (
        <ul className='SidebarTasks NavGroupContent nav nav-pills__container'>
            <li
                id='sidebar-tasks-button'
                className={classNames('SidebarChannel', {active: inTasks})}
                tabIndex={-1}
            >
                <Link
                    to={`${url}/tasks`}
                    id='sidebarItem_tasks'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                >
                    <span className='icon'>
                        <CheckboxMarkedCircleOutlineIcon size={18}/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            <FormattedMessage
                                id='tasks.sidebarLink'
                                defaultMessage='Tasks'
                            />
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
};

export default TasksLink;
