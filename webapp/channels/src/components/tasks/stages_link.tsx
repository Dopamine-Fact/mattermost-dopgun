// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link, matchPath, useLocation, useRouteMatch} from 'react-router-dom';

import {FlagCheckeredIcon} from '@mattermost/compass-icons/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {useCanSeeStages} from './task_bits';

// StagesLink opens the stages page, for the users who may see stages; it follows TasksLink.
const StagesLink = () => {
    const {url} = useRouteMatch();
    const {pathname} = useLocation();
    const team = useSelector(getCurrentTeam);
    const canSee = useCanSeeStages(team?.id ?? '');

    if (!team?.tasks_enabled || !canSee) {
        return null;
    }

    return (
        <ul className='SidebarTasks NavGroupContent nav nav-pills__container'>
            <li
                id='sidebar-stages-button'
                className={classNames('SidebarChannel', {active: matchPath(pathname, {path: '/:team/stages'}) != null})}
                tabIndex={-1}
            >
                <Link
                    to={`${url}/stages`}
                    id='sidebarItem_stages'
                    draggable='false'
                    className='SidebarLink sidebar-item'
                    tabIndex={0}
                >
                    <span className='icon'>
                        <FlagCheckeredIcon size={18}/>
                    </span>
                    <div className='SidebarChannelLinkLabel_wrapper'>
                        <span className='SidebarChannelLinkLabel sidebar-item__name'>
                            <FormattedMessage
                                id='tasks.view.stages'
                                defaultMessage='Stages'
                            />
                        </span>
                    </div>
                </Link>
            </li>
        </ul>
    );
};

export default StagesLink;
