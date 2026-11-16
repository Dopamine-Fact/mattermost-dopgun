// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link} from 'react-router-dom';

import type {Post} from '@mattermost/types/posts';

import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTask} from 'mattermost-redux/selectors/entities/tasks';
import {getTeam} from 'mattermost-redux/selectors/entities/teams';

import Markdown from 'components/markdown';

import type {GlobalState} from 'types/store';

import {AssigneeLabel, StatusSelect} from './task_bits';
import {formatVideoTime} from './task_utils';

import './tasks.scss';

// RevisionPost draws a revision channel's chat card for one revision from the live task,
// so its status colour, assignee and title follow every change; the posted text is the fallback.
const RevisionPost = ({post}: {post: Post}) => {
    const taskId = typeof post.props?.task_id === 'string' ? post.props.task_id : '';
    const task = useSelector((state: GlobalState) => getTask(state, taskId));
    const assignee = useSelector((state: GlobalState) => (task?.assignee_id ? state.entities.users.profiles[task.assignee_id] : undefined));
    const channel = useSelector((state: GlobalState) => getChannel(state, post.channel_id));
    const team = useSelector((state: GlobalState) => (channel ? getTeam(state, channel.team_id) : undefined));

    if (!task || !channel || !team) {
        return <Markdown message={post.message}/>;
    }

    return (
        <div className={classNames('RevisionPost', `TaskStatus--${task.status}`)}>
            <div className='RevisionPost__label'>
                <FormattedMessage
                    id='tasks.revisionPost.label'
                    defaultMessage='New revision'
                />
                <span className='RevisionPost__time'>{formatVideoTime(task.video_time)}</span>
            </div>
            <Link
                className='RevisionPost__title'
                to={`/${team.name}/channels/${channel.name}?revision=${task.id}`}
            >
                {task.title}
            </Link>
            <div className='RevisionPost__meta'>
                <AssigneeLabel user={assignee}/>
                <StatusSelect task={task}/>
            </div>
        </div>
    );
};

export default RevisionPost;
