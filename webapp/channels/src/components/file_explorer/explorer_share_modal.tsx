// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {DriveItem} from '@mattermost/types/drive';

import {Client4} from 'mattermost-redux/client';
import {getCurrentTeamId, getMyTeams} from 'mattermost-redux/selectors/entities/teams';

type Props = {
    channelId: string;
    item: DriveItem;
    onExited: () => void;
};

// ExplorerShareModal picks the other teams a projects folder shows in, read-only.
const ExplorerShareModal = ({channelId, item, onExited}: Props) => {
    const {formatMessage} = useIntl();
    const currentTeamId = useSelector(getCurrentTeamId);
    const teams = useSelector(getMyTeams).filter((t) => t.id !== currentTeamId && t.delete_at === 0).sort((a, b) => a.display_name.localeCompare(b.display_name));
    const [show, setShow] = useState(true);
    const [picked, setPicked] = useState<Set<string>>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        Client4.getDriveShares(channelId, item.id).then((s) => setPicked(new Set(s.team_ids)), (err) => {
            setPicked(new Set());
            setError(err?.message || String(err));
        });
    }, [channelId, item.id]);

    const save = async () => {
        if (!picked || busy) {
            return;
        }
        setBusy(true);
        setError('');
        try {
            await Client4.setDriveShares(channelId, item.id, [...picked]);
            setShow(false);
        } catch (err) {
            setError((err as Error)?.message || String(err));
        } finally {
            setBusy(false);
        }
    };

    const toggle = (id: string) => setPicked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) {
            next.add(id);
        }
        return next;
    });

    return (
        <GenericModal
            id='fileExplorerShareModal'
            className='ExplorerShareModal'
            modalHeaderText={formatMessage({id: 'file_explorer.share.title', defaultMessage: 'Share "{name}" with teams'}, {name: item.name})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={save}
            confirmButtonText={formatMessage({id: 'file_explorer.share.save', defaultMessage: 'Save'})}
            isConfirmDisabled={!picked || busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <p>
                <FormattedMessage
                    id='file_explorer.share.info'
                    defaultMessage='The folder shows in the projects folder of the teams you pick. Their members can view and download it but not change it.'
                />
            </p>
            {teams.length === 0 && (
                <p>
                    <FormattedMessage
                        id='file_explorer.share.noTeams'
                        defaultMessage='You are not a member of any other team.'
                    />
                </p>
            )}
            {picked && teams.map((t) => (
                <div
                    key={t.id}
                    className='checkbox'
                >
                    <label>
                        <input
                            type='checkbox'
                            checked={picked.has(t.id)}
                            onChange={() => toggle(t.id)}
                        />
                        {t.display_name}
                    </label>
                </div>
            ))}
        </GenericModal>
    );
};

export default ExplorerShareModal;
