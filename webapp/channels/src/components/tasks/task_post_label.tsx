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
// A missing task counts as deleted only once the team's task lists are in (they arrive with its tasks); before that
// the label waits. shortcut: a team whose lists are all gone shows nothing for its old messages; track loaded teams if
// that matters.
const TaskPostLabel = ({post}: {post: Post}) => {
    const {formatMessage} = useIntl();
    const taskId = typeof post.props?.task_id === 'string' ? post.props.task_id : '';
    const task = useSelector((state: GlobalState) => getTask(state, taskId));
    const channel = useSelector((state: GlobalState) => getChannel(state, post.channel_id));
    const team = useSelector((state: GlobalState) => (channel ? getTeam(state, channel.team_id) : undefined));
    const teamTasksLoaded = useSelector((state: GlobalState) => Boolean(channel) && Object.values(state.entities.tasks.sectionsById).some((s) => s.team_id === channel!.team_id));

    if (!task && !teamTasksLoaded) {
        return null;
    }
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
