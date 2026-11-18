// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import type {PostList} from '@mattermost/types/posts';

import {makeGetTaskRootPosts} from 'mattermost-redux/selectors/entities/tasks';

import {fetchTaskPosts} from 'actions/tasks';

import PostSearchResultsItem from 'components/search_results/post_search_results_item';

import type {GlobalState} from 'types/store';

const PAGE_SIZE = 60;

type Props = {
    taskId: string;
    channelId?: string;
};

// TaskPostList shows one task's messages oldest first, a page at a time; replies open in the RHS like search results.
const TaskPostList = ({taskId, channelId}: Props) => {
    const dispatch = useDispatch();
    const getTaskRootPosts = useMemo(() => makeGetTaskRootPosts(), []);
    const posts = useSelector((state: GlobalState) => getTaskRootPosts(state, taskId, channelId));

    // The cursor is the oldest message of the last page fetched, not of the store, which may hold older messages
    // loaded elsewhere and would skip the ones between.
    const [cursor, setCursor] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const request = useRef(0);

    const load = async (before?: number) => {
        const id = ++request.current;
        const {data} = await dispatch(fetchTaskPosts(taskId, {channelId, before, perPage: PAGE_SIZE})) as {data?: PostList};
        if (id !== request.current || !data) {
            return;
        }
        const page = Object.values(data.posts);
        setHasMore(page.length >= PAGE_SIZE);
        if (page.length) {
            setCursor(Math.min(...page.map((p) => p.create_at)));
        }
    };

    useEffect(() => {
        setHasMore(false);
        setCursor(0);
        load();
    }, [taskId, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!posts.length) {
        return null;
    }

    return (
        <div className='TaskPostList'>
            {hasMore && (
                <button
                    className='btn btn-tertiary btn-sm TaskPostList__older'
                    onClick={() => load(cursor)}
                >
                    <FormattedMessage
                        id='tasks.posts.loadOlder'
                        defaultMessage='Load older'
                    />
                </button>
            )}
            {posts.map((post, i) => (
                <PostSearchResultsItem
                    key={post.id}
                    post={post}
                    a11yIndex={i}
                    isFlaggedPosts={false}
                    isMentionSearch={false}
                    isPinnedPosts={false}
                    matches={[]}
                    searchTerm=''
                />
            ))}
        </div>
    );
};

export default TaskPostList;
