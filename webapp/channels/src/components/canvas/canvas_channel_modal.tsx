// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';

import {getCurrentTeam} from 'mattermost-redux/selectors/entities/teams';

import {createCanvasChannel} from 'actions/canvas';

import {getHistory} from 'utils/browser_history';

import '../tasks/tasks.scss';

type Props = {
    onExited: () => void;
};

// CanvasChannelModal creates a canvas channel: a chat channel with a whiteboard tab.
const CanvasChannelModal = ({onExited}: Props) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const team = useSelector(getCurrentTeam);
    const [show, setShow] = useState(true);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const create = async () => {
        if (!team || !name.trim() || busy) {
            return;
        }
        setBusy(true);
        setError('');
        const result = await dispatch(createCanvasChannel(team.id, name.trim()));
        setBusy(false);
        if (result.error || !result.data) {
            setError(result.error?.message ?? '');
            return;
        }
        getHistory().push(`/${team.name}/channels/${result.data.name}?canvas=1`);
        setShow(false);
    };

    return (
        <GenericModal
            id='canvasChannelModal'
            className='RevisionChannelModal'
            modalHeaderText={formatMessage({id: 'canvas.channelModal.title', defaultMessage: 'Create canvas channel'})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={create}
            confirmButtonText={formatMessage({id: 'canvas.channelModal.create', defaultMessage: 'Create'})}
            isConfirmDisabled={!name.trim() || busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <div className='RevisionChannelModal__body'>
                <label htmlFor='canvasChannelName'>
                    <FormattedMessage
                        id='canvas.channelModal.name'
                        defaultMessage='Name'
                    />
                </label>
                <input
                    id='canvasChannelName'
                    className='form-control'
                    value={name}
                    maxLength={64}
                    onChange={(e) => setName(e.target.value)}
                />
            </div>
        </GenericModal>
    );
};

export default CanvasChannelModal;
