// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {createEpisodeChannel} from 'actions/tasks';

import {getHistory} from 'utils/browser_history';

import './tasks.scss';

type Props = {
    onExited: () => void;
};

// EpisodeChannelModal creates an episode: a revision channel that is also a canvas, seeded from the team's templates.
const EpisodeChannelModal = ({onExited}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const [show, setShow] = useState(true);
    const [name, setName] = useState('');
    const [video, setVideo] = useState<File>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // Set once the channel exists but some template lines could not be added; closing then opens the channel.
    const [failed, setFailed] = useState<string[]>([]);
    const [channelUrl, setChannelUrl] = useState('');

    const close = () => {
        if (channelUrl) {
            getHistory().push(channelUrl);
        }
        setShow(false);
    };

    const create = async () => {
        if (!team || !name.trim() || busy) {
            return;
        }
        setBusy(true);
        setError('');
        const result = await dispatch(createEpisodeChannel(team.id, name.trim(), video));
        setBusy(false);
        if (result.error || !result.data) {
            setError(result.error?.message ?? '');
            return;
        }
        const url = `/${team.name}/channels/${result.data.channel.name}`;
        if (result.data.failed.length) {
            setChannelUrl(url);
            setFailed(result.data.failed);
            return;
        }
        getHistory().push(url);
        setShow(false);
    };

    if (channelUrl) {
        return (
            <GenericModal
                id='episodeChannelModal'
                className='RevisionChannelModal'
                modalHeaderText={formatMessage({id: 'tasks.episodeChannelModal.title', defaultMessage: 'Create episode channel'})}
                show={show}
                onExited={onExited}
                onHide={close}
                handleConfirm={close}
                confirmButtonText={formatMessage({id: 'tasks.episodeChannelModal.open', defaultMessage: 'Open channel'})}
                compassDesign={true}
            >
                <div className='RevisionChannelModal__body'>
                    <FormattedMessage
                        id='tasks.episodeChannelModal.failed'
                        defaultMessage='The channel was created, but these could not be added:'
                    />
                    <ul>
                        {failed.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </div>
            </GenericModal>
        );
    }

    return (
        <GenericModal
            id='episodeChannelModal'
            className='RevisionChannelModal'
            modalHeaderText={formatMessage({id: 'tasks.episodeChannelModal.title', defaultMessage: 'Create episode channel'})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={create}
            confirmButtonText={formatMessage({id: 'tasks.revisionChannelModal.create', defaultMessage: 'Create'})}
            isConfirmDisabled={!name.trim() || busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <div className='RevisionChannelModal__body'>
                <label htmlFor='episodeChannelName'>
                    <FormattedMessage
                        id='tasks.revisionChannelModal.name'
                        defaultMessage='Name'
                    />
                </label>
                <input
                    id='episodeChannelName'
                    className='form-control'
                    value={name}
                    maxLength={64}
                    onChange={(e) => setName(e.target.value)}
                />
                <label htmlFor='episodeChannelVideo'>
                    <FormattedMessage
                        id='tasks.episodeChannelModal.video'
                        defaultMessage='Video (optional)'
                    />
                </label>
                <input
                    id='episodeChannelVideo'
                    type='file'
                    accept='video/mp4,video/webm,video/ogg,video/quicktime,.m4v'
                    onChange={(e) => setVideo(e.target.files?.[0])}
                />
            </div>
        </GenericModal>
    );
};

export default EpisodeChannelModal;
