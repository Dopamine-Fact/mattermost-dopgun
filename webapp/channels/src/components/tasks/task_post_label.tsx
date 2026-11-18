// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {Link} from 'react-router-dom';

import type {Post} from '@mattermost/types/posts';

import {getChannel} from 'mattermost-redux/selectors/entities/channels';
import {getTask} from 'mattermost-redux/selectors/entities/tasks';
import {getTeam} from 'mattermost-redux/selectors/entities/teams';

import type {GlobalState} from 'types/store';

import './task_post_label.scss';

// TaskPostLabel names the task a message is about and opens it in the channel's Revisions or Tasks tab.
// shortcut: a task not yet loaded shows as deleted until fetchTeamTasks finishes.
const TaskPostLabel = ({post}: {post: Post}) => {
    const {formatMessage} = useIntl();
    const taskId = typeof post.props?.task_id === 'string' ? post.props.task_id : '';
    const task = useSelector((state: GlobalState) => getTask(state, taskId));
    const channel = useSelector((state: GlobalState) => getChannel(state, post.channel_id));
    const team = useSelector((state: GlobalState) => (channel ? getTeam(state, channel.team_id) : undefined));

    if (!task) {
        return (
            <span className='TaskPostLabel TaskPostLabel--deleted'>
                <FormattedMessage
                    id='tasks.postLabel.deleted'
                    defaultMessage='Deleted task'
                />
            </span>
        );
    }
    if (!channel || !team) {
        return <span className='TaskPostLabel'>{task.title}</span>;
    }
    const query = task.video_file_id ? `revision=${task.id}` : `task=${task.id}`;
    return (
        <Link
            className='TaskPostLabel'
            to={`/${team.name}/channels/${channel.name}?${query}`}
            title={formatMessage({id: 'tasks.postLabel.open', defaultMessage: 'Open task'})}
        >
            {task.title}
        </Link>
    );
};

export default TaskPostLabel;
