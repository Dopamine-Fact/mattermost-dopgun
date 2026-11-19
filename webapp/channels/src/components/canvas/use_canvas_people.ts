// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {getMissingProfilesByIds, getProfilesInChannel} from 'mattermost-redux/actions/users';
import {Client4} from 'mattermost-redux/client';
import {makeGetProfilesInChannel} from 'mattermost-redux/selectors/entities/users';

import type {GlobalState} from 'types/store';

import {isId} from './model';
import type {CanvasElement} from './model';

/**
 * Loads everyone the board names, read-only viewers included: the channel's members, the uploader of the selected image
 * (from its file info; a fetch that fails just leaves the line out) and every owner and author, who need not be members.
 */
export function useCanvasPeople(channelId: string, els: CanvasElement[], fileId?: string) {
    const dispatch = useDispatch();
    const getChannelProfiles = useMemo(() => makeGetProfilesInChannel(), []);
    const members = useSelector((s: GlobalState) => getChannelProfiles(s, channelId));

    // Uploader user id by file id.
    const [uploaders, setUploaders] = useState<Record<string, string>>({});
    const fetchedRef = useRef(new Set<string>());
    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        dispatch(getProfilesInChannel(channelId, 0, 200));
        return () => {
            aliveRef.current = false;
        };
    }, [dispatch, channelId]);

    useEffect(() => {
        if (!fileId || fetchedRef.current.has(fileId)) {
            return;
        }
        fetchedRef.current.add(fileId);
        Client4.getFileInfo(fileId).then((info) => {
            if (aliveRef.current) {
                setUploaders((u) => ({...u, [fileId]: info.user_id}));
            }
        }).catch(() => {});
    }, [fileId]);

    // Keyed on the sorted ids, so a move or an edit that names nobody new fetches nothing.
    const ids = useMemo(() => [...new Set([...els.flatMap((el) => [el.ownerId, el.createdBy, el.updatedBy]), ...Object.values(uploaders)])].
        filter(isId).sort().join(','), [els, uploaders]);
    useEffect(() => {
        if (ids) {
            dispatch(getMissingProfilesByIds(ids.split(',')));
        }
    }, [dispatch, ids]);

    return {members, uploaderId: fileId ? uploaders[fileId] : undefined};
}
