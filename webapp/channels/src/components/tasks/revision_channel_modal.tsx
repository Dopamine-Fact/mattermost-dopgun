// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {createRevisionChannel} from 'actions/tasks';

import {getHistory} from 'utils/browser_history';

import './tasks.scss';

type Props = {
    onExited: () => void;
};

// RevisionChannelModal creates a revision channel: a chat channel with a video whose revisions are tasks.
const RevisionChannelModal = ({onExited}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const [show, setShow] = useState(true);
    const [name, setName] = useState('');
    const [video, setVideo] = useState<File>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const create = async () => {
        if (!team || !name.trim() || !video || busy) {
            return;
        }
        setBusy(true);
        setError('');
        const result = await dispatch(createRevisionChannel(team.id, name.trim(), video));
        setBusy(false);
        if (result.error || !result.data) {
            setError(result.error?.message ?? '');
            return;
        }
        getHistory().push(`/${team.name}/channels/${result.data.name}`);
        setShow(false);
    };

    return (
        <GenericModal
            id='revisionChannelModal'
            className='RevisionChannelModal'
            modalHeaderText={formatMessage({id: 'tasks.revisionChannelModal.title', defaultMessage: 'Create revision channel'})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={create}
            confirmButtonText={formatMessage({id: 'tasks.revisionChannelModal.create', defaultMessage: 'Create'})}
            isConfirmDisabled={!name.trim() || !video || busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <div className='RevisionChannelModal__body'>
                <label htmlFor='revisionChannelName'>
                    <FormattedMessage
                        id='tasks.revisionChannelModal.name'
                        defaultMessage='Name'
                    />
                </label>
                <input
                    id='revisionChannelName'
                    className='form-control'
                    value={name}
                    maxLength={64}
                    onChange={(e) => setName(e.target.value)}
                />
                <label htmlFor='revisionChannelVideo'>
                    <FormattedMessage
                        id='tasks.revisionChannelModal.video'
                        defaultMessage='Video'
                    />
                </label>
                <input
                    id='revisionChannelVideo'
                    type='file'
                    accept='video/mp4,video/webm,video/ogg,video/quicktime,.m4v'
                    onChange={(e) => setVideo(e.target.files?.[0])}
                />
            </div>
        </GenericModal>
    );
};

export default RevisionChannelModal;
